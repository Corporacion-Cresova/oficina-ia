// Chat grupal de cada departamento. Diego escribe; responde quien esté @mencionado
// (o quien lidera el departamento si no se menciona a nadie). Las respuestas pueden mencionar a otros
// agentes: hasta 2 rondas más y 3 voces por ronda, para que no se arme un bucle.
import { randomUUID } from 'node:crypto';
import { state, broadcast, saveNow } from './state.mjs';
import { getAgents } from './settings.mjs';
import { DEPARTMENTS } from './agents.mjs';

const MAX_HOPS = 1; // (se usa solo cuando nadie fue mencionado)
const MAX_PER_HOP = 3;
const KEEP = 200;

state.group ||= { messages: [] };
for (const m of state.group.messages) m.dept ||= DEPARTMENTS[0].id; // mensajes de antes de los departamentos

export const isDept = (id) => DEPARTMENTS.some((d) => d.id === id);
// Miembros: los del departamento más la coordinadora, que está en todos.
// El vendedor (motor de ventas) atiende clientes, no conversa en el chat del equipo.
const members = (dept) => getAgents().filter((a) => (a.dept === dept || a.coordinator) && !a.engine);

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function addGroupMessage(dept, from, text) {
  const message = { id: randomUUID(), ts: Date.now(), dept, from, text: String(text).slice(0, 8000) };
  state.group.messages.push(message);
  const mine = state.group.messages.filter((m) => m.dept === dept);
  if (mine.length > KEEP) state.group.messages = state.group.messages.filter((m) => m.dept !== dept || mine.indexOf(m) >= mine.length - KEEP);
  broadcast({ type: 'group', message });
  saveNow();
  return message;
}

export const groupMessages = (dept, n = 80) => state.group.messages.filter((m) => m.dept === dept).slice(-n);

export function mentionsIn(dept, text, exclude = []) {
  const t = norm(text);
  // @equipo: todos menos los editores de video (están produciendo; se les habla por nombre).
  if (/@(equipo|todos)\b/.test(t)) return members(dept).filter((a) => a.enabled && !a.studio && !exclude.includes(a.id)).map((a) => a.id);
  return members(dept)
    .filter((a) => a.enabled && !exclude.includes(a.id) && new RegExp(`@${norm(a.nombre)}\\b`).test(t))
    .map((a) => a.id);
}

// Transcripción reciente en texto, para que cada agente vea la conversación.
export function transcript(dept, n = 16) {
  const names = Object.fromEntries(getAgents().map((a) => [a.id, a.nombre]));
  return groupMessages(dept, n).map((m) => `${m.from === 'diego' ? 'Diego' : m.from === 'sistema' ? 'Oficina' : names[m.from] || m.from}: ${m.text}`).join('\n\n');
}

const busyGroups = new Set();
// Quien estaba trabajando cuando lo mencionaron responde apenas se libera (antes se perdía).
state.groupPending ||= [];
let deps = null;
setInterval(async () => {
  if (!deps || !state.groupPending.length) return;
  for (const p of [...state.groupPending]) {
    if (busyGroups.has(p.dept) || deps.busy(p.agentId)) continue;
    state.groupPending = state.groupPending.filter((x) => x !== p);
    saveNow();
    busyGroups.add(p.dept);
    broadcast({ type: 'group-busy', dept: p.dept, busy: true });
    try {
      const answer = await deps.reply(p.agentId, p.dept);
      if (answer) addGroupMessage(p.dept, p.agentId, answer);
    } catch {} finally {
      busyGroups.delete(p.dept);
      broadcast({ type: 'group-busy', dept: p.dept, busy: false });
    }
  }
}, 20_000);
export const groupBusy = (dept) => busyGroups.has(dept);

// reply(agentId) → texto de la respuesta (o null). busy(agentId) → true si está trabajando.
export async function postGroup(dept, text, { reply, busy }) {
  if (busyGroups.has(dept)) throw new Error('El equipo todavía está respondiendo. Esperá un momento.');
  const lead = DEPARTMENTS.find((d) => d.id === dept)?.lead;
  const coordinator = members(dept).find((a) => a.id === lead && a.enabled)?.id;
  addGroupMessage(dept, 'diego', text);
  deps = { reply, busy };
  busyGroups.add(dept);
  broadcast({ type: 'group-busy', dept, busy: true });
  try {
    // Si Diego le habla a alguien con @, responde SOLO esa persona (sin cadena de menciones).
    // Con @equipo responden todos una vez. Sin mención responde quien lidera, y solo puede sumar a 1 compañero.
    const mentioned = mentionsIn(dept, text);
    const toAll = /@(equipo|todos)\b/i.test(text);
    let targets = mentioned.length ? mentioned : coordinator ? [coordinator] : [];
    const hops = mentioned.length || toAll ? 0 : 1;
    const perHop = (hop) => (hop === 0 ? MAX_PER_HOP + (toAll ? 10 : 0) : 1);
    const spoken = new Set();
    for (let hop = 0; hop <= hops && targets.length; hop++) {
      const next = [];
      for (const id of targets.slice(0, perHop(hop))) {
        if (spoken.has(id)) continue;
        spoken.add(id);
        if (busy(id)) {
          addGroupMessage(dept, 'sistema', `${getAgents().find((a) => a.id === id)?.nombre} está con otro trabajo; te responde apenas termine.`);
          if (!state.groupPending.some((x) => x.dept === dept && x.agentId === id)) state.groupPending.push({ dept, agentId: id, ts: Date.now() });
          continue;
        }
        const answer = await reply(id, dept);
        if (!answer) continue;
        addGroupMessage(dept, id, answer);
        next.push(...mentionsIn(dept, answer, [id]).filter((x) => !spoken.has(x)));
      }
      targets = [...new Set(next)];
    }
  } finally {
    busyGroups.delete(dept);
    broadcast({ type: 'group-busy', dept, busy: false });
  }
}
