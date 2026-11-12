// Tablero de tareas: cada encargo pasa por pendiente → en progreso → espera de
// aprobación → (correcciones →) hecha. Un trabajador toma las pendientes y se
// las da al agente asignado cuando está libre; la revisión de Diego mueve la
// tarjeta. Lo usan Diego (pantalla Tablero) y el coordinador (herramientas).
import { randomUUID } from 'node:crypto';
import { state, broadcast, log, saveNow } from './state.mjs';
import { getAgent, getAgents, isPaused } from './settings.mjs';
import { isBlocked } from './cupo.mjs';

export const STATES = ['pendiente', 'en_progreso', 'espera', 'correcciones', 'hecha', 'cancelada'];
const PRIORITY = { alta: 0, media: 1, baja: 2 };

state.tasks ||= [];
// Un reinicio corta cualquier corrida: lo que estaba en progreso vuelve a la cola.
for (const t of state.tasks) if (t.status === 'en_progreso') t.status = 'pendiente';

function emit(t) {
  t.updatedAt = Date.now();
  broadcast({ type: 'task', task: t });
  saveNow();
}

const note = (t, by, text) => t.notes.push({ ts: Date.now(), by, text: String(text).slice(0, 2000) });

// Acepta id o nombre ("Lucía", "lucia", "video").
export function resolveAgent(who) {
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return getAgents().find((a) => norm(a.id) === norm(who) || norm(a.nombre) === norm(who)) || null;
}

export function createTask({ assignee, title, description = '', priority = 'media', createdBy = 'diego', avisar = false, pedidoDiego = false }) {
  const agent = resolveAgent(assignee);
  if (!agent && /p[ií]xel|luis|lupa|ashley|constructor|revisor|desarrollo/i.test(String(assignee))) throw new Error('Desarrollo (Luis y Ashley) no usa el tablero. Para ver sus proyectos usá desarrollo_estado y para pedirles trabajo, desarrollo_pedir.');
  if (!agent) throw new Error('Ese agente no existe.');
  if (typeof title !== 'string' || !title.trim()) throw new Error('La tarea necesita un título.');
  const t = {
    id: randomUUID(), title: title.trim().slice(0, 140), description: String(description).slice(0, 6000),
    assignee: agent.id, priority: PRIORITY[priority] != null ? priority : 'media', status: 'pendiente',
    createdBy, createdAt: Date.now(), updatedAt: Date.now(), deliverables: [], notes: [], runs: 0, awaitingVideo: false, avisar: Boolean(avisar), pedidoDiego: Boolean(pedidoDiego),
  };
  state.tasks.push(t);
  const from = createdBy === 'diego' ? 'Diego' : (getAgent(createdBy)?.nombre || createdBy);
  log(agent.id, `Nueva tarea de ${from}: ${t.title}`, 'start');
  emit(t);
  kick();
  return t;
}

// Tareas que Diego pidió que le avisen: el sistema le escribe al terminar (no depende de que Jarvis esté despierto ni del tope de avisos).
function avisarFin(t) {
  if (!t.avisar || t.avisado) return;
  t.avisado = Date.now();
  const quien = getAgent(t.assignee)?.nombre || t.assignee;
  const d = state.deliverables.find((x) => x.id === t.deliverables.at(-1));
  import('./ventas/whatsapp.mjs').then((wa) => wa.avisarDiego(`✅ *${quien}* terminó "${t.title}"${d ? `: ${d.title}` : ''}. Está esperando tu revisión en la oficina.`)).catch(() => {});
}

export const getTask = (id) => state.tasks.find((t) => t.id === id);
export const listTasks = () => state.tasks.slice(-300);

export function updateTask(id, patch = {}, by = 'diego') {
  const t = getTask(id);
  if (!t) throw new Error('Tarea no encontrada.');
  if ('status' in patch && !STATES.includes(patch.status)) throw new Error('Estado inválido.');
  if ('assignee' in patch) {
    const a = resolveAgent(patch.assignee);
    if (!a) throw new Error('Ese agente no existe.');
    t.assignee = a.id;
  }
  if ('priority' in patch && PRIORITY[patch.priority] != null) t.priority = patch.priority;
  if ('title' in patch && String(patch.title).trim()) t.title = String(patch.title).trim().slice(0, 140);
  if ('description' in patch) t.description = String(patch.description).slice(0, 6000);
  if ('status' in patch) t.status = patch.status;
  if (patch.note) note(t, by, patch.note);
  emit(t);
  kick();
  return t;
}

export function linkDeliverable(taskId, deliverableId, { video = false, terminada = false } = {}) {
  const t = getTask(taskId);
  if (!t) return;
  t.deliverables.push(deliverableId);
  // Un reporte (sin pregunta para Diego) cierra la tarea: él lo lee cuando quiera en la Bandeja.
  if (terminada && !t.awaitingVideo && t.status !== 'cancelada') { t.status = 'hecha'; log(t.assignee, `Tarea terminada: ${t.title}`, 'ok'); }
  if (video) {
    t.awaitingVideo = false;
    if (t.status !== 'cancelada') t.status = 'espera';
  }
  emit(t);
}

export function markAwaitingVideo(taskId) {
  const t = getTask(taskId);
  if (t) { t.awaitingVideo = true; emit(t); }
}

// La revisión de un entregable mueve la tarea: aprobado todo → hecha;
// cambios pedidos → correcciones (el trabajador la vuelve a asignar).
export function onReview(d, status, noteText) {
  const t = getTask(d.taskId);
  if (!t || ['cancelada', 'hecha'].includes(t.status)) return false;
  if (status === 'approved' || status === 'discarded' || status === 'read') {
    const open = t.deliverables.map((id) => state.deliverables.find((x) => x.id === id)).filter((x) => x && x.status === 'pending');
    if (!open.length && !t.awaitingVideo) {
      t.status = 'hecha';
      log(t.assignee, `Tarea terminada: ${t.title}`, 'ok');
    }
  } else {
    t.status = 'correcciones';
    note(t, 'diego', noteText || 'Diego pidió cambios.');
  }
  emit(t);
  kick();
  return true;
}

// ---------- trabajador ----------
let runner = null;
let pumping = false;

export function startTaskWorker({ run, busy }) {
  runner = { run, busy };
  setInterval(kick, 15_000);
  setTimeout(kick, 2_000);
}

export function kick() {
  if (!runner || pumping) return;
  pumping = true;
  try {
    const queue = state.tasks
      .filter((t) => t.status === 'pendiente' || t.status === 'correcciones')
      .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.createdAt - b.createdAt);
    const taken = new Set();
    for (const t of queue) {
      const a = getAgent(t.assignee);
      if (!a || !a.enabled || isPaused() || isBlocked() || taken.has(a.id) || runner.busy(a.id)) continue;
      taken.add(a.id);
      startTask(t);
    }
  } finally {
    pumping = false;
  }
}

async function startTask(t) {
  const correcting = t.status === 'correcciones';
  const previous = t.status;
  t.status = 'en_progreso';
  t.runs += 1;
  emit(t);
  const who = (n) => (n.by === 'diego' ? 'Diego' : (getAgent(n.by)?.nombre || n.by));
  const notes = t.notes.map((n) => `- ${who(n)}: ${n.text}`).join('\n');
  const instruction = [
    `Tarea del tablero: "${t.title}" (prioridad ${t.priority}).`,
    t.description,
    notes && `Notas y correcciones:\n${notes}`,
    correcting && 'Diego pidió correcciones: aplicalas sobre tu entrega anterior y volvé a entregar.',
  ].filter(Boolean).join('\n\n');
  let started = false;
  try {
    started = await runner.run(t.assignee, { reason: `tarea: ${t.title}`, instruction, taskId: t.id });
  } catch (e) {
    note(t, 'sistema', `Error al ejecutar: ${e.message}`);
  }
  const fresh = getTask(t.id);
  if (!fresh || fresh.status !== 'en_progreso') return kick(); // la movieron a mano mientras trabajaba
  if (started === false || started === 'limited') {
    fresh.status = previous; // estaba ocupado o sin cupo: vuelve a la cola
    if (started === 'limited') note(fresh, 'sistema', 'La cortó el límite de uso de Claude: se retoma sola cuando vuelva el cupo.');
  } else if (fresh.deliverables.length || fresh.awaitingVideo) {
    fresh.status = 'espera';
    avisarFin(fresh);
  } else {
    fresh.status = 'espera';
    note(fresh, 'sistema', 'Terminó sin entregable. Revisá la Actividad y decidí si reintentar.');
  }
  emit(fresh);
  kick();
}
