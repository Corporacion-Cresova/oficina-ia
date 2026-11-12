// Cupo de la suscripción de Claude: lo que informan los agentes al trabajar
// (ventana de 5 horas y semanal). Si se acaba, la oficina se pausa sola y
// retoma el trabajo cortado apenas se reinicia la ventana.
import { state, log, broadcast, saveNow } from './state.mjs';

state.cupo ||= { windows: {}, blockedUntil: 0, retries: [] };
const cupo = state.cupo;
let runner = null;

export const isBlocked = () => Date.now() < cupo.blockedUntil;

// Modo ahorro: queda poco cupo semanal. Solo se gasta en lo que Diego pide (chat, cambios,
// respuestas); la línea no produce videos nuevos y los turnos programados no corren.
// Se enciende solo con el 70 % semanal usado y se apaga solo cuando se renueva la semana.
cupo.ahorro ||= { on: false, hasta: 0 };
// Presupuesto de la oficina: con la ventana de 5 h o la semana por encima de estos topes,
// la oficina solo trabaja en lo que Diego pide (el resto queda para que él use Claude).
cupo.limites ||= { cincoHoras: 0.6, semana: 0.7 };
const vigente = (w) => w && w.utilization != null && !(w.resetsAt && w.resetsAt < Date.now());
export function sobreLimite() {
  const w5 = cupo.windows.five_hour, w7 = cupo.windows.seven_day;
  if (vigente(w7) && w7.utilization >= cupo.limites.semana) return 'semana';
  if (vigente(w5) && w5.utilization >= cupo.limites.cincoHoras) return 'cincoHoras';
  return null;
}
export function setLimites({ cincoHoras, semana } = {}) {
  const pct = (v, d) => (v == null || isNaN(v) ? d : Math.min(1, Math.max(0.1, Number(v) > 1 ? Number(v) / 100 : Number(v))));
  cupo.limites = { cincoHoras: pct(cincoHoras, cupo.limites.cincoHoras), semana: pct(semana, cupo.limites.semana) };
  log(null, `Presupuesto de la oficina: hasta ${Math.round(cupo.limites.cincoHoras * 100)} % de la ventana de 5 h y ${Math.round(cupo.limites.semana * 100)} % de la semana.`, 'info');
  emit();
  return publicCupo();
}

// Lo que gasta la oficina (costo equivalente en la API), para ver su parte del cupo.
cupo.gasto ||= [];
export function noteSpend(agentId, usd) {
  if (!(usd > 0)) return;
  cupo.gasto.push({ ts: Date.now(), usd, agentId });
  const corte = Date.now() - 8 * 86400e3;
  if (cupo.gasto[0]?.ts < corte) cupo.gasto = cupo.gasto.filter((g) => g.ts >= corte);
}
const gastoDesde = (t) => cupo.gasto.filter((g) => g.ts >= t).reduce((a, g) => a + g.usd, 0);

export function isAhorro() {
  if (sobreLimite()) return true;
  if (cupo.ahorro.on && cupo.ahorro.hasta && Date.now() > cupo.ahorro.hasta) {
    cupo.ahorro.on = false;
    log(null, 'Se renovó el cupo semanal: termina el modo ahorro y el equipo vuelve a producir.', 'ok');
    emit();
  }
  return cupo.ahorro.on;
}
export function setAhorro({ on, hasta } = {}) {
  cupo.ahorro = { on: Boolean(on), hasta: on ? Number(hasta) || cupo.windows.seven_day?.resetsAt || 0 : 0 };
  log(null, on ? 'Modo ahorro de Claude: solo se trabaja en lo que Diego pide.' : 'Modo ahorro apagado: el equipo vuelve a producir.', on ? 'warn' : 'ok');
  emit();
  return publicCupo();
}
export const publicCupo = () => {
  const w5 = cupo.windows.five_hour, w7 = cupo.windows.seven_day;
  const desde5 = w5?.resetsAt > Date.now() ? w5.resetsAt - 5 * 3600e3 : Date.now() - 5 * 3600e3;
  const desde7 = w7?.resetsAt > Date.now() ? w7.resetsAt - 7 * 86400e3 : Date.now() - 7 * 86400e3;
  return {
    windows: cupo.windows, blockedUntil: cupo.blockedUntil, retries: cupo.retries.map((r) => r.agentId),
    ahorro: { ...cupo.ahorro, activo: isAhorro(), motivo: sobreLimite() }, limites: cupo.limites,
    gasto: { cincoHoras: gastoDesde(desde5), semana: gastoDesde(desde7) }, medido: cupo.medido || null, encabezados: cupo.encabezados || null,
  };
};
const emit = () => { saveNow(); broadcast({ type: 'cupo', cupo: publicCupo() }); };

const hn = (t) => new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(t);

// Eventos rate_limit_event del SDK.
export function noteRateLimit(info) {
  if (!info) return;
  const kind = info.rateLimitType || 'five_hour';
  const resetsAt = info.resetsAt ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : null;
  // El aviso del SDK trae un umbral, no el uso real: si ya hay uso real reciente, no lo pisa.
  const prev = cupo.windows[kind] || {};
  // utilization llega como fracción (0–1); por las dudas se acepta también 0–100.
  const u = typeof info.utilization === 'number' ? (info.utilization > 1 ? info.utilization / 100 : info.utilization) : null;
  if (u != null) {
    cupo.windows[kind] = { utilization: u, resetsAt: resetsAt ?? prev.resetsAt ?? null, status: info.status, real: true, ts: Date.now() };
    cupo.medido = Date.now();
  } else {
    const keepReal = prev.real && info.status !== 'rejected'; // el aviso sin porcentaje no borra lo medido
    // Sin porcentaje, un aviso de umbral ("ya pasaste el 75 %") al menos da un piso.
    const piso = typeof info.surpassedThreshold === 'number' ? (info.surpassedThreshold > 1 ? info.surpassedThreshold / 100 : info.surpassedThreshold) : null;
    cupo.windows[kind] = keepReal ? { ...prev, resetsAt: resetsAt ?? prev.resetsAt } : { utilization: info.status === 'rejected' ? 1 : piso, resetsAt, status: info.status, real: piso != null || info.status === 'rejected', ts: Date.now() };
  }
  cupo.ultimoAviso = { ...info, ts: Date.now() };
  if (info.status === 'rejected') block(resetsAt);
  emit();
}

// Encabezados anthropic-ratelimit-unified-* (5h y 7d): utilización 0–1 y reinicio en segundos.
export function noteHeaders(h, status) {
  cupo.encabezados = { ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k.replace('anthropic-ratelimit-unified-', ''), v])), http: status, ts: Date.now() };
  let ok = false;
  for (const [pref, kind] of [['5h', 'five_hour'], ['7d', 'seven_day']]) {
    const u = parseFloat(h[`anthropic-ratelimit-unified-${pref}-utilization`]);
    if (isNaN(u)) continue;
    const r = Number(h[`anthropic-ratelimit-unified-${pref}-reset`]);
    const st = h[`anthropic-ratelimit-unified-${pref}-status`] || 'allowed';
    cupo.windows[kind] = { utilization: u > 1 ? u / 100 : u, resetsAt: r ? (r < 1e12 ? r * 1000 : r) : cupo.windows[kind]?.resetsAt ?? null, status: st, real: true, ts: Date.now() };
    ok = true;
  }
  if (ok) cupo.medido = Date.now();
  emit();
  return ok;
}

// Uso real que devuelve /usage: porcentajes 0–100 y fecha de reinicio de cada ventana.
export function noteUsage(rl) {
  if (!rl) return;
  for (const [kind, w] of [['five_hour', rl.five_hour], ['seven_day', rl.seven_day]]) {
    if (!w || w.utilization == null) continue;
    const prev = cupo.windows[kind] || {};
    cupo.windows[kind] = { ...prev, utilization: w.utilization / 100, resetsAt: w.resets_at ? Date.parse(w.resets_at) : prev.resetsAt ?? null, status: w.utilization >= 100 ? 'rejected' : 'allowed', real: true, ts: Date.now() };
  }
  emit();
}

// Errores del tipo "You've hit your 5-hour limit · resets 6pm".
export const isLimitError = (text) => /hit your .*limit|usage limit|rate[_ ]limit/i.test(String(text || ''));

function block(until) {
  const t = until && until > Date.now() ? until + 60e3 : Date.now() + 30 * 60e3; // sin hora exacta: reintenta en 30 min
  if (t <= cupo.blockedUntil) return;
  cupo.blockedUntil = t;
  log(null, `Se acabó el cupo de Claude. La oficina retoma sola el ${hn(t)}.`, 'warn');
}

export function onLimitHit(retry) {
  const w = Object.values(cupo.windows).filter((x) => x.status === 'rejected' && x.resetsAt).sort((a, b) => b.resetsAt - a.resetsAt)[0];
  block(w?.resetsAt);
  if (retry && !cupo.retries.some((r) => r.agentId === retry.agentId)) cupo.retries.push({ ...retry, ts: Date.now() });
  emit();
}

// Diego subió de plan o el cupo volvió antes: se retoma ya.
export function unblock() {
  cupo.blockedUntil = Date.now() - 1;
  for (const w of Object.values(cupo.windows)) if (w.status === 'rejected') w.status = 'allowed';
  log(null, 'Diego retomó el trabajo: la oficina vuelve a usar el cupo de Claude.', 'ok');
  emit();
}

// Un encargo que llega con el cupo agotado queda en cola.
export function queueRetry(retry) {
  if (!cupo.retries.some((r) => r.agentId === retry.agentId)) cupo.retries.push({ ...retry, ts: Date.now() });
  emit();
}

const RESUME = 'Te cortó el límite de uso de Claude a mitad del trabajo. Retomá desde donde quedaste: revisá primero lo que ya hiciste (archivos, carpeta, voz, entregas) y no repitas nada que ya esté hecho.';

export function startCupoWatcher({ run, busy }) {
  runner = { run, busy };
  setInterval(() => {
    if (isBlocked() || !cupo.retries.length) return;
    if (cupo.blockedUntil) { cupo.blockedUntil = 0; log(null, 'Volvió el cupo de Claude: el equipo retoma lo que quedó cortado.', 'ok'); }
    const pending = cupo.retries.splice(0);
    for (const r of pending) {
      if (runner.busy(r.agentId)) { cupo.retries.push(r); continue; }
      runner.run(r.agentId, { reason: 'retoma tras el límite', instruction: r.cut ? `${RESUME}${r.instruction ? `\n\nEncargo original:\n${r.instruction}` : ''}` : r.instruction, taskId: r.taskId });
    }
    emit();
  }, 60_000);
}
