// Estudio de video en el VPS: recibe el motor de cresova-motion (privado, en
// el volumen de datos) y renderiza videos con su propio render.js
// (Playwright + Chromium + ffmpeg). Los trabajos van en cola y con prioridad
// baja para no frenar al resto de servicios del servidor.
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, log, broadcast, addDeliverable, state, readDeliverable, saveNow } from './state.mjs';
import { linkDeliverable, createTask } from './tareas.mjs';

export const ESTUDIO_DIR = path.join(DATA_DIR, 'estudio');
const TOOLKIT = process.env.ESTUDIO_TOOLKIT || '/opt/estudio';
const OUT = 'renders-vps';
// El VPS tiene 8 núcleos y le sobra CPU (con 2 renders usaba ~30 %): hasta 6 procesos de render a la vez
// (cada uno va a ~1 cuadro por segundo). Los videos largos se parten en trozos que cuentan como procesos.
const MAX_PARALLEL = Number(process.env.ESTUDIO_PARALLEL || 6);
const PARTIR_DESDE = 75; // segundos: un video más largo se renderiza por partes en paralelo
const MAX_PARTES = 4;
const MAX_UPLOAD = 600 * 1024 * 1024;
const LOG_LINES = 200;

const jobs = new Map();
const queue = [];
let running = 0;

function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} terminó con código ${code}: ${err.slice(-400)}`))));
  });
}

// Las dependencias pesadas (playwright, three) viven en la imagen; el motor
// las ve como si estuvieran en su propia carpeta.
function linkToolkit() {
  const link = path.join(ESTUDIO_DIR, 'node_modules');
  const target = path.join(TOOLKIT, 'node_modules');
  if (!fs.existsSync(target)) return;
  try { fs.lstatSync(link); } catch { fs.symlinkSync(target, link, 'dir'); }
}

// destino 'estudio' = motor de cresova-motion; 'plugin' = la skill, privada, en /data/plugins.
export async function receiveUpload(req, destino = 'estudio') {
  const dest = destino === 'plugin' ? path.join(DATA_DIR, 'plugins') : ESTUDIO_DIR;
  fs.mkdirSync(dest, { recursive: true });
  const tmp = path.join(DATA_DIR, `subida-${Date.now()}.tgz`);
  const out = fs.createWriteStream(tmp);
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_UPLOAD) throw new Error('El paquete supera los 600 MB.');
      if (!out.write(chunk)) await once(out, 'drain');
    }
    out.end();
    await once(out, 'finish');
    await exec('tar', ['xzf', tmp, '-C', dest, '--no-same-owner', '--no-same-permissions']);
  } finally {
    out.destroy();
    fs.rmSync(tmp, { force: true });
  }
  if (destino !== 'plugin') linkToolkit();
  log(null, `Estudio: ${destino === 'plugin' ? 'skill' : 'motor'} actualizado (${Math.round(size / 1024 / 1024)} MB)`, 'system');
  return { size, videos: listVideos() };
}

export function listVideos() {
  const dir = path.join(ESTUDIO_DIR, 'videos');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((v) => fs.existsSync(path.join(dir, v, 'src', 'render.js'))).sort();
}

// Para la sala del Estudio: cada video con su locución y las notas de quien lo hizo.
function readScript(folder) {
  try {
    const md = fs.readFileSync(path.join(ESTUDIO_DIR, 'videos', folder, 'plan', 'script.md'), 'utf8');
    const m = md.match(/--- TEXTO PARA ELEVENLABS ---\s*([\s\S]*?)--- FIN ---/);
    return (m ? m[1] : md).replace(/\[[a-z ]+\]\s*/gi, '').trim().slice(0, 1500);
  } catch {
    return '';
  }
}

export function videoReviews() {
  const all = state.deliverables;
  return all.filter((d) => d.kind === 'video').slice(-60).reverse().map(({ content, file, ...d }) => {
    const folder = d.video?.video || '';
    const notes = all.slice(-80).reverse().find((x) => x.kind === 'informe' && x.agentId === d.agentId
      && Math.abs(x.ts - d.ts) < 36 * 3600e3 && folder && readDeliverable(x.id)?.includes(folder));
    return { ...d, folder, script: readScript(folder), notesId: notes?.id || null };
  });
}

const segsLog = (log) => { const m = (log || []).join(' ').match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)?.at(-1)?.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0; };
const publicJob = ({ proc, hijos, ...j }) => {
  const out = { ...j, log: j.log.slice(-40) };
  if (hijos) {
    const hs = hijos.map((id) => jobs.get(id)).filter(Boolean);
    out.partes = hs.length;
    out.partesListas = hs.filter((h) => h.status === 'done').length;
    out.hecho = Math.round(hs.reduce((a, h) => a + (h.status === 'done' ? h.tramo : h.status === 'running' ? Math.min(h.tramo, segsLog(h.log)) : 0), 0));
  }
  return out;
};

export function listJobs() {
  return [...jobs.values()].filter((j) => !j.padre).sort((a, b) => b.createdAt - a.createdAt).map(publicJob);
}

export function startRender({ video, from, to, scale = 1, fps = 30, name, review, prioridad = false } = {}) {
  if (typeof video !== 'string' || !/^[\w-]+$/.test(video)) throw new Error('Nombre de video inválido.');
  const dir = path.join(ESTUDIO_DIR, 'videos', video);
  if (!fs.existsSync(path.join(dir, 'src', 'render.js'))) throw new Error('Ese video no está en el estudio.');
  const num = (v, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error('Parámetros de render fuera de rango.');
    return n;
  };
  const args = [path.join('videos', video, 'src', 'render.js'), '--fps', String(num(fps, 1, 60)), '--scale', String(num(scale, 0.1, 1))];
  if (from != null) args.push('--from', String(num(from, 0, 600)));
  if (to != null) args.push('--to', String(num(to, 0.1, 600)));
  const label = (typeof name === 'string' && /^[\w .-]{1,60}$/.test(name) ? name : 'VPS') + ` ${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  args.push('--out', path.join(OUT, video), '--name', label);
  const audio = path.join('videos', video, 'renders', 'mix.wav');
  if (fs.existsSync(path.join(ESTUDIO_DIR, audio))) args.push('--audio', audio);

  // Duración del video (del audio mezclado) para estimar cuánto falta.
  let duracion = null;
  try {
    const fd = fs.openSync(path.join(ESTUDIO_DIR, audio), 'r');
    const h = Buffer.alloc(44); fs.readSync(fd, h, 0, 44, 0); fs.closeSync(fd);
    const byteRate = h.readUInt32LE(28);
    if (byteRate) duracion = Math.round((fs.statSync(path.join(ESTUDIO_DIR, audio)).size - 44) / byteRate);
  } catch {}
  if (from != null || to != null) duracion = Math.max(0, (to ?? duracion ?? 0) - (from ?? 0)) || duracion;
  const job = {
    id: randomUUID(), video, label, args: args.slice(1), status: 'queued', duracion, prioridad: Boolean(prioridad),
    createdAt: Date.now(), startedAt: null, endedAt: null, seconds: null,
    file: `${video}/${label}.mp4`, bytes: null, log: [], review: review || null, qa: null,
  };
  jobs.set(job.id, job);
  // Se guarda para retomarlo si la oficina se reinicia en medio del render.
  (state.renderPending ||= []).push({ id: job.id, params: { video, from, to, scale, fps, name, review, prioridad } });
  saveNow();
  // Video largo: se parte en trozos que se renderizan a la vez (un 2:50 pasa de ~1,5 h a ~25 min). Al final se
  // pegan y se les pone el audio completo.
  if (from == null && to == null && duracion > PARTIR_DESDE) {
    const n = Math.min(MAX_PARTES, Math.ceil(duracion / 45));
    const tramo = Math.ceil(duracion / n);
    const carpeta = path.join(OUT, video, `partes-${job.id.slice(0, 8)}`);
    job.hijos = [];
    const hijos = [];
    for (let k = 0; k < n; k++) {
      const a = k * tramo, b = Math.min(duracion, (k + 1) * tramo);
      if (b <= a) break;
      const h = {
        id: randomUUID(), padre: job.id, video, label: `parte-${k}`, tramo: b - a, status: 'queued', createdAt: Date.now(), startedAt: null, endedAt: null, seconds: null,
        args: [path.join('videos', video, 'src', 'render.js'), '--from', String(a), '--to', String(b), '--fps', String(fps), '--scale', String(scale), '--out', carpeta, '--name', `parte-${k}`].slice(1),
        file: path.relative(OUT, path.join(carpeta, `parte-${k}.mp4`)).split(path.sep).join('/'), bytes: null, log: [],
      };
      jobs.set(h.id, h); job.hijos.push(h.id); hijos.push(h);
    }
    job.carpeta = carpeta;
    if (prioridad) queue.unshift(...hijos); else queue.push(...hijos);
    log(review?.agentId || null, `Render de ${video} (${Math.round(duracion)} s) partido en ${hijos.length} partes que van a la vez`, 'info');
    pump();
    return publicJob(job);
  }
  if (prioridad) queue.unshift(job); else queue.push(job);
  pump();
  return publicJob(job);
}

// Diego necesita un video ya: pasa al frente de la cola (y queda primero si la oficina se reinicia).
export function priorizarRender(id) {
  const job = jobs.get(id);
  if (!job) throw new Error('Ese render no existe.');
  if (job.status !== 'queued' && !(job.hijos && job.status === 'running')) throw new Error(job.status === 'running' ? 'Ya se está renderizando.' : 'Ya terminó.');
  const mover = job.hijos ? job.hijos.map((h) => jobs.get(h)).filter((h) => h && h.status === 'queued') : [job];
  for (const m of mover) { const i = queue.indexOf(m); if (i >= 0) queue.splice(i, 1); }
  queue.unshift(...mover);
  job.prioridad = true;
  const p = (state.renderPending || []).find((x) => x.id === id);
  if (p) { p.params.prioridad = true; state.renderPending = [p, ...state.renderPending.filter((x) => x !== p)]; saveNow(); }
  emit(job);
  log(job.review?.agentId || null, `Render priorizado por Diego: ${job.video}`, 'info');
  return publicJob(job);
}

// Diego cancela un render (en cola o andando): se detiene y no se vuelve a encargar al reiniciar.
export function cancelarRender(id) {
  const job = jobs.get(id);
  if (!job) throw new Error('Ese render no existe.');
  if (!['queued', 'running'].includes(job.status)) throw new Error('Ese render ya terminó.');
  const todos = [job, ...(job.hijos || []).map((h) => jobs.get(h)).filter(Boolean)];
  for (const j of todos) {
    const i = queue.indexOf(j);
    if (i >= 0) queue.splice(i, 1);
    j.cancelado = true;
    if (j.status === 'running' && j.proc) { try { j.proc.kill('SIGKILL'); } catch {} }
    else j.status = 'cancelado';
  }
  forget(job);
  job.status = 'cancelado';
  job.endedAt = Date.now();
  emit(job);
  log(job.review?.agentId || null, `Render cancelado por Diego: ${job.video}`, 'warn');
  return publicJob(job);
}

function forget(job) {
  state.renderPending = (state.renderPending || []).filter((x) => x.id !== job.id);
  saveNow();
}

// Al arrancar: los renders que quedaron a medias o en cola se vuelven a encargar.
setTimeout(() => {
  const pending = [...(state.renderPending || [])].sort((a, b) => Boolean(b.params?.prioridad) - Boolean(a.params?.prioridad));
  state.renderPending = [];
  for (const { params } of pending) {
    try { startRender(params); log(params.review?.agentId || null, `Render retomado tras el reinicio: ${params.video}`, 'info'); }
    catch (e) { log(null, `No se pudo retomar el render de ${params.video}: ${e.message}`, 'error'); }
  }
}, 5000);

function pump() {
  while (running < MAX_PARALLEL && queue.length) runJob(queue.shift());
}

function runJob(job) {
  running++;
  job.status = 'running';
  job.startedAt = Date.now();
  emit(job);
  // nice 10: el render cede CPU a la oficina, n8n y los demás servicios.
  const p = spawn('nice', ['-n', '10', 'node', ...[path.join('videos', job.video, 'src', 'render.js'), ...job.args]], {
    cwd: ESTUDIO_DIR, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
  });
  Object.defineProperty(job, 'proc', { value: p, enumerable: false, writable: true });
  job.ultimoAvance = Date.now(); job.ultimoCuadro = -1;
  const onData = (d) => {
    for (const line of String(d).split(/\r?\n|\r/)) {
      if (!line.trim()) continue;
      job.log.push(line.slice(0, 300));
      const fr = Number(line.match(/frame=\s*(\d+)/)?.[1]);
      if (fr > job.ultimoCuadro) { job.ultimoCuadro = fr; job.ultimoAvance = Date.now(); }
    }
    if (job.log.length > LOG_LINES) job.log.splice(0, job.log.length - LOG_LINES);
  };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  if (job.padre) {
    const padre = jobs.get(job.padre);
    if (padre && padre.status === 'queued') { padre.status = 'running'; padre.startedAt = Date.now(); emit(padre); }
  }
  p.on('close', (code) => {
    if (job.cancelado) { running--; job.status = 'cancelado'; emit(job); pump(); return; }
    if (job.padre) { running--; terminarParte(job, code); pump(); return; }
    running--;
    forget(job);
    job.endedAt = Date.now();
    job.seconds = Math.round((job.endedAt - job.startedAt) / 1000);
    const file = path.join(ESTUDIO_DIR, OUT, job.file);
    job.bytes = fs.existsSync(file) ? fs.statSync(file).size : null;
    job.status = code === 0 && job.bytes ? 'done' : 'failed';
    log(job.review?.agentId || null, `Render de ${job.video} ${job.status === 'done' ? `listo en ${Math.round(job.seconds / 60)} min` : 'falló'}`, job.status === 'done' ? 'ok' : 'error');
    emit(job);
    pump();
    if (job.status === 'done') finish(job, file).catch((e) => log(null, `Control de calidad falló: ${e.message}`, 'error'));
    else if (job.review) deliverFailure(job);
  });
  p.on('error', (e) => { job.log.push(`No se pudo iniciar: ${e.message}`); });
}

async function terminarParte(h, code) {
  h.endedAt = Date.now();
  h.seconds = Math.round((h.endedAt - h.startedAt) / 1000);
  const f = path.join(ESTUDIO_DIR, OUT, h.file);
  h.status = code === 0 && fs.existsSync(f) ? 'done' : 'failed';
  const padre = jobs.get(h.padre);
  if (!padre || padre.status === 'failed' || padre.status === 'done') return;
  const hs = padre.hijos.map((id) => jobs.get(id));
  if (h.status === 'failed') {
    for (const o of hs) if (o.status === 'queued') { o.status = 'failed'; const i = queue.indexOf(o); if (i >= 0) queue.splice(i, 1); }
    padre.log.push(`Falló la ${h.label}: ${h.log.slice(-3).join(' | ')}`);
    return cerrarPadre(padre, false);
  }
  emit(padre);
  if (!hs.every((o) => o.status === 'done')) return;
  // Todas listas: se pegan sin recodificar y se les pone el audio completo.
  const dir = path.join(ESTUDIO_DIR, padre.carpeta);
  fs.writeFileSync(path.join(dir, 'lista.txt'), hs.map((o) => `file '${path.basename(o.file)}'`).join('\n'));
  const dest = path.join(ESTUDIO_DIR, OUT, padre.file);
  const audio = path.join(ESTUDIO_DIR, 'videos', padre.video, 'renders', 'mix.wav');
  const args = ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'lista.txt')];
  if (fs.existsSync(audio)) args.push('-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest');
  else args.push('-c', 'copy');
  args.push('-movflags', '+faststart', dest);
  try { await exec('ffmpeg', args); cerrarPadre(padre, true); fs.rmSync(dir, { recursive: true, force: true }); }
  catch (e) { padre.log.push(`No se pudieron pegar las partes: ${e.message}`); cerrarPadre(padre, false); }
}
function cerrarPadre(job, ok) {
  forget(job);
  job.endedAt = Date.now();
  job.seconds = Math.round((job.endedAt - (job.startedAt || job.createdAt)) / 1000);
  const file = path.join(ESTUDIO_DIR, OUT, job.file);
  job.bytes = ok && fs.existsSync(file) ? fs.statSync(file).size : null;
  job.status = ok && job.bytes ? 'done' : 'failed';
  log(job.review?.agentId || null, `Render de ${job.video} ${job.status === 'done' ? `listo en ${Math.round(job.seconds / 60)} min (por partes)` : 'falló'}`, job.status === 'done' ? 'ok' : 'error');
  emit(job);
  if (job.status === 'done') finish(job, file).catch((e) => log(null, `Control de calidad falló: ${e.message}`, 'error'));
  else if (job.review) deliverFailure(job);
}

// Vigía: un render que no avanza ni un cuadro en 10 minutos está trabado (pasó con el G1 el 4 nov: 40 minutos en el
// cuadro 361). Se detiene y se reporta con el segundo donde se quedó, en vez de girar para siempre.
const TRABADO_MS = 10 * 60e3;
setInterval(() => {
  for (const job of jobs.values()) {
    if (job.status !== 'running' || !job.proc || job.trabado) continue;
    // Punto de control cada 10 min: si en ese rato avanzó menos de 60 cuadros (2 s de video), está trabado o se arrastra.
    job.control ||= { ts: job.startedAt, cuadro: 0 };
    if (Date.now() - job.control.ts < TRABADO_MS) continue;
    const avance = Math.max(0, job.ultimoCuadro) - job.control.cuadro;
    if (avance >= 60) { job.control = { ts: Date.now(), cuadro: Math.max(0, job.ultimoCuadro) }; continue; }
    const seg = segsLog(job.log);
    job.trabado = `${avance ? `avanzó solo ${avance} cuadros en 10 minutos` : '10 minutos sin avanzar'}, en el cuadro ${Math.max(0, job.ultimoCuadro)} (segundo ${seg.toFixed(1)}${job.padre ? ` de la ${job.label}` : ''})`;
    job.log.push(`Detenido por la oficina: ${job.trabado}`);
    if (job.padre) { const padre = jobs.get(job.padre); if (padre) padre.trabado = job.trabado; }
    log(job.review?.agentId || jobs.get(job.padre)?.review?.agentId || null, `Render de ${job.video} trabado: ${job.trabado}. Se detuvo`, 'error');
    try { job.proc.kill('SIGKILL'); } catch {}
  }
}, 60e3);

function emit(job) {
  if (job.padre) { const padre = jobs.get(job.padre); if (padre) emit(padre); return; }
  broadcast({ type: 'render', job: publicJob(job) });
}

export function renderFile(video, file) {
  if (!/^[\w-]+$/.test(video) || !/^[\w .-]+\.mp4$/.test(file)) return null;
  const f = path.join(ESTUDIO_DIR, OUT, video, file);
  return fs.existsSync(f) ? f : null;
}

// ---------- control de calidad y entrega para aprobación ----------
function capture(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => resolve({ code: -1, out: e.message }));
    p.on('close', (code) => resolve({ code, out }));
  });
}

async function quality(file) {
  const probe = await capture('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', file]);
  let width = null; let height = null; let duration = null;
  try {
    const j = JSON.parse(probe.out);
    const v = j.streams.find((x) => x.width);
    width = v?.width; height = v?.height; duration = Number(j.format.duration);
  } catch { /* se informa como desconocido */ }
  const loud = await capture('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const lufs = Number([...loud.out.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
  const peak = Number([...loud.out.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].at(-1)?.[1]);
  const scan = fs.existsSync(path.join(ESTUDIO_DIR, 'scripts', 'scan_negro.mjs'))
    ? await capture('node', ['scripts/scan_negro.mjs', file], { cwd: ESTUDIO_DIR })
    : { code: 0, out: 'sin escáner' };
  return {
    width, height, duration, lufs, peak,
    formatOk: width === 1080 && height === 1920,
    loudOk: lufs >= -17 && lufs <= -15,
    peakOk: peak <= -1,
    negro: scan.out.trim().split('\n').slice(-6).join('\n').slice(0, 600),
  };
}

async function finish(job, file) {
  job.qa = await quality(file);
  emit(job);
  if (!job.review) return;
  const q = job.qa;
  const mark = (ok) => (ok ? '✓' : '⚠');
  const md = [
    `## ${job.review.title}`,
    '',
    `Video listo para revisar: \`videos/${job.video}\` · render en el servidor en ${Math.round(job.seconds / 60)} min.`,
    '',
    '| Control | Resultado |',
    '|---|---|',
    `| Formato | ${q.width}×${q.height} ${mark(q.formatOk)} |`,
    `| Duración | ${q.duration?.toFixed(1)} s |`,
    `| Volumen | ${q.lufs} LUFS ${mark(q.loudOk)} (objetivo −16) |`,
    `| Pico | ${q.peak} dBFS ${mark(q.peakOk)} |`,
    '',
    '**Escáner de cuadros negros:**',
    '',
    '```',
    q.negro || 'sin salida',
    '```',
  ].join('\n');
  const taskId = job.review.taskId || null;
  const d = addDeliverable(job.review.agentId, `🎬 ${job.review.title.replace(/^🎬\s*/, '')}`, md, { video: { video: job.video, name: `${job.label}.mp4` }, ...(taskId ? { taskId } : {}), ...(job.review.tipo === 'anuncio' ? { tipo: 'anuncio' } : {}) });
  if (taskId) linkDeliverable(taskId, d.id, { video: true });
  log(job.review.agentId, `Video para aprobar: ${job.review.title}`, 'deliverable');
  // Orgánicos: el revisor automático los mira y, si pasan, se aprueban solos (autonomía de Diego, 5 nov).
  import('./autonomia.mjs').then((a) => a.videoListo(d, file, q)).catch((e) => log(null, `Revisor automático: ${e.message}`, 'warn'));
}

function deliverFailure(job) {
  const taskId = job.review.taskId || null;
  const d = addDeliverable(job.review.agentId, `⚠ Render ${job.trabado ? 'trabado' : 'fallido'}: ${job.review.title}`,
    `El render de \`videos/${job.video}\` ${job.trabado ? `se trabó: ${job.trabado}. Casi siempre es código de la escena en ese segundo (un recurso que nunca carga, una espera infinita o algo que se vuelve más pesado en cada cuadro). Revisá ese tramo con una vista previa corta (--from/--to) antes de volver a renderizar` : 'falló'}.\n\nÚltimas líneas del registro:\n\n\`\`\`\n${job.log.slice(-25).join('\n')}\n\`\`\``,
    taskId ? { taskId } : {});
  if (taskId) linkDeliverable(taskId, d.id, { video: true });
  if (job.trabado && job.review.agentId) {
    state.renderArreglos ||= {};
    if (Date.now() - (state.renderArreglos[job.video] || 0) < 24 * 3600e3) return;
    state.renderArreglos[job.video] = Date.now();
    saveNow();
    try {
      createTask({
        assignee: job.review.agentId, createdBy: 'diego', priority: 'alta',
        title: `Arreglar render trabado: ${job.video}`.slice(0, 140),
        description: `El render de \`videos/${job.video}\` (${job.review.title}) se trabó: ${job.trabado}. La oficina lo detuvo.

Cómo encontrarlo y arreglarlo:
1. Medí la velocidad por tramos (2 s cada uno, escala 0.5, --jpg en cache/): al inicio, justo antes del segundo trabado, en el segundo trabado y al final. Anotá cuántos cuadros por segundo da cada tramo (lo normal es 1 o más).
2. Si el tramo trabado es lento aunque empiece ahí (--from en ese segundo): la escena es pesada en sí (filtros blur/shadow grandes, demasiados elementos, imágenes gigantes, video embebido, un recurso que nunca carga o un await que no resuelve). Simplificala.
3. Si solo es lento cuando viene de atrás (rápido empezando ahí, lento renderizando desde 0): hay acumulación. renderFrame(t) tiene que ser idempotente: no crear elementos, listeners, partículas ni canvas nuevos en cada cuadro sin borrar los anteriores; calcular todo desde t.
4. Cuando todos los tramos den 1 cuadro/s o más, volvé a renderizar el video completo y entregalo como siempre.`,
      });
    } catch (e) { log(null, `No se pudo crear la tarea para arreglar ${job.video}: ${e.message}`, 'error'); }
  }
}
