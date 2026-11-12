// Cliente de Cresova Sitios (servicio aparte, tools/sitios). Desde el corte (10 nov 2026) Luis y Ashley viven allá:
// la oficina crea proyectos y pide cambios por API, y se entera de todo por los eventos en vivo de Sitios.
// La parte comercial (Bandeja, envío por WhatsApp, autonomía) sigue en la oficina, en proyectos.mjs.
// Se activa solo cuando está la llave SITIOS_API_KEY (Sistema → Llaves). Sin llave, la oficina usa su Desarrollo local.
import { state, log, broadcast, saveNow } from '../state.mjs';

export const SITIOS_URL = (process.env.SITIOS_URL || 'http://tools_sitios:3100').replace(/\/+$/, '');
export const activo = () => Boolean(process.env.SITIOS_API_KEY?.trim());

export async function api(ruta, { metodo = 'GET', cuerpo, timeout = 60_000 } = {}) {
  const r = await fetch(`${SITIOS_URL}/api/${ruta}`, {
    method: metodo,
    headers: { 'x-api-key': process.env.SITIOS_API_KEY?.trim() || '', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Sitios respondió ${r.status}`);
  return j;
}

// Campos que son de la oficina (comerciales): Sitios nunca los pisa.
const DE_OFICINA = ['envioProgramado', 'avisoLista', 'enviada', 'pedidoTs', 'alertaVencida', 'chat'];

state.proyectos ||= [];
state.sitios ||= { ultimoAviso: 0, vistos: [] };
const P = state.proyectos;

let ganchos = { proyecto: () => {}, aviso: () => {} };
/** proyectos.mjs registra qué hacer con cada proyecto actualizado y con cada aviso (demo lista, cambios listos). */
export function enganchar(g) { ganchos = { ...ganchos, ...g }; }

/** Mezcla un proyecto que llega de Sitios con el de la oficina (los campos comerciales quedan). */
export function mezclar(remoto, { chat } = {}) {
  if (!remoto?.id) return null;
  let p = P.find((x) => x.id === remoto.id);
  const { trabajando, mensajes, chat: _c, brief, ...datos } = remoto;
  if (!p) { p = { chat: [] }; P.push(p); }
  for (const [k, v] of Object.entries(datos)) if (!DE_OFICINA.includes(k)) p[k] = v;
  p.trabajandoRemoto = Boolean(trabajando);
  if (Array.isArray(chat)) p.chat = chat;
  p.chat ||= [];
  return p;
}

export async function sincronizar({ chats = false } = {}) {
  const lista = await api('proyectos');
  for (const r of lista) mezclar(r);
  if (chats) for (const r of lista) {
    try { const d = await api(`proyectos/${encodeURIComponent(r.id)}`); mezclar(d, { chat: d.chat }); } catch {}
  }
  try { state.reglasDiseno = await api('reglas'); } catch {}
  saveNow();
  return lista.length;
}

async function procesarAviso(a) {
  if (!a?.id || state.sitios.vistos.includes(a.id)) return;
  state.sitios.vistos.push(a.id);
  if (state.sitios.vistos.length > 400) state.sitios.vistos.splice(0, state.sitios.vistos.length - 400);
  state.sitios.ultimoAviso = Math.max(state.sitios.ultimoAviso || 0, a.ts || 0);
  const p = mezclar(a.proyecto);
  saveNow();
  try { await ganchos.aviso(a, p); } catch (e) { log('constructor', `Aviso de Sitios (${a.tipo}) no se pudo procesar: ${e.message}`, 'warn'); }
}

// ---------- eventos en vivo ----------
let conectado = false, corriendo = false;
export const estadoConexion = () => ({ activo: activo(), conectado, url: SITIOS_URL });

async function escuchar() {
  const r = await fetch(`${SITIOS_URL}/api/eventos`, { headers: { 'x-api-key': process.env.SITIOS_API_KEY?.trim() || '' } });
  if (!r.ok || !r.body) throw new Error(`Sitios respondió ${r.status}`);
  conectado = true;
  // Al conectar: lo que pasó mientras no escuchábamos.
  await sincronizar({ chats: true }).catch(() => {});
  for (const a of await api(`avisos?desde=${state.sitios.ultimoAviso || 0}`).catch(() => [])) await procesarAviso(a);
  const dec = new TextDecoder();
  let buf = '';
  for await (const parte of r.body) {
    buf += dec.decode(parte, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const bloque = buf.slice(0, i); buf = buf.slice(i + 2);
      const linea = bloque.split('\n').find((l) => l.startsWith('data: '));
      if (!linea) continue;
      let ev; try { ev = JSON.parse(linea.slice(6)); } catch { continue; }
      if (ev.type === 'proyecto') { const p = mezclar(ev.proyecto); if (p) ganchos.proyecto(p); }
      else if (ev.type === 'proyecto-msg') {
        const p = P.find((x) => x.id === ev.id);
        if (p) { (p.chat ||= []).push(ev.mensaje); if (p.chat.length > 300) p.chat.splice(0, p.chat.length - 300); }
        broadcast(ev);
      } else if (ev.type === 'proyecto-trabajo') {
        const p = P.find((x) => x.id === ev.id);
        if (p) p.trabajo = ev.texto;
        broadcast(ev);
      } else if (ev.type === 'aviso') await procesarAviso(ev.aviso);
    }
  }
  throw new Error('Sitios cortó la conexión');
}

/** Arranca (una vez) la escucha de Sitios, con reconexión. Se llama sola cuando aparece la llave. */
export function iniciar() {
  if (corriendo || !activo()) return;
  corriendo = true;
  log('constructor', `Desarrollo conectado a Sitios (${SITIOS_URL})`, 'ok');
  (async () => {
    let espera = 2000;
    while (activo()) {
      try { await escuchar(); espera = 2000; } catch (e) {
        if (conectado) log('constructor', `Se cortó la conexión con Sitios: ${e.message}. Reintento…`, 'warn');
        conectado = false;
      }
      await new Promise((r) => setTimeout(r, espera));
      espera = Math.min(espera * 2, 60_000);
    }
    corriendo = false;
  })();
}
setTimeout(iniciar, 3000);
setInterval(iniciar, 30_000); // si la llave se carga después, se conecta sola

/** Vista previa: la oficina la pide a Sitios (para el panel de la oficina y las capturas). */
export async function proxyPreview(req, res, ruta) {
  try {
    const r = await fetch(`${SITIOS_URL}/p${ruta}`, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const h = {};
    for (const k of ['content-type', 'cache-control', 'location']) { const v = r.headers.get(k); if (v) h[k] = k === 'location' ? v.replace(/^\/p\//, '/p/') : v; }
    res.writeHead(r.status, h);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Sitios no responde por ahora.');
  }
}
