// Publicador sin IA: cuando Diego aprueba un video en el Estudio, el servidor lo
// programa en TikTok y YouTube en el próximo hueco libre, directo con la API de
// Upload-Post. No gasta cupo de Claude.
import fs from 'node:fs';
import path from 'node:path';
import { ESTUDIO_DIR, renderFile } from './estudio.mjs';
import { state, log, broadcast, saveNow } from './state.mjs';

const API = 'https://api.upload-post.com/api';
const PROFILE = process.env.UPLOADPOST_PROFILE || 'cresova';
// Horarios de Honduras (UTC−6, sin horario de verano), según el manual.
// Reglas de publicación: las define Diego en Marketing → Publicación (state.redes.reglas). Ningún agente las cambia.
export const REGLAS_BASE = { horarios: ['07:00', '11:00', '13:30', '17:30', '20:00'], separacionMin: 45, igfbHora: '20:00', igfbPorDia: 1, reservaMinDias: 2, alternarRubros: true };
export const reglas = () => ({ ...REGLAS_BASE, ...(state.redes?.reglas || {}) });
const hm = (s) => String(s).split(':').map(Number);
export const SLOTS = () => reglas().horarios.map(hm).sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));
export function guardarReglas(nuevas = {}) {
  const r = reglas();
  const horarios = Array.isArray(nuevas.horarios) ? [...new Set(nuevas.horarios.map(String).filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)))] : r.horarios;
  if (!horarios.length) throw new Error('Tiene que haber al menos un horario.');
  state.redes ||= { avisos: {} };
  state.redes.reglas = {
    horarios: horarios.sort(),
    separacionMin: Math.max(15, Math.min(240, Number(nuevas.separacionMin ?? r.separacionMin) || r.separacionMin)),
    igfbHora: /^([01]\d|2[0-3]):[0-5]\d$/.test(nuevas.igfbHora || '') ? nuevas.igfbHora : r.igfbHora,
    igfbPorDia: 1,
    reservaMinDias: Math.max(1, Math.min(14, Number(nuevas.reservaMinDias ?? r.reservaMinDias) || r.reservaMinDias)),
    alternarRubros: nuevas.alternarRubros ?? r.alternarRubros,
    cambiadas: Date.now(),
  };
  saveNow();
  log('diego', `Cambió las reglas de publicación: ${horarios.length} al día (${horarios.join(', ')}), Instagram a las ${state.redes.reglas.igfbHora}`, 'info');
  return reglas();
}
const HN_OFFSET_H = 6;
const gapMs = () => reglas().separacionMin * 60e3; // nada más cerca de otra publicación de TikTok/YouTube
const MIN_LEAD_MS = 30 * 60e3;

const headers = () => {
  const key = process.env.UPLOADPOST_API_KEY?.trim();
  if (!key) throw new Error('Falta la llave de Upload-Post (Sistema → Llaves).');
  return { Authorization: `Apikey ${key}` };
};

async function api(pathname, opts = {}) {
  const res = await fetch(`${API}${pathname}`, { ...opts, headers: { ...headers(), ...opts.headers }, signal: AbortSignal.timeout(120_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.message || body.error || `Upload-Post respondió ${res.status}`);
  return body;
}

// Texto que dejó el equipo junto al video (videos/<carpeta>/plan/publicacion.json).
export function postText(folder) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ESTUDIO_DIR, 'videos', folder, 'plan', 'publicacion.json'), 'utf8'));
    return { title: String(j.titulo || '').slice(0, 100), caption: String(j.texto || '').slice(0, 2200) };
  } catch {
    return { title: '', caption: '' };
  }
}

// Upload-Post devuelve las fechas en UTC, a veces SIN la "Z". Sin esto el servidor (en hora de
// Honduras) las leía 6 h corridas y programaba videos encima de los que ya estaban.
const parseUtc = (s) => Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(String(s)) ? s : `${s}Z`);

async function scheduledJobs(from, to, redes = ['tiktok', 'youtube']) {
  const q = new URLSearchParams({ profile_username: PROFILE, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  const { scheduled_posts: list = [] } = await api(`/uploadposts/schedule?${q}`);
  return list.filter((j) => (j.platforms || []).some((p) => redes.includes(p)))
    .map((j) => ({ id: j.job_id, at: parseUtc(j.scheduled_date), oficina: String(j.external_id || '').startsWith('oficina-'), ext: j.external_id || '', file: j.source_filename || '', title: String(j.title || '').slice(0, 80) }));
}
async function takenTimes(from, to) {
  return (await scheduledJobs(from, to)).map((j) => j.at);
}

function freeSlot(taken, startAt = Date.now(), evitar = null) {
  const now = Math.max(Date.now(), startAt - MIN_LEAD_MS);
  const today = new Date(startAt - HN_OFFSET_H * 3600e3); // fecha de Honduras desde donde se busca
  for (let day = 0; day < 45; day++) {
    for (const [h, m] of SLOTS()) {
      const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + day, h + HN_OFFSET_H, m);
      if (t < now + MIN_LEAD_MS) continue;
      if (taken.some((x) => Math.abs(x - t) < gapMs())) continue;
      if (evitar && evitar(t)) continue;
      return t;
    }
  }
  throw new Error('No hay huecos libres en los próximos 45 días.');
}

// La agenda real es la de Upload-Post. Las horas guardadas en la oficina pueden estar viejas (si alguien movió un video
// allá, acá quedaba la hora anterior y ese hueco se daba por ocupado): solo se suman las de los últimos 15 minutos,
// que Upload-Post a veces todavía no lista.
const recientes = [];
const RUBRO_RE = /(despacho|abogad|legal|colegio|escuela|admisi|constructora|obra|cotizaci|cl[ií]nica|paciente|consulta|distribuidora|pedido|hotel|hu[eé]sped|laboratorio|transporte|cami[oó]n|restaurante)/i;
const GRUPOS = { abogad: 'despacho', legal: 'despacho', escuela: 'colegio', admisi: 'colegio', obra: 'constructora', cotizaci: 'constructora', paciente: 'clínica', consulta: 'clínica', clinica: 'clínica', pedido: 'distribuidora', huesped: 'hotel', 'huésped': 'hotel', camion: 'transporte', 'camión': 'transporte' };
export const rubroDeTexto = (t) => { const m = String(t || '').toLowerCase().match(RUBRO_RE); if (!m) return null; const k = m[1].normalize('NFD').replace(/[\u0300-\u036f]/g, ''); return GRUPOS[k] || GRUPOS[m[1]] || k; };
export async function nextSlot(rubro = null) {
  const now = Date.now();
  const jobs = await scheduledJobs(now - 6 * 3600e3, now + 45 * 86400e3).catch(() => []);
  const taken = jobs.map((j) => j.at);
  // Rubro del video vecino (el anterior y el siguiente en la agenda) para no repetir tema seguido.
  const evitar = rubro && reglas().alternarRubros ? (t) => {
    const antes = jobs.filter((j) => j.at < t).sort((a, b) => b.at - a.at)[0], despues = jobs.filter((j) => j.at > t).sort((a, b) => a.at - b.at)[0];
    return [antes, despues].some((j) => j && rubroDeTexto(`${j.file} ${j.title}`) === rubro);
  } : null;
  for (const r of recientes) if (now - r.ts < 15 * 60e3) taken.push(r.at);
  try { if (evitar) return freeSlot(taken, now, evitar); } catch {}
  return freeSlot(taken);
}

// Rellena los huecos de los próximos días adelantando los videos de la oficina programados más lejos.
export async function rellenarHuecos({ dias = 3 } = {}) {
  const now = Date.now();
  const jobs = (await scheduledJobs(now, now + 60 * 86400e3)).sort((a, b) => a.at - b.at);
  const taken = jobs.map((j) => j.at);
  const movibles = jobs.filter((j) => j.oficina).sort((a, b) => b.at - a.at);
  const limite = now + dias * 86400e3;
  const movidos = [];
  for (;;) {
    let slot;
    try { slot = freeSlot(taken); } catch { break; }
    if (slot > limite) break;
    const j = movibles.find((x) => x.at > slot + 86400e3 && !movidos.some((m) => m.id === x.id));
    if (!j) break;
    try {
      await api(`/uploadposts/schedule/${encodeURIComponent(j.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduled_date: new Date(slot).toISOString() }) });
    } catch (e) { log('community', `No se pudo adelantar ${j.file || j.title}: ${e.message}`, 'warn'); break; }
    taken.splice(taken.indexOf(j.at), 1, slot);
    const d = state.deliverables.find((x) => j.ext === `oficina-${x.id}`);
    if (d?.published) d.published.at = slot;
    movidos.push({ id: j.id, video: j.file || j.title, de: hnLabel(j.at), a: hnLabel(slot) });
  }
  if (movidos.length) { log('community', `Agenda: ${movidos.length} videos adelantados para llenar huecos de los próximos ${dias} días`, 'ok'); saveNow(); }
  return movidos;
}

// Revisión del calendario completo (tandas anteriores + videos de la oficina): si un video que
// programó la oficina choca con otro, la oficina lo mueve sola al próximo hueco libre.
state.calendario ||= { ultima: null, movidos: [] };
export async function auditCalendar() {
  const now = Date.now();
  const jobs = (await scheduledJobs(now + 5 * 60e3, now + 45 * 86400e3)).sort((a, b) => a.at - b.at);
  const fixed = jobs.filter((j) => !j.oficina);
  const taken = fixed.map((j) => j.at);
  const movidos = [];
  for (const j of jobs.filter((x) => x.oficina)) {
    if (!taken.some((t) => Math.abs(t - j.at) < gapMs())) { taken.push(j.at); continue; }
    const at = freeSlot(taken, j.at); // solo hacia adelante, desde su mismo día
    try {
      await api(`/uploadposts/schedule/${encodeURIComponent(j.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduled_date: new Date(at).toISOString() }) });
      taken.push(at);
      const d = state.deliverables.find((x) => j.ext === `oficina-${x.id}`);
      if (d?.published) d.published.at = at;
      movidos.push({ video: j.file || j.title, de: j.at, a: at });
      log('community', `Calendario: ${j.file || j.title} chocaba con otro video; pasó de ${hnLabel(j.at)} a ${hnLabel(at)}`, 'ok');
    } catch (e) {
      taken.push(j.at);
      log('community', `Calendario: no se pudo mover ${j.file || j.title}: ${e.message}`, 'warn');
    }
  }
  const dias = {};
  for (const j of jobs) {
    const k = new Date(j.at - 6 * 3600e3).toISOString().slice(0, 10);
    (dias[k] ||= { total: 0, oficina: 0 }).total += 1;
    if (j.oficina) dias[k].oficina += 1;
  }
  const titulos = jobs.map((j) => `${new Date(j.at - 6 * 3600e3).toISOString().slice(5, 10)} · ${j.file || ''} · ${j.title}`).slice(0, 80);
  state.calendario = { titulos, ultima: now, movidos: [...movidos, ...(state.calendario.movidos || [])].slice(0, 30), dias, total: jobs.length, oficina: jobs.filter((j) => j.oficina).length };
  saveNow();
  broadcast({ type: 'calendario', calendario: state.calendario });
  return state.calendario;
}
export const calendarState = () => state.calendario;

// Reserva: días seguidos, desde mañana, con la cantidad de videos que pide la regla. Y la agenda de los próximos 7 días.
export async function reserva() {
  const now = Date.now();
  const jobs = (await scheduledJobs(now, now + 21 * 86400e3)).sort((a, b) => a.at - b.at);
  const porDia = SLOTS().length;
  const dia = (t) => new Date(t - HN_OFFSET_H * 3600e3).toISOString().slice(0, 10);
  const cuenta = {};
  for (const j of jobs) cuenta[dia(j.at)] = (cuenta[dia(j.at)] || 0) + 1;
  const dias = [];
  for (let i = 0; i < 14; i++) { const k = dia(now + i * 86400e3); dias.push({ dia: k, videos: cuenta[k] || 0 }); }
  let llenos = 0;
  for (const d of dias.slice(1)) { if (d.videos >= porDia) llenos++; else break; }
  const aprobadosSinProgramar = state.deliverables.filter((d) => d.kind === 'video' && d.status === 'approved' && !d.published?.jobId && !(d.tipo === 'anuncio' || (!d.tipo && /anuncio/i.test(d.title || '')))).length;
  return { porDia, diasLlenos: llenos, minimo: reglas().reservaMinDias, baja: llenos < reglas().reservaMinDias, dias, aprobadosSinProgramar, proximos: jobs.slice(0, 20).map((j) => ({ cuando: hnLabel(j.at), video: j.file || j.title, oficina: j.oficina })) };
}
// Al arrancar y cada 6 horas.
setTimeout(() => auditCalendar().catch((e) => log('community', `Revisión del calendario: ${e.message}`, 'warn')), 60_000);
setInterval(() => auditCalendar().catch(() => {}), 6 * 3600e3);

export const hnLabel = (t) => new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(t);

export async function publishVideo(id, { title, caption }) {
  const d = state.deliverables.find((x) => x.id === id);
  if (!d || d.kind !== 'video') throw new Error('Video no encontrado.');
  if (d.status !== 'approved') throw new Error('Primero hay que aprobar el video.');
  if (d.published?.jobId) throw new Error('Este video ya está programado.');
  if (d.tipo === 'anuncio' || (!d.tipo && /anuncio/i.test(d.title || ''))) throw new Error('Es un ANUNCIO: va a Meta con Renata, no al calendario orgánico. Si querés publicarlo orgánico, cambialo a ORGÁNICO primero.');
  title = String(title || '').trim().slice(0, 100);
  caption = numeroVentas(String(caption || '').trim()).slice(0, 2200);
  if (!title || !caption) throw new Error('Falta el título o el texto de la publicación.');
  const file = renderFile(d.video.video, d.video.name);
  if (!file) throw new Error('No encuentro el archivo del video en el servidor.');

  const at = await nextSlot(rubroDeTexto(`${d.video?.video || ''} ${d.title}`));
  recientes.push({ at, ts: Date.now() });
  const form = new FormData();
  form.append('user', PROFILE);
  form.append('platform[]', 'tiktok');
  form.append('platform[]', 'youtube');
  form.append('video', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), `${d.video.video}.mp4`);
  form.append('title', caption);             // en TikTok el título es el texto de la publicación
  form.append('tiktok_title', caption);
  form.append('youtube_title', title);
  form.append('youtube_description', caption);
  form.append('privacyStatus', 'public');
  form.append('scheduled_date', new Date(at).toISOString());
  form.append('external_id', `oficina-${d.id}`);
  const body = await api('/upload', { method: 'POST', body: form, headers: { 'Idempotency-Key': `oficina-${d.id}` } });

  d.published = { jobId: body.job_id || body.request_id || null, at, title, caption, platforms: ['tiktok', 'youtube'], by: 'oficina' };
  saveNow();
  broadcast({ type: 'deliverable-updated', deliverable: publicView(d) });
  log('community', `Programado para ${hnLabel(at)} en TikTok y YouTube: ${d.title.replace(/^🎬\s*/, '')}`, 'ok');
  // Instagram y Facebook: solo los mejores, en su propio horario (1 por día a las 20:00).
  // Automático solo cuando Diego elige el criterio de "los mejores" (state.redes.igfbAuto); mientras, se programa a mano.
  if (state.redes?.igfbAuto && mejorParaIgFb(d)) await programarIgFb(d.id).catch((e) => log('community', `No se pudo programar en Instagram/Facebook: ${e.message}`, 'warn'));
  setTimeout(() => auditCalendar().catch(() => {}), 30_000);
  return d.published;
}

// Diego (10 nov): lo que aprueba como orgánico se programa solo, con el texto que dejó Lucía.
const esAnuncio = (d) => d.tipo === 'anuncio' || (!d.tipo && /anuncio/i.test(d.title || ''));
export async function autoPublicar(id) {
  const d = state.deliverables.find((x) => x.id === id);
  if (!d || d.kind !== 'video' || d.status !== 'approved' || d.published?.jobId || esAnuncio(d)) return null;
  const t = postText(d.video?.video);
  const title = t.title || d.title.replace(/^🎬s*/, '').replace(/^d+s*·s*/, '').slice(0, 90);
  if (!t.caption) { log('community', `No se programó "${d.title}": le falta el texto de publicación (plan/publicacion.json)`, 'warn'); return null; }
  return publishVideo(id, { title, caption: t.caption });
}
// Programa todos los orgánicos aprobados que quedaron sin programar, alternando rubros para no repetir tema seguido.
const RUBROS = ['despacho', 'colegio', 'constructora', 'clínica', 'clinica', 'distribuidora', 'hotel', 'agente'];
const rubroDe = (d) => RUBROS.find((r) => d.title.toLowerCase().includes(r)) || 'otro';
export async function publicarAprobados() {
  const lista = state.deliverables.filter((d) => d.kind === 'video' && d.status === 'approved' && !d.published?.jobId && !esAnuncio(d));
  const orden = [];
  let ultimo = null;
  while (lista.length) { const i = Math.max(0, lista.findIndex((d) => rubroDe(d) !== ultimo)); const [d] = lista.splice(i, 1); orden.push(d); ultimo = rubroDe(d); }
  const out = [];
  for (const d of orden) {
    try { const r = await autoPublicar(d.id); out.push({ video: d.title, cuando: r ? hnLabel(r.at) : null, error: r ? null : 'sin texto' }); } catch (e) { out.push({ video: d.title, error: e.message }); }
  }
  return out;
}

export async function cancelPublish(id) {
  const d = state.deliverables.find((x) => x.id === id);
  if (!d?.published?.jobId) throw new Error('Este video no está programado.');
  await api(`/uploadposts/schedule/${encodeURIComponent(d.published.jobId)}`, { method: 'DELETE' });
  if (d.igfb?.jobId) await api(`/uploadposts/schedule/${encodeURIComponent(d.igfb.jobId)}`, { method: 'DELETE' }).catch(() => {});
  delete d.igfb;
  log('community', `Se canceló la publicación de ${d.title.replace(/^🎬\s*/, '')}`, 'warn');
  delete d.published;
  saveNow();
  broadcast({ type: 'deliverable-updated', deliverable: publicView(d) });
}

const publicView = ({ content, file, ...d }) => d;

// ---------- Instagram y Facebook (fase 1 del plan de contenido, 6 nov 2026) ----------
// Regla de Diego: a IG/FB van solo los mejores, aparte de TikTok/YouTube (nunca un job de 4 redes), 1 Reel por día
// a las 20:00 HN. "Mejor" = el revisor automático le dio ≥ IGFB_NOTA_MIN, o lo aprobó Diego a mano.
const FB_PAGE = process.env.UPLOADPOST_FB_PAGE || '';
const IGFB_NOTA_MIN = 8;
const igfbHora = () => hm(reglas().igfbHora);
export const mejorParaIgFb = (d) => d.kind === 'video' && d.status === 'approved' && (d.revisorAuto ? Number(d.revisorAuto.puntaje) >= IGFB_NOTA_MIN : true);
const diaHN = (t) => new Date(t - HN_OFFSET_H * 3600e3).toISOString().slice(0, 10);

async function igfbSlot() {
  const now = Date.now();
  const ocupados = (await scheduledJobs(now, now + 60 * 86400e3, ['instagram', 'facebook'])).map((j) => j.at);
  for (const d of state.deliverables) if (d.igfb?.at && d.igfb.at > now) ocupados.push(d.igfb.at);
  const hoy = new Date(now - HN_OFFSET_H * 3600e3);
  for (let day = 0; day < 60; day++) {
    const t = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + day, igfbHora()[0] + HN_OFFSET_H, igfbHora()[1]);
    if (t < now + MIN_LEAD_MS) continue;
    if (ocupados.some((x) => diaHN(x) === diaHN(t))) continue; // 1 por día
    return t;
  }
  throw new Error('No hay días libres para Instagram/Facebook en los próximos 60 días.');
}

export async function programarIgFb(id) {
  const d = state.deliverables.find((x) => x.id === id);
  if (!d || d.kind !== 'video') throw new Error('Video no encontrado.');
  if (d.igfb?.jobId) throw new Error('Este video ya está programado en Instagram y Facebook.');
  const caption = numeroVentas(d.published?.caption || postText(d.video?.video).caption);
  if (!caption) throw new Error('Falta el texto de la publicación.');
  const file = renderFile(d.video.video, d.video.name);
  if (!file) throw new Error('No encuentro el archivo del video en el servidor.');
  const at = await igfbSlot();
  const form = new FormData();
  form.append('user', PROFILE);
  form.append('platform[]', 'instagram');
  form.append('platform[]', 'facebook');
  form.append('video', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), `${d.video.video}.mp4`);
  form.append('title', caption);
  form.append('description', caption);
  form.append('media_type', 'REELS');
  form.append('share_to_feed', 'true');
  form.append('facebook_page_id', FB_PAGE);
  form.append('facebook_media_type', 'REELS');
  form.append('scheduled_date', new Date(at).toISOString());
  form.append('external_id', `oficina-igfb-${d.id}`);
  const body = await api('/upload', { method: 'POST', body: form, headers: { 'Idempotency-Key': `oficina-igfb-${d.id}` } });
  d.igfb = { jobId: body.job_id || body.request_id || null, at, platforms: ['instagram', 'facebook'] };
  saveNow();
  broadcast({ type: 'deliverable-updated', deliverable: publicView(d) });
  log('community', `Programado para ${hnLabel(at)} en Instagram y Facebook (Reel): ${d.title.replace(/^🎬\s*/, '')}`, 'ok');
  return d.igfb;
}

// Videos ya publicados en TikTok/YouTube que califican para IG/FB y todavía no se programaron ahí.
export function pendientesIgFb() {
  return state.deliverables.filter((d) => d.published?.jobId && !d.igfb?.jobId && mejorParaIgFb(d))
    .map((d) => ({ id: d.id, titulo: d.title.replace(/^🎬\s*/, ''), puntaje: d.revisorAuto?.puntaje ?? 'Diego', tiktok: d.published.at }))
    .sort((a, b) => b.tiktok - a.tiktok);
}

// ---------- Alarma: una red 24 h sin publicar ----------
// Cada 3 h: última publicación con éxito por red (historial de Upload-Post) y lo programado en las próximas 24 h.
// Si una red no publicó en 24 h y no tiene nada programado para las próximas 24 h, o si una publicación falló,
// aviso a Diego por Discord (una vez por red y por día).
state.redes ||= { avisos: {} };
const REDES = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook' };
export async function estadoRedes() {
  const now = Date.now();
  const hist = [];
  for (let page = 1; page <= 2; page++) {
    const j = await api(`/uploadposts/history?limit=50&page=${page}`);
    const h = j.history || j.result?.history || [];
    hist.push(...h.filter((x) => x.profile_username === PROFILE));
    if (h.length < 50) break;
  }
  const prog = await api(`/uploadposts/schedule?${new URLSearchParams({ profile_username: PROFILE, from: new Date(now).toISOString(), to: new Date(now + 24 * 3600e3).toISOString() })}`).catch(() => ({}));
  const redes = {};
  for (const red of Object.keys(REDES)) {
    const ok = hist.filter((x) => x.platform === red && x.success).map((x) => parseUtc(x.upload_timestamp)).sort((a, b) => b - a)[0] || null;
    const fallas = hist.filter((x) => x.platform === red && !x.success && now - parseUtc(x.upload_timestamp) < 24 * 3600e3).map((x) => String(x.error_message || x.error_code || 'error').slice(0, 120));
    const programadas = (prog.scheduled_posts || []).filter((j) => (j.platforms || []).includes(red)).length;
    redes[red] = { ultima: ok, horasSinPublicar: ok ? Math.round((now - ok) / 3600e3) : null, programadas24h: programadas, fallas };
  }
  return { redes, historial: hist.length, revisado: now };
}
export async function vigilarRedes() {
  const est = await estadoRedes();
  const hoy = diaHN(Date.now());
  const problemas = [];
  for (const [red, r] of Object.entries(est.redes)) {
    if ((r.horasSinPublicar === null || r.horasSinPublicar >= 24) && !r.programadas24h) problemas.push({ red, texto: `• **${REDES[red]}**: ${r.horasSinPublicar === null ? 'sin publicaciones recientes' : `${Math.round(r.horasSinPublicar / 2.4) / 10} días sin publicar`} y nada programado para las próximas 24 h` });
    if (r.fallas.length) problemas.push({ red: `${red}-falla`, texto: `• **${REDES[red]}**: ${r.fallas.length} publicación(es) fallaron hoy (${r.fallas[0]})` });
  }
  try { const rv = await reserva(); if (rv.baja) problemas.push({ red: 'reserva', texto: `• **Reserva baja**: solo ${rv.diasLlenos} día(s) con ${rv.porDia} videos programados (mínimo ${rv.minimo}). Hacen falta videos aprobados.` }); } catch {}
  const nuevos = problemas.filter((p) => state.redes.avisos[p.red] !== hoy);
  if (nuevos.length) {
    for (const p of nuevos) state.redes.avisos[p.red] = hoy;
    const pend = pendientesIgFb().length;
    try { const { mensajeDiscord } = await import('./voz.mjs'); await mensajeDiscord(`📵 **Redes sin publicar**\n${nuevos.map((p) => p.texto).join('\n')}${pend ? `\nHay ${pend} video(s) buenos ya publicados en TikTok que se pueden programar en Instagram/Facebook.` : ''}`); }
    catch (e) { log('community', `Alarma de redes: ${e.message}`, 'warn'); }
  }
  state.redes.ultimo = { ...est, problemas: problemas.map((p) => p.texto) };
  saveNow();
  return state.redes.ultimo;
}
setTimeout(() => vigilarRedes().catch((e) => log('community', `Alarma de redes: ${e.message}`, 'warn')), 3 * 60e3);
setInterval(() => vigilarRedes().catch(() => {}), 3 * 3600e3);

// ---------- Elegir cada día el mejor para Instagram/Facebook (Diego, 6 nov: "el que mejor rindió") ----------
// Del historial de Upload-Post: videos de la oficina publicados en TikTok los últimos 7 días, con sus métricas
// (get_post_analytics). Puntaje = vistas + 5·likes + 10·compartidos + 10·guardados, con al menos 20 vistas.
// Se programa el ganador para las 20:00 de hoy (o el próximo día libre). Si ninguno tiene métricas todavía,
// va el aprobado más reciente que no salió en IG/FB.
export async function elegirMejorIgFb({ dias = 30 } = {}) {
  const now = Date.now();
  const yaHoy = (await scheduledJobs(now, now + 30 * 3600e3, ['instagram', 'facebook'])).length + state.deliverables.filter((d) => d.igfb?.at > now && d.igfb.at < now + 30 * 3600e3).length;
  if (yaHoy) return { omitido: 'Ya hay un Reel programado en Instagram/Facebook para las próximas horas.' };
  const { callMcpTool } = await import('./connections.mjs');
  const hist = [];
  for (let page = 1; page <= 6; page++) {
    const j = await api(`/uploadposts/history?limit=50&page=${page}`);
    const h = j.history || j.result?.history || [];
    hist.push(...h.filter((x) => x.profile_username === PROFILE && x.platform === 'tiktok' && x.success && now - parseUtc(x.upload_timestamp) < dias * 86400e3 && now - parseUtc(x.upload_timestamp) >= 48 * 3600e3));
    if (h.length < 50 || (h.length && now - parseUtc(h.at(-1).upload_timestamp) > dias * 86400e3)) break;
  }
  const candidatos = [];
  for (const x of hist) {
    const d = state.deliverables.find((v) => x.external_id === `oficina-${v.id}` || (v.published?.jobId && v.published.jobId === x.job_id));
    if (!d || d.igfb?.jobId || !mejorParaIgFb(d)) continue;
    let m = null;
    try { const a = await callMcpTool('uploadpost', 'get_post_analytics', { requestId: x.request_id }); m = (a?.result?.platforms || a?.platforms || {}).tiktok?.post_metrics || null; } catch {}
    if (!m || (m.views || 0) < 20) continue;
    // Diego (10 nov): los mejores son los que retienen, no los que tienen más vistas.
    const r3 = (m.retention || []).find((r) => String(r.second) === '3');
    const ret3 = r3 ? Math.round(r3.percentage * 100) : null;
    const completo = m.full_video_watched_rate != null ? Math.round(m.full_video_watched_rate * 1000) / 10 : 0;
    const puntaje = (ret3 ?? 0) * 100 + completo * 10 + Math.min(m.views || 0, 999) / 1000;
    candidatos.push({ d, puntaje, vistas: m.views || 0, ret3, completo });
  }
  candidatos.sort((a, b) => b.puntaje - a.puntaje);
  let elegido = candidatos[0]?.d || null;
  let motivo = elegido ? `mejor retención de TikTok en ${dias} días (${candidatos[0].ret3 ?? '—'} % al segundo 3, ${candidatos[0].completo} % completo, ${candidatos[0].vistas} vistas)` : '';
  if (!elegido) {
    elegido = state.deliverables.filter((d) => d.published?.jobId && d.published.at < now && !d.igfb?.jobId && mejorParaIgFb(d)).sort((a, b) => b.published.at - a.published.at)[0] || null;
    motivo = 'ningún video con métricas suficientes: el aprobado más reciente ya publicado en TikTok';
  }
  if (!elegido) return { omitido: 'No hay videos aprobados pendientes para Instagram/Facebook.' };
  const r = await programarIgFb(elegido.id);
  log('community', `Instagram/Facebook: elegido "${elegido.title.replace(/^🎬\s*/, '')}" (${motivo})`, 'ok');
  state.redes.ultimaEleccionIgFb = { video: elegido.title.replace(/^🎬\s*/, ''), motivo, cuando: hnLabel(r.at), ts: Date.now() };
  saveNow();
  return { elegido: elegido.title, motivo, ...r, candidatos: candidatos.slice(0, 5).map((c) => ({ video: c.d.title, vistas: c.vistas, ret3: c.ret3, completo: c.completo })) };
}
// Todos los días a las 10:00 HN.
setInterval(() => {
  const d = new Date(Date.now() - HN_OFFSET_H * 3600e3);
  const hoy = d.toISOString().slice(0, 10);
  if (d.getUTCHours() !== 10 || state.redes.eleccionIgFb === hoy) return;
  state.redes.eleccionIgFb = hoy; saveNow();
  elegirMejorIgFb().catch((e) => log('community', `Elección para Instagram/Facebook: ${e.message}`, 'warn'));
}, 10 * 60e3);

// ---------- Número de WhatsApp en los textos (6 nov) ----------
// Si el dueño tiene un número PERSONAL que no debe salir en los textos publicados, ponelo en NUMERO_PERSONAL (solo dígitos)
// y el número de ventas (el que atiende el bot) en EMPRESA_WHATSAPP: todo lo que se publica lleva el de ventas.
// Sin esas dos variables, esta función no cambia nada.
export const numeroVentas = (t) => {
  const viejo = String(process.env.NUMERO_PERSONAL || '').replace(/\D/g, '');
  const nuevo = process.env.EMPRESA_WHATSAPP || '';
  if (!viejo || !nuevo) return String(t ?? '');
  const patron = new RegExp(`(\\+?\\d{1,3}[\\s-]+)?${viejo.slice(-8).replace(/(\d{4})(\d{4})/, '$1[\\s-]?$2')}`, 'g');
  return String(t ?? '').replace(patron, nuevo);
};

// Corrige el texto de las publicaciones ya programadas en Upload-Post (todas las redes). limite: cuántas cambiar.
export async function corregirNumeroProgramadas({ limite = 500, probar = false } = {}) {
  const now = Date.now();
  const q = new URLSearchParams({ profile_username: PROFILE, from: new Date(now).toISOString(), to: new Date(now + 400 * 86400e3).toISOString() });
  const { scheduled_posts: list = [] } = await api(`/uploadposts/schedule?${q}`);
  const malas = list.filter((p) => new RegExp(NUM_VIEJO.source).test(JSON.stringify(p.platform_content || {}) + (p.title || '') + (p.description || '') + (p.caption || '')));
  const out = { total: list.length, conNumeroViejo: malas.length, corregidas: 0, errores: [] };
  for (const p of malas.slice(0, limite)) {
    const pc = {};
    for (const [red, c] of Object.entries(p.platform_content || {})) pc[red] = { ...(c.title != null ? { title: numeroVentas(c.title) } : {}), ...(c.caption != null ? { caption: numeroVentas(c.caption) } : {}) };
    const body = { platform_content: pc };
    if (p.title) body.title = numeroVentas(p.title);
    if (p.description) body.description = numeroVentas(p.description);
    if (probar) { out.ejemplo = { job: p.job_id, body }; break; }
    try {
      await api(`/uploadposts/schedule/${encodeURIComponent(p.job_id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      out.corregidas++;
    } catch (e) { out.errores.push({ job: p.job_id, error: e.message }); }
  }
  for (const d of state.deliverables) if (d.published?.caption) d.published.caption = numeroVentas(d.published.caption);
  saveNow();
  log('community', `Número de WhatsApp corregido en ${out.corregidas} publicaciones programadas (de ${out.conNumeroViejo} con el número personal)`, out.errores.length ? 'warn' : 'ok');
  return out;
}
