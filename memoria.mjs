// Memoria del equipo: las indicaciones permanentes que Diego da en los chats
// ("no digan 24 a 48 h, digan 1 a 2 días"). Cualquier agente las guarda con una
// herramienta y desde ahí entran en las instrucciones de quien corresponda,
// incluido el vendedor de WhatsApp. Diego las ve y las borra en Ajustes.
import { randomUUID } from 'node:crypto';
import { state, broadcast, saveNow, log } from './state.mjs';

state.memoria ||= [];

const emit = () => { saveNow(); broadcast({ type: 'memoria', memoria: state.memoria }); };
export const listMemoria = () => state.memoria;

// para: 'todos', un departamento ('marketing', 'ventas') o el id de un agente.
export function remember({ indicacion, para = 'todos', por = null, origen = '' }) {
  const text = String(indicacion || '').trim().slice(0, 600);
  if (text.length < 5) throw new Error('La indicación está vacía.');
  const dup = state.memoria.find((m) => m.indicacion.toLowerCase() === text.toLowerCase() && m.para === para);
  if (dup) return dup;
  const m = { id: randomUUID().slice(0, 8), indicacion: text, para: String(para || 'todos').slice(0, 40), por, origen: String(origen).slice(0, 80), ts: Date.now() };
  state.memoria.push(m);
  if (state.memoria.length > 150) state.memoria.splice(0, state.memoria.length - 150);
  log(por, `Aprendió de Diego: ${text}`, 'ok');
  emit();
  return m;
}

export function forget(id) {
  const before = state.memoria.length;
  state.memoria = state.memoria.filter((m) => m.id !== id);
  if (state.memoria.length !== before) emit();
  return before !== state.memoria.length;
}

// Las que le tocan a un agente (o al vendedor, con agent = { id: 'vendedor', dept: 'ventas' }).
export function memoriaFor(agent) {
  return state.memoria.filter((m) => m.para === 'todos' || m.para === agent.id || (agent.dept && m.para === agent.dept) || (agent.coordinator && m.para === 'coordinador'));
}

export function memoriaBlock(agent) {
  const list = memoriaFor(agent);
  if (!list.length) return '';
  return `\n\n## Indicaciones permanentes de Diego (tienen prioridad sobre cualquier otra regla)\n${list.map((m) => `- ${m.indicacion}`).join('\n')}`;
}

// Memoria de lo comprobado: solo entra lo que un experimento demostró con datos. No son opiniones de los agentes.
state.aprendizajes ||= [];
export const listaAprendizajes = () => state.aprendizajes;
export function aprendizajeComprobado({ area = '', para = 'todos', que, resultado, evidencia, aprendizaje, fuente = '', ref = '' }) {
  if (ref && state.aprendizajes.some((a) => a.ref === ref)) return null;
  const a = { id: randomUUID().slice(0, 8), ts: Date.now(), area: String(area).slice(0, 40), para: String(para || 'todos').slice(0, 40), que: String(que).slice(0, 240), resultado: String(resultado).slice(0, 30), evidencia: String(evidencia).slice(0, 300), aprendizaje: String(aprendizaje).slice(0, 500), fuente: String(fuente).slice(0, 40), ref: String(ref).slice(0, 40) };
  state.aprendizajes.push(a);
  if (state.aprendizajes.length > 100) state.aprendizajes.splice(0, state.aprendizajes.length - 100);
  saveNow();
  return a;
}
export function quitarAprendizaje(id) {
  const antes = state.aprendizajes.length;
  state.aprendizajes = state.aprendizajes.filter((a) => a.id !== id && a.ref !== id);
  if (antes !== state.aprendizajes.length) saveNow();
  return antes !== state.aprendizajes.length;
}
export function aprendizajesBlock(agent) {
  const l = state.aprendizajes.filter((m) => m.para === 'todos' || m.para === agent.id || (agent.dept && m.para === agent.dept) || agent.ceo).slice(-12);
  if (!l.length) return '';
  return `\n\n## Lo que ya se comprobó con datos (usalo y no lo repitas como si fuera nuevo)\n${l.map((a) => `- [${a.resultado}] ${a.que}. ${a.aprendizaje} (${a.evidencia})`).join('\n')}`;
}
