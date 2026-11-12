// Estado compartido de la oficina: agentes, aprobaciones, bitácora y
// entregables. Se guarda en DATA_DIR/state.json y se transmite por SSE.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AGENTS } from './agents.mjs';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(import.meta.dirname, 'data'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LOG_LIMIT = 300;

fs.mkdirSync(path.join(DATA_DIR, 'entregables'), { recursive: true });

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { agents: {}, approvals: [], log: [], deliverables: [], costs: {}, chats: {}, feedback: {} };
  }
}

export const state = load();
state.chats ||= {};
state.feedback ||= {};
state.decisions ||= [];
// Tipos de entrega: 'decision' (Diego responde), 'informe' (solo leer) y 'video'
// (se aprueba en el Estudio). Los entregables viejos sin tipo se ordenan una vez:
// los videos quedan por aprobar y el resto pasa a informes leídos.
for (const d of state.deliverables) {
  d.status ||= 'pending';
  // Una decisión que se "reemplazó" a sí misma (bug ya corregido) vuelve a la Bandeja.
  if (d.reemplazadaPor === d.id) { d.status = 'pending'; delete d.reemplazadaPor; delete d.note; }
  if (!d.kind) {
    d.kind = d.video ? 'video' : d.taskId ? 'decision' : 'informe';
    if (d.kind === 'informe' && d.status === 'pending') d.status = 'read';
  }
  // Un reporte que entró como "decisión" sin pregunta ni opciones (por venir de una tarea) es un informe: se lee y listo.
  if (d.kind === 'decision' && d.status === 'pending' && !d.question && !d.options?.length && !d.devProyecto && !d.ventasConv && !d.recontactoLote) d.kind = 'informe';
}
for (const a of AGENTS) {
  // Un reinicio del servidor corta cualquier corrida en curso.
  state.agents[a.id] = { status: 'idle', text: 'Disponible', lastRun: null, ...state.agents[a.id] };
  if (state.agents[a.id].status !== 'idle') Object.assign(state.agents[a.id], { status: 'idle', text: 'Disponible' });
}
state.approvals = state.approvals.filter((x) => x.status !== 'pending');

const clients = new Set();
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state, null, 1));
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
  }, 300);
}

export const saveNow = save;

export function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
}

export function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
  res.write(`data: ${JSON.stringify({ type: 'snapshot', state: publicState() })}\n\n`);
}

function publicDeliverable({ content, file, ...d }) {
  return d;
}

export function publicState() {
  return {
    agents: state.agents,
    approvals: state.approvals.filter((x) => x.status === 'pending'),
    log: state.log.slice(-200),
    deliverables: state.deliverables.slice(-120).map(publicDeliverable),
    costs: state.costs,
    chats: Object.fromEntries(Object.entries(state.chats).map(([id, c]) => [id, { messages: c.messages.slice(-60) }])),
    tasks: (state.tasks || []).slice(-300),
    group: (state.group?.messages || []).slice(-240),
  };
}

export const listDeliverables = () => state.deliverables;

export function setAgent(id, patch) {
  Object.assign(state.agents[id], patch);
  broadcast({ type: 'agent', id, agent: state.agents[id] });
  save();
}

export function log(agentId, text, kind = 'info') {
  const entry = { id: randomUUID(), ts: Date.now(), agentId, text, kind };
  state.log.push(entry);
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  broadcast({ type: 'log', entry });
  save();
}

export function addCost(agentId, usd) {
  state.costs[agentId] = (Object.hasOwn(state.costs, agentId) ? state.costs[agentId] : 0) + usd;
  broadcast({ type: 'costs', costs: state.costs });
  save();
}

export function addDeliverable(agentId, title, content, extra = {}) {
  const d = { id: randomUUID(), ts: Date.now(), agentId, title, status: 'pending', note: '', kind: extra.video ? 'video' : 'informe', ...extra };
  const file = path.join(DATA_DIR, 'entregables', `${new Date().toISOString().slice(0, 10)}-${agentId}-${d.id.slice(0, 6)}.md`);
  fs.writeFileSync(file, `# ${title}\n\n${content}\n`);
  // Las preguntas del equipo van al CEO; a Diego le llegan las del CEO, las demos, los comprobantes y quien pide una persona.
  if (d.kind === 'decision' && agentId !== 'ceo' && !d.devProyecto && !d.pagoAnticipo && !(d.ventasConv && !d.ventasPregunta)) d.paraCeo = true;
  // Los informes del equipo los lee el CEO; a Diego le llegan los del CEO y todo lo que él mismo pidió: por tarea, en un chat o a través de Jarvis.
  const tareaOrigen = (state.tasks || []).find((t) => t.id === d.taskId);
  if (d.kind === 'informe' && agentId !== 'ceo' && !d.pedidoDiego && tareaOrigen?.createdBy !== 'diego' && !tareaOrigen?.pedidoDiego) d.status = 'read';
  if (d.kind === 'informe') limpiarBandeja(d);
  state.deliverables.push({ ...d, file });
  broadcast({ type: 'deliverable', deliverable: d });
  save();
  if (d.kind === 'decision' && !d.paraCeo) import('./abogado.mjs').then((a) => { if (a.aplica(d)) a.criticar(d.id); }).catch(() => {});
  return d;
}

// ---------- Bandeja sin ruido (6 nov) ----------
// La Bandeja es para lo que necesita a Diego. Por eso:
//  - Los avisos que ya le llegaron por Discord/WhatsApp ("Aviso a Diego…", "WhatsApp enviado…", recordatorios) no
//    quedan "sin leer": están en el historial.
//  - Un informe que repite otro del mismo agente en las últimas 24 h reemplaza al anterior (el viejo pasa a leído).
//  - Los informes sin leer de más de 48 h pasan solos a leídos: lo importante ya lo resumió Jarvis en su reporte diario.
const normTitulo = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const ES_AVISO = /^(aviso|recordatorio|whatsapp (enviado|a diego)|mensaje enviado|discord)/;
function parecidos(a, b) {
  const pa = new Set(normTitulo(a).split(' ').filter((w) => w.length > 2 && !/^\d+$/.test(w)));
  const pb = new Set(normTitulo(b).split(' ').filter((w) => w.length > 2 && !/^\d+$/.test(w)));
  if (!pa.size || !pb.size) return false;
  const comunes = [...pa].filter((w) => pb.has(w)).length;
  return comunes / Math.min(pa.size, pb.size) >= 0.75;
}
function marcarLeido(x, nota) {
  x.status = 'read';
  x.note = x.note || nota;
  broadcast({ type: 'deliverable-updated', deliverable: publicDeliverable(x) });
}
// Los documentos de trabajo de la línea de video (notas de los editores, lotes de guiones, veredictos de Nico, planes
// de publicación) son para el equipo: Diego decide sobre el VIDEO en el Estudio, no sobre sus notas.
const DE_TRABAJO = new Set(['video', 'video2', 'video3', 'guionista', 'viralidad', 'community']);
const esRuido = (x) => ES_AVISO.test(normTitulo(x.title)) || DE_TRABAJO.has(x.agentId);
function limpiarBandeja(d) {
  if (esRuido(d)) { d.status = 'read'; d.note = DE_TRABAJO.has(d.agentId) ? 'Documento de trabajo del equipo' : 'Aviso ya enviado a Diego'; return; }
  for (const x of state.deliverables) {
    if (x.kind === 'informe' && x.status === 'pending' && x.agentId === d.agentId && Date.now() - x.ts < 24 * 3600e3 && parecidos(x.title, d.title)) marcarLeido(x, 'Reemplazado por uno más nuevo');
  }
}
function archivarViejos() {
  let n = 0;
  for (const x of state.deliverables) {
    if (x.kind !== 'informe' || x.status !== 'pending') continue;
    if (Date.now() - x.ts > 48 * 3600e3 || esRuido(x)) { marcarLeido(x, 'Archivado solo (más de 48 h, aviso ya enviado o documento de trabajo)'); n++; }
  }
  if (n) { save(); log(null, `Bandeja: ${n} informe(s) viejos o avisos pasaron a leídos`, 'info'); }
}
setTimeout(archivarViejos, 30e3);
setInterval(archivarViejos, 60 * 60e3);

// Para el contexto de otros agentes: el último aprobado; si no hay, el último
// sin revisar. Un entregable con cambios pedidos no se usa.
export function latestDeliverable(agentId) {
  const mine = state.deliverables.filter((d) => d.agentId === agentId && d.status !== 'changes');
  const pick = [...mine].reverse().find((d) => d.status === 'approved') || mine.at(-1);
  return pick ? { ...publicDeliverable(pick), content: readDeliverable(pick.id) } : null;
}

const REVIEW_STATES = { decision: ['approved', 'changes', 'discarded'], video: ['approved', 'changes', 'discarded'], informe: ['read', 'pending'] };

export function reviewDeliverable(id, status, note = '', answer = '') {
  const d = state.deliverables.find((x) => x.id === id);
  if (!d || !(REVIEW_STATES[d.kind] || REVIEW_STATES.decision).includes(status)) return null;
  if (answer && !(d.options || []).includes(answer)) return null;
  d.status = status;
  d.note = note;
  if (answer) d.answer = answer;
  if (d.kind === 'informe') {
    broadcast({ type: 'deliverable-updated', deliverable: publicDeliverable(d) });
    save();
    return publicDeliverable(d);
  }
  if (d.question && (answer || note)) {
    state.decisions.push({ ts: Date.now(), agentId: d.agentId, question: d.question, answer: answer || (status === 'approved' ? 'Sí' : 'No'), note });
    if (state.decisions.length > 25) state.decisions.splice(0, state.decisions.length - 25);
  }
  if (note || status === 'changes') {
    // Object.hasOwn: un agente llamado "constructor" (Píxel) no debe resolver a Object.prototype.constructor.
    if (!Object.hasOwn(state.feedback, d.agentId)) state.feedback[d.agentId] = [];
    const list = state.feedback[d.agentId];
    list.push({ ts: Date.now(), title: d.title, status, note });
    if (list.length > 15) list.splice(0, list.length - 15);
  }
  broadcast({ type: 'deliverable-updated', deliverable: publicDeliverable(d) });
  save();
  return publicDeliverable(d);
}

export const feedbackFor = (agentId) => (Object.hasOwn(state.feedback, agentId) ? state.feedback[agentId] : []);
export const recentDecisions = () => state.decisions.slice(-12);

export function readDeliverable(id) {
  const d = state.deliverables.find((x) => x.id === id);
  if (!d) return null;
  try {
    return fs.readFileSync(d.file, 'utf8');
  } catch {
    return null;
  }
}

// Aprobaciones: el agente queda en espera hasta que Diego decida en la oficina.
const waiters = new Map();
const APPROVAL_TIMEOUT_MS = 12 * 60 * 60 * 1000;

// Permisos temporales: "aprobá todas y no vuelvas a preguntar por esta acción por un rato".
state.permisos ||= {};
const permisoKey = (agentId, tool) => `${agentId}|${tool}`;
export function permitir(agentId, tool, horas = 3) {
  state.permisos[permisoKey(agentId, tool)] = Date.now() + horas * 3600e3;
  save();
}
export function requestApproval(agentId, tool, input, signal) {
  // Diego ya dio permiso para esta acción hace poco: pasa sin preguntar.
  if (state.permisos[permisoKey(agentId, tool)] > Date.now()) return Promise.resolve({ decision: 'approved', note: 'Permiso temporal de Diego' });
  const approval = { id: randomUUID(), ts: Date.now(), agentId, tool, input, status: 'pending' };
  state.approvals.push(approval);
  broadcast({ type: 'approval', approval });
  save();
  return new Promise((resolve) => {
    const finish = (decision, note) => {
      clearTimeout(timer);
      waiters.delete(approval.id);
      approval.status = decision;
      approval.note = note || '';
      broadcast({ type: 'approval-resolved', id: approval.id, status: decision });
      save();
      resolve({ decision, note });
    };
    const timer = setTimeout(() => finish('expired', 'Sin respuesta en 12 horas'), APPROVAL_TIMEOUT_MS);
    signal?.addEventListener('abort', () => finish('expired', 'Corrida cancelada'));
    waiters.set(approval.id, finish);
  });
}

export function resolveApproval(id, decision, note) {
  const finish = waiters.get(id);
  if (!finish) return false;
  finish(decision === 'approved' ? 'approved' : 'rejected', note);
  return true;
}

// Conversaciones directas con cada agente.
export function chatOf(agentId) {
  if (!Object.hasOwn(state.chats, agentId)) state.chats[agentId] = { sessionId: null, messages: [] };
  return state.chats[agentId];
}

export function addChatMessage(agentId, role, text) {
  const chat = chatOf(agentId);
  const message = { id: randomUUID(), ts: Date.now(), role, text };
  chat.messages.push(message);
  if (chat.messages.length > 120) chat.messages.splice(0, chat.messages.length - 120);
  broadcast({ type: 'chat', agentId, message });
  save();
  return message;
}

export function setChatSession(agentId, sessionId) {
  chatOf(agentId).sessionId = sessionId;
  save();
}
