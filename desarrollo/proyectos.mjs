// Desarrollo: el "Lovable" de Cresova dentro de la oficina.
// Cada proyecto es una carpeta con la plantilla de Cresova (React + Tailwind) y su historial en git.
// El constructor (Claude, con el plan de Diego) edita los archivos, compila, mira capturas en celular
// y computadora, y corrige. La vista previa queda pública en demo.preview.cresova.com/<proyecto>/.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { state, DATA_DIR, log, broadcast, saveNow, addDeliverable, listDeliverables, reviewDeliverable } from '../state.mjs';
import { noteRateLimit, noteSpend, isLimitError, onLimitHit, isBlocked } from '../cupo.mjs';
import { saldoOpenRouter } from '../secrets.mjs';
import * as S from './sitios.mjs'; // desde el corte, Luis y Ashley trabajan en Sitios (servicio aparte)
const R = () => S.activo(); // true: el motor es Sitios; false: el Desarrollo local de siempre

const HERE = import.meta.dirname;
export const PROYECTOS_DIR = path.join(DATA_DIR, 'proyectos');
const PLANTILLA = path.join(HERE, 'plantilla');
const KIT = path.join(HERE, 'kit');
const PROMPT = path.join(HERE, '..', 'prompts', 'constructor.md');
export const PREVIEW_HOST = process.env.PREVIEW_HOST || 'demo.preview.cresova.com';
const MODEL = process.env.CONSTRUCTOR_MODEL || 'claude-sonnet-5-5';
const MODEL_DEMO = process.env.CONSTRUCTOR_MODEL_DEMO || 'claude-opus-5-5';   // la primera versión y las correcciones del revisor
const REVIEW_MODEL = process.env.REVISOR_MODEL || 'claude-sonnet-5-5';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'google/gemini-3.1-flash-image';

state.proyectos ||= [];
const P = state.proyectos;
const running = new Map(); // slug → AbortController

const emit = (p) => { saveNow(); broadcast({ type: 'proyecto', proyecto: publicProyecto(p) }); };
export const publicProyecto = ({ chat, sessionId, ...p }) => ({ ...p, trabajando: running.has(p.id) || (R() && Boolean(p.trabajandoRemoto)), mensajes: (chat || []).length, fechaSugerida: p.origen?.conv ? fechaSugerida(p) : null });
export const listarProyectos = () => P.slice().sort((a, b) => b.actualizado - a.actualizado).map(publicProyecto);
export const getProyecto = (id) => P.find((p) => p.id === id);
export const dirOf = (id) => path.join(PROYECTOS_DIR, path.basename(id));
export const previewUrl = (id) => `https://${PREVIEW_HOST}/${id}/`;

function run(cmd, args, { cwd, timeout = 180_000, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let out = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} tardó demasiado`)); }, timeout);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(Object.assign(new Error(out.trim().slice(-3000) || `${cmd} terminó con código ${code}`), { out })); });
  });
}
const git = (id, ...args) => run('git', ['-c', `user.name=${process.env.GIT_NOMBRE || 'Constructor Oficina'}`, '-c', `user.email=${process.env.GIT_CORREO || 'oficina@example.com'}`, ...args], { cwd: dirOf(id), timeout: 60_000 });

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'proyecto';

function copiar(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    if (e.isDirectory()) copiar(a, b); else fs.copyFileSync(a, b);
  }
}

/** Crea un proyecto nuevo a partir de la plantilla y el brief del cliente. */
export async function crearProyecto({ nombre, rubro = '', ciudad = '', whatsapp = '', brief = '', por = 'diego', origen = null }) {
  nombre = String(nombre || '').trim();
  if (!nombre) throw new Error('Falta el nombre del negocio.');
  if (R()) {
    const p = S.mezclar(await S.api('proyectos', { metodo: 'POST', cuerpo: { nombre, rubro, ciudad, whatsapp, brief, por, origen } }));
    log('constructor', `Proyecto nuevo en Sitios: ${nombre}`, 'start');
    emit(p);
    return p;
  }
  let id = slugify(nombre);
  for (let i = 2; P.some((p) => p.id === id) || fs.existsSync(dirOf(id)); i++) id = `${slugify(nombre).slice(0, 36)}-${i}`;
  const dir = dirOf(id);
  copiar(PLANTILLA, dir);
  fs.rmSync(path.join(dir, '.bolt'), { recursive: true, force: true });
  copiar(KIT, path.join(dir, '.cresova', 'kit'));
  fs.copyFileSync(path.join(PLANTILLA, '.bolt', 'prompt'), path.join(dir, '.cresova', 'PLANTILLA.md'));
  fs.writeFileSync(path.join(dir, '.cresova', 'BRIEF.md'), `# ${nombre}\n\n- Rubro: ${rubro || '(sin definir)'}\n- Ciudad: ${ciudad || '(sin definir)'}\n- WhatsApp: ${whatsapp || '(sin definir)'}\n\n## Lo que sabemos del cliente\n${brief || '(nada más por ahora)'}\n`);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\ndist\n.cresova/capturas\n');
  // Las dependencias se comparten: la plantilla trae su node_modules instalado en la imagen.
  const nm = path.join(PLANTILLA, 'node_modules');
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await git(id, 'init', '-q');
  await git(id, 'add', '-A');
  await git(id, 'commit', '-q', '-m', 'Plantilla de Cresova');
  const p = { id, nombre, rubro, ciudad, whatsapp, estado: 'nuevo', por, origen, ts: Date.now(), actualizado: Date.now(), version: 1, preview: previewUrl(id), chat: [], sessionId: null, error: null, tieneBuild: false };
  P.push(p);
  log('constructor', `Proyecto nuevo: ${nombre}`, 'start');
  emit(p);
  return p;
}

// ---------- compilar y mirar ----------
// Las fotos generadas salen de ~2 MB: se pasan a JPG liviano (máx. 1600 px) para que el sitio cargue rápido en el celular.
async function optimizarFotos(dir) {
  const fotos = path.join(dir, 'public', 'fotos');
  if (!fs.existsSync(fotos)) return;
  for (const n of fs.readdirSync(fotos)) {
    const f = path.join(fotos, n);
    if (!/\.(jpe?g|png|webp)$/i.test(n) || fs.statSync(f).size < 450_000) continue;
    const tmp = `${f}.tmp.jpg`;
    try {
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', f, '-vf', "scale='min(1600,iw)':-2", '-q:v', '4', tmp], { timeout: 60_000 });
      fs.renameSync(tmp, f);
    } catch { fs.rmSync(tmp, { force: true }); }
  }
}

export async function compilar(id) {
  if (R()) { const r = S.mezclar(await S.api(`proyectos/${encodeURIComponent(id)}/compilar`, { metodo: 'POST', timeout: 300_000 })); if (r) emit(r); return true; }
  const dir = dirOf(id);
  await optimizarFotos(dir);
  const vite = path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) throw new Error('Faltan las dependencias de la plantilla en el servidor.');
  await run(process.execPath, [vite, 'build', '--base', './', '--logLevel', 'error'], { cwd: dir, timeout: 240_000 });
  const p = getProyecto(id);
  if (p) { p.tieneBuild = true; p.compilado = Date.now(); }
  return true;
}

let chromium = null;
function playwright() {
  if (chromium) return chromium;
  const req = createRequire(path.join(process.env.ESTUDIO_TOOLKIT || '/opt/estudio', 'package.json'));
  chromium = req('playwright').chromium;
  return chromium;
}

/** Capturas de la vista previa: computadora (página entera, reducida) y celular (primera pantalla y página entera). */
export async function capturas(id) {
  if (R()) return { carpeta: null, errores: [] }; // Sitios saca las capturas al compilar
  const out = path.join(dirOf(id), '.cresova', 'capturas');
  fs.mkdirSync(out, { recursive: true });
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/p/${id}/`;
  const browser = await playwright().launch();
  const errores = [];
  try {
    for (const [nombre, opts, full] of [
      ['computadora', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 0.5 }, true],
      ['celular', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, false],
      ['celular-completo', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 0.6, isMobile: true, hasTouch: true }, true],
    ]) {
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 300)));
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      // Las animaciones de aparición se disparan al bajar: se recorre la página antes de la foto.
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, `${nombre}.jpg`), type: 'jpeg', quality: 72, fullPage: full });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return { carpeta: out, errores: [...new Set(errores)] };
}

const PRIVADO = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[|tools_|.*\.internal$|.*\.local$|.*easypanel\.host$|panel\.cresova\.com$)/i;
export async function referencia(id, url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Dirección inválida.'); }
  if (!/^https?:$/.test(u.protocol) || PRIVADO.test(u.hostname) || !u.hostname.includes('.')) throw new Error('Solo sitios públicos de internet.');
  const out = path.join(dirOf(id), '.cresova', 'referencias');
  fs.mkdirSync(out, { recursive: true });
  const base = slugify(u.hostname + u.pathname).slice(0, 40);
  const browser = await playwright().launch();
  try {
    for (const [nombre, opts] of [['computadora', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 0.5 }], ['celular', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 0.6, isMobile: true, hasTouch: true }]]) {
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      await page.goto(u.href, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
      await page.evaluate(async () => { for (let y = 0; y < Math.min(document.body.scrollHeight, 12000); y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(out, `${base}-${nombre}.jpg`), type: 'jpeg', quality: 70, fullPage: true });
      await ctx.close();
    }
  } finally { await browser.close(); }
  return `Capturas guardadas: .cresova/referencias/${base}-computadora.jpg y ${base}-celular.jpg (miralas con Read).`;
}

// ---------- fotos generadas ----------
// Fotos con Runware (FLUX.2): ~US$ 0,0006 la normal y ~US$ 0,03 la "alta" (la de portada). Mucho más barato que Nano Banana por OpenRouter.
async function fotoRunware(key, prompt, formato, calidad) {
  const [w, h] = { horizontal: [1280, 720], vertical: [768, 1024], cuadrada: [1024, 1024] }[formato] || [1280, 720];
  const model = calidad === 'alta' ? 'bfl:5@1' : 'runware:400@4'; // FLUX.2 [pro] / FLUX.2 [klein] 4B
  const res = await fetch('https://api.runware.ai/v1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify([{ taskType: 'imageInference', taskUUID: randomUUID(), positivePrompt: prompt, model, width: w, height: h, outputType: 'URL', outputFormat: 'JPG', numberResults: 1 }]),
    signal: AbortSignal.timeout(120_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.errors?.length || j.error) throw new Error(j.errors?.[0]?.message || j.error?.message || `Runware respondió ${res.status}`);
  const url = j.data?.[0]?.imageURL;
  if (!url) throw new Error('Runware no devolvió una imagen.');
  const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw new Error(`No pude bajar la imagen (HTTP ${img.status}).`);
  return Buffer.from(await img.arrayBuffer());
}

async function generarFoto(id, descripcion, archivo, formato = 'horizontal', calidad = 'normal') {
  const rw = process.env.RUNWARE_API_KEY?.trim();
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!rw && !key) throw new Error('Falta la llave de Runware (o la de OpenRouter) para generar fotos.');
  const name = `${slugify(archivo || descripcion).slice(0, 40)}.jpg`;
  // Ahorro de saldo (el mismo saldo de OpenRouter es el del vendedor de WhatsApp):
  // 1) si esa foto ya existe, se reutiliza (los rediseños no la vuelven a pagar);
  const destino = path.join(dirOf(id), 'public', 'fotos', name);
  if (fs.existsSync(destino)) return `fotos/${name}`;
  // 2) tope de fotos generadas por proyecto;
  const proy = getProyecto(id);
  const tope = rw ? 30 : 8;
  if (proy && (proy.fotosIA || 0) >= tope) throw new Error(`Ya se generaron ${tope} fotos para este proyecto (el tope). Usá las fotos del cliente, ilustración o composición tipográfica.`);
  if (rw) {
    // Con Runware cada foto cuesta centavos y no toca el saldo del vendedor.
    const alta = calidad === 'alta' && (proy?.fotosAlta || 0) < 3 ? 'alta' : 'normal';
    const prompt = `Fotografía realista y profesional para el sitio web de un negocio en Honduras. ${descripcion}. Luz natural, colores reales, sin texto, sin marcas de agua, calidad de fotografía comercial.`;
    let buf = null;
    try { buf = await fotoRunware(rw, prompt, formato, alta); } catch (e) {
      // Respaldo: si Runware falla (caída, saldo), la foto sale por OpenRouter para que la demo no quede sin imágenes.
      if (!key) throw e;
      log('constructor', `Runware falló (${e.message}); la foto sale por OpenRouter`, 'warn');
    }
    if (buf) {
    const dirRw = path.join(dirOf(id), 'public', 'fotos');
    fs.mkdirSync(dirRw, { recursive: true });
    fs.writeFileSync(path.join(dirRw, name), buf);
    if (proy) { proy.fotosIA = (proy.fotosIA || 0) + 1; if (alta === 'alta') proy.fotosAlta = (proy.fotosAlta || 0) + 1; saveNow(); }
    return `fotos/${name}`;
    }
  }
  // 3) sin Runware: si el saldo de OpenRouter está bajo, no se gasta: hay que dejarle saldo al vendedor.
  const saldo = await saldoOpenRouter();
  if (saldo != null && saldo < 3) throw new Error(`El saldo de OpenRouter está bajo (US$ ${saldo.toFixed(2)}): no se generan fotos para no dejar sin saldo al vendedor de WhatsApp. Seguí sin esa foto: usá las del cliente, ilustración, gradientes o composición tipográfica.`);
  const forma = { horizontal: '16:9', vertical: '3:4', cuadrada: '1:1' }[formato] || '16:9';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://cresova.com', 'X-Title': 'Oficina Cresova - Fotos de demos' },
    body: JSON.stringify({ model: IMAGE_MODEL, modalities: ['image', 'text'], image_config: { aspect_ratio: forma },
      messages: [{ role: 'user', content: `Fotografía realista y profesional para el sitio web de un negocio en Honduras. ${descripcion}. Formato ${forma}. Luz natural, colores reales, sin texto, sin logos, sin marcas de agua, personas latinas si aparecen personas.` }] }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error?.message || `OpenRouter respondió ${res.status}`);
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url || '';
  const m = url.match(/^data:image\/\w+;base64,(.+)$/);
  if (!m) throw new Error('El modelo no devolvió una imagen.');
  const dir = path.join(dirOf(id), 'public', 'fotos');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from(m[1], 'base64'));
  if (proy) { proy.fotosIA = (proy.fotosIA || 0) + 1; saveNow(); }
  return `fotos/${name}`;
}

// ---------- el constructor ----------
function herramientas(p, flags) {
  const text = (t) => ({ content: [{ type: 'text', text: t }] });
  return createSdkMcpServer({
    name: 'obra',
    version: '1.0.0',
    tools: [
      tool('compilar_y_revisar', 'Compila el sitio y saca capturas: computadora (página entera), celular (primera pantalla) y celular (página entera). Devuelve errores y las rutas de las capturas: miralas con Read antes de dar algo por terminado.', {}, async () => {
        setTrabajo(p, 'Compilando y mirando cómo quedó…');
        try { await compilar(p.id); } catch (e) { return { content: [{ type: 'text', text: `La compilación falló:\n${e.message}` }], isError: true }; }
        flags.compilado = true;
        emit(p);
        try {
          const r = await capturas(p.id);
          return text(`Compilado. Capturas en .cresova/capturas/: computadora.jpg, celular.jpg y celular-completo.jpg (miralas con Read).${r.errores.length ? `\nErrores en el navegador:\n- ${r.errores.join('\n- ')}` : ''}`);
        } catch (e) {
          return text(`Compilado, pero no se pudieron sacar capturas: ${e.message}`);
        }
      }),
      tool('generar_foto', 'Genera una foto realista para el sitio y la guarda en public/fotos/. Devuelve la ruta para usar en el código (por ejemplo "fotos/taller-frente.jpg", relativa, sin barra inicial). Usala solo para fotos que representen honestamente al negocio (máximo 8 por proyecto).', {
        descripcion: z.string().describe('Qué se ve en la foto, concreto y del rubro. Ej.: "mecánico revisando el motor de un pickup en un taller limpio"'),
        archivo: z.string().optional().describe('Nombre corto del archivo, sin extensión'),
        formato: z.enum(['horizontal', 'vertical', 'cuadrada']).optional(),
        calidad: z.enum(['normal', 'alta']).optional().describe('"normal" (casi gratis) para el resto; "alta" solo para la foto de portada o la más importante (máximo 3 por proyecto)'),
      }, async ({ descripcion, archivo, formato, calidad }) => {
        const topeFotos = process.env.RUNWARE_API_KEY?.trim() ? 30 : 12;
        if ((p.fotos || 0) >= topeFotos) return { content: [{ type: 'text', text: `Ya se generaron ${topeFotos} fotos en este proyecto: usá las que hay.` }], isError: true };
        setTrabajo(p, 'Generando una foto…');
        try {
          const ruta = await generarFoto(p.id, descripcion, archivo, formato, calidad);
          p.fotos = (p.fotos || 0) + 1;
          return text(`Foto guardada: ${ruta}`);
        } catch (e) { return { content: [{ type: 'text', text: `No se pudo generar: ${e.message}` }], isError: true }; }
      }),
      tool('mirar_referencia', 'Saca capturas de un sitio de referencia que Diego quiere como norte (computadora y celular) y las guarda en .cresova/referencias/. Miralas con Read y tomá de ahí la dirección: composición, tipografía, ritmo, tratamiento de fotos. No copies textos ni marcas.', {
        url: z.string().describe('Dirección completa del sitio, con https://'),
      }, async ({ url }) => {
        setTrabajo(p, 'Mirando el sitio de referencia…');
        try { return text(await referencia(p.id, url)); } catch (e) { return { content: [{ type: 'text', text: `No pude abrir la referencia: ${e.message}` }], isError: true }; }
      }),
      tool('guardar_regla_diseno', 'Guarda una preferencia de diseño GENERAL de Diego para todos los proyectos futuros (ej.: "nada de fondos negros salvo que la marca lo pida", "titulares en minúscula, nunca todo en mayúsculas"). No la uses para cambios de un solo proyecto.', {
        regla: z.string().max(300),
      }, async ({ regla }) => {
        state.reglasDiseno.push({ regla: regla.trim(), ts: Date.now(), proyecto: p.id });
        saveNow();
        log('constructor', `Regla de diseño guardada: ${regla.trim()}`, 'info');
        return text('Guardada: vale para todos los proyectos.');
      }),
      tool('limpiar_logo', 'Convierte un logo con fondo blanco (el JPG típico que mandan por WhatsApp) en PNG transparente, más una versión en blanco para fondos oscuros. Usalo SIEMPRE que el cliente haya mandado su logo; mirá el resultado con Read antes de usarlo.', {
        archivo: z.string().describe('Nombre del archivo dentro de public/fotos, por ejemplo original-imagen-abc.jpg'),
        tolerancia: z.number().min(0.02).max(0.4).optional().describe('Cuánto blanco quitar (0.12 por defecto; subilo si queda un halo, bajalo si se come partes del logo)'),
      }, async ({ archivo, tolerancia }) => {
        try { const r = await limpiarLogo(p.id, archivo, { tolerancia }); return text(`Logo transparente: ${r.transparente} · versión clara para fondos oscuros: ${r.claro}. Miralos con Read (public/${r.transparente}).`); }
        catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
      }),
      tool('estado', 'Cuenta en una frase corta qué estás haciendo (Diego lo ve en vivo).', { texto: z.string() }, async ({ texto }) => { setTrabajo(p, texto); return text('ok'); }),
    ],
  });
}

function setTrabajo(p, texto) {
  p.trabajo = String(texto).slice(0, 160);
  broadcast({ type: 'proyecto-trabajo', id: p.id, texto: p.trabajo });
}

const dentro = (dir) => async (input) => {
  const f = path.resolve(dir, String(input?.tool_input?.file_path ?? ''));
  if ((f === dir || f.startsWith(dir + path.sep)) && !f.includes(`${path.sep}node_modules`) && !f.includes(`${path.sep}.git${path.sep}`)) return {};
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Solo podés tocar los archivos de este proyecto.' } };
};

// Leer: solo el proyecto (y los resultados largos de herramientas que guarda el SDK). Nada de llaves ni datos de la oficina.
const soloLeer = (dir) => async (input) => {
  const ti = input?.tool_input || {};
  const f = path.resolve(dir, String(ti.file_path ?? ti.path ?? '.'));
  if ((f === dir || f.startsWith(dir + path.sep) || /[\/]tool-results[\/]/.test(f)) && !f.includes(`${path.sep}.git${path.sep}`)) return {};
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Solo podés leer los archivos de este proyecto.' } };
};

const addMsg = (p, role, text, extra = {}) => {
  // Con Sitios, el chat vive allá: los avisos de la oficina (envíos, cambios pedidos) se anotan como nota y vuelven por los eventos.
  if (R()) { S.api(`proyectos/${encodeURIComponent(p.id)}`, { metodo: 'PATCH', cuerpo: { nota: String(text).slice(0, 500) } }).catch(() => {}); return; }
  const m = { role, text: String(text).slice(0, 20000), ts: Date.now(), ...extra };
  p.chat.push(m);
  if (p.chat.length > 300) p.chat.splice(0, p.chat.length - 300);
  broadcast({ type: 'proyecto-msg', id: p.id, mensaje: m });
};

export const ocupado = (id) => running.has(id) || (R() && Boolean(getProyecto(id)?.trabajandoRemoto));

// Cola: cuántos proyectos se construyen a la vez. El resto espera su turno (y se ve "En cola").
const MAX_A_LA_VEZ = Number(process.env.CONSTRUCTORES_A_LA_VEZ || 1);
let activos = 0;
const espera = [];
const tomarTurno = () => (activos < MAX_A_LA_VEZ ? (activos++, Promise.resolve()) : new Promise((r) => espera.push(r)).then(() => { activos++; }));
const soltarTurno = () => { activos = Math.max(0, activos - 1); espera.shift()?.(); };
export function detener(id) { if (R()) { S.api(`proyectos/${encodeURIComponent(id)}/detener`, { metodo: 'POST' }).catch(() => {}); return; } running.get(id)?.abort(); }

// Reglas de diseño que Diego fue dejando ("no me gustan los fondos negros", "más aire entre secciones"…):
// valen para todos los proyectos y mandan sobre cualquier otra guía.
state.reglasDiseno ||= [];
// 2026-11-04: la regla vieja ("evitar imágenes hechas con IA… resolver con ilustración") hacía que Ashley mandara a quitar
// TODAS las fotos y que Luis pusiera dibujos aunque Diego pidiera imágenes. Diego quiere fotos: se reescribe.
const FOTOS_REGLA = 'Las demos llevan FOTOS que se vean reales y profesionales (del cliente o generadas con generar_foto). Si una foto generada sale con defectos (manos o caras raras, texto borroso, objetos deformes), se REGENERA con una descripción mejor o calidad alta; nunca se reemplaza por dibujos o ilustraciones de línea.';
for (const r of state.reglasDiseno) {
  if (/hechas con IA/i.test(r.regla) && /ilustraci/i.test(r.regla)) { r.regla = `Hero sobrio y elegante: nada de fondos de color saturado a sangre (naranja/amarillo chillante) ni neón. ${FOTOS_REGLA}`; r.editada = Date.now(); }
}
const reglasTexto = () => state.reglasDiseno.length ? `\n\n## Reglas de diseño de Diego (mandan sobre todo lo demás)\n${state.reglasDiseno.map((r) => `- ${r.regla}`).join('\n')}` : '';
export const listarReglas = () => state.reglasDiseno;
export function editarRegla(i, regla) { const r = state.reglasDiseno[Number(i)]; if (!r || !String(regla || '').trim()) throw new Error('Regla inválida.'); r.regla = String(regla).trim().slice(0, 400); r.editada = Date.now(); saveNow(); if (R()) S.api(`reglas/${Number(i)}`, { metodo: 'PUT', cuerpo: { regla: r.regla } }).catch((e) => log('constructor', `No se pudo guardar la regla en Sitios: ${e.message}`, 'warn')); return state.reglasDiseno; }
export function borrarRegla(i) { state.reglasDiseno.splice(Number(i), 1); saveNow(); if (R()) S.api(`reglas/${Number(i)}`, { metodo: 'DELETE' }).catch((e) => log('constructor', `No se pudo borrar la regla en Sitios: ${e.message}`, 'warn')); return state.reglasDiseno; }

function msgsDe(p, q, onResult) {
  return (async () => {
    let reply = '';
    for await (const msg of q) {
      if (msg.session_id && onResult.session) p.sessionId = msg.session_id;
      if (msg.type === 'assistant') {
        for (const b of msg.message?.content || []) {
          if (b.type === 'tool_use' && /^(Write|Edit)$/.test(b.name)) setTrabajo(p, `Editando ${path.basename(String(b.input?.file_path || ''))}…`);
          else if (b.type === 'tool_use' && b.name === 'Read' && /capturas/.test(String(b.input?.file_path))) setTrabajo(p, onResult.revisor ? 'El revisor está mirando las capturas…' : 'Mirando las capturas…');
          else if (b.type === 'tool_use' && b.name === 'Read' && /referencias/.test(String(b.input?.file_path))) setTrabajo(p, 'Mirando la referencia…');
        }
      } else if (msg.type === 'rate_limit_event') noteRateLimit(msg.rate_limit_info);
      else if (msg.type === 'result') {
        if (typeof msg.total_cost_usd === 'number') { noteSpend('constructor', msg.total_cost_usd); p.costo = (p.costo || 0) + msg.total_cost_usd; }
        if (msg.subtype === 'success') reply = String(msg.result || '').trim();
        else if (isLimitError(JSON.stringify(msg))) throw new Error(String(msg.result || 'Límite de uso de Claude'));
        else reply = reply || 'No pude terminar esta vez.';
      }
    }
    return reply;
  })();
}

// Un turno del constructor (con su sesión, para que recuerde la conversación).
async function turno(p, texto, { abort, flags, model }) {
  const dir = dirOf(p.id);
  // Proyectos creados antes de que existieran las skills: se les agregan.
  copiar(KIT, path.join(dir, '.cresova', 'kit')); // el kit (guía de estilo y skills) siempre al día
  const system = `${fs.readFileSync(PROMPT, 'utf8')}${reglasTexto()}\n\n## Este proyecto\n- Negocio: ${p.nombre}${p.rubro ? ` (${p.rubro})` : ''}\n- Carpeta: ${dir}\n- Vista previa pública: ${p.preview}\n- Estado: ${p.estado}${fs.existsSync(path.join(dir, 'public', 'fotos')) ? `\n- Fotos disponibles: ${fs.readdirSync(path.join(dir, 'public', 'fotos')).join(', ')}` : ''}`;
  const q = query({
    prompt: texto,
    options: {
      model, effort: 'high', systemPrompt: system, cwd: dir, settingSources: [], resume: p.sessionId || undefined, abortController: abort, maxTurns: 140,
      mcpServers: { obra: herramientas(p, flags) },
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'mcp__obra__compilar_y_revisar', 'mcp__obra__generar_foto', 'mcp__obra__estado', 'mcp__obra__mirar_referencia', 'mcp__obra__guardar_regla_diseno', 'mcp__obra__limpiar_logo'],
      disallowedTools: ['Bash', 'NotebookEdit', 'WebSearch', 'WebFetch', 'Task'],
      hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [dentro(dir)] }, { matcher: 'Read|Grep|Glob', hooks: [soloLeer(dir)] }] },
      canUseTool: async () => ({ behavior: 'deny', message: 'Esa herramienta no está habilitada en el constructor.' }),
    },
  });
  return msgsDe(p, q, { session: true });
}

// El revisor: otros ojos, sin la sesión del constructor. Mira capturas y código y califica sin tocar nada.
const REVISOR = `Sos el **Revisor de calidad de Cresova**. Un constructor acaba de terminar un sitio. Tu trabajo es decidir si está a la altura del estándar de Diego: "Cresova no tiene que tener comparación". Tiene que parecer hecho por un estudio de diseño para ESTE negocio, nunca una plantilla ni algo hecho por IA.

Cómo revisás:
1. Leé \`.cresova/BRIEF.md\` y **\`.cresova/kit/ESTILO-CRESOVA.md\`** (lo que Diego aprueba: impacto comercial nivel Lovable). Después \`.cresova/kit/skills/ui-pro-rules.md\` y \`.cresova/kit/skills/web-interface-guidelines.md\` para la calidad técnica. Para que no sea una plantilla genérica, usá \`.cresova/kit/skills/ai-tells-catalog.md\` (pero una página sobria o plana es PEOR que una con degradados o íconos bien usados).
   Si existen capturas de referencia en \`.cresova/referencias/\`, miralas y compará el nivel de impacto.
2. Mirá con Read las capturas \`.cresova/capturas/computadora.jpg\`, \`celular.jpg\` y \`celular-completo.jpg\`. También \`src/App.tsx\` y \`src/index.css\`.
3. Calificá de 1 a 10 con honestidad. 8 o más significa que el dueño del negocio la abre y dice \"¡wow!\", y que se ve igual o mejor que las páginas de Lovable de las referencias. Si se ve plana, apagada, con mucho fondo liso o sin una portada de impacto, no pasa de 6. **Fotos:** una página de negocio sin fotos (solo dibujos o ilustraciones de línea) no pasa de 6. Si una foto generada tiene defectos visibles (manos o caras raras, texto ilegible, objetos deformes), pedí REGENERARLA con una descripción concreta mejor o calidad alta; nunca pidas quitar las fotos ni cambiarlas por ilustración.
4. Llamá **una sola vez** a \`mcp__revision__veredicto\` con el puntaje, un resumen de una línea y hasta 8 cambios concretos, ordenados por impacto. Que sean concretos y accionables, por ejemplo: "El hero usa fondo casi negro con un solo acento rojo: es un vicio de IA; probá un fondo claro cálido de taller con el rojo solo en botones". Nada de "mejorar el diseño".
No edites archivos.`;

async function revisar(p, abort) {
  const dir = dirOf(p.id);
  let veredicto = null;
  const srv = createSdkMcpServer({
    name: 'revision', version: '1.0.0',
    tools: [tool('veredicto', 'Tu veredicto final sobre el sitio.', {
      puntaje: z.number().min(1).max(10), resumen: z.string().max(300), cambios: z.array(z.string().max(400)).max(8),
    }, async (v) => { veredicto = v; return { content: [{ type: 'text', text: 'Recibido.' }] }; })],
  });
  const q = query({
    prompt: `Revisá el sitio de ${p.nombre}${p.rubro ? ` (${p.rubro})` : ''}.${reglasTexto()}`,
    options: {
      model: REVIEW_MODEL, effort: 'high', systemPrompt: REVISOR, cwd: dir, settingSources: [], abortController: abort, maxTurns: 40,
      mcpServers: { revision: srv },
      allowedTools: ['Read', 'Glob', 'Grep', 'mcp__revision__veredicto'],
      disallowedTools: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebSearch', 'WebFetch', 'Task'],
      hooks: { PreToolUse: [{ matcher: 'Read|Grep|Glob', hooks: [soloLeer(dir)] }] },
      canUseTool: async () => ({ behavior: 'deny', message: 'Solo podés leer.' }),
    },
  });
  await msgsDe(p, q, { revisor: true });
  return veredicto;
}

// Después de cada turno: si cambió algo, se compila (si hacía falta), se sacan capturas y se guarda la versión.
async function cerrarTurno(p, texto, flags) {
  const id = p.id;
  try {
    const cambios = (await git(id, 'status', '--porcelain')).trim();
    if (!cambios) return false;
    if (!flags.compilado) { setTrabajo(p, 'Actualizando la vista previa…'); await compilar(id).catch((e) => { p.error = `No compila: ${e.message.slice(0, 200)}`; }); }
    await capturas(id).catch(() => {});
    await git(id, 'add', '-A');
    await git(id, 'commit', '-q', '-m', texto.replace(/\s+/g, ' ').slice(0, 72));
    p.version = Number((await git(id, 'rev-list', '--count', 'HEAD')).trim()) || p.version + 1;
    emit(p);
    return true;
  } catch (e) { log('constructor', `No se pudo guardar la versión de ${p.nombre}: ${e.message}`, 'warn'); return false; }
}

/** Diego (o la oficina) le pide algo al constructor en un proyecto. Con `revisar`, pasa por el revisor de calidad. */
export async function pedir(id, texto, { por = 'diego', revisar: conRevision = false, fuerte = false, retomar = false } = {}) {
  const p = getProyecto(id);
  if (!p) throw new Error('Proyecto no encontrado.');
  texto = String(texto || '').trim();
  if (!texto) throw new Error('Mensaje vacío.');
  if (R()) {
    const r = await S.api(`proyectos/${encodeURIComponent(id)}/pedir`, { metodo: 'POST', cuerpo: { texto, por, revisar: conRevision, fuerte } });
    log('constructor', `Pedido enviado a Sitios: ${p.nombre}`, 'info');
    return r.estado;
  }
  // Si Luis está ocupado con este proyecto, el pedido queda en cola y sale solo al terminar
  // (antes se perdía sin aviso: la tarjeta de la Bandeja decía "enviado" y nadie lo hacía).
  if (running.has(id)) {
    (p.cola ||= []).push({ texto, por, revisar: conRevision, fuerte });
    addMsg(p, 'user', texto, { por });
    addMsg(p, 'sistema', 'Luis está terminando otra cosa en este proyecto: este pedido quedó en cola y lo hace apenas termine.');
    emit(p); saveNow();
    return 'En cola';
  }
  if (isBlocked()) throw new Error('Se acabó el cupo de Claude por ahora: probá cuando se renueve.');
  if (!retomar) addMsg(p, 'user', texto, { por });
  p.enCurso = { texto, por, revisar: conRevision, fuerte, ts: Date.now() };
  saveNow();
  const abort = new AbortController();
  running.set(id, abort);
  // La primera versión define la calidad: modelo más fuerte y revisor. También cuenta una demo que quedó a medio armar
  // (tiene build de un intento cortado por un reinicio, pero nunca se anunció).
  const demoNueva = !p.tieneBuild || (p.estado === 'armando' && !p.avisoLista && !p.enviada);
  p.estado = p.estado === 'nuevo' ? 'armando' : p.estado;
  p.error = null;
  emit(p);
  let reply = '';
  let conTurno = false;
  try {
    if (activos >= MAX_A_LA_VEZ) setTrabajo(p, 'En cola: el constructor termina otro proyecto y sigue con este.');
    await tomarTurno();
    conTurno = true;
    if (abort.signal.aborted) throw new Error('detenido');
    setTrabajo(p, 'Leyendo el pedido…');
    const flags = { compilado: false };
    reply = await turno(p, texto, { abort, flags, model: demoNueva || fuerte ? MODEL_DEMO : MODEL });
    await cerrarTurno(p, texto, flags);
    // Revisor: hasta 2 rondas de corrección si no llega a 8/10.
    if ((demoNueva || conRevision) && p.tieneBuild && !abort.signal.aborted) {
      const RONDAS = Number(process.env.REVISOR_RONDAS || 1); // cada ronda cuesta cupo: por defecto una
      for (let ronda = 1; ronda <= RONDAS; ronda++) {
        setTrabajo(p, `El revisor de calidad está evaluando (ronda ${ronda})…`);
        const v = await revisar(p, abort);
        if (!v) break;
        p.calidad = v.puntaje;
        addMsg(p, 'sistema', `Revisor de calidad: ${v.puntaje}/10 · ${v.resumen}${v.puntaje < 8 && v.cambios.length ? `\n${v.cambios.map((c) => `• ${c}`).join('\n')}` : ''}`);
        if (v.puntaje >= 8 || !v.cambios.length || abort.signal.aborted) break;
        const fix = `El revisor de calidad le puso ${v.puntaje}/10 al sitio. Aplicá estos cambios (podés mejorar más allá si ves algo), compilá y revisá las capturas:\n${v.cambios.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
        const f2 = { compilado: false };
        reply = await turno(p, fix, { abort, flags: f2, model: MODEL }); // las correcciones con Sonnet: la dirección ya la decidió Opus
        await cerrarTurno(p, `Revisión ${ronda}: ${v.resumen}`, f2);
      }
    }
  } catch (e) {
    if (abort.signal.aborted) reply = 'Me detuviste antes de terminar. Lo que alcancé a cambiar quedó guardado.';
    else if (isLimitError(e.message)) { onLimitHit(null); reply = 'Se me acabó el cupo de Claude a mitad del trabajo. Lo que alcancé a hacer quedó guardado; pedímelo de nuevo cuando vuelva el cupo.'; }
    else { p.error = e.message.slice(0, 300); reply = `Tuve un error: ${e.message.slice(0, 300)}`; }
    await cerrarTurno(p, texto, { compilado: false });
  } finally {
    running.delete(id);
    if (conTurno) soltarTurno();
    p.enCurso = null;
  }
  if (p.estado === 'armando' && p.tieneBuild) p.estado = 'demo';
  p.actualizado = Date.now();
  p.trabajo = null;
  addMsg(p, 'agent', reply || 'Listo.');
  emit(p);
  if (p.estado === 'demo') {
    if (demoNueva) avisarDemoLista(p);
    else if (!abort.signal.aborted && !p.error && por !== 'sistema') avisarCambiosListos(p, reply);
  }
  // Lo que quedó en cola mientras trabajaba.
  const sig = p.cola?.shift();
  if (sig) { saveNow(); setTimeout(() => pedir(p.id, sig.texto, { ...sig, retomar: true }).catch((e) => log('constructor', `No se pudo seguir con la cola de ${p.nombre}: ${e.message}`, 'error')), 1500); }
  return reply;
}

/** Fotos que manda el cliente: se guardan en public/fotos/cliente-*.jpg (livianas) y el constructor las ve en su lista. */
export async function subirFoto(id, nombre, base64) {
  const p = getProyecto(id);
  if (!p) throw new Error('Proyecto no encontrado.');
  if (R()) return (await S.api(`proyectos/${encodeURIComponent(id)}/fotos`, { metodo: 'POST', cuerpo: { nombre, base64 }, timeout: 120_000 })).ruta;
  const buf = Buffer.from(String(base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (buf.length < 1000 || buf.length > 25e6) throw new Error('La foto está vacía o pesa más de 25 MB.');
  const dir = path.join(dirOf(id), 'public', 'fotos');
  fs.mkdirSync(dir, { recursive: true });
  const name = `cliente-${slugify(String(nombre || 'foto').replace(/\.\w+$/, '')).slice(0, 30)}-${Date.now().toString(36).slice(-4)}.jpg`;
  const tmp = path.join(dir, `${name}.subida`);
  fs.writeFileSync(tmp, buf);
  try { await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-vf', "scale='min(1600,iw)':-2", '-q:v', '4', path.join(dir, name)], { timeout: 60_000 }); }
  finally { fs.rmSync(tmp, { force: true }); }
  addMsg(p, 'sistema', `Diego subió una foto del cliente: fotos/${name}`);
  emit(p);
  return `fotos/${name}`;
}

// ---------- versiones ----------
export async function versiones(id) {
  if (R()) return S.api(`proyectos/${encodeURIComponent(id)}/versiones`);
  const out = await git(id, 'log', '--format=%h|%ct|%s', '-n', '60');
  return out.trim().split('\n').filter(Boolean).map((l) => { const [hash, t, ...msg] = l.split('|'); return { hash, ts: Number(t) * 1000, mensaje: msg.join('|') }; });
}
export async function volverA(id, hash) {
  const p = getProyecto(id);
  if (!p) throw new Error('Proyecto no encontrado.');
  if (running.has(id)) throw new Error('Esperá a que el constructor termine.');
  if (!/^[0-9a-f]{6,40}$/.test(hash)) throw new Error('Versión inválida.');
  if (R()) { const r = S.mezclar(await S.api(`proyectos/${encodeURIComponent(id)}/volver`, { metodo: 'POST', cuerpo: { hash }, timeout: 300_000 })); emit(r); return publicProyecto(r); }
  await git(id, 'checkout', hash, '--', '.');
  await git(id, 'add', '-A');
  await git(id, 'commit', '-q', '--allow-empty', '-m', `Volver a la versión ${hash}`);
  await compilar(id);
  capturas(id).catch(() => {});
  p.version = Number((await git(id, 'rev-list', '--count', 'HEAD')).trim()) || p.version;
  p.actualizado = Date.now();
  addMsg(p, 'sistema', `Volviste a la versión ${hash}.`);
  emit(p);
  return publicProyecto(p);
}

export function setEstado(id, estado) {
  const p = getProyecto(id);
  if (!p) throw new Error('Proyecto no encontrado.');
  if (!['nuevo', 'armando', 'demo', 'enviada', 'aprobada', 'publicada', 'archivada'].includes(estado)) throw new Error('Estado inválido.');
  p.estado = estado;
  p.actualizado = Date.now();
  if (R()) S.api(`proyectos/${encodeURIComponent(id)}`, { metodo: 'PATCH', cuerpo: { estado } }).catch((e) => log('constructor', `No se pudo cambiar el estado en Sitios: ${e.message}`, 'warn'));
  emit(p);
  return publicProyecto(p);
}

export const chatDe = (id) => getProyecto(id)?.chat || [];

// ---------- vista previa pública ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
/** Sirve /<id>/... desde dist (o una captura en /<id>/__captura/<nombre>.jpg). Devuelve false si no corresponde. */
export function servirPreview(req, res, rest) {
  const m = rest.match(/^\/([a-z0-9-]+)(\/.*)?$/);
  if (!m) return false;
  const id = m[1];
  if (!getProyecto(id)) return false;
  if (R()) { S.proxyPreview(req, res, rest); return true; }
  let sub = decodeURIComponent(m[2] || '/');
  if (sub === '/' && !rest.endsWith('/')) { res.writeHead(301, { Location: `${rest}/` }); res.end(); return true; }
  let file;
  const cap = sub.match(/^\/__captura\/([\w-]+)\.jpg$/);
  if (cap) file = path.join(dirOf(id), '.cresova', 'capturas', `${cap[1]}.jpg`);
  else {
    const dist = path.join(dirOf(id), 'dist');
    file = path.resolve(dist, `.${sub}`);
    if (!file.startsWith(dist)) return false;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#555">Esta página se está construyendo. Volvé en unos minutos.</body>');
    return true;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cap || file.endsWith('.html') ? 'no-cache' : 'public, max-age=300' });
  fs.createReadStream(file).pipe(res);
  return true;
}

// ---------- desde Ventas ----------
/** Crea el proyecto de una demo aceptada por WhatsApp y arranca la construcción. Si ya existe, lo devuelve. */
export async function desdeVenta(conv, { arrancar = true, cambios = '' } = {}) {
  const ya = P.find((x) => x.origen?.conv === conv.id);
  if (ya) return ya;
  const c = conv.contacto || {};
  const charla = (conv.msgs || []).filter((m) => m.role === 'cliente' || m.role === 'equipo').map((m) => `- ${m.role === 'equipo' ? 'Diego' : 'Cliente'}: ${String(m.text).slice(0, 400)}`).join('\n');
  const enlaces = [...new Set((charla.match(/https?:\/\/[^\s"\]]+/g) || []))];
  const brief = [
    conv.estado?.resumenDemo && `Resumen del vendedor: ${conv.estado.resumenDemo}`,
    conv.recontacto?.notas && `Notas de la cotización (sistema Cresova): ${conv.recontacto.notas}`,
    conv.recontacto?.contexto && `Contexto de Martín: ${conv.recontacto.contexto}`,
    cambios && `## Lo que el cliente pide cambiar de su demo anterior\n${cambios}`,
    conv.estado?.demo && `Paquete cotizado: ${conv.estado.demo}${conv.estado.cotizacion ? ` (${conv.estado.cotizacion})` : ''}`,
    conv.anuncio?.titulo && `Llegó por el anuncio: ${conv.anuncio.titulo}`,
    Object.keys(c).length && `Datos que dio: ${Object.entries(c).map(([k, v]) => `${k}: ${v}`).join(' · ')}`,
    enlaces.length && `Redes o enlaces que mandó (miralos con mirar_referencia para tomar su identidad: logo, colores, fotos): ${enlaces.join(' ')}`,
    `\n## Lo que dijo el cliente por WhatsApp\n${charla}`,
  ].filter(Boolean).join('\n');
  const tel = String(conv.phone || '').startsWith('lid:') ? '' : conv.phone;
  const p = await crearProyecto({ nombre: c.empresa || conv.recontacto?.nombre || c.nombre || conv.title, rubro: c.rubro || '', whatsapp: tel, brief, por: 'vendedor', origen: { conv: conv.id, cotizacion: conv.estado?.cotizacion || null } });
  const wa = await import('../ventas/whatsapp.mjs');
  const imgs = [];
  for (const f of wa.imagenesDe(conv.id)) imgs.push(await copiarImagen(p, f).catch(() => null));
  if (imgs.filter(Boolean).length) (R() ? (t) => S.api(`proyectos/${encodeURIComponent(p.id)}/brief`, { metodo: 'POST', cuerpo: { texto: t } }).catch(() => {}) : (t) => fs.appendFileSync(path.join(dirOf(p.id), '.cresova', 'BRIEF.md'), t))(`\n## Imágenes que mandó el cliente por WhatsApp (en public/fotos)\n${imgs.filter(Boolean).map((n) => `- fotos/${n} (original: fotos/original-…)`).join('\n')}\nSi alguna es el logo, pasalo por limpiar_logo y usalo en el encabezado y el pie.\n`);
  if (arrancar) pedir(p.id, 'Armá la demo completa según el brief y lo que dijo el cliente por WhatsApp: si mandó redes, miralas primero para tomar su identidad. Decidí el diseño, generá las fotos, compilá y revisá hasta que quede excelente.', { por: 'vendedor' }).catch((e) => log('constructor', `Demo de ${p.nombre}: ${e.message}`, 'error'));
  return p;
}

// El cliente ya vio su demo y pidió cambios por WhatsApp: se la pasa a Luis (nuevo proyecto si no existía) y, al terminar,
// vuelve a salir la tarjeta "Demo lista" para que Diego la apruebe antes de mandársela.
export async function cambiosDesdeVenta(conv, cambios) {
  const yaAcepto = (x) => x && (['aprobada', 'publicada'].includes(x.estado) || x.publicacion?.url);
  const previo = P.find((x) => x.origen?.conv === conv.id);
  if (R() && yaAcepto(previo)) return pedidoDeCliente(previo, conv, cambios);
  const texto = `El cliente ya vio su demo y pidió cambios por WhatsApp. Sus palabras: "${String(cambios).slice(0, 800)}"\n\nRehacé lo que haga falta según eso (si dice que debería verse "más profesional", rediseñá con más cuidado: tipografía, jerarquía, fotos y cómo se muestran los productos). Mantené lo que no criticó. Compilá y revisá hasta que quede excelente.`;
  let p = P.find((x) => x.origen?.conv === conv.id);
  if (!p) p = await desdeVenta(conv, { arrancar: false, cambios });
  if (ocupado(p.id)) throw new Error('Luis ya está trabajando en esa demo.');
  p.avisoLista = null;
  p.enviada = null;
  if (p.estado === 'enviada' || p.estado === 'aprobada') { p.estado = 'demo'; if (R()) S.api(`proyectos/${encodeURIComponent(p.id)}`, { metodo: 'PATCH', cuerpo: { estado: 'demo' } }).catch(() => {}); }
  p.pedidoTs = Date.now();
  p.envioProgramado = null;
  addMsg(p, 'sistema', 'El cliente pidió cambios por WhatsApp.');
  import('../ventas/vendedor.mjs').then((v) => v.registrarEvento(conv.id, 'cambios_pedidos', String(cambios).slice(0, 160))).catch(() => {});
  emit(p);
  return pedir(p.id, texto, { por: 'vendedor', revisar: true, fuerte: true });
}

// Enviar la demo al cliente por WhatsApp (solo con el botón de Diego) y arrancar el seguimiento post-demo.
// Una demo no sale antes de 1 día desde que el cliente la pidió (si llega en 3 horas parece que no costó nada),
// y siempre dentro del horario de atención: lunes a sábado, de 9:00 a 17:00 de Honduras.
const ESPERA_MIN_MS = 24 * 3600e3;
// Se le promete "mañana": la espera es de hasta 24 h, pero nunca pasa del día siguiente de atención (a más tardar
// a las 16:00–16:45 de Honduras). Antes, si pedía después de las 5 p. m., salía pasado mañana.
export function envioMasTemprano(p) {
  const pedido = p.pedidoTs || p.ts;
  const d = new Date(pedido - 6 * 3600e3);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0);
  d.setUTCHours(16, 0, 0, 0);
  const tope = d.getTime() + 6 * 3600e3 + Math.floor(((pedido / 1000) % 45)) * 60e3;
  return Math.min(pedido + ESPERA_MIN_MS, tope);
}
// Fecha que se le propone a Diego al aprobar o enviar (la regla de siempre: 1 día y en horario), sin el azar de minutos.
export function fechaSugerida(p) { return ventanaEnvio(envioMasTemprano(p), false); }
function ventanaEnvio(desde, azar = true) {
  let t = Math.max(desde, Date.now());
  for (let i = 0; i < 10; i++) {
    const d = new Date(t - 6 * 3600e3);
    const h = d.getUTCHours(), okDia = d.getUTCDay() !== 0;
    if (okDia && h >= 9 && h < 17) return t;
    const sig = new Date(d);
    if (h >= 17 || !okDia) sig.setUTCDate(sig.getUTCDate() + 1);
    sig.setUTCHours(9, 0, 0, 0);
    t = sig.getTime() + 6 * 3600e3 + (azar ? Math.floor(Math.random() * 90) : 30) * 60e3; // 9:00 a 10:30
  }
  return t;
}
const cuandoTexto = (t) => new Date(t).toLocaleString('es-HN', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Tegucigalpa' });
export function programarEnvio(id, elegida = null) {
  const p = getProyecto(id);
  if (!p) throw new Error('Proyecto no encontrado.');
  if (!p.origen?.conv) throw new Error('Este proyecto no vino de una conversación de WhatsApp.');
  if (!p.tieneBuild) throw new Error('Todavía no hay vista previa para mandar.');
  // Diego puede elegir la fecha (viene prellenada con la sugerida); si no, se usa la regla de 1 día en horario.
  const cuando = Number(elegida) > 0 ? Number(elegida) : ventanaEnvio(envioMasTemprano(p));
  if (cuando <= Date.now() + 2 * 60e3) { enviarAhora(id).catch((e) => log('constructor', `No se pudo enviar la demo de ${p.nombre}: ${e.message}`, 'error')); return { ahora: true }; }
  p.envioProgramado = cuando;
  p.actualizado = Date.now();
  addMsg(p, 'sistema', elegida ? `Envío programado por Diego: la demo sale por WhatsApp el ${cuandoTexto(cuando)}. Podés enviarla ya o cancelar el envío.` : `Envío programado: la demo sale por WhatsApp el ${cuandoTexto(cuando)} (pasó menos de 1 día desde que el cliente la pidió y no conviene que parezca hecha en unas horas). Podés enviarla ya o cancelar el envío.`);
  log('constructor', `Demo de ${p.nombre} programada para el ${cuandoTexto(cuando)}`, 'ok');
  import('../ventas/vendedor.mjs').then((v) => v.registrarEvento(p.origen.conv, 'demo_programada', `Sale el ${cuandoTexto(cuando)}`)).catch(() => {});
  emit(p);
  return { programada: cuando };
}
export function cancelarEnvio(id) {
  const p = getProyecto(id);
  if (!p) throw new Error('Proyecto no encontrado.');
  p.envioProgramado = null;
  p.actualizado = Date.now();
  addMsg(p, 'sistema', 'Envío programado cancelado.');
  if (p.origen?.conv) import('../ventas/vendedor.mjs').then((v) => v.registrarEvento(p.origen.conv, 'envio_cancelado', '')).catch(() => {});
  emit(p);
  return publicProyecto(p);
}
// Con "ahora" sale en el momento (Diego lo fuerza); si no, se programa respetando el día de espera.
export async function enviarDemo(id, { ahora = false, cuando = null } = {}) {
  const p = getProyecto(id);
  if (!p) throw new Error('Proyecto no encontrado.');
  if (ahora) return enviarAhora(id);
  programarEnvio(id, cuando);
  return publicProyecto(p);
}
setInterval(() => {
  for (const p of P) {
    if (!p.envioProgramado || Date.now() < p.envioProgramado) continue;
    enviarAhora(p.id).catch(async (e) => {
      log('constructor', `No se pudo enviar la demo programada de ${p.nombre}: ${e.message}`, 'error');
      const wa = await import('../ventas/whatsapp.mjs');
      wa.avisarDiego(`⚠️ No pude enviar la demo programada de *${p.nombre}*: ${e.message}. Reintentala desde Desarrollo.`).catch(() => {});
    });
  }
}, 60e3);
async function enviarAhora(id) {
  const p = getProyecto(id);
  if (!p) throw new Error('Proyecto no encontrado.');
  if (!p.origen?.conv) throw new Error('Este proyecto no vino de una conversación de WhatsApp.');
  if (!p.tieneBuild) throw new Error('Todavía no hay vista previa para mandar.');
  p.envioProgramado = null;
  const wa = await import('../ventas/whatsapp.mjs');
  await wa.sendDemo(p.origen.conv, p.preview, p.nombre);
  p.estado = 'enviada';
  p.enviada = Date.now();
  if (R()) S.api(`proyectos/${encodeURIComponent(p.id)}`, { metodo: 'PATCH', cuerpo: { estado: 'enviada' } }).catch((e) => log('constructor', `No se pudo marcar enviada en Sitios: ${e.message}`, 'warn'));
  // En la base de Cresova la cotización pasa a "Demo enviada" con el enlace (igual que el botón del panel).
  if (p.origen.cotizacion && p.origen.cotizacion !== 'creada') {
    import('../cresova/db.mjs').then((db) => (db.enUso() ? db.demoEnviada(p.origen.cotizacion, p.preview) : null))
      .catch((e) => log('constructor', `No se pudo marcar "Demo enviada" en Cresova para ${p.origen.cotizacion}: ${e.message}`, 'warn'));
  }
  p.actualizado = Date.now();
  addMsg(p, 'sistema', 'Demo enviada al cliente por WhatsApp. El vendedor le da seguimiento a los 1, 3 y 7 días si no responde.');
  emit(p);
  return publicProyecto(p);
}
// Luis terminó los cambios que alguien pidió: nueva tarjeta en la Bandeja (si es una demo de un cliente) y un aviso para volver a revisar.
function avisarCambiosListos(p, reply) {
  p.avisoLista = null;
  avisarDemoLista(p, { cambios: true });
  const resumen = String(reply || '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 280);
  import('../ventas/whatsapp.mjs').then((wa) => wa.avisarDiego(`🔁 *${p.nombre}*: Luis terminó los cambios${p.calidad ? ` (revisor ${p.calidad}/10)` : ''}. Volvé a revisarla: ${p.preview}${resumen ? `\n\nResumen: ${resumen}` : ''}${p.origen?.conv ? '\n\nLa tarjeta para aprobarla está en la Bandeja.' : ''}`)).catch(() => {});
}
// Reanuda una demo que quedó "armando" sin construirse (por ejemplo, la oficina se reinició a mitad del trabajo).
export function reanudar(id, pedido) {
  const p = getProyecto(id);
  if (!p) throw new Error('Proyecto no encontrado.');
  const texto = String(pedido || '').trim() || p.chat.find((m) => m.role === 'user')?.text || 'Armá la demo completa según el brief: decidí el diseño, escribí el contenido, generá las fotos, compilá y revisá hasta que quede excelente.';
  return pedir(p.id, texto, { por: 'sistema', revisar: true, fuerte: true, retomar: !pedido && p.chat.some((m) => m.role === 'user' && m.text === texto) });
}
const sinRespuesta = (p) => { const u = (p.chat || []).filter((m) => m.role === 'user' || m.role === 'agent').at(-1); return u?.role === 'user' && Date.now() - u.ts < 36 * 3600e3 ? u : null; };
// Al arrancar: demos que ya estaban listas antes de que existiera la tarjeta también piden aprobación,
// y las que quedaron a medio construir (la oficina se reinició) se retoman solas.
setTimeout(() => {
  for (const p of P) {
    if (p.estado === 'demo') {
      const tarjetas = listDeliverables().filter((d) => d.devProyecto === p.id).sort((a, b) => a.ts - b.ts);
      const ultima = tarjetas.at(-1);
      // Solo si la última tarjeta quedó en "cambios pedidos" (se rehízo y nadie lo avisó). Si ya la aprobó o está programada, no se vuelve a preguntar.
      if (p.origen?.conv && !p.enviada && !p.envioProgramado && p.avisoLista && ultima?.status === 'changes') avisarCambiosListos(p, '');
      else avisarDemoLista(p);
    }
    if (R()) continue; // Sitios retoma lo suyo
    // Un pedido que quedó a medias porque la oficina se reinició: se retoma solo, sin repetir el mensaje.
    // (Antes solo se retomaban demos sin construir; un cambio sobre una demo hecha se perdía.)
    if (running.has(p.id)) continue;
    if (p.enCurso && Date.now() - p.enCurso.ts < 36 * 3600e3) {
      log('constructor', `Retomando ${p.nombre}: quedó a medias por un reinicio`, 'warn');
      addMsg(p, 'sistema', 'La oficina se reinició a mitad del trabajo: Luis retoma este pedido.');
      const c = p.enCurso;
      pedir(p.id, c.texto, { ...c, retomar: true }).catch((e) => log('constructor', `No se pudo retomar ${p.nombre}: ${e.message}`, 'error'));
    } else if (sinRespuesta(p)) {
      // Proyectos de antes de que existiera enCurso: el último pedido nunca tuvo respuesta.
      const u = sinRespuesta(p);
      log('constructor', `Retomando ${p.nombre}: su último pedido quedó sin respuesta por un reinicio`, 'warn');
      addMsg(p, 'sistema', 'La oficina se reinició a mitad del trabajo: Luis retoma este pedido.');
      pedir(p.id, u.text, { por: u.por || 'diego', revisar: true, fuerte: !p.tieneBuild, retomar: true }).catch((e) => log('constructor', `No se pudo retomar ${p.nombre}: ${e.message}`, 'error'));
    } else if (p.estado === 'armando' && !p.tieneBuild) {
      log('constructor', `Retomando la demo de ${p.nombre}: quedó a medias por un reinicio`, 'warn');
      reanudar(p.id).catch((e) => log('constructor', `No se pudo retomar ${p.nombre}: ${e.message}`, 'error'));
    } else if (p.cola?.length) {
      const sig = p.cola.shift();
      pedir(p.id, sig.texto, { ...sig, retomar: true }).catch(() => {});
    }
  }
}, 20_000);
// Demo prometida hace más de 48 h y todavía sin enviar: se avisa a Diego una vez.
setInterval(async () => {
  for (const p of P) {
    if (!p.origen?.conv || p.enviada || p.alertaVencida || ['aprobada', 'publicada', 'archivada', 'enviada'].includes(p.estado)) continue;
    if (Date.now() - p.ts < 48 * 3600e3) continue;
    p.alertaVencida = Date.now();
    saveNow();
    const wa = await import('../ventas/whatsapp.mjs');
    wa.avisarDiego(`⏰ La demo de *${p.nombre}* lleva más de 48 h sin enviarse (se la prometimos al cliente). Está en Desarrollo: ${p.tieneBuild ? 'ya está lista para mandar' : 'todavía no está lista'}.`);
  }
}, 15 * 60e3);

// ---------- imágenes que mandó el cliente por WhatsApp ----------
async function copiarImagen(p, origen) {
  if (R()) {
    const ruta = (await S.api(`proyectos/${encodeURIComponent(p.id)}/fotos`, { metodo: 'POST', cuerpo: { nombre: path.basename(origen), base64: fs.readFileSync(origen).toString('base64'), origen: 'whatsapp' }, timeout: 120_000 })).ruta;
    return path.basename(ruta);
  }
  const dir = path.join(dirOf(p.id), 'public', 'fotos');
  fs.mkdirSync(dir, { recursive: true });
  const name = `cliente-wa-${path.basename(origen).replace(/\.\w+$/, '')}.jpg`;
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', origen, '-vf', "scale='min(1600,iw)':-2", '-q:v', '3', path.join(dir, name)], { timeout: 60_000 });
  // Copia original sin tocar (por si es un logo con transparencia).
  fs.copyFileSync(origen, path.join(dir, `original-${path.basename(origen)}`));
  return name;
}
export async function imagenDeVenta(convId, archivo) {
  const p = P.find((x) => x.origen?.conv === convId);
  if (!p) return;
  const name = await copiarImagen(p, archivo);
  if (R()) { emit(p); return; } // Sitios ya anotó la imagen en el chat
  addMsg(p, 'sistema', `El cliente mandó una imagen por WhatsApp: fotos/${name} (original: fotos/original-${path.basename(archivo)}). Puede ser su logo o una foto del negocio.`);
  emit(p);
}

// Logo con fondo blanco (JPG típico de WhatsApp) → PNG transparente, y una versión clara para fondos oscuros.
export async function limpiarLogo(id, archivo, { tolerancia = 0.12 } = {}) {
  const dir = path.join(dirOf(id), 'public', 'fotos');
  const src = path.resolve(dir, path.basename(String(archivo)));
  if (!src.startsWith(dir) || !fs.existsSync(src)) throw new Error('No encuentro ese archivo en public/fotos.');
  const base = path.basename(src).replace(/\.\w+$/, '').replace(/^original-/, '');
  const out = path.join(dir, `logo-${base}.png`);
  const outClaro = path.join(dir, `logo-${base}-claro.png`);
  const vf = `colorkey=0xFFFFFF:${tolerancia}:0.08,format=rgba,scale='min(800,iw)':-2`;
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', vf, out], { timeout: 60_000 });
  // Versión en blanco para poner sobre fondos oscuros (mantiene la forma y la transparencia).
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-vf', 'format=rgba,lutrgb=r=255:g=255:b=255', outClaro], { timeout: 60_000 });
  return { transparente: `fotos/${path.basename(out)}`, claro: `fotos/${path.basename(outClaro)}` };
}

// Demo nueva lista (vino de WhatsApp y todavía no se mandó): tarjeta en la Bandeja para enviarla con un toque.
export function avisarDemoLista(p, { cambios = false } = {}) {
  if (!p.origen?.conv || p.enviada || p.avisoLista || !p.tieneBuild) return;
  p.avisoLista = Date.now();
  // Una sola tarjeta por proyecto en la Bandeja: si quedó otra sin responder (por ejemplo, de una vuelta que cortó un reinicio), la nueva la reemplaza.
  for (const d of state.deliverables) if (d.devProyecto === p.id && d.kind === 'decision' && d.status === 'pending') reviewDeliverable(d.id, 'discarded', '');
  import('../ventas/vendedor.mjs').then((v) => v.registrarEvento(p.origen.conv, cambios ? 'cambios_listos' : 'demo_lista', `${p.preview}${p.calidad ? ` · revisor ${p.calidad}/10` : ''}`)).catch(() => {});
  addDeliverable('constructor', `${cambios ? '🔁 Cambios listos' : '🌐 Demo lista'}: ${p.nombre}`, `${cambios ? 'Luis terminó los cambios que pediste en' : 'La demo de'} **${p.nombre}** ${cambios ? '(ya compilados y revisados)' : 'está terminada'}${p.calidad ? ` (revisor: ${p.calidad}/10)` : ''}.\n\n**Vista previa:** ${p.preview}\n\nRevisala en el celular. Si está bien, aprobá: NO sale de inmediato. Se programa para al menos 1 día después de que el cliente la pidió (lunes a sábado, entre 9:00 y 17:00) para que no parezca hecha en unas horas, y el vendedor se la manda con el enlace y le da seguimiento a los 1, 3 y 7 días. Si querés forzar el envío ya, lo hacés desde Desarrollo. Si querés cambios, decí cuáles y el constructor los hace antes de enviarla.\n\nOjo: los datos marcados como EJEMPLO (cifras, testimonios) hay que confirmarlos con el cliente o quitarlos.`,
    { kind: 'decision', summary: `${p.rubro || ''} · ${p.preview}`, question: '¿Se la mandamos al cliente?', options: ['Sí, enviarla', 'Primero ajustar'], devProyecto: p.id });
  saveNow();
  envioAutomatico(p).catch((e) => log('constructor', `Envío automático de la demo de ${p.nombre}: ${e.message}`, 'warn'));
}
// Autonomía (5 nov): si Ashley le dio buena nota y tiene las fotos del cliente (si mandó), la demo sale sola en la fecha
// sugerida, con al menos 2 h para que Diego la cancele desde Desarrollo.
function fotosUsadas(p) {
  let n = 0;
  const ver = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', 'dist', '.git', 'public'].includes(f.name)) continue; const x = path.join(d, f.name); if (f.isDirectory()) ver(x); else if (/\.(tsx|jsx|ts|js|astro|html|css)$/.test(f.name) && /cliente-wa-|original-imagen/.test(fs.readFileSync(x, 'utf8'))) n++; } };
  try { ver(dirOf(p.id)); } catch {}
  return n;
}
async function envioAutomatico(p) {
  const au = await import('../autonomia.mjs');
  const wa = await import('../ventas/whatsapp.mjs');
  if (state.ventas?.convs?.[p.origen.conv]?.pausa?.total) return; // Diego dijo que no se le escriba a este cliente
  const regla = au.demoAuto(p, { fotosCliente: wa.imagenesDe(p.origen.conv).length, fotosUsadas: fotosUsadas(p) });
  if (!regla) return;
  const cuando = Math.max(fechaSugerida(p), Date.now() + regla.vetoMs);
  programarEnvio(p.id, cuando);
  const card = state.deliverables.find((d) => d.devProyecto === p.id && d.kind === 'decision' && d.status === 'pending');
  if (card) reviewDeliverable(card.id, 'approved', `Sale sola: Ashley le dio ${p.calidad}/10`, 'Sí, enviarla');
  const { mensajeDiscord } = await import('../voz.mjs');
  mensajeDiscord(`🌐 **La demo de ${p.nombre} sale sola** el ${cuandoTexto(cuando)} (Ashley: ${p.calidad}/10).\n${p.preview}\nSi no querés que salga, cancelala en Desarrollo → ${p.nombre} → Cancelar envío.`).catch(() => {});
  log('constructor', `Demo de ${p.nombre} programada sola (Ashley ${p.calidad}/10): ${cuandoTexto(cuando)}`, 'ok');
}

// Demos sin respuesta de Diego (9 nov): siguen saliendo en la Bandeja, pero si en 5 h no dijo nada se programan solas
// en buen horario (regla de programarEnvio: lunes a sábado 9:00–17:00, al menos 1 día desde que la pidieron).
// No salen solas si Diego puso el chat en pausa total, si el cliente no quiere contacto o si Diego le escribió en las
// últimas 24 h (ese chat lo está llevando él). Las tarjetas viejas cuentan las 5 h desde que se encendió esta regla.
const DEMO_5H = 5 * 3600e3;
state.demoSola ||= { desde: Date.now() };
setInterval(() => {
  const ahora = Date.now();
  for (const d of listDeliverables()) {
    if (d.kind !== 'decision' || d.status !== 'pending' || !d.devProyecto || ahora - Math.max(d.ts, state.demoSola.desde) < DEMO_5H) continue;
    const p = getProyecto(d.devProyecto);
    if (!p || !p.origen?.conv || p.enviada || p.envioProgramado || !p.tieneBuild || ocupado(p.id)) continue;
    const c = state.ventas?.convs?.[p.origen.conv];
    if (!c || c.optOut || c.estado?.noCalificado || c.pausa?.total) continue;
    const ultEquipo = [...c.msgs].reverse().find((m) => m.role === 'equipo');
    if (c.pausa && !c.pausa.existente && ultEquipo && ahora - ultEquipo.ts < 24 * 3600e3) continue;
    try {
      programarEnvio(p.id);
      reviewDeliverable(d.id, 'approved', 'Sale sola: pasaron 5 h sin respuesta', 'Sí, enviarla');
      log('constructor', `Demo de ${p.nombre}: 5 h sin respuesta, se programó sola`, 'ok');
      import('../voz.mjs').then(({ mensajeDiscord }) => mensajeDiscord(`🌐 **La demo de ${p.nombre} sale sola** el ${cuandoTexto(p.envioProgramado)}: pasaron 5 h sin tu respuesta.\n${p.preview}\nSi no querés que salga, cancelala en Desarrollo → ${p.nombre} → Cancelar envío.`)).catch(() => {});
    } catch (e) { log('constructor', `Demo de ${p.nombre}: no se pudo programar sola: ${e.message}`, 'warn'); }
  }
}, 5 * 60e3);

// ---------- Sitios: avisos y actualizaciones en vivo ----------
S.enganchar({
  proyecto: (p) => broadcast({ type: 'proyecto', proyecto: publicProyecto(p) }),
  aviso: (a, p) => {
    if (!p) return;
    broadcast({ type: 'proyecto', proyecto: publicProyecto(p) });
    if (a.tipo === 'demo_lista') avisarDemoLista(p);
    else if (a.tipo === 'cambios_listos' && a.por !== 'sistema') avisarCambiosListos(p, a.resumen || '');
    else if (a.tipo === 'cambio_listo') tarjetaCambioListo(p, a.solicitud);
    else if (a.tipo === 'cambio_publicado') cambioPublicado(p, a.solicitud, a.url, a.avisarCliente).catch((e) => log('constructor', `Aviso al cliente falló: ${e.message}`, 'warn'));
    else if (a.tipo === 'error') log('constructor', `Sitios: ${p.nombre} tuvo un error: ${a.error || p.error || ''}`, 'error');
  },
});

// ---------- Fase 4: cambios de clientes que ya aceptaron su sitio ----------
// El pedido queda registrado en Sitios; Luis lo hace en el borrador; a Diego le llega una tarjeta para publicarlo.
// Nada le cambia al cliente sin que Diego lo apruebe.
async function pedidoDeCliente(p, conv, cambios) {
  const s = await S.api(`proyectos/${encodeURIComponent(p.id)}/solicitudes`, { metodo: 'POST', cuerpo: { texto: String(cambios).slice(0, 4000), origen: 'cliente-whatsapp', por: 'vendedor', conv: conv.id } });
  log('constructor', `${p.nombre} (cliente ya aceptado) pidió un cambio: ${String(cambios).slice(0, 80)}`, 'info');
  import('../ventas/whatsapp.mjs').then((wa) => wa.avisarDiego(`✏️ *${p.nombre}* (sitio ya aceptado) pidió un cambio: "${String(cambios).slice(0, 220)}". Luis lo hace en el borrador; te llega la tarjeta para publicarlo.`)).catch(() => {});
  return s;
}

const OP_PUBLICAR_AVISAR = 'Publicar y avisarle', OP_PUBLICAR = 'Publicar sin avisarle', OP_AJUSTAR = 'Pedir ajuste';
function tarjetaCambioListo(p, sol) {
  if (!sol?.conv) return; // los que pidió Diego desde Sitios se ven allá
  if (state.deliverables.some((d) => d.devSolicitud?.sid === sol.id && d.status === 'pending')) return;
  addDeliverable('constructor', `🔁 Cambio listo: ${p.nombre}`, `El cliente pidió por WhatsApp:\n\n> ${String(sol.texto).replace(/\n/g, '\n> ')}\n\n${sol.resumen ? `**Lo que hizo Luis:** ${sol.resumen}\n\n` : ''}**Mirala en el borrador:** ${p.preview}\n\nTodavía NO está publicado: el sitio del cliente no cambió. Si está bien, publicalo (y si querés le llega un WhatsApp avisándole). Si falta algo, pedí el ajuste con una nota.${p.publicacion?.url ? `\n\nSitio publicado: ${p.publicacion.url}` : ''}`,
    { kind: 'decision', summary: `${p.nombre} · ${String(sol.texto).slice(0, 80)}`, question: '¿Lo publicamos?', options: [OP_PUBLICAR_AVISAR, OP_PUBLICAR, OP_AJUSTAR], ventasConv: sol.conv, devSolicitud: { proyecto: p.id, sid: sol.id } });
}

// Las respuestas de Diego a esas tarjetas (sin tocar server.mjs: se revisan cada 15 s).
setInterval(() => {
  if (!R()) return;
  for (const d of state.deliverables) {
    if (!d.devSolicitud || d.status === 'pending' || d.solicitudHecha) continue;
    d.solicitudHecha = Date.now();
    saveNow();
    const { proyecto, sid } = d.devSolicitud;
    const nota = String(d.note || '').trim();
    let pr = null;
    if (d.status === 'approved' && (d.answer === OP_PUBLICAR_AVISAR || d.answer === OP_PUBLICAR)) pr = S.api(`proyectos/${encodeURIComponent(proyecto)}/solicitudes/${sid}/aprobar`, { metodo: 'POST', cuerpo: { avisarCliente: d.answer === OP_PUBLICAR_AVISAR }, timeout: 300_000 });
    else if ((d.answer === OP_AJUSTAR || d.status === 'changes') && nota) pr = S.api(`proyectos/${encodeURIComponent(proyecto)}/solicitudes/${sid}/ajustar`, { metodo: 'POST', cuerpo: { texto: nota } });
    else if (d.status === 'discarded') pr = S.api(`proyectos/${encodeURIComponent(proyecto)}/solicitudes/${sid}/descartar`, { metodo: 'POST', cuerpo: { motivo: nota } });
    else if (d.answer === OP_AJUSTAR) log('constructor', `Pediste un ajuste en ${proyecto} sin decir cuál: hacelo desde Sitios → Cambios del cliente.`, 'warn');
    pr?.catch((e) => {
      log('constructor', `No se pudo aplicar tu respuesta al cambio de ${proyecto}: ${e.message}`, 'error');
      import('../ventas/whatsapp.mjs').then((wa) => wa.avisarDiego(`⚠️ No pude ${d.answer?.startsWith('Publicar') ? 'publicar' : 'aplicar'} el cambio de ${proyecto}: ${e.message}. Hacelo desde Sitios → Cambios del cliente.`)).catch(() => {});
    });
  }
}, 15_000);

async function cambioPublicado(p, sol, url, avisarCliente) {
  if (!avisarCliente || !sol?.conv) return;
  const wa = await import('../ventas/whatsapp.mjs');
  const ok = await wa.enviarFijo(sol.conv, `¡Listo! 🙌 Ya está en línea el cambio que nos pediste en tu página:${url ? `\n\n${url}` : ''}\n\nRevísala y cualquier otro detalle nos dices por aquí.`, { cambioPublicado: sol.id });
  log('constructor', `${p.nombre}: ${ok ? 'se le avisó al cliente que el cambio está en línea' : 'NO se pudo avisar al cliente (ventana de WhatsApp cerrada o error)'}`, ok ? 'ok' : 'warn');
  if (!ok) wa.avisarDiego(`⚠️ El cambio de *${p.nombre}* ya está publicado, pero no pude avisarle al cliente por WhatsApp (puede que la ventana de 24 h esté cerrada). Avisale vos: ${url || p.preview}`).catch(() => {});
}
