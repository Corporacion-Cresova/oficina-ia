// Línea de producción: mantiene llena la reserva de videos usando cada ventana
// de cupo de Claude. Ciclo: Mateo escribe un lote de guiones → Nico elige los
// mejores y los pasa a la cola → Lucía los produce uno por uno → los videos
// llegan al Estudio para que Diego los apruebe (y se programan solos).
// La orquestación es código: solo gastan cupo los tres agentes.
import { randomUUID } from 'node:crypto';
import { state, log, broadcast, saveNow } from './state.mjs';
import { isPaused, getAgent } from './settings.mjs';
import { isBlocked, isAhorro } from './cupo.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ESTUDIO_DIR } from './estudio.mjs';

state.linea ||= {};
const L = state.linea;
L.enabled ??= false;
L.reserva ??= 10;      // videos listos (por aprobar o aprobados sin programar) + en cola
L.maxPorDia ??= 8;     // tope de videos producidos por día
L.lote ??= 6;          // guiones por lote de Mateo
L.editores ??= 3;      // editores preparando videos en paralelo (Lucía, Bruno, Inés)
L.queue ||= [];        // { id, title, script, base, status: queued|producing|done|failed, tries, resume, ts }
L.batch ||= null;      // { stage: 'guiones'|'filtro', ts, fails }
L.produced ||= {};     // { 'YYYY-MM-DD': n }
L.replicas ||= [];     // { id, videoId, titulo, ficha, variantes, notas, status: pendiente|guiones|filtro|hecha, ts }
for (const q of L.queue) if (q.status === 'producing' && !q.porTarea) { q.status = 'queued'; q.resume = true; } // un reinicio corta la producción
if (L.batch?.stage === 'guiones') L.batch = null; // el turno de Mateo se cortó con el reinicio: se pide de nuevo
if (L.batch) L.batch.running = false;

let runner = null;
let ticking = false;
const day = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10); // fecha de Honduras

const emit = () => { saveNow(); broadcast({ type: 'linea', linea: publicLinea() }); };

function stock() {
  // Los anuncios van a pauta, no al calendario: no cuentan como reserva de videos para redes.
  const ready = state.deliverables.filter((d) => d.kind === 'video' && d.tipo !== 'anuncio' && (d.status === 'pending' || (d.status === 'approved' && !d.published))).length;
  const queued = L.queue.filter((q) => q.tipo !== 'anuncio' && (q.status === 'queued' || q.status === 'producing')).length;
  return { ready, queued, total: ready + queued };
}

export function publicLinea() {
  return {
    enabled: L.enabled, reserva: L.reserva, maxPorDia: L.maxPorDia, lote: L.lote, editores: L.editores,
    trabajando: L.queue.filter((q) => q.status === 'producing').map((q) => ({ title: q.title, editor: q.editor })),
    replicas: L.replicas.slice(-10).map(({ ficha, ...r }) => r),
    batch: L.batch, producedToday: L.produced[day()] || 0, stock: stock(),
    queue: L.queue.filter((q) => q.status !== 'done').slice(-20).map(({ script, ...q }) => q),
  };
}

export function setLinea(patch = {}) {
  if (typeof patch.enabled === 'boolean') {
    L.enabled = patch.enabled;
    log(null, `Línea de producción ${L.enabled ? 'encendida' : 'apagada'}`, L.enabled ? 'ok' : 'warn');
  }
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
  if (patch.reserva != null && !isNaN(patch.reserva)) L.reserva = num(patch.reserva, 1, 100);
  if (patch.maxPorDia != null && !isNaN(patch.maxPorDia)) L.maxPorDia = num(patch.maxPorDia, 1, 80);
  if (patch.lote != null && !isNaN(patch.lote)) L.lote = num(patch.lote, 3, 12);
  if (patch.editores != null && !isNaN(patch.editores)) L.editores = num(patch.editores, 1, 3);
  emit();
  setTimeout(tick, 500);
  return publicLinea();
}

// Herramienta de Nico: pasa un guion aprobado a la cola de producción.
// tipo 'anuncio' = video para pauta en Meta: va primero (como una réplica), no cuenta en la reserva de redes y no se programa.
// Clave para detectar el mismo video con otro número o título apenas distinto ("Sí, tu página web es cara · A" = "Sí, tu página es cara · A").
const claveVideo = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/^[^a-z]*\d+\s*·?\s*/, '').replace(/\b(v\d+|web|anuncio|pauta|no publicar|cierre unificado del set|pagina|tu|la|el|de|del|y)\b/g, ' ')
  .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 2).sort().join(' ');
function yaHecho(title) {
  const k = claveVideo(title);
  if (!k) return null;
  const desde = Date.now() - 10 * 86400e3;
  const igual = (t) => { const a = new Set(claveVideo(t).split(' ')), b = k.split(' '); const comunes = b.filter((w) => a.has(w)).length; return comunes / Math.max(a.size, b.length) >= 0.75; };
  const q = L.queue.find((x) => x.ts > desde && x.status !== 'failed' && igual(x.title));
  if (q) return `ya está en la cola de producción (${q.status === 'done' ? 'producido' : q.status}): "${q.title}"`;
  const d = state.deliverables.find((x) => x.kind === 'video' && x.ts > desde && x.status !== 'discarded' && igual(x.title));
  if (d) return `ya se produjo y está en el Estudio: "${d.title}"`;
  return null;
}

export function enqueueScript({ title, script, base, prio = false, tipo = 'organico', rehacer = false }) {
  const anuncio = tipo === 'anuncio';
  const rep = !rehacer && yaHecho(title);
  if (rep) throw new Error(`No lo encolo: ${rep}. No se produce dos veces el mismo video. Solo si Diego pidió expresamente rehacerlo, volvé a llamar con rehacer: true.`);
  const item = { id: randomUUID(), title: String(title).slice(0, 140), script: String(script).slice(0, 12000), base: base ? String(base).slice(0, 80) : null, status: 'queued', tries: 0, ts: Date.now(), ...(prio || anuncio ? { prio: true } : {}), ...(anuncio ? { tipo: 'anuncio' } : {}) };
  L.queue.push(item);
  if (L.queue.length > 80) L.queue.splice(0, L.queue.length - 80);
  log('viralidad', `Pasó a producción${anuncio ? ' (anuncio, con prioridad)' : ''}: ${item.title}`, 'ok');
  emit();
  setTimeout(tick, 500);
  return item;
}

// Prioridad a un video que ya está en la cola (Jarvis): sale antes que el resto y aunque se haya llegado al tope del día.
export function priorizar(idPrefijo, { tipo } = {}) {
  const q = L.queue.find((x) => x.id.startsWith(String(idPrefijo).trim()) && x.status === 'queued');
  if (!q) throw new Error('No hay un video en cola con ese id.');
  q.prio = true;
  if (tipo === 'anuncio') q.tipo = 'anuncio';
  log('coordinador', `Prioridad en la línea: ${q.title}`, 'info');
  emit();
  setTimeout(tick, 500);
  return q;
}

// Videos de la cola que un editor ya está produciendo por una tarea del tablero: la línea no los vuelve a hacer.
export function enTarea(ids, taskId, editor = 'video') {
  const out = [];
  for (const id of ids) {
    const q = L.queue.find((x) => x.id.startsWith(String(id).trim()) && x.status === 'queued');
    if (!q) continue;
    Object.assign(q, { status: 'producing', editor, porTarea: taskId });
    out.push(q.title);
  }
  emit();
  return out;
}

// Cambios que pidió Diego: van primero, aunque la línea esté apagada o se haya llegado al tope del día.
export function enqueueChange({ title, instruction, sourceId }) {
  const dup = L.queue.find((q) => q.kind === 'cambios' && q.sourceId === sourceId && (q.status === 'queued' || q.status === 'producing'));
  if (dup) { dup.instruction = instruction; emit(); return dup; }
  const item = { id: randomUUID(), kind: 'cambios', sourceId, title: `Cambios: ${String(title).replace(/^(🎬\s*)+/, '').slice(0, 120)}`, instruction: String(instruction).slice(0, 6000), status: 'queued', tries: 0, ts: Date.now() };
  L.queue.unshift(item);
  log('video', `En cola con prioridad: ${item.title}`, 'info');
  emit();
  setTimeout(tick, 500);
  return item;
}

export function removeQueued(id) {
  const q = L.queue.find((x) => x.id === id && x.status === 'queued');
  if (!q) return false;
  q.status = 'failed';
  q.note = 'Quitado por Diego';
  emit();
  return true;
}

const RESUME = 'Te cortó el límite de uso o un reinicio a mitad de este video. Antes de nada, buscá en videos/ si ya existe su carpeta y retomá desde donde quedó: no repitas la voz ni lo que ya esté hecho.';

// Cada editor recibe su número de carpeta para que dos no tomen el mismo.
function nextFolderNum() {
  let max = 0;
  try { for (const d of fs.readdirSync(path.join(ESTUDIO_DIR, 'videos'))) { const n = parseInt(d, 10); if (n > max) max = n; } } catch {}
  for (const q of L.queue) if (q.status === 'producing' && q.num > max) max = q.num;
  return max + 1;
}

function produceInstruction(q) {
  return [
    q.num && `Tu carpeta para este video es videos/${String(q.num).padStart(2, '0')}-<nombre-corto> (ese número es tuyo: otro editor está trabajando en paralelo con el siguiente). Si ya existe una carpeta con ese número de un intento anterior tuyo, seguí en ella.`,
    q.resume && RESUME,
    `Video de la línea de producción: "${q.title}". El guion ya lo aprobó el comité (Nico) y Diego aprueba el video final en el Estudio, así que producilo completo sin esperar otra aprobación.`,
    q.tipo === 'anuncio' && 'ES UN ANUNCIO PARA PAUTA EN META, no un video de redes: vertical 9:16 con zonas seguras, la promesa clara en los primeros 2 segundos, subtítulos con contorno negro (nunca caja negra), CTA a WhatsApp. No lo programes ni lo publiques: en encargar_render poné tipo "anuncio" y Renata lo sube a Meta con la aprobación de Diego. Si es parte de un set (A, B, C), misma voz, misma música y mismo cierre en las variantes: cambia solo el cuerpo.',
    q.base && `Es una variante de videos/${q.base}: copiá esa carpeta como punto de partida (no _plantilla) y cambiá solo lo necesario (rubro, textos, gancho, locución). Es más rápido y mantiene lo que ya funcionó.`,
    'Seguí tu flujo completo: carpeta nueva, script.md, publicacion.json, voz, tiempos, escenas, mezcla, vista previa revisada, encargar_render y entregar el resumen como informe.',
    `## Guion\n\n${q.script}`,
  ].filter(Boolean).join('\n\n');
}

const runStage = (agentId, opts) => Promise.resolve(runner.run(agentId, { ...opts, noRetry: true })).catch(() => 'error');

function tick() {
  revisarTareas();
  avisarAtascos();
  if (!runner || ticking || isPaused() || isBlocked()) return;
  ticking = true;
  try {
    // 1. Producción: cada editor libre toma un trabajo. Primero los cambios pedidos por Diego, después los guiones nuevos.
    const editors = ['video', 'video2', 'video3'].slice(0, L.editores).filter((id) => getAgent(id)?.enabled && !runner.busy(id));
    for (const editor of editors) {
    const today = L.produced[day()] || 0;
    const inProgress = L.queue.filter((q) => q.status === 'producing' && q.kind !== 'cambios').length;
    // Primero los cambios de Diego; después las réplicas que pidió (prioridad); después lo normal.
    const change = L.queue.find((q) => q.status === 'queued' && q.kind === 'cambios')
      || (!isAhorro() ? L.queue.find((q) => q.status === 'queued' && q.prio) : null);
    const next = change || (L.enabled && !isAhorro() && today + inProgress < L.maxPorDia ? L.queue.find((q) => q.status === 'queued' && q.kind !== 'cambios') : null);
    if (!next) break;
    {
      next.status = 'producing';
      next.editor = editor;
      next.tries += 1;
      if (next.kind !== 'cambios' && !next.num) next.num = nextFolderNum();
      emit();
      runStage(editor, { reason: next.kind === 'cambios' ? 'cambios pedidos' : 'línea de producción', instruction: next.kind === 'cambios' ? `${next.resume ? `${RESUME}

` : ''}${next.instruction}` : produceInstruction(next) }).then((r) => {
        if (r === 'limited' || r === false) { next.status = 'queued'; next.resume = r === 'limited'; }
        else if (r === 'error' && next.tries < 2) { next.status = 'queued'; next.resume = true; }
        else if (r === 'error') { next.status = 'failed'; next.note = 'Falló dos veces: revisá la Actividad.'; log('video', `La línea no pudo producir "${next.title}"`, 'error'); }
        else { next.status = 'done'; if (next.kind !== 'cambios') L.produced[day()] = (L.produced[day()] || 0) + 1; }
        emit();
        setTimeout(tick, 2000);
      });
    }
    }

    // Réplica pedida por Diego: Mateo escribe las variantes aunque la línea esté apagada (respeta el presupuesto de Claude).
    const replica = L.replicas.find((r) => r.status === 'pendiente');
    if (replica && !L.batch && !isAhorro() && !runner.busy('guionista')) {
      replica.status = 'guiones';
      L.batch = { stage: 'guiones', ts: Date.now(), fails: 0, replica: replica.id };
      emit();
      runStage('guionista', {
        reason: 'réplica pedida por Diego',
        instruction: `Réplica de un video ganador que mandó Diego: "${replica.titulo}". Escribí ${replica.variantes + 1} guiones que REPLIQUEN la idea ganadora (mismo mecanismo de gancho, estructura y ritmo) adaptada a Cresova y a negocios de Honduras: no copies el texto, copiá lo que lo hace funcionar. Variá el rubro y el ángulo entre guiones.${replica.notas ? ` Indicaciones de Diego: ${replica.notas}.` : ''} Cada guion con título, "Réplica de: ${replica.titulo}", locución entre --- TEXTO PARA ELEVENLABS --- y --- FIN --- (40–50 palabras), texto en pantalla y escenas por segundo, CTA correcto y texto de publicación. Entregalo como informe: Nico elige enseguida.

## Análisis del video original

${replica.ficha}`,
      }).then((r) => {
        if (r === true) L.batch.stage = 'filtro'; else { L.batch = null; replica.status = (replica.tries = (replica.tries || 0) + 1) >= 3 ? 'fallida' : 'pendiente'; }
        emit();
        setTimeout(tick, 2000);
      });
    }

    if (!L.enabled || isAhorro()) { filtro(); return; }
    const today = L.produced[day()] || 0;
    // 2. Guiones: si la reserva no alcanza y la cola se está vaciando, nuevo lote.
    const s = stock();
    const lowQueue = L.queue.filter((q) => q.status === 'queued').length < L.editores + 1;
    if (!L.batch && lowQueue && s.total < L.reserva && today < L.maxPorDia && !runner.busy('guionista')) {
      L.batch = { stage: 'guiones', ts: Date.now(), fails: 0 };
      emit();
      runStage('guionista', {
        reason: 'línea de producción',
        instruction: `Lote para la línea de producción: escribí ${L.lote} guiones completos, listos para producir, siguiendo el manual y el último brief de Valeria (70 % explotar ganadores / 30 % explorar). Para cada uno: título, tipo (explotar/explorar), si es variante de un video existente indicá "Base: NN-carpeta", locución entre --- TEXTO PARA ELEVENLABS --- y --- FIN --- (40–50 palabras), texto en pantalla y escenas por segundo, CTA correcto según la línea, y texto de publicación (título YouTube ≤60 + texto con gancho, valor, CTA y hashtags del rubro). Entregalo como informe: Nico lo filtra enseguida.`,
      }).then((r) => {
        if (r === true) {
          L.batch.stage = 'filtro';
          const ult = state.deliverables.filter((x) => x.agentId === 'guionista' && x.ts >= L.batch.ts).at(-1);
          if (ult) L.batch.entregable = ult.id;
        } else L.batch = null;
        emit();
        setTimeout(tick, 2000);
      });
    }

    filtro();
  } catch (e) {
    // Un error de la línea nunca debe tirar la oficina.
    log(null, `Línea de producción: ${e.message}`, 'error');
  } finally {
    ticking = false;
  }
}

// 3. Filtro: Nico elige y pasa a la cola los mejores del lote (las réplicas, con prioridad).
function filtro() {
    if (isAhorro()) return; // con el presupuesto de Claude al tope, espera
    if (L.batch?.stage === 'filtro' && !L.batch.running && !runner.busy('viralidad')) {
      const replica = L.batch.replica ? L.replicas.find((r) => r.id === L.batch.replica) : null;
      if (replica) replica.status = 'filtro';
      L.batch.running = true;
      runStage('viralidad', {
        reason: 'línea de producción',
        instruction: replica
          ? `Réplica pedida por Diego de "${replica.titulo}". Mateo acaba de entregar las variantes (su último entregable, en tu contexto). Pasá a producción las ${replica.variantes} mejores con \`mcp__oficina__encolar_video\` y **prioridad: true**, una por llamada, con el guion completo ya corregido (locución entre marcadores, escenas, CTA y texto de publicación). Corregí lo que haga falta en vez de descartar: Diego quiere ver estas variantes. Entregá como informe corto.`
          : `Filtro de la línea de producción. Mateo acaba de entregar un lote de guiones${L.batch.entregable ? ` (entregable ${L.batch.entregable.slice(0, 8)}: leelo con leer_entregable)` : ' (es su último entregable, en tu contexto)'}. Calificá SOLO ese lote: otros guiones (anuncios, encargos de Diego) ya tienen su propio camino y no se vuelven a encolar. Calificalos con tu escala y pasá a producción con \`mcp__oficina__encolar_video\` SOLO los que aprueban (máximo ${Math.max(2, Math.ceil(L.lote * 0.6))}), uno por llamada, con el guion completo ya corregido (incluí locución entre marcadores, escenas, CTA y texto de publicación) y su "Base" si es variante. Los que no pasan, explicá por qué en tu informe para que Mateo aprenda. Entregá como informe corto.`,
      }).then((r) => {
        // Si lo cortó el límite, el filtro se repite al volver el cupo.
        if (r === 'limited' && L.batch) L.batch.running = false;
        else { if (replica) replica.status = r === true ? 'hecha' : (replica.tries = (replica.tries || 0) + 1) >= 3 ? 'fallida' : 'pendiente'; L.batch = null; }
        emit();
        setTimeout(tick, 2000);
      });
    }
}

function revisarTareas() {
  for (const q of L.queue) {
    if (!q.porTarea || q.status !== 'producing') continue;
    const t = state.tasks.find((x) => x.id === q.porTarea);
    if (!t || t.status === 'cancelada') { q.status = 'queued'; delete q.porTarea; delete q.editor; emit(); }
    else if (['espera', 'hecha'].includes(t.status)) { q.status = 'done'; q.note = 'Lo produjo la tarea del tablero'; emit(); }
  }
}

// Algo que lleva demasiado sin moverse: un aviso a Diego (una vez por cosa, de día).
// Anuncios y prioridades: 6 h en cola. Lo normal: 48 h. Guiones entregados que Nico no veredictó: 6 h.
function avisarAtascos() {
  const h = new Date(Date.now() - 6 * 3600e3).getUTCHours();
  if (h < 8 || h >= 20) return;
  const lista = [];
  for (const q of L.queue) {
    if (q.status !== 'queued' || q.avisoAtasco) continue;
    const limite = (q.prio ? 6 : 48) * 3600e3;
    if (Date.now() - q.ts > limite) { q.avisoAtasco = Date.now(); lista.push(`• ${q.tipo === 'anuncio' ? '📣 ' : ''}${q.title}: en cola hace ${Math.round((Date.now() - q.ts) / 3600e3)} h`); }
  }
  for (const t of state.tasks) {
    if (!t.guionDe || t.avisoAtasco || !['pendiente', 'correcciones'].includes(t.status)) continue;
    if (Date.now() - t.createdAt > 6 * 3600e3) { t.avisoAtasco = Date.now(); lista.push(`• Guiones de Mateo sin veredicto de Nico: ${t.title}`); }
  }
  if (!lista.length) return;
  saveNow();
  import('./ventas/whatsapp.mjs').then((wa) => wa.avisarDiego(`⏳ Línea de videos: esto lleva demasiado sin moverse\n${lista.slice(0, 8).join('\n')}\n\nPuede ser el tope diario o el modo ahorro de Claude: lo ves en Estudio → Línea.`)).catch(() => {});
}

// ¿El entregable de Mateo trae guiones para producir? Antes se miraba solo la marca "TEXTO PARA ELEVENLABS" y Mateo
// a veces escribe "**Voz:**" o "Voz (A, 49 palabras):": esos guiones nunca le llegaban a Nico (4 nov 2026).
export function sonGuiones(titulo, contenido) {
  const t = String(titulo || ''), c = String(contenido || '');
  if (/autoevaluaci|lluvia de ideas|recomendaci[oó]n|informe|estado de/i.test(t)) return false;
  if (/TEXTO PARA ELEVENLABS/i.test(c)) return true;
  return /gui[oó]n(es)?/i.test(t) && /(\*\*voz|^\s*[-*]?\s*\**voz\b|locuci[oó]n|texto en pantalla|escenas? por segundo|cuadro 0|\bcta\b)/im.test(c);
}

// Guiones que Mateo entrega fuera de un lote de la línea (un encargo de Diego, un anuncio): pasan solos a Nico.
// Si Mateo le preguntó a Diego cuáles producir, pasan cuando Diego contesta (eleccion = su respuesta).
export async function guionesANico(d, { tareaOrigen, eleccion = '' } = {}) {
  const ya = state.tasks.find((x) => x.guionDe === d.id && x.status !== 'cancelada');
  if (ya) return ya;
  const { createTask } = await import('./tareas.mjs');
  const texto = `${d.title}\n${tareaOrigen?.title || ''}\n${tareaOrigen?.description || ''}`;
  const anuncio = /anuncio|pauta|meta ads|publicidad|campa[ñn]a/i.test(texto);
  const t = createTask({
    assignee: 'viralidad',
    title: `Veredicto y a producción: ${d.title.replace(/^[^\wÁÉÍÓÚáéíóúñÑ¿¡"]+/, '').slice(0, 100)}`,
    priority: anuncio || tareaOrigen?.priority === 'alta' ? 'alta' : 'media',
    createdBy: 'guionista',
    description: `${eleccion ? `**Diego ya eligió: «${eleccion}».** Pasá a producción SOLO los que eligió; corregí lo que haga falta, pero no descartes ninguno de los elegidos salvo un problema grave (y en ese caso explicalo).\n\n` : ''}Mateo entregó guiones (entregable ${d.id.slice(0, 8)}: leelo con leer_entregable). Pasaron solos del entregable a vos para que no se atoren.\n\nHacé tu veredicto con tu escala. Los que aprueban, pasalos a producción con encolar_video, uno por llamada, con el guion completo ya corregido (locución entre marcadores, escenas, CTA y texto de publicación)${anuncio ? ' y **tipo: "anuncio"** (es para pauta: sale con prioridad y no se programa en redes). Si es un set de variantes (A, B, C), encolalas en el orden de prioridad y mantené misma voz, música y cierre' : ''}. Los que no pasan, explicá por qué para que Mateo aprenda. Entregá un informe corto con lo que encolaste.${tareaOrigen ? `\n\nEncargo original de Mateo: "${tareaOrigen.title}"` : ''}`,
  });
  t.guionDe = d.id;
  const dv = state.deliverables.find((x) => x.id === d.id);
  if (dv) dv.pasadoANico = Date.now();
  saveNow();
  return t;
}

// Vigilante: un guion de Mateo que Diego ya aprobó y que no le llegó a Nico en 20 minutos se le pasa solo.
// (Solo lo entregado desde que existe este vigilante, para no volver a producir lo que ya se resolvió a mano.)
L.vigilaGuionesDesde ||= Date.now();
async function vigilarGuiones() {
  const { readDeliverable } = await import('./state.mjs');
  for (const d of state.deliverables) {
    if (d.agentId !== 'guionista' || d.pasadoANico || d.ts < L.vigilaGuionesDesde || Date.now() - d.ts < 20 * 60e3) continue;
    if (d.kind !== 'decision' && !d.taskId) continue; // los lotes de la línea los filtra Nico por su camino
    const aprobado = d.kind === 'decision' ? d.status === 'approved' && !/^(no\b|ninguno|descart)/i.test(String(d.answer || '')) : d.kind === 'informe' || d.status === 'approved';
    if (!aprobado || !sonGuiones(d.title, readDeliverable(d.id))) continue;
    const t = await guionesANico(d, { eleccion: d.kind === 'decision' ? `${d.answer || 'Sí'}${d.note ? ` — ${d.note}` : ''}` : '' }).catch(() => null);
    if (t) log('guionista', `Los guiones "${d.title.slice(0, 60)}" se habían quedado sin pasar a Nico: se los pasé solos`, 'warn');
  }
}
setInterval(() => vigilarGuiones().catch((e) => log(null, `Vigilante de guiones: ${e.message}`, 'warn')), 10 * 60e3);

export function encargarReplica({ videoId, titulo, ficha, variantes = 3, notas = '' }) {
  const item = { id: randomUUID(), videoId, titulo: String(titulo).slice(0, 140), ficha: String(ficha).slice(0, 14000), variantes: Math.min(5, Math.max(1, Math.round(variantes))), notas: String(notas || '').slice(0, 1000), status: 'pendiente', ts: Date.now() };
  L.replicas.push(item);
  if (L.replicas.length > 40) L.replicas.splice(0, L.replicas.length - 40);
  log('coordinador', `Réplica encargada: ${item.titulo} (${item.variantes} variantes)`, 'ok');
  emit();
  setTimeout(tick, 500);
  return { ...item, enEspera: isAhorro() ? 'La oficina está en modo ahorro: arranca cuando haya cupo.' : null };
}

export function startLinea({ run, busy }) {
  runner = { run, busy };
  setInterval(tick, 60_000);
  setTimeout(tick, 5000);
}
