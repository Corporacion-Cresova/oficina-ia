// Biblioteca de videos: Jarvis (y el equipo) pueden "ver" un video de YouTube, TikTok,
// Instagram o uno que Diego mande por WhatsApp, y quedarse con su transcripción y su análisis.
// Lo ve Gemini por OpenRouter (imagen y audio juntos), así no gasta el cupo de Claude.
// - YouTube: Gemini lo abre directo desde el link (sin descargar; los servidores suelen estar bloqueados).
// - Otros sitios: se descarga con yt-dlp en baja calidad y se le pasa el archivo.
// - Videos muy largos: solo el audio (alcanza para entender una charla y cuesta mucho menos).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { state, DATA_DIR, log, saveNow } from './state.mjs';

export const BIBLIOTECA_DIR = path.join(DATA_DIR, 'biblioteca');
export const ENTRANTES_DIR = path.join(BIBLIOTECA_DIR, 'entrantes');
const MODEL = process.env.VIDEO_MODEL || 'google/gemini-3.7-flash';
const MAX_VIDEO_S = 50 * 60;      // más largo que esto: solo audio
const MAX_INLINE_MB = 45;          // archivo que se manda entero a Gemini

state.biblioteca ||= [];

const idOf = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
const isYouTube = (u) => /(^|\.)youtube\.com\/|youtu\.be\//i.test(u);

function run(cmd, args, { timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} tardó demasiado`)); }, timeout);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error((err || out).trim().split('\n').at(-1)?.slice(0, 300) || `${cmd} terminó con código ${code}`)); });
  });
}

async function meta(url) {
  try {
    const j = JSON.parse(await run('yt-dlp', ['-J', '--no-warnings', '--no-playlist', url], { timeout: 60_000 }));
    return { titulo: j.title, canal: j.uploader || j.channel, duracion: j.duration, descripcion: String(j.description || '').slice(0, 1500) };
  } catch {
    if (!isYouTube(url)) return null;
    // Sin yt-dlp (YouTube bloquea servidores): al menos el título por oEmbed.
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15_000) });
      if (r.ok) { const j = await r.json(); return { titulo: j.title, canal: j.author_name }; }
    } catch {}
    return null;
  }
}

async function descargar(url, dir, { soloAudio = false } = {}) {
  const out = path.join(dir, soloAudio ? 'audio.%(ext)s' : 'video.%(ext)s');
  const fmt = soloAudio ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '9'] : ['-f', 'worst[ext=mp4][height>=360]/worst[ext=mp4]/worst', '--max-filesize', `${MAX_INLINE_MB}M`];
  await run('yt-dlp', ['--no-warnings', '--no-playlist', ...fmt, '-o', out, url], { timeout: 6 * 60_000 });
  const f = fs.readdirSync(dir).find((n) => n.startsWith(soloAudio ? 'audio.' : 'video.'));
  if (!f) throw new Error('No se pudo descargar el video.');
  return path.join(dir, f);
}

// Audio liviano para videos largos o archivos grandes (mono, 32 kbps).
async function aMp3(file, dir) {
  const out = path.join(dir, 'audio-liviano.mp3');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', out], { timeout: 10 * 60_000 });
  return out;
}

const PROMPT = (foco, m) => `Sos el analista de contenido de Cresova (agencia de páginas web, agentes de WhatsApp y marketing en Honduras). Mirá y escuchá este video completo${m?.titulo ? ` ("${m.titulo}"${m.canal ? `, de ${m.canal}` : ''})` : ''} y devolvé, en español y en Markdown, exactamente estas secciones:

## Resumen
3 a 6 líneas: de qué trata y cuál es la idea central.

## Ideas clave
Lista de las ideas, marcos, pasos o tácticas concretas que enseña o usa (con números, ejemplos y frases textuales importantes).

## Cómo aplicarlo en Cresova
Acciones concretas para Cresova (contenido, anuncios, ventas por WhatsApp, ofertas, lead magnets), en orden de impacto.

## Estructura del video
Gancho (qué pasa en los primeros 3 segundos, texto en pantalla y lo que se dice), desarrollo, cierre/CTA, duración y ritmo de cortes.

## Lo que se ve
Formato (persona a cámara, pantalla, b-roll, animación), textos en pantalla, subtítulos, música o efectos, y recursos visuales que lo hacen funcionar.

## Por qué funciona
Qué lo hace efectivo o viral, y qué se podría replicar.

## Transcripción
Todo lo que se dice, textual, en el idioma original${(m?.duracion || 0) > 20 * 60 ? ' (si es muy largo, textual en las partes importantes y resumido en el resto, marcando [resumen])' : ''}.
${foco ? `\nDiego quiere sobre todo: ${foco}` : ''}

MUY IMPORTANTE: trabajá solo con lo que de verdad ves y oís en el video que te llegó. Si no recibiste el video (te llega vacío, una pantalla de error, un aviso de inicio de sesión o de "no sos un robot"), NO lo reconstruyas con lo que sabés del autor: respondé únicamente NO_PUDE_VER.`;

async function gemini(parts) {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('Falta la llave de OpenRouter (Sistema → Llaves).');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://cresova.com', 'X-Title': 'Oficina Cresova - Biblioteca de videos' },
    body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: 24000, messages: [{ role: 'user', content: parts }] }),
    signal: AbortSignal.timeout(8 * 60_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error?.message || `OpenRouter respondió ${res.status}`);
  const text = String(j.choices?.[0]?.message?.content || '').trim();
  return { text: comprobar(text), costo: j.usage?.cost ?? null };
}

// Gemini no puede ver el video si YouTube lo bloquea; a veces igual "analiza" con lo que sabe del autor.
const BLOQUEO = /NO_PUDE_VER|LOGIN_REQUIRED|anti-?bot|confirm you.re not a bot|no (pude|puedo) (acceder|ver)/i;
function comprobar(text) {
  if (!text) throw new Error('Gemini no devolvió nada.');
  if (BLOQUEO.test(text.slice(0, 3000)) || BLOQUEO.test(text.match(/## Transcripción[\s\S]{0,600}/)?.[0] || '')) throw new Error('No pudo ver el video (bloqueado).');
  return text;
}

// ---------- YouTube con la llave de Google (Gemini): Google abre el video por dentro, sin bloqueos ----------
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
let geminiModelos = null;
// Modelos Flash disponibles con esta llave, del preferido al de respaldo (si uno está saturado, se usa otro).
async function modelosGoogle(key) {
  if (geminiModelos) return geminiModelos;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(20_000) });
    const j = await r.json();
    const ids = (j.models || []).filter((x) => (x.supportedGenerationMethods || []).includes('generateContent')).map((x) => x.name.replace('models/', ''));
    const ver = (n) => parseFloat(n.split('-')[1]) || 0;
    const flash = ids.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => ver(b) - ver(a));
    const lite = ids.filter((n) => /^gemini-[\d.]+-flash-lite$/.test(n)).sort((a, b) => ver(b) - ver(a));
    geminiModelos = [...new Set([...(ids.includes(GEMINI_MODEL) ? [GEMINI_MODEL] : []), ...flash.slice(0, 3), ...lite.slice(0, 1)])];
    if (!geminiModelos.length) geminiModelos = [GEMINI_MODEL];
  } catch { return [GEMINI_MODEL]; }
  return geminiModelos;
}
const saturado = (msg, status) => status === 429 || status === 503 || /high demand|overloaded|unavailable|try again/i.test(msg || '');
async function geminiYouTube(url, promptText) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const clean = `https://www.youtube.com/watch?v=${(url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/) || [])[1] || ''}`;
  let ultimo = null;
  for (const model of await modelosGoogle(key)) {
    for (let intento = 0; intento < 2; intento++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ file_data: { file_uri: clean } }, { text: promptText }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 32000, mediaResolution: 'MEDIA_RESOLUTION_LOW' } }),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        const text = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
        return { text: comprobar(text), costo: null, modelo: model };
      }
      ultimo = j.error?.message || `Google respondió ${res.status}`;
      if (!saturado(ultimo, res.status)) throw new Error(ultimo);
      await new Promise((r) => setTimeout(r, 8000 * (intento + 1)));
    }
  }
  throw new Error(`Gemini está saturado en este momento (${ultimo}). Probá de nuevo en un rato.`);
}

// ---------- YouTube por subtítulos (cuando el servidor logra leerlos) ----------
async function subtitulos(url, dir) {
  await run('yt-dlp', ['--no-warnings', '--no-playlist', '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'es.*,en.*,es,en', '--sub-format', 'vtt', '-o', path.join(dir, 'sub.%(ext)s'), url], { timeout: 90_000 });
  const f = fs.readdirSync(dir).find((n) => n.startsWith('sub') && n.endsWith('.vtt'));
  if (!f) return null;
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => l && !/-->|^WEBVTT|^Kind:|^Language:|^\d+$/.test(l)).map((l) => l.replace(/<[^>]+>/g, '').trim());
  const out = [];
  for (const l of lines) if (l && l !== out.at(-1)) out.push(l);
  fs.rmSync(path.join(dir, f), { force: true });
  return out.join(' ').slice(0, 200_000) || null;
}

const b64 = (file) => fs.readFileSync(file).toString('base64');
const videoPart = (file) => ({ type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64(file)}` } });
const audioPart = (file) => ({ type: 'input_audio', input_audio: { data: b64(file), format: 'mp3' } });

/** Ve un video y lo guarda en la biblioteca. `url` o `archivo` (nombre en entrantes/). */
export async function verVideo({ url, archivo, foco = '', por = 'coordinador' } = {}) {
  url = String(url || '').trim();
  archivo = archivo ? path.basename(String(archivo)) : '';
  if (!url && !archivo) throw new Error('Pasá el link del video o el archivo que mandó Diego.');
  const id = idOf(url || archivo);
  const prev = state.biblioteca.find((x) => x.id === id);
  if (prev && !foco) return { ...prev, ficha: leerFicha(id), yaEstaba: true };

  const dir = path.join(BIBLIOTECA_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const m = url ? await meta(url) : null;
  const prompt = { type: 'text', text: PROMPT(foco, m) };
  let r = null, via = '';
  const largo = (m?.duracion || 0) > MAX_VIDEO_S;

  if (archivo) {
    const file = path.join(ENTRANTES_DIR, archivo);
    if (!fs.existsSync(file)) throw new Error('No encuentro ese archivo.');
    const mb = fs.statSync(file).size / 1e6;
    r = await gemini([prompt, mb <= MAX_INLINE_MB ? videoPart(file) : audioPart(await aMp3(file, dir))]);
    via = mb <= MAX_INLINE_MB ? 'video completo (WhatsApp)' : 'solo audio (archivo grande)';
  } else {
    if (isYouTube(url)) {
      // 1) Con la llave de Google: Gemini ve el video completo (imagen y audio) desde los servidores de Google.
      try { r = await geminiYouTube(url, prompt.text); if (r) via = `video completo (Google ${r.modelo})`; } catch (e) { log(por, `Gemini (Google) no pudo con el video: ${e.message}`, 'warn'); }
      // 2) Subtítulos de YouTube, si el servidor logra leerlos: el análisis sale del texto real.
      if (!r) {
        const subs = await subtitulos(url, dir).catch(() => null);
        if (subs) { r = await gemini([{ type: 'text', text: `${prompt.text}\n\nNo tenés el video: tenés sus SUBTÍTULOS reales (abajo). Basate solo en ellos; en "Lo que se ve" poné "No disponible (solo subtítulos)". En "Transcripción" pegá los subtítulos ordenados en párrafos.\n\n--- SUBTÍTULOS ---\n${subs}` }]); via = 'subtítulos de YouTube'; }
      }
      if (!r) throw new Error(process.env.GEMINI_API_KEY?.trim()
        ? 'YouTube bloqueó el video y Google tampoco pudo abrirlo (¿es privado o tiene restricción de edad?). Pedile a Diego el video como archivo por WhatsApp.'
        : 'YouTube bloquea al servidor y todavía falta la llave de Google Gemini (Sistema → Conexiones y llaves). Decile a Diego que la agregue, o que mande el video como archivo por WhatsApp.');
    }
    if (!r) {
      try {
        if (largo) { r = await gemini([prompt, audioPart(await descargar(url, dir, { soloAudio: true }))]); via = 'solo audio (video largo)'; }
        else {
          const file = await descargar(url, dir);
          r = await gemini([prompt, videoPart(file)]);
          via = 'video completo (descargado)';
        }
      } catch (e) {
        const ig = /instagram\.com/i.test(url);
        throw new Error(`No pude ver ese video (${e.message.slice(0, 160)}).${ig ? ' Instagram suele bloquear los servidores: pedile a Diego que te mande el video como archivo por WhatsApp.' : ' Si es privado o está bloqueado, que Diego te lo mande como archivo por WhatsApp.'}`);
      }
    }
    // Lo descargado ya no hace falta: queda la ficha.
    for (const n of fs.readdirSync(dir)) if (/^(video|audio)/.test(n)) fs.rmSync(path.join(dir, n), { force: true });
  }

  const titulo = m?.titulo || (r.text.match(/## Resumen\s*\n+([^\n]{10,120})/)?.[1] || archivo || url).slice(0, 140);
  const cabecera = `# ${titulo}\n\n- Fuente: ${url || `archivo de WhatsApp (${archivo})`}\n${m?.canal ? `- Canal: ${m.canal}\n` : ''}${m?.duracion ? `- Duración: ${Math.round(m.duracion / 60)} min\n` : ''}- Visto: ${new Date().toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa' })} · ${via}${foco ? `\n- Foco pedido: ${foco}` : ''}\n\n`;
  fs.writeFileSync(path.join(dir, 'ficha.md'), cabecera + r.text);
  const item = { id, url: url || null, archivo: archivo || null, titulo, canal: m?.canal || null, duracion: m?.duracion || null, ts: Date.now(), por,
    resumen: (r.text.match(/## Resumen\s*\n+([\s\S]*?)(\n## |$)/)?.[1] || '').trim().slice(0, 600), costo: r.costo };
  state.biblioteca = [item, ...state.biblioteca.filter((x) => x.id !== id)].slice(0, 300);
  saveNow();
  log(por, `Vio un video: ${titulo}`, 'ok');
  return { ...item, ficha: cabecera + r.text };
}

export function leerFicha(id) {
  const f = path.join(BIBLIOTECA_DIR, path.basename(String(id)), 'ficha.md');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

// Para responder sin gastar cupo de más: todo menos la transcripción (que se pide aparte).
export function fichaSinTranscripcion(texto) {
  const i = texto.indexOf('## Transcripción');
  return i < 0 ? texto : `${texto.slice(0, i)}## Transcripción\n(Guardada en la biblioteca: pedila con leer_video si la necesitás.)`;
}

export const listaBiblioteca = () => state.biblioteca.map(({ id, titulo, canal, url, archivo, duracion, ts, resumen }) => ({ id, titulo, canal, url, archivo, duracion, ts, resumen }));

/** Guarda un video que Diego mandó por WhatsApp. Devuelve el nombre del archivo. */
export function guardarEntrante(buf, ext = 'mp4') {
  fs.mkdirSync(ENTRANTES_DIR, { recursive: true });
  const name = `wa-${new Date().toISOString().slice(0, 10)}-${idOf(buf.subarray(0, 4096).toString('base64') + buf.length)}.${ext.replace(/\W/g, '') || 'mp4'}`;
  fs.writeFileSync(path.join(ENTRANTES_DIR, name), buf);
  // Se guardan los últimos 30: los videos pesan.
  const all = fs.readdirSync(ENTRANTES_DIR).map((n) => ({ n, t: fs.statSync(path.join(ENTRANTES_DIR, n)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const x of all.slice(30)) fs.rmSync(path.join(ENTRANTES_DIR, x.n), { force: true });
  return name;
}

export function borrarFicha(id) {
  id = path.basename(String(id));
  state.biblioteca = state.biblioteca.filter((x) => x.id !== id);
  fs.rmSync(path.join(BIBLIOTECA_DIR, id), { recursive: true, force: true });
  saveNow();
}
