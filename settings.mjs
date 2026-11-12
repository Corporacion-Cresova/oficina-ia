// Ajustes editables de la oficina: por agente (encendido, modelo, esfuerzo,
// tope de gasto, horario), pausa general y los textos que guían a los agentes
// (conocimiento de Cresova e instrucciones de cada rol) con historial.
// Todo se guarda en el estado y manda lo que valga sobre agents.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { AGENTS } from './agents.mjs';
import { state, broadcast, log, saveNow } from './state.mjs';

const PROMPTS_DIR = path.join(import.meta.dirname, 'prompts');
const DEFAULT_BUDGET = Number(process.env.AGENT_MAX_BUDGET_USD || 3);
const MAX_VERSIONS = 20;
const MAX_TEXT = 20_000;

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'El más capaz. Para análisis y creatividad.' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'Equilibrado: rápido y muy capaz.' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'El más rápido y económico. Para tareas repetitivas.' },
];
export const EFFORTS = [
  { id: 'low', label: 'Bajo' }, { id: 'medium', label: 'Medio' }, { id: 'high', label: 'Alto' },
  { id: 'xhigh', label: 'Muy alto' }, { id: 'max', label: 'Máximo' },
];

state.settings ||= {};
state.settings.paused ??= false;
state.settings.agents ||= {};
state.settings.knowledge ||= { text: null, versions: [] };
state.settings.prompts ||= {};
state.settings.manual ||= { text: null, versions: [] };

const readDefault = (file) => fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8').trim();
const defaultKnowledge = () => readDefault('_conocimiento.md');
const defaultManual = () => readDefault('_manual.md');
const HELPERS = { video2: 'Bruno', video3: 'Inés' };
const defaultRole = (id) => (HELPERS[id]
  ? `En la oficina te llamás **${HELPERS[id]}**: sos editor de video de apoyo y trabajás exactamente con las mismas reglas que Lucía (abajo). Donde dice "Lucía", sos vos.\n\n${readDefault('video.md')}`
  : readDefault(`${id}.md`));
export const getOfficeRules = () => readDefault('_oficina.md');

// ---------- agentes ----------
function effective(a) {
  const o = state.settings.agents[a.id] || {};
  return {
    ...a,
    enabled: o.enabled !== false,
    model: o.model || a.model,
    effort: o.effort || a.effort,
    maxBudgetUsd: o.maxBudgetUsd ?? a.maxBudgetUsd ?? DEFAULT_BUDGET,
    schedule: o.schedule || a.schedule,
  };
}

export const getAgents = () => AGENTS.map(effective);
export const getAgent = (id) => {
  const a = AGENTS.find((x) => x.id === id);
  return a ? effective(a) : null;
};
export const isPaused = () => state.settings.paused === true;

function validateSchedule(s) {
  const days = Array.isArray(s?.days) ? [...new Set(s.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
  const hour = Number(s?.hour);
  const minute = Number(s?.minute);
  if (!days.length) throw new Error('Elegí al menos un día.');
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('La hora no es válida.');
  return { days, hour, minute };
}

export function updateAgent(id, patch) {
  const base = AGENTS.find((a) => a.id === id);
  if (!base) throw new Error('Agente desconocido.');
  const next = { ...(state.settings.agents[id] || {}) };
  if ('enabled' in patch) next.enabled = Boolean(patch.enabled);
  if ('model' in patch) {
    if (!MODELS.some((m) => m.id === patch.model)) throw new Error('Modelo no permitido.');
    next.model = patch.model;
  }
  if ('effort' in patch) {
    if (!EFFORTS.some((e) => e.id === patch.effort)) throw new Error('Esfuerzo no válido.');
    next.effort = patch.effort;
  }
  if ('maxBudgetUsd' in patch) {
    const v = Number(patch.maxBudgetUsd);
    if (!(v >= 0.1 && v <= 50)) throw new Error('El tope por corrida debe estar entre 0.10 y 50 dólares.');
    next.maxBudgetUsd = Math.round(v * 100) / 100;
  }
  if ('schedule' in patch) next.schedule = validateSchedule(patch.schedule);
  state.settings.agents[id] = next;
  const eff = effective(base);
  const names = { model: 'modelo', effort: 'esfuerzo', maxBudgetUsd: 'tope de gasto', schedule: 'horario' };
  const changes = Object.keys(patch).filter((k) => k !== 'enabled').map((k) => names[k] || k);
  if ('enabled' in patch) log(id, next.enabled ? 'Agente encendido' : 'Agente apagado', 'system');
  if (changes.length) log(id, `Ajustes actualizados: ${changes.join(', ')}`, 'system');
  changed();
  return eff;
}

export function setPaused(value) {
  state.settings.paused = Boolean(value);
  log(null, state.settings.paused ? 'Pausa general activada: los horarios no van a disparar agentes' : 'Pausa general desactivada', 'system');
  changed();
}

// ---------- textos con historial ----------
function holder(kind, id) {
  if (kind === 'knowledge') return { slot: state.settings.knowledge, fallback: defaultKnowledge };
  if (kind === 'manual') return { slot: state.settings.manual, fallback: defaultManual };
  if (kind === 'prompt' && AGENTS.some((a) => a.id === id)) {
    const slot = (state.settings.prompts[id] ||= { text: null, versions: [] });
    return { slot, fallback: () => defaultRole(id) };
  }
  throw new Error('Texto desconocido.');
}

export const getKnowledge = () => state.settings.knowledge.text ?? defaultKnowledge();
export const getManual = () => state.settings.manual.text ?? defaultManual();
export const getRolePrompt = (id) => state.settings.prompts[id]?.text ?? defaultRole(id);

function pushVersion(slot, current) {
  slot.versions.push({ ts: Date.now(), text: current });
  if (slot.versions.length > MAX_VERSIONS) slot.versions.splice(0, slot.versions.length - MAX_VERSIONS);
}

export function saveText(kind, id, text, by = null) {
  const { slot, fallback } = holder(kind, id);
  if (typeof text !== 'string' || !text.trim()) throw new Error('El texto no puede estar vacío.');
  if (text.length > MAX_TEXT) throw new Error(`El texto es demasiado largo (máximo ${MAX_TEXT} caracteres).`);
  const clean = text.replace(/\r\n/g, '\n').trim();
  const current = slot.text ?? fallback();
  if (clean === current) return;
  pushVersion(slot, current);
  slot.text = clean === fallback() ? null : clean;
  const what = { knowledge: 'Conocimiento de Cresova actualizado', manual: 'Manual de contenido actualizado', prompt: 'Instrucciones del agente actualizadas' }[kind];
  log(kind === 'prompt' ? id : by, what, kind === 'manual' && by ? 'deliverable' : 'system');
  changed();
}

export function resetText(kind, id) {
  const { slot, fallback } = holder(kind, id);
  if (slot.text == null) return;
  pushVersion(slot, slot.text);
  slot.text = null;
  log(kind === 'prompt' ? id : null, 'Texto devuelto a la versión original', 'system');
  changed();
  return fallback();
}

export function restoreText(kind, id, ts) {
  const { slot, fallback } = holder(kind, id);
  const v = slot.versions.find((x) => x.ts === Number(ts));
  if (!v) throw new Error('Esa versión ya no existe.');
  const current = slot.text ?? fallback();
  pushVersion(slot, current);
  slot.text = v.text === fallback() ? null : v.text;
  log(kind === 'prompt' ? id : null, 'Texto restaurado a una versión anterior', 'system');
  changed();
}

// ---------- lo que ve la interfaz ----------
const versionsOf = (slot) => [...slot.versions].reverse().map((v) => ({ ts: v.ts, chars: v.text.length, preview: v.text.slice(0, 120).replace(/\s+/g, ' ') }));

export function publicSettings() {
  const k = state.settings.knowledge;
  return {
    paused: isPaused(),
    models: MODELS,
    efforts: EFFORTS,
    defaultBudget: DEFAULT_BUDGET,
    agents: getAgents().map(({ id, nombre, rol, color, enabled, model, effort, maxBudgetUsd, schedule }) => ({ id, nombre, rol, color, enabled, model, effort, maxBudgetUsd, schedule })),
    knowledge: { text: getKnowledge(), isDefault: k.text == null, versions: versionsOf(k) },
    manual: { text: getManual(), isDefault: state.settings.manual.text == null, versions: versionsOf(state.settings.manual) },
    prompts: Object.fromEntries(AGENTS.map((a) => {
      const slot = state.settings.prompts[a.id] || { text: null, versions: [] };
      return [a.id, { text: getRolePrompt(a.id), isDefault: slot.text == null, versions: versionsOf(slot) }];
    })),
  };
}

function changed() {
  saveNow();
  broadcast({ type: 'settings', settings: publicSettings() });
}
