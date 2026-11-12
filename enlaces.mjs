// Enlaces públicos temporales a un video aprobado, para que Renata lo suba a Meta (Meta pide una URL pública y
// los videos de la oficina están detrás de la contraseña). Cada enlace sirve un solo video y vence en pocas horas.
// Se publican por el dominio de las demos: https://demo.preview.cresova.com/v/<token>/<nombre>.mp4
import crypto from 'node:crypto';
import fs from 'node:fs';
import { state, log, saveNow } from './state.mjs';
import { renderFile } from './estudio.mjs';

const BASE = (process.env.PUBLIC_DEMOS_URL || 'https://demo.preview.cresova.com').replace(/\/+$/, '');
state.enlacesVideo ||= {};
const E = state.enlacesVideo;

function limpiar() {
  for (const [t, e] of Object.entries(E)) if (e.exp < Date.now()) delete E[t];
}

const slug = (s) => String(s || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'video';

export function crearEnlace(entregable, { horas = 6, por = 'media' } = {}) {
  const d = state.deliverables.find((x) => x.id === entregable || x.id.startsWith(String(entregable || '').trim()));
  if (!d || d.kind !== 'video') throw new Error('No hay un video con ese id en el Estudio.');
  if (d.status !== 'approved') throw new Error('Diego todavía no aprobó ese video en el Estudio: el enlace público es solo para videos aprobados.');
  const file = renderFile(d.video.video, d.video.name);
  if (!file) throw new Error('El archivo del render ya no está en el servidor.');
  limpiar();
  const h = Math.min(24, Math.max(1, Number(horas) || 6));
  const token = crypto.randomBytes(24).toString('hex');
  E[token] = { d: d.id, exp: Date.now() + h * 3600e3, por, ts: Date.now() };
  saveNow();
  log(por, `Enlace público temporal (${h} h) para subir a Meta: ${d.title}`, 'info');
  return { url: `${BASE}/v/${token}/${slug(d.title.replace(/^[^\w]+/, ''))}.mp4`, vence: new Date(E[token].exp).toISOString(), titulo: d.title, bytes: fs.statSync(file).size };
}

// GET/HEAD /publico/video/<token>: sin contraseña, con soporte de Range (Meta baja por partes).
export function servirEnlace(req, res, token) {
  const e = /^[0-9a-f]{48}$/.test(token) ? E[token] : null;
  const no = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(msg); };
  if (!e || e.exp < Date.now()) return no(404, 'Enlace vencido o inexistente');
  const d = state.deliverables.find((x) => x.id === e.d);
  const file = d?.kind === 'video' && d.status === 'approved' ? renderFile(d.video.video, d.video.name) : null;
  if (!file) return no(404, 'Video no disponible');
  const size = fs.statSync(file).size;
  const head = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  const m = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  e.descargas = (e.descargas || 0) + 1;
  fs.createReadStream(file).pipe(res);
}

// Tipo del video: el que se marcó (guion, render o Diego); si no, por el título ("📣 Anuncio · …").
export const tipoVideo = (d) => d.tipo || (/anuncio/i.test(d.title || '') ? 'anuncio' : 'organico');

// Videos que Renata puede subir: los aprobados, primero los marcados como anuncio.
export function videosParaPauta(dias = 30) {
  const desde = Date.now() - dias * 86400e3;
  return state.deliverables
    .filter((d) => d.kind === 'video' && d.ts > desde && d.status === 'approved')
    .sort((a, b) => (tipoVideo(b) === 'anuncio') - (tipoVideo(a) === 'anuncio') || b.ts - a.ts)
    .slice(0, 30)
    .map((d) => ({ id: d.id.slice(0, 8), titulo: d.title, tipo: tipoVideo(d), carpeta: d.video.video, publicado_en_redes: Boolean(d.published), meta: d.meta || null }));
}

// Después de subirlo: se guarda el id del video (y del anuncio) en Meta, para medir costo por lead y por demo de cada video.
export function registrarEnMeta(entregable, { video_id, anuncio_id } = {}) {
  const d = state.deliverables.find((x) => x.kind === 'video' && (x.id === entregable || x.id.startsWith(String(entregable || '').trim())));
  if (!d) throw new Error('No hay un video con ese id.');
  d.meta = { ...(d.meta || {}), ...(video_id ? { videoId: String(video_id) } : {}), ...(anuncio_id ? { anuncioId: String(anuncio_id) } : {}), ts: Date.now() };
  d.tipo ||= 'anuncio';
  saveNow();
  return d.meta;
}
