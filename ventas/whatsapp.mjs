// Canal de WhatsApp del vendedor (Evolution API). Aprendizajes de Velforce:
// - Se ignoran grupos, estados, canales y difusiones.
// - Los números @lid se resuelven con remoteJidAlt / senderPn.
// - Los mensajes propios (fromMe) que envió el bot se reconocen por su id y por
//   el texto reciente: así el bot nunca se pausa solo.
// - Un fromMe que no es del bot lo escribió una persona desde el teléfono: el
//   bot se pausa en esa conversación y se cancela todo lo que estuviera en cola.
//   Excepción: el saludo automático de WhatsApp Business, que llega antes de
//   que el cliente escriba nada.
// - Buffer: espera unos segundos y junta los mensajes seguidos en una sola respuesta.
// - Fotos, audios, stickers y documentos se describen al modelo en una línea.
// - Se guarda el anuncio de origen (Click-to-WhatsApp) en el primer toque.
// - Seguimientos solo en horario, con tope por hora y separación mínima, y se
//   cancelan si el cliente escribe, si una persona toma el chat o si se cerró.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { state, log, saveNow, DATA_DIR } from '../state.mjs';
import { ventasState as V, newConv, sellerTurn, touchConv, anuncioPorTexto, registrarEvento } from './vendedor.mjs';
import * as YC from './ycloud.mjs';
import { plantillaPara, textoDe, nombreSaludo } from './plantillas.mjs';
import { etapaDe, AVANZADAS, leerRespuesta } from './etapa.mjs';
// Con la API oficial, el primer seguimiento sale a las 22 h (dentro de la ventana de 24 h) en vez de a las 24 h.
const h1 = (h) => (YC.activo() && h === 24 ? 22 : h);

const BUFFER_S = 13;          // como Velforce
// El número de Diego: si escribe al número de ventas, le contesta Jarvis (no el vendedor).
const OWNER = (process.env.OWNER_WHATSAPP || '').replace(/\D/g, '');
export const OWNER_NUM = () => OWNER;
const BUFFER_MAX_S = 45;      // nunca esperar más que esto desde el primer mensaje
const FU_HOURS = { start: 8, end: 18, days: [1, 2, 3, 4, 5, 6] }; // hora de Honduras
const FU_HOURLY_CAP = 5;
const FU_MIN_GAP_MS = 2 * 60e3;

V.live ||= { enabled: false, sentIds: [], seenIds: [], lastFollowups: [] };

// Pasos de seguimiento (Diego los ajusta en Ventas → Seguimientos). Las horas cuentan desde
// el último mensaje del vendedor; cada paso solo sale si el cliente no respondió al anterior.
const PASOS_BASE = [
  { horas: 24, activo: true, pista: 'Si el cliente preguntó algo y quedó sin una respuesta clara, contestalo bien primero. Si no, mandale UN ejemplo real del portafolio, el más parecido a su rubro (enlace en texto plano), con media frase de por qué se lo mandás ("mira cómo quedó la de una pastelería"), y preguntá si le armás la suya. PROHIBIDO repetir una pregunta o un pedido de datos que ya le hiciste. Si la persona no mostró interés en una página web, respondé exactamente NO_ENVIAR.' },
  { horas: 72, activo: true, pista: 'Una sola idea concreta de su rubro (qué gana: que lo encuentren en Google, pedidos o reservas por WhatsApp, verse serio frente a clientes nuevos) y una pregunta fácil de contestar. Máximo 2 líneas, sin precio ni lista de lo que incluye. Si no corresponde escribir, respondé exactamente NO_ENVIAR.' },
  { horas: 168, activo: true, pista: 'Cerrá el ciclo con respeto y una pregunta de sí o no: si lo dejamos para más adelante o si le armamos la demo esta semana. Una o dos líneas, sin presionar ni inventar escasez. Si no corresponde escribir, respondé exactamente NO_ENVIAR.' },
  { horas: 720, activo: true, pista: 'Último contacto, un mes después: saludo breve y amable, preguntá si sigue con la idea de su página y dejá la puerta abierta para cuando quiera. Sin insistir. Si no corresponde escribir, respondé exactamente NO_ENVIAR.' },
];
// Pistas anteriores (hasta nov. 2026): si Diego no las cambió, se reemplazan por las nuevas.
const PISTAS_VIEJAS = ['Retomá algo concreto del cliente', 'Contá en una frase qué gana un negocio', 'Compartí UN ejemplo real del mismo rubro', 'Último contacto, un mes después'];
V.seguimientos ||= { pasos: PASOS_BASE, stats: {} };
const SG = V.seguimientos;
if (SG.pasos?.length && SG.pasos.every((p) => PISTAS_VIEJAS.some((v) => String(p.pista).startsWith(v)))) SG.pasos = PASOS_BASE;
SG.stats ||= {};
const pasos = () => SG.pasos.filter((p) => p.activo !== false && p.horas > 0).sort((a, b) => a.horas - b.horas);

const L = V.live;
// Contactos que ya existían (Velforce, agenda y chats del teléfono): el vendedor no los atiende.
L.existing ||= [];
let existingSet = new Set(L.existing);
const keyOf = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 8 ? `504${d}` : d; };
export const isExisting = (phone) => existingSet.has(keyOf(phone));
// Cliente de verdad = tiene una cotización aceptada, firmada o pagada en la base de Cresova.
export async function esClienteReal(phone) {
  const ult8 = keyOf(phone).slice(-8);
  if (ult8.length < 8) return false;
  try {
    const db = await import('../cresova/db.mjs');
    if (!db.enUso()) return false;
    const r = await db.q("select 1 from quotes where status in ('accepted', 'signed', 'paid') and right(regexp_replace(coalesce(client_phone, ''), '[^0-9]', '', 'g'), 8) = $1 limit 1", [ult8]);
    return r.length > 0;
  } catch { return true; } // si la base no responde, mejor no arriesgar: queda pausado como antes
}
export function addExisting(list, fuente = 'lista') {
  const before = existingSet.size;
  for (const p of list || []) { const k = keyOf(p); if (k.length >= 10 && k.length <= 14) existingSet.add(k); }
  L.existing = [...existingSet];
  saveNow();
  const n = existingSet.size - before;
  if (n) log('vendedor', `Contactos existentes: +${n} desde ${fuente} (total ${existingSet.size}). El vendedor no los atiende.`, 'system');
  return { agregados: n, total: existingSet.size };
}
export async function importExistingFromEvolution() {
  const { inst } = env();
  const out = [];
  for (const path of [`/chat/findChats/${inst}`, `/chat/findContacts/${inst}`]) {
    const list = await evo(path, {}).catch(() => []);
    for (const c of Array.isArray(list) ? list : []) {
      for (const j of [c.remoteJid, c.remoteJidAlt, c.id, c.lastMessage?.key?.remoteJidAlt]) {
        if (typeof j === 'string' && j.endsWith('@s.whatsapp.net')) out.push(j.split('@')[0]);
      }
    }
  }
  return addExisting(out, 'el teléfono (chats y agenda)');
}
const timers = new Map(); // convId -> { timer, first }

// Dos números: el principal (EVOLUTION_INSTANCE) y el de prospección. Cada conversación del número de prospección
// guarda su instancia en conv.inst, y todo lo que se le manda sale por ese número.
const env = (conv) => ({ url: process.env.EVOLUTION_API_URL?.trim().replace(/\/$/, ''), key: process.env.EVOLUTION_API_KEY?.trim(), inst: conv?.inst || process.env.EVOLUTION_INSTANCE?.trim() });
export const hookToken = () => createHash('sha256').update(`hook:${process.env.EVOLUTION_API_KEY || ''}`).digest('hex').slice(0, 32);
export const hookTokenProspeccion = () => createHash('sha256').update(`hook-prospeccion:${process.env.EVOLUTION_API_KEY || ''}`).digest('hex').slice(0, 32);
export const evoApi = (p, body, method) => evo(p, body, method);
const mismaInst = (c, inst) => (c.inst || null) === (inst || null);

// Con la API oficial (YCloud) encendida, lo del número principal no va a Evolution: lo traduce ventas/ycloud.mjs.
const esPrincipal = (path) => { const [p, qs] = path.split('?'); const inst = p.split('/')[3] || new URLSearchParams(qs || '').get('instanceName'); return inst === process.env.EVOLUTION_INSTANCE?.trim(); };
async function evo(path, body, method = 'POST') {
  if (YC.activo() && esPrincipal(path)) return YC.evoCompat(path, body, method);
  const { url, key } = env();
  if (!url || !key) throw new Error('Falta configurar Evolution (Sistema → Llaves).');
  const res = await fetch(`${url}${path}`, { method, headers: { apikey: key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Evolution ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// Historial anterior de un cliente, desde lo que ya guarda Evolution (no hace falta tocar Velforce ni el teléfono):
// los mensajes de antes de que la oficina empezara a recibirlos se agregan al principio de la conversación,
// para que el vendedor sepa lo que ya se habló con el equipo. Los que escribió el equipo quedan como "equipo".
const textoHistorial = (rec) => {
  const x = rec.message || {};
  const t = x.conversation || x.extendedTextMessage?.text || x.imageMessage?.caption || x.videoMessage?.caption || '';
  if (t) return String(t);
  const tipo = x.imageMessage ? 'una imagen' : x.videoMessage ? 'un video' : x.audioMessage ? 'una nota de voz' : x.documentMessage ? `un documento (${x.documentMessage.fileName || 'archivo'})` : x.stickerMessage ? 'un sticker' : x.locationMessage ? 'una ubicación' : null;
  return tipo ? `[${rec.key?.fromMe ? 'Se envió' : 'El cliente envió'} ${tipo}]` : null;
};
let chatsCache = { at: 0, list: [] };
async function chatsEvolution() {
  if (Date.now() - chatsCache.at < 10 * 60e3) return chatsCache.list;
  const { inst } = env();
  const c = await evo(`/chat/findChats/${inst}`, {});
  chatsCache = { at: Date.now(), list: Array.isArray(c) ? c : [] };
  return chatsCache.list;
}
// Índice de TODOS los mensajes que guarda Evolution (unos 9.000, en páginas de 100). Los contactos con identificador @lid
// guardan el teléfono en key.remoteJidAlt (o senderPn): buscar solo por remoteJid se pierde esos chats.
let indice = { at: 0, filas: [], total: 0 };
export async function indiceMensajes(forzar = false) {
  if (!forzar && Date.now() - indice.at < 30 * 60e3 && indice.filas.length) return indice;
  const { inst } = env();
  const filas = [];
  let page = 1, pages = 1, total = 0;
  while (page <= pages && page <= 200) {
    const r = await evo(`/chat/findMessages/${inst}`, { where: {}, page, offset: 100 });
    const m = r?.messages;
    pages = m?.pages || pages; total = m?.total ?? total;
    for (const x of m?.records || []) {
      const ts = Number(x.messageTimestamp?.low ?? x.messageTimestamp);
      const texto = textoHistorial(x);
      if (!ts || !texto) continue;
      filas.push({ jid: x.key?.remoteJid || '', alt: x.key?.remoteJidAlt || x.senderPn || '', fromMe: Boolean(x.key?.fromMe), ts: ts * 1000, texto, id: x.key?.id });
    }
    page++;
  }
  indice = { at: Date.now(), filas, total };
  return indice;
}
export async function importarHistorial(conv, { max = 150, forzar = false } = {}) {
  if (!conv || conv.kind !== 'whatsapp' || (conv.historialImportado && !forzar)) return 0;
  if (forzar) conv.msgs = conv.msgs.filter((m) => !m.previo);
  const num = keyOf(conv.phone);
  const ix = await indiceMensajes();
  const propios = ix.filas.filter((f) => f.jid.startsWith(num) || String(f.alt).startsWith(num));
  // Si el chat está con @lid, todos los mensajes de ese mismo identificador también son de este cliente.
  const lids = new Set(propios.map((f) => f.jid).filter((j) => j.endsWith('@lid')));
  const porId = new Map();
  for (const f of ix.filas) if (f.jid.startsWith(num) || String(f.alt).startsWith(num) || lids.has(f.jid)) porId.set(f.id || `${f.jid}-${f.ts}`, f);
  const tope = conv.msgs[0]?.ts ?? Date.now();
  const previos = [...porId.values()]
    .filter((x) => x.ts < tope - 60e3)
    .sort((a, b) => a.ts - b.ts)
    .slice(-max)
    .map((x) => ({ role: x.fromMe ? 'equipo' : 'cliente', text: String(x.texto).slice(0, 1200), ts: x.ts, previo: true }));
  conv.historialImportado = Date.now();
  if (previos.length) { conv.msgs.unshift(...previos); conv.historialN = previos.length; log('vendedor', `Historial anterior de ${conv.contacto?.empresa || conv.title}: ${previos.length} mensajes desde ${new Date(previos[0].ts).toISOString().slice(0, 10)}`, 'info'); }
  touchConv(conv);
  return previos.length;
}
export async function importarHistorialRecontactosViejo(conv, { max = 150 } = {}) {
  if (!conv || conv.kind !== 'whatsapp' || conv.historialImportado) return 0;
  const { inst } = env();
  const num = keyOf(conv.phone);
  const jids = new Set([String(conv.phone).startsWith('lid:') ? `${String(conv.phone).slice(4)}@lid` : `${num}@s.whatsapp.net`]);
  for (const c of await chatsEvolution().catch(() => [])) {
    const alt = [c.remoteJid, c.remoteJidAlt, c.lastMessage?.key?.remoteJid, c.lastMessage?.key?.remoteJidAlt].filter(Boolean);
    if (alt.some((j) => String(j).startsWith(num))) alt.forEach((j) => jids.add(j));
  }
  const porId = new Map();
  for (const jid of jids) {
    for (let page = 1; page <= 3; page++) {
      const r = await evo(`/chat/findMessages/${inst}`, { where: { key: { remoteJid: jid } }, page, offset: 100 }).catch(() => null);
      const recs = Array.isArray(r?.messages?.records) ? r.messages.records : [];
      for (const x of recs) porId.set(x.key?.id || `${jid}-${x.messageTimestamp}`, x);
      if (recs.length < 100) break;
    }
  }
  // Solo lo anterior a lo que la oficina ya tiene (lo demás está duplicado).
  const tope = conv.msgs[0]?.ts ?? Date.now();
  const previos = [...porId.values()]
    .map((x) => ({ ts: (Number(x.messageTimestamp?.low ?? x.messageTimestamp) || 0) * 1000, fromMe: Boolean(x.key?.fromMe), text: textoHistorial(x) }))
    .filter((x) => x.ts && x.ts < tope - 60e3 && x.text)
    .sort((a, b) => a.ts - b.ts)
    .slice(-max)
    .map((x) => ({ role: x.fromMe ? 'equipo' : 'cliente', text: x.text.slice(0, 1200), ts: x.ts, previo: true }));
  conv.historialImportado = Date.now();
  if (previos.length) { conv.msgs.unshift(...previos); conv.historialN = previos.length; log('vendedor', `Historial anterior de ${conv.contacto?.empresa || conv.title}: ${previos.length} mensajes desde ${new Date(previos[0].ts).toISOString().slice(0, 10)}`, 'info'); }
  touchConv(conv);
  return previos.length;
}
export async function importarHistorialRecontactos({ forzar = false } = {}) {
  const lista = Object.values(V.convs).filter((c) => c.kind === 'whatsapp' && (forzar || !c.historialImportado) && (c.recontacto || c.estado?.cotizacion));
  const out = [];
  await indiceMensajes(true);
  for (const c of lista) { try { out.push({ cliente: c.contacto?.empresa || c.title, mensajes: await importarHistorial(c, { forzar }) }); } catch (e) { out.push({ cliente: c.title, error: e.message.slice(0, 100) }); } }
  saveNow();
  return out;
}

// Diagnóstico: qué campos trae el mensaje CRUDO de un cliente que llegó por un anuncio (busca datos del anuncio de origen).
// Diagnóstico: los últimos mensajes que mandamos a un número y su estado real en WhatsApp
// (PENDING = reloj, nunca salió · SERVER_ACK = un check · DELIVERY_ACK = dos checks · READ = leído).
export async function estadoEnvios(telefono, n = 12) {
  const num = keyOf(telefono);
  const { inst } = env();
  const ix = await indiceMensajes();
  const jids = new Set([`${num}@s.whatsapp.net`]);
  for (const f of ix.filas) if (f.jid.startsWith(num) || String(f.alt).startsWith(num)) jids.add(f.jid);
  const out = [];
  for (const jid of jids) {
    const r = await evo(`/chat/findMessages/${inst}`, { where: { key: { remoteJid: jid, fromMe: true } }, page: 1, offset: 50 }).catch((e) => ({ error: e.message }));
    for (const x of r?.messages?.records || []) {
      const ups = (x.MessageUpdate || x.messageUpdate || []).map((u) => u.status);
      out.push({ jid, id: x.key?.id, ts: (x.messageTimestamp || 0) * 1000, status: x.status || null, updates: ups, texto: String(x.message?.conversation || x.message?.extendedTextMessage?.text || '').slice(0, 70) });
    }
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, n);
}
export async function mensajeCrudo(telefono) {
  const ix = await indiceMensajes();
  const num = keyOf(telefono);
  const { inst } = env();
  const jids = new Set([`${num}@s.whatsapp.net`]);
  for (const f of ix.filas) if (f.jid.startsWith(num) || String(f.alt).startsWith(num)) jids.add(f.jid);
  const out = { numero: num, mensajes: [] };
  const hallazgos = new Set();
  for (const jid of jids) {
    const r = await evo(`/chat/findMessages/${inst}`, { where: { key: { remoteJid: jid } }, page: 1, offset: 20 }).catch(() => null);
    for (const x of (r?.messages?.records || []).filter((m) => !m.key?.fromMe).slice(-3)) {
      const rutas = [];
      const walk = (o, ruta) => {
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o)) {
          const r2 = `${ruta}.${k}`;
          if (/ctwa|referral|externalAd|sourceId|sourceUrl|entryPoint|conversion|adReply|headline|utm|campaign/i.test(k)) { rutas.push(`${r2} = ${typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80)}`); hallazgos.add(k); }
          if (v && typeof v === 'object') walk(v, r2);
        }
      };
      walk(x, 'msg');
      out.mensajes.push({ tipo: x.messageType, texto: String(textoHistorial(x) || '').slice(0, 70), claves_contexto: Object.keys(x.contextInfo || x.message?.extendedTextMessage?.contextInfo || x.message?.[x.messageType]?.contextInfo || {}).join(','), datos_de_anuncio: rutas });
    }
  }
  try { const v = await fetch(env().url, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()); out.evolution = { version: v.version, cliente: v.clientName, integraciones: v.integration || undefined }; } catch {}
  try { const ins = await evo('/instance/fetchInstances', null, 'GET'); out.integracion = (Array.isArray(ins) ? ins : []).map((i) => (i.instance || i).integration).join(','); } catch {}
  out.resumen = hallazgos.size ? `Aparecen: ${[...hallazgos].join(', ')}` : 'No aparece ningún campo de anuncio en el mensaje crudo';
  return out;
}

// Diagnóstico del historial que guarda Evolution: ajustes, cuántos chats y qué tan atrás llegan los mensajes de algunos números.
export async function diagnosticoHistorial(telefonos = []) {
  const { inst } = env();
  const out = { instancia: inst };
  try { out.ajustes = await evo(`/settings/find/${inst}`, null, 'GET'); } catch (e) { out.ajustes = `no se pudo leer: ${e.message}`; }
  try {
    const chats = await evo(`/chat/findChats/${inst}`, {});
    const lista = Array.isArray(chats) ? chats : [];
    const ts = (c) => Number(c.lastMessage?.messageTimestamp?.low ?? c.lastMessage?.messageTimestamp ?? c.updatedAt ? Date.parse(c.updatedAt) / 1000 : 0) || 0;
    const tiempos = lista.map(ts).filter(Boolean).sort((a, b) => a - b);
    out.chats = { total: lista.length, ultimoMensajeMasAntiguo: tiempos[0] ? new Date(tiempos[0] * 1000).toISOString().slice(0, 10) : null, ultimoMensajeMasNuevo: tiempos.at(-1) ? new Date(tiempos.at(-1) * 1000).toISOString().slice(0, 10) : null };
  } catch (e) { out.chats = `no se pudo leer: ${e.message}`; }
  try {
    const ins = await evo('/instance/fetchInstances', null, 'GET');
    out.instancias = (Array.isArray(ins) ? ins : []).map((i) => { const x = i.instance || i; return { nombre: x.name || x.instanceName, estado: x.connectionStatus || x.status, numero: String(x.ownerJid || x.owner || '').replace(/@.*/, '').slice(-4), conteo: x._count || undefined }; });
  } catch (e) { out.instancias = `no se pudo leer: ${e.message}`; }
  // Mensajes de todo el historial guardado: el más nuevo y el más antiguo (la lista viene del más nuevo al más viejo).
  try {
    const p1 = await evo(`/chat/findMessages/${inst}`, { where: {}, page: 1, offset: 1 });
    const total = p1?.messages?.total ?? 0;
    const ult = await evo(`/chat/findMessages/${inst}`, { where: {}, page: total, offset: 1 });
    const t = (r) => { const x = (r?.messages?.records || [])[0]; const v = Number(x?.messageTimestamp?.low ?? x?.messageTimestamp); return v ? new Date(v * 1000).toISOString().slice(0, 10) : null; };
    out.mensajes = { total, masNuevo: t(p1), masAntiguo: t(ult) };
  } catch (e) { out.mensajes = `no se pudo leer: ${e.message.slice(0, 160)}`; }
  // Los contactos nuevos de WhatsApp pueden guardarse con identificador @lid en vez del teléfono: se buscan los dos.
  let chatsAll = [];
  try { const c = await evo(`/chat/findChats/${inst}`, {}); chatsAll = Array.isArray(c) ? c : []; } catch {}
  out.numeros = [];
  for (const t of telefonos) {
    const num = keyOf(t);
    const jids = new Set([`${num}@s.whatsapp.net`]);
    for (const c of chatsAll) { const alt = [c.remoteJid, c.remoteJidAlt, c.lastMessage?.key?.remoteJid, c.lastMessage?.key?.remoteJidAlt].filter(Boolean); if (alt.some((j) => String(j).startsWith(num))) alt.forEach((j) => jids.add(j)); }
    let total = 0; const tss = [];
    for (const jid of jids) {
      try {
        const r = await evo(`/chat/findMessages/${inst}`, { where: { key: { remoteJid: jid } }, page: 1, offset: 200 });
        const m = r?.messages || r;
        const recs = Array.isArray(m?.records) ? m.records : Array.isArray(m) ? m : [];
        total += m?.total ?? recs.length;
        for (const x of recs) { const v = Number(x.messageTimestamp?.low ?? x.messageTimestamp); if (v) tss.push(v); }
      } catch {}
    }
    tss.sort((a, b) => a - b);
    out.numeros.push({ numero: num, identificadores: [...jids].map((j) => String(j).replace(/^(\d{4}).*@/, '$1…@')), total, masAntiguo: tss[0] ? new Date(tss[0] * 1000).toISOString().slice(0, 16) : null, masNuevo: tss.at(-1) ? new Date(tss.at(-1) * 1000).toISOString().slice(0, 16) : null });
  }
  return out;
}

// ---------- configuración ----------
export async function connectWebhook(publicBase) {
  await importExistingFromEvolution().catch(() => {});
  const { inst } = env();
  const url = `${publicBase.replace(/\/$/, '')}/hook/evolution/${hookToken()}`;
  await evo(`/webhook/set/${inst}`, { webhook: { enabled: true, url, byEvents: false, base64: false, events: ['MESSAGES_UPSERT'] } });
  log('vendedor', 'WhatsApp conectado a la oficina (Evolution → webhook)', 'ok');
  return { ok: true };
}
let keyCache = { ts: 0, v: null };
export async function waStatus() {
  const { inst } = env();
  const s = await evo(`/instance/connectionState/${inst}`, null, 'GET').catch((e) => ({ error: e.message }));
  if (Date.now() - keyCache.ts > 5 * 60e3) {
    const { testKey } = await import('../secrets.mjs');
    keyCache = { ts: Date.now(), v: await testKey('OPENROUTER_API_KEY').catch((e) => ({ state: 'unreachable', detail: e.message })) };
  }
  // ¿La oficina alcanza a Evolution por la red interna? (Evolution usa la misma red para avisarnos.)
  const red = await fetch('http://tools_evolution:8080/', { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? 'ok' : `HTTP ${r.status}`)).catch((e) => e.message.slice(0, 60));
  return { live: L.enabled, autoStart: Boolean(L.autoStart), existentes: existingSet.size, redInterna: red, avisos: L.hooks || null, state: s?.instance?.state || s?.error || 'desconocido', modelo: keyCache.v, caidoDesde: L.waCaido || null, ycloud: YC.activo() };
}
// ---------- conexión del WhatsApp principal: reconectar con QR, vigía y recuperar lo que llegó mientras estaba caído ----------
const estadoEvo = async (inst = env().inst) => { const s = await evo(`/instance/connectionState/${inst}`, null, 'GET').catch((e) => ({ error: e.message })); return s?.instance?.state || s?.state || null; };
// Reconectar desde Ajustes: primero se reinicia la sesión (si el teléfono no la cerró, vuelve sola); si no, sale el QR.
export async function qrWhatsapp() {
  const { inst } = env();
  if ((await estadoEvo(inst)) === 'open') return { conectado: true };
  // Si WhatsApp sacó el dispositivo (401 / device_removed), la sesión guardada ya no sirve: reiniciarla deja la
  // instancia en "connecting" para siempre. Se cierra (logout: no borra chats ni ajustes) y se pide un QR limpio.
  const info = await evo(`/instance/fetchInstances?instanceName=${inst}`, null, 'GET').catch(() => []);
  const i0 = (Array.isArray(info) ? info : [info])[0] || {};
  const sacado = Number(i0.disconnectionReasonCode) === 401 || /device_removed|conflict|logged ?out/i.test(JSON.stringify(i0.disconnectionObject || ''));
  if (sacado) {
    log('vendedor', 'WhatsApp había sacado el dispositivo: se cierra la sesión vieja y se genera un QR limpio', 'warn');
    await evo(`/instance/logout/${inst}`, null, 'DELETE').catch(() => null);
    await sleep(3000);
    const c = await evo(`/instance/connect/${inst}`, null, 'GET');
    return { conectado: false, qr: c?.base64 || null, codigo: c?.pairingCode || null, estado: await estadoEvo(inst), motivo: 'WhatsApp había cerrado la sesión de este dispositivo: escaneá el QR nuevo.' };
  }
  await evo(`/instance/restart/${inst}`, {}, 'POST').catch(() => evo(`/instance/restart/${inst}`, {}, 'PUT').catch(() => null));
  for (let i = 0; i < 4; i++) { await sleep(2500); if ((await estadoEvo(inst)) === 'open') { vigiaWa().catch(() => {}); return { conectado: true, reconectado: true }; } }
  const c = await evo(`/instance/connect/${inst}`, null, 'GET');
  return { conectado: false, qr: c?.base64 || null, codigo: c?.pairingCode || null, estado: await estadoEvo(inst) };
}
// Los mensajes que entraron mientras no llegaban avisos (WhatsApp caído): se procesan en orden, como si acabaran de
// llegar. Los que ya se habían procesado se saltan solos (L.seenIds).
export async function recuperarPerdidos(desde) {
  const { inst } = env();
  const tsDe = (x) => Number(x.messageTimestamp?.low ?? x.messageTimestamp) * 1000;
  const pag = async (page) => (await evo(`/chat/findMessages/${inst}`, { where: {}, page, offset: 100 }))?.messages || {};
  const p1 = await pag(1);
  const pages = p1.pages || 1;
  const ultima = pages > 1 ? await pag(pages) : p1;
  // ¿Las páginas vienen de la más nueva a la más vieja o al revés?
  const desc = Math.max(0, ...(p1.records || []).map(tsDe)) >= Math.max(0, ...(ultima.records || []).map(tsDe));
  const recs = [];
  for (let i = 0; i < Math.min(pages, 40); i++) {
    const page = desc ? i + 1 : pages - i;
    const r = page === 1 ? p1 : page === pages ? ultima : await pag(page);
    const nuevos = (r.records || []).filter((x) => tsDe(x) > desde);
    recs.push(...nuevos);
    if (!nuevos.length) break;
  }
  recs.sort((a, b) => tsDe(a) - tsDe(b));
  let n = 0;
  for (const rec of recs) {
    if (rec.key?.id && L.seenIds.includes(rec.key.id)) continue;
    await handleWebhook({ event: 'messages.upsert', data: rec }).catch((e) => log('vendedor', `No se pudo procesar un mensaje recuperado: ${e.message}`, 'warn'));
    n++;
  }
  log('vendedor', `WhatsApp: ${n} mensajes recuperados de cuando estaba desconectado`, n ? 'ok' : 'info');
  return { recuperados: n };
}
// Vigía: cada minuto mira la conexión. Si se cae, avisa por Discord (el WhatsApp no sirve para eso) y en la oficina;
// cuando vuelve, avisa y procesa lo que llegó mientras tanto.
let fallasWa = 0;
export async function vigiaWa() {
  const { inst } = env();
  if (!inst) return;
  const st = await estadoEvo(inst);
  if (st === 'open') {
    fallasWa = 0;
    if (L.waCaido) {
      const desde = L.waCaido - 10 * 60e3;
      L.waCaido = null; saveNow();
      const { mensajeDiscord } = await import('../voz.mjs');
      mensajeDiscord('✅ **WhatsApp de ventas reconectado.** Estoy procesando los mensajes que llegaron mientras estaba caído.').catch(() => {});
      const r = await recuperarPerdidos(desde).catch((e) => ({ error: e.message }));
      mensajeDiscord(r.error ? `⚠️ No pude recuperar los mensajes perdidos: ${r.error}` : `📥 Recuperé **${r.recuperados}** mensajes de cuando WhatsApp estaba caído; el vendedor y Jarvis ya los están atendiendo.`).catch(() => {});
    }
    return;
  }
  if (++fallasWa < 2 || L.waCaido) return; // dos lecturas seguidas para no avisar por un parpadeo
  L.waCaido = Math.min(Date.now(), L.hooks?.last || Date.now()); saveNow();
  log('vendedor', `WhatsApp de ventas desconectado (estado: ${st || 'sin respuesta'}). Reconectalo en Ajustes → WhatsApp de ventas`, 'error');
  const { mensajeDiscord } = await import('../voz.mjs');
  mensajeDiscord(`🔴 **WhatsApp de ventas desconectado** (estado: ${st || 'sin respuesta'}). El vendedor y Jarvis no reciben mensajes.
Reconectalo en la oficina: **Ajustes → WhatsApp de ventas → Reconectar** (si hace falta, ahí sale el QR). Al volver, proceso solo lo que haya llegado.`).catch(() => {});
}
setInterval(() => vigiaWa().catch(() => {}), 60e3);
export const waCaido = () => L.waCaido || null;

export async function setLive(on) {
  if (on) {
    // No se enciende si el modelo no puede responder: el cliente quedaría sin respuesta.
    const { testKey } = await import('../secrets.mjs');
    const conPlan = V.config.motor !== 'openrouter' && process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    const t = conPlan ? null : await testKey('OPENROUTER_API_KEY');
    if (!conPlan && t?.state !== 'ok') throw new Error(`No se puede encender: ${t?.detail || 'falta la llave de OpenRouter'}`);
  }
  L.enabled = Boolean(on);
  L.autoStart = false; // una decisión manual reemplaza al encendido automático
  if (!L.enabled) { for (const t of timers.values()) clearTimeout(t.timer); timers.clear(); }
  // Al encender: quien escribió hace poco y quedó sin respuesta, recibe respuesta.
  if (L.enabled) for (const c of Object.values(V.convs)) {
    const last = c.msgs?.at(-1);
    if (c.kind === 'whatsapp' && !c.pausa && !timers.has(c.id) && last?.role === 'cliente' && Date.now() - last.ts < 30 * 60e3) schedule(c);
  }
  log('vendedor', L.enabled ? 'Vendedor ENCENDIDO: responde en WhatsApp' : 'Vendedor APAGADO: no responde ni hace seguimientos', L.enabled ? 'ok' : 'warn');
  saveNow();
  return L.enabled;
}

// ---------- utilidades ----------
const digits = (s) => String(s || '').replace(/\D/g, '');
const isLid = (j) => String(j || '').endsWith('@lid');
// A dónde se manda. WhatsApp pasó muchos chats a la dirección @lid: si se le escribe al número (@s.whatsapp.net),
// el mensaje llega pero en el teléfono de Cresova queda en OTRO hilo, y parecía que la demo no había salido
// (Diego la reenviaba a mano: Flujo Evolutivo, Academia, Asociación Esperanza Catracha, nov. 2026).
const destino = (conv) => (conv.phone.startsWith('lid:') ? `${conv.phone.slice(4)}@lid` : YC.activo() && !conv.inst ? conv.phone : conv.lid || conv.phone);
function marcarLid(conv, jid) {
  if (!conv || !isLid(jid) || conv.phone.startsWith('lid:') || conv.lid === jid) return;
  conv.lid = jid;
  touchConv(conv);
}
// Chats que ya existían: se les busca su @lid en el índice de mensajes de Evolution (una vez al arrancar).
export async function completarLids() {
  const ix = await indiceMensajes().catch(() => null);
  if (!ix) return 0;
  const porNumero = new Map();
  for (const f of ix.filas) if (isLid(f.jid) && f.alt && !isLid(f.alt)) porNumero.set(digits(String(f.alt).split('@')[0]), f.jid);
  let n = 0;
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp' || c.lid || String(c.phone).startsWith('lid:')) continue;
    const j = porNumero.get(c.phone);
    if (j) { c.lid = j; touchConv(c); n++; }
  }
  if (n) log('vendedor', `${n} chats de WhatsApp ahora responden en su hilo @lid (el mismo donde escribe el cliente)`, 'info');
  return n;
}
setTimeout(() => { if (env().inst) completarLids().catch(() => {}); }, 90_000);
function resolvePhone(m) {
  const k = m.key || {};
  for (const c of [!isLid(k.remoteJid) ? k.remoteJid : null, k.remoteJidAlt, k.senderPn, m.senderPn, k.participantPn]) {
    if (!c || isLid(c)) continue;
    const d = digits(String(c).split('@')[0].split(':')[0]);
    if (d.length >= 10 && d.length <= 14) return d;
  }
  return isLid(k.remoteJid) ? `lid:${digits(k.remoteJid.split('@')[0])}` : null;
}

function describe(msg) {
  const x = msg.message || {};
  if (x.conversation) return x.conversation;
  if (x.extendedTextMessage?.text) return x.extendedTextMessage.text;
  if (x.imageMessage) return x.imageMessage.caption ? `[El cliente envió una imagen con el texto: "${x.imageMessage.caption}"]` : '[El cliente envió una imagen (puede ser su logo o una foto de su negocio)]';
  if (x.videoMessage) return x.videoMessage.caption ? `[El cliente envió un video: "${x.videoMessage.caption}"]` : '[El cliente envió un video]';
  if (x.audioMessage) return '[El cliente envió un audio que no podés escuchar]';
  if (x.stickerMessage) return '[El cliente envió un sticker]';
  if (x.documentMessage) return `[El cliente envió un documento: ${x.documentMessage.fileName || 'archivo'}]`;
  if (x.locationMessage) return '[El cliente envió una ubicación]';
  if (x.contactMessage) return '[El cliente envió un contacto]';
  if (x.reactionMessage) return null; // reacciones: no disparan respuesta
  return '[Mensaje no soportado]';
}

function adOf(msg) {
  // Evolution puede mandar el contexto arriba (msg.contextInfo) o dentro del tipo de mensaje (texto, imagen, video…):
  // se busca en todos y se usa el primero que traiga el anuncio.
  const ctxs = [msg.contextInfo, ...Object.values(msg.message || {}).map((v) => v && typeof v === 'object' ? v.contextInfo : null)].filter(Boolean);
  const ad = ctxs.map((c) => c.externalAdReply).find(Boolean);
  if (!ad || !(ad.title || ad.body || ad.sourceId || ad.ctwaClid)) return null;
  return { titulo: String(ad.title || ad.body || `Anuncio ${ad.sourceId || ''}`).slice(0, 200), texto: String(ad.body || '').slice(0, 600), id: ad.sourceId || null, url: ad.sourceUrl || null, clid: ad.ctwaClid || ad.ctwaClickId || null, campos: Object.keys(ad).join(',').slice(0, 300), en: Date.now() };
}
// Para diagnosticar: qué trae el contexto de los primeros mensajes de cada conversación nueva.
const ctxKeys = (msg) => [msg.contextInfo ? `top:${Object.keys(msg.contextInfo).join('+')}` : '', ...Object.entries(msg.message || {}).map(([k, v]) => v && typeof v === 'object' && v.contextInfo ? `${k}:${Object.keys(v.contextInfo).join('+')}` : '')].filter(Boolean).join(' | ').slice(0, 400);

const remember = (list, id, max = 3000) => { list.push(id); if (list.length > max) list.splice(0, list.length - max); };
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 300);

// "Pare", "no me escriban", "ya no me interesa"… (no incluye cosas como "ya no tengo el logo").
const OPT_OUT = /b(pare|parar|paren)b.*b(proyecto|mensajes|escribir|contacto)|bpare conb|no me (interesa|escrib|moles|contact|vuelvan|llamen)|no (quiero|queremos) (nada|continuar|seguir|m[aá]s|la p[aá]gina|el proyecto)|no nos interesa|bd[eé]j(a|e|en|ame|enme)b.*b(escribir|molestar|contactar|tranquilo)|b(stop|baja)b|ya no (me|nos) interesa|cancel(ar|e|en|a)b.*b(proyecto|pedido|todo)/i;
// Respuesta automática de un negocio (menú, "gracias por escribirnos", "estamos ocupados"…).
const AUTO_REPLY = /un gusto atenderle|gracias por (contactar|comunicarte|escribir|escribirnos|contactarnos|comunicarse)|(en qu[eé]|con qu[eé]) (puedo|podemos) (ayudar|servir)|(cu[aá]l|qu[eé]) (producto|servicio) (necesita|necesitas|desea|deseas)|estamos (ocupados|fuera|cerrados)|fuera de (nuestro )?horario|horario de atenci[oó]n|respuesta autom[aá]tica|mensaje autom[aá]tico|te atenderemos|le atenderemos|en breve (un|nuestro|te|le)|responderemos|bienvenid[oa] a|escribe (el )?n[uú]mero|marca (1|2)|digita/i;
function convFor(phone, pushName, inst = null) {
  let conv = Object.values(V.convs).find((c) => c.kind === 'whatsapp' && c.phone === phone && mismaInst(c, inst));
  if (!conv) {
    conv = newConv({ title: pushName ? `${pushName} · +${phone}` : `+${phone}`, kind: 'whatsapp', phone });
    if (inst) conv.inst = inst;
    conv.pausa = !inst && isExisting(phone) ? { motivo: 'Contacto que ya existía: el vendedor solo atiende contactos nuevos', existente: true, ts: Date.now() } : null;
    conv.followups = { step: 0, next: null };
    conv.outbox = [];
  }
  return conv;
}

// ---------- notas de voz ----------
// Con llave de OpenAI se usa Whisper; si no, un modelo que entiende audio por OpenRouter
// (la misma llave del vendedor). El audio de WhatsApp (ogg/opus) se pasa a mp3 con ffmpeg.
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'google/gemini-3.5-flash-lite';

async function toMp3(buf) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-f', 'mp3', 'pipe:1']);
    const out = [];
    p.stdout.on('data', (d) => out.push(d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg terminó con código ${code}`))));
    p.stdin.end(buf);
  });
}

async function transcribe(m, instP = null) {
  const openai = process.env.OPENAI_API_KEY?.trim();
  const openrouter = process.env.OPENROUTER_API_KEY?.trim();
  if (!openai && !openrouter && !process.env.GEMINI_API_KEY?.trim()) return null;
  const inst = instP || env().inst;
  const media = await evo(`/chat/getBase64FromMediaMessage/${inst}`, { message: { key: m.key, message: m.message }, convertToMp4: false });
  if (!media?.base64) throw new Error('Evolution no devolvió el audio');
  const raw = Buffer.from(media.base64, 'base64');
  const mime = String(media.mimetype || m.message.audioMessage.mimetype || 'audio/ogg').split(';')[0];
  return transcribeRaw(raw, mime);
}

export async function transcribeRaw(raw, mime = 'audio/ogg') {
  const openai = process.env.OPENAI_API_KEY?.trim();
  const openrouter = process.env.OPENROUTER_API_KEY?.trim();
  if (!openai && !openrouter && !process.env.GEMINI_API_KEY?.trim()) return null;
  if (openai) {
    const form = new FormData();
    form.append('file', new Blob([raw], { type: mime }), `nota.${mime.includes('mp4') ? 'm4a' : mime.includes('mpeg') ? 'mp3' : 'ogg'}`);
    form.append('model', 'whisper-1');
    form.append('language', 'es');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${openai}` }, body: form, signal: AbortSignal.timeout(60_000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message || `OpenAI respondió ${res.status}`);
    return String(j.text || '').trim().slice(0, 8000) || null;
  }
  // Con la llave de Google (Gemini) se transcribe directo, sin depender del saldo de OpenRouter.
  const gem = process.env.GEMINI_API_KEY?.trim();
  if (gem) {
    for (const model of ['gemini-2.5-flash', 'gemini-flash-latest']) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(gem)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: String(mime).split(';')[0] || 'audio/ogg', data: Buffer.from(raw).toString('base64') } }, { text: 'Transcribí este audio en español, palabra por palabra, sin comentarios ni comillas. Si no se entiende nada, respondé solo: [inaudible]' }] }], generationConfig: { temperature: 0, maxOutputTokens: 2048, ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }),
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      if (!r?.ok) continue;
      const j = await r.json().catch(() => ({}));
      const t = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
      if (t) return t.slice(0, 8000);
    }
  }
  const mp3 = await toMp3(raw);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openrouter}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://cresova.com', 'X-Title': 'Oficina Cresova - Notas de voz' },
    body: JSON.stringify({ model: TRANSCRIBE_MODEL, temperature: 0, messages: [{ role: 'user', content: [
      { type: 'text', text: 'Transcribí exactamente lo que dice este audio de WhatsApp (español de Honduras). Devolvé solo la transcripción, sin comentarios. Si no se entiende nada, devolvé: [inaudible]' },
      { type: 'input_audio', input_audio: { data: mp3.toString('base64'), format: 'mp3' } },
    ] }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error?.message || `OpenRouter respondió ${res.status}`);
  const text = String(j.choices?.[0]?.message?.content || '').trim();
  return text && !/^\[inaudible\]$/i.test(text) ? text.slice(0, 8000) : null;
}

// ---------- entrada ----------
export async function handleWebhook(body, { inst: P = null } = {}) {
  L.hooks = { n: (L.hooks?.n || 0) + 1, last: Date.now(), event: String(body?.event || '') };
  const ev = String(body?.event || '').toLowerCase().replace(/_/g, '.');
  if (ev !== 'messages.upsert') return;
  const list = Array.isArray(body.data?.messages) ? body.data.messages : [body.data];
  for (const m of list) {
    const jid = m?.key?.remoteJid || '';
    if (!jid || /@g\.us$|@broadcast$|@newsletter$|^status@/.test(jid)) continue;
    const id = m.key.id;
    if (id && L.seenIds.includes(id)) continue;
    if (id) remember(L.seenIds, id);
    const phone = resolvePhone(m);
    if (!phone) continue;
    let text = describe(m);
    if (text == null) continue;
    // Notas de voz: se transcriben con Whisper (si hay llave de OpenAI) y el vendedor responde a lo que dijeron.
    if (m.message?.audioMessage && !m.key.fromMe) {
      const said = await transcribe(m, P).catch((e) => { log('vendedor', `No se pudo transcribir un audio: ${e.message}`, 'warn'); return null; });
      if (said) text = phone === OWNER ? `[Nota de voz de Diego, transcrita]: ${said}` : `[Nota de voz del cliente, transcrita]: ${said}`;
    }

    if (P && phone === OWNER) continue; // en el número de prospección Diego no habla con Jarvis
    if (!m.key.fromMe && phone === OWNER) {
      const vid = m.message?.videoMessage || (m.message?.documentMessage?.mimetype?.startsWith('video/') ? m.message.documentMessage : null);
      if (vid) {
        try {
          const { inst } = env();
          const media = await evo(`/chat/getBase64FromMediaMessage/${inst}`, { message: { key: m.key, message: m.message }, convertToMp4: true });
          if (!media?.base64) throw new Error('Evolution no devolvió el video');
          const { guardarEntrante } = await import('../videos.mjs');
          const name = guardarEntrante(Buffer.from(media.base64, 'base64'), 'mp4');
          text = `[Diego te mandó un video por WhatsApp: archivo "${name}"${vid.caption ? ` con el texto: ${vid.caption}` : ''}. Miralo con ver_video (archivo) antes de responder.]`;
        } catch (e) {
          text = `[Diego te mandó un video por WhatsApp pero no se pudo descargar (${e.message}). Pedile el link.]`;
        }
      }
      L.ownerUltimo = Date.now();
      ownerSays(text);
      continue;
    }
    if (phone === OWNER) continue; // lo que sale hacia Diego (respuestas de Jarvis) no es una conversación de ventas

    if (m.key.fromMe) {
      // ¿Lo envió el bot? Por id, o por texto idéntico enviado hace menos de 2 min (el webhook puede llegar antes que la respuesta del envío).
      const conv0 = Object.values(V.convs).find((c) => c.kind === 'whatsapp' && c.phone === phone && mismaInst(c, P));
      const recentBot = conv0?.msgs.filter((x) => x.role === 'bot' && Date.now() - x.ts < 120e3).some((x) => norm(x.text) === norm(text));
      if ((id && L.sentIds.includes(id)) || recentBot) continue;
      const isNew = !Object.values(V.convs).some((c) => c.kind === 'whatsapp' && c.phone === phone && mismaInst(c, P));
      const conv = convFor(phone, null, P);
      marcarLid(conv, jid);
      // Si la conversación la empezó el equipo, no es un prospecto nuevo de anuncio (salvo que sea el saludo automático, que llega pegado al primer mensaje del cliente).
      if (isNew) conv.iniciadaPorEquipo = Date.now();
      conv.msgs.push({ role: 'equipo', text, ts: Date.now() });
      if (conv.msgs.some((x) => x.role === 'cliente')) pause(conv, 'Una persona escribió desde el teléfono');
      manualComoSeguimiento(conv, text);
      touchConv(conv);
      continue;
    }

    const conv = convFor(phone, m.pushName, P);
    marcarLid(conv, jid);
    if (m.pushName && !conv.contacto.nombre) conv.contacto.nombre = String(m.pushName).slice(0, 80);
    const ad = adOf(m);
    if (ad && !conv.anuncio) {
      conv.anuncio = ad;
      // Confirmación del parche de Evolution (3 nov 2026): el primer chat que llega con el anuncio se le avisa a Diego.
      if (!L.anuncioConfirmado && ad.id) {
        L.anuncioConfirmado = Date.now();
        avisarDiego(`✅ *Ya llega el anuncio en los chats.* ${conv.contacto?.nombre || conv.title} escribió desde el anuncio "${String(ad.titulo || ad.id).slice(0, 80)}" (ID ${ad.id}). Desde ahora Ventas y Renata pueden juzgar cada anuncio por sus ventas.`).catch(() => {});
      }
    }
    // Diego (3 nov 2026): un contacto que ya existía pero vuelve por un anuncio es un lead (los leads vuelven por otros
    // anuncios). Solo sigue pausado si es cliente de verdad: tiene una cotización aceptada, firmada o pagada.
    if (conv.anuncio && conv.pausa?.existente && !conv.pausa.revisadaPorAnuncio) {
      conv.pausa.revisadaPorAnuncio = true;
      if (await esClienteReal(phone)) conv.pausa.motivo = 'Es cliente (cotización aceptada o pagada): lo atiende una persona';
      else {
        conv.pausa = null;
        conv.vuelveDeAnuncio = Date.now();
        await importarHistorial(conv).catch(() => 0);
        log('vendedor', `${conv.title} ya nos había escrito antes pero volvió por un anuncio: el vendedor lo atiende como lead`, 'info');
      }
    }
    if (!conv.anuncio && conv.msgs.filter((x) => x.role === 'cliente').length < 2) { const a = anuncioPorTexto(text); if (a) conv.anuncio = { titulo: a.anuncio, texto: '', id: a.id || null, url: null, via: 'texto', en: Date.now() }; }
    if (!conv.anuncio && !conv.ctxVisto && conv.msgs.filter((x) => x.role === 'cliente').length < 3) { const k = ctxKeys(m); if (k) conv.ctxVisto = k; }
    if (conv.iniciadaPorEquipo && !conv.pausa && !conv.msgs.some((x) => x.role === 'cliente') && Date.now() - conv.iniciadaPorEquipo > 60e3) {
      pause(conv, 'La conversación la empezó una persona del equipo');
    }
    // Si a nuestro recontacto le contesta el bot de un negocio, no es una respuesta: se guarda, pero ni se cuenta ni se contesta.
    // También cuando contesta al instante, sin que el cliente haya escrito nada todavía después de nuestro mensaje.
    const ultimo = conv.msgs.filter((x) => !x.previo).at(-1);
    const alInstante = ultimo?.role === 'bot' && Date.now() - ultimo.ts < 90e3;
    if (AUTO_REPLY.test(text) && ((conv.recontacto && !conv.recontacto.respondio) || alInstante)) {
      conv.msgs.push({ role: 'cliente', text, ts: Date.now(), auto: true });
      if (conv.recontacto) conv.recontacto.auto = Date.now();
      log('vendedor', `Respuesta automática de ${conv.contacto?.empresa || conv.title}: se ignora`, 'info');
      touchConv(conv);
      continue;
    }
    const esImagen = Boolean(m.message?.imageMessage || m.message?.documentMessage?.mimetype?.startsWith('image/'));
    let imgArchivo = null;
    if (esImagen) {
      try {
        const g = await guardarImagen(conv, m);
        imgArchivo = conv.imagenes?.at(-1)?.archivo || null;
        // Ahorro: de una tanda de fotos solo se leen con IA las primeras 5 (ahí suele venir el logo; el resto son
        // productos). Las demás se guardan igual y pasan a su demo. Después de mandarle la cuenta se lee todo (comprobantes).
        const seguidas = (conv.imagenes || []).filter((i) => Date.now() - i.ts < TANDA_IMG_MS).length;
        const leer = seguidas <= MAX_IMG_LEIDAS || conv.estado?.cierre?.enviada;
        if (!leer) {
          const cap = m.message?.imageMessage?.caption;
          text = `[El cliente envió otra imagen${cap ? ` con el texto "${cap}"` : ''}. No se analizó: ya mandó ${seguidas} seguidas, probablemente más fotos de sus productos. Quedó guardada para su demo]`;
          if (seguidas === MAX_IMG_LEIDAS + 1) log('vendedor', `${conv.contacto?.empresa || conv.title} mandó más de ${MAX_IMG_LEIDAS} imágenes seguidas: las demás se guardan sin leerlas con IA`, 'info');
        }
        const { leerImagen } = await import('./imagen.mjs');
        const lectura = leer ? await leerImagen(g.base64, g.mime) : null;
        if (lectura) {
          const cap = m.message?.imageMessage?.caption;
          text = `[El cliente envió una imagen${cap ? ` con el texto "${cap}"` : ''}. Lo que se ve: ${lectura}]`;
          const ult = conv.imagenes?.at(-1);
          if (ult) ult.lectura = lectura;
          revisarComprobante(conv, { lectura, caption: cap || '', archivo: ult?.archivo || null });
        }
      } catch (e) { log('vendedor', `No se pudo guardar o leer una imagen de ${conv.title}: ${e.message}`, 'warn'); }
    }
    const docPdf = m.message?.documentMessage && !String(m.message.documentMessage.mimetype || '').startsWith('image/') ? `${m.message.documentMessage.fileName || ''} ${m.message.documentMessage.caption || ''}` : '';
    if (docPdf && conv.estado?.cierre?.enviada) revisarComprobante(conv, { documento: `Documento: ${docPdf.trim()}. Comprobante de pago en PDF`, caption: m.message.documentMessage.caption || '' });
    conv.msgs.push({ role: 'cliente', text, ts: Date.now(), ...(imgArchivo ? { img: imgArchivo } : {}) });
    if (conv.estado?.demoEnviada && !conv.estado.respondioDemo) { conv.estado.respondioDemo = Date.now(); registrarEvento(conv.id, 'respondio_demo', String(text).slice(0, 140)); }
    if (conv.estado?.demoEnviada) respuestaDemo(conv, text);
    import('./compromisos.mjs').then((k) => k.programar(conv)).catch(() => {}); // ¿dijo que iba a hacer algo? (Fase 1, solo anota)
    if (conv.recontacto && !conv.recontacto.respondio) {
      conv.recontacto.respondio = Date.now();
      import('./recontacto.mjs').then((rc) => rc.marcarRespondio(keyOf(conv.phone))).catch(() => {});
      avisarDiego(`💬 *${conv.contacto?.empresa || conv.title}* respondió al recontacto: "${String(text).slice(0, 160)}". El vendedor ya está atendiendo; está en Ventas si querés tomar el chat.`).catch(() => {});
    }
    // Pide que no lo contactemos: queda marcado, se cancelan todos los mensajes automáticos y se avisa.
    if (OPT_OUT.test(text) && !conv.optOut) {
      conv.optOut = Date.now();
      conv.estado.noCalificado ||= 'Pidió que no lo contactemos';
      conv.followups = { ...(conv.followups || {}), next: null };
      if (conv.postDemo) conv.postDemo = { ...conv.postDemo, next: null };
      import('./recontacto.mjs').then((rc) => { const r = rc.optOut(keyOf(conv.phone), text); if (r.pausadoAuto) avisarDiego('🛑 *Recontacto pausado automáticamente*: dos personas pidieron que no las contactemos en el mismo día. Revisá el tono de los mensajes y decime si seguimos.').catch(() => {}); }).catch(() => {});
      avisarDiego(`🛑 *${conv.contacto?.empresa || conv.title}* pidió que no lo contactemos: "${String(text).slice(0, 120)}". Ya no se le escribe más.`).catch(() => {});
    }
    if (conv.prospecto) import('../prospeccion/index.mjs').then((pr) => pr.respondio(conv, text)).catch((e) => log('gerente_ventas', `Prospección: no se pudo marcar la respuesta: ${e.message}`, 'warn'));
    // Fotos o logo que manda el cliente: se guardan para su demo (y si la demo ya existe, se le pasan).
    if (conv.msgs.length > 300) conv.msgs.splice(0, conv.msgs.length - 300);
    // El cliente escribió: se cancelan los seguimientos pendientes (y si fue tras un seguimiento, cuenta como respondido).
    const ult = conv.followups?.ultimo;
    if (ult && !ult.respondido && Date.now() - ult.ts < 14 * 86400e3) {
      ult.respondido = true;
      (SG.stats[ult.step] ||= { enviados: 0, respondidos: 0 }).respondidos += 1;
    }
    conv.followups = { ...(conv.followups || {}), step: conv.followups?.step || 0, next: null };
    if (conv.postDemo?.next) conv.postDemo = { ...conv.postDemo, next: null, respondio: Date.now() };
    touchConv(conv);
    if (!L.enabled || conv.pausa) continue;
    schedule(conv);
  }
}

// Los mensajes que el bot tenía agendados para este cliente no quedan vivos: si el chat se reactivaba, salían igual.
function cancelarAgenda(conv, motivo) {
  let n = 0;
  for (const a of conv.agenda || []) if (!a.hecho) { a.hecho = Date.now(); a.resultado = `cancelado: ${motivo}`; n++; }
  if (n) log('vendedor', `${conv.title}: ${n} mensaje(s) agendado(s) cancelado(s) (${motivo})`, 'info');
  return n;
}
// Pausa total (botón): nada automático le escribe a este cliente (ni seguimientos, ni acuse, ni retomar a las 4 h) hasta
// que Diego lo reactive. Si después Diego escribe desde el teléfono, sigue siendo total.
function pause(conv, motivo, { total = false } = {}) {
  const esTotal = total || Boolean(conv.pausa?.total);
  conv.pausa = { motivo: conv.pausa?.total ? conv.pausa.motivo : motivo, ts: Date.now(), ...(esTotal ? { total: true } : {}) };
  conv.followups = { ...(conv.followups || {}), next: null };
  cancelarAgenda(conv, 'chat en pausa');
  if (esTotal) {
    if (conv.postDemo) conv.postDemo.next = null;
    for (const p of state.proyectos || []) if (p.origen?.conv === conv.id && p.envioProgramado) import('../desarrollo/proyectos.mjs').then((d) => d.cancelarEnvio(p.id)).catch(() => {});
  }
  const t = timers.get(conv.id);
  if (t) { clearTimeout(t.timer); timers.delete(conv.id); }
  log('vendedor', `Pausado en ${conv.title}: ${motivo}`, 'warn');
}
export function resume(convId) {
  const conv = V.convs[convId];
  if (!conv) throw new Error('Conversación no encontrada.');
  const eraExistente = Boolean(conv.pausa?.existente);
  conv.pausa = null;
  conv.handoffPending = false;
  log('vendedor', `Reactivado en ${conv.title}`, 'ok');
  touchConv(conv);
  // Si el cliente quedó esperando respuesta, se le contesta (antes reactivar no contestaba hasta que volviera a escribir).
  const ultimo = conv.msgs.filter((m) => !m.previo && m.role !== 'sistema').at(-1);
  if (conv.kind === 'whatsapp' && ultimo?.role === 'cliente' && !ultimo.auto) {
    (eraExistente ? importarHistorial(conv).catch(() => 0) : Promise.resolve()).then(() => schedule(conv));
  }
}
// Diego le escribe al cliente desde la oficina: sale por WhatsApp y el bot se pausa en ese chat.
export async function sendAsTeam(convId, text) {
  const conv = V.convs[convId];
  if (!conv || conv.kind !== 'whatsapp') throw new Error('Conversación de WhatsApp no encontrada.');
  text = String(text || '').trim().slice(0, 3000);
  if (!text) throw new Error('Mensaje vacío.');
  if (YC.activo() && !conv.inst && !YC.ventanaAbierta(conv)) throw new Error('Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo deja mandar plantillas. Usá "Mandar plantilla" o llamalo.');
  pause(conv, 'Diego tomó la conversación');
  const { inst } = env(conv);
  const number = destino(conv);
  const mm = { role: 'equipo', text, ts: Date.now(), desdeOficina: true };
  conv.msgs.push(mm);
  manualComoSeguimiento(conv, text);
  const r = await evo(`/message/sendText/${inst}`, { number, text });
  if (r?.key?.id) { remember(L.sentIds, r.key.id); mm.wid = r.key.id; }
  touchConv(conv);
}

// Diego (4 nov 2026): si una persona del equipo le escribe al cliente, eso cuenta como seguimiento hecho y la
// secuencia de la demo se reprograma desde ahí, en vez de apagarse. Si el mensaje trae el enlace de la demo,
// cuenta como el envío de la demo (pasó con la Academia de fútbol: Diego la mandó a mano y no hubo más seguimientos).
const DEMO_RE = /https?:\/\/demo\.preview\.cresova\.com\/[\w-]+\/?/i;
function manualComoSeguimiento(conv, text) {
  if (conv.optOut || conv.estado?.resultado) return;
  const url = String(text || '').match(DEMO_RE)?.[0];
  if (url) {
    conv.estado.demoEnviada ||= Date.now();
    conv.estado.demoUrl ||= url;
    conv.postDemo = { step: 0, next: enVentana(Date.now() + h1(POST_DEMO[0].horas) * 3600e3), manual: Date.now() };
    registrarEvento(conv.id, 'demo_enviada', `${url} (la mandó una persona)`);
    log('vendedor', `${conv.title}: la demo la mandó una persona; los seguimientos arrancan desde ahora`, 'info');
    return;
  }
  const pd = conv.postDemo;
  if (!pd?.next) return; // la secuencia ya terminó o el cliente respondió
  const step = pd.step || 0;
  conv.postDemo = step + 1 < POST_DEMO.length
    ? { step: step + 1, next: enVentana(Date.now() + (POST_DEMO[step + 1].horas - POST_DEMO[step].horas) * 3600e3), manual: Date.now() }
    : { ...pd, next: null, manual: Date.now() };
  log('vendedor', `${conv.title}: el mensaje de una persona cuenta como seguimiento ${step + 1} de la demo`, 'info');
}
// Un chat que tomó una persona solo para escribir algo (no porque el cliente esté conversando) puede seguir con los
// seguimientos de la demo: si el último en escribir no fue el cliente y la persona no escribió en las últimas 20 h.
function seguimientoDemoPermitido(c, en = Date.now()) {
  if (!c.pausa) return true;
  if (c.pausa.total || c.pausa.existente || c.estado?.humano || c.optOut) return false;
  if (!/persona escribi|Diego tom|empez[oó] una persona/i.test(c.pausa.motivo || '')) return false;
  const reales = c.msgs.filter((m) => !m.previo && m.role !== 'sistema');
  if (reales.at(-1)?.role === 'cliente') return false;
  const ultEquipo = reales.filter((m) => m.role === 'equipo').at(-1);
  return !ultEquipo || en - ultEquipo.ts > 20 * 3600e3;
}

export function pauseManual(convId) {
  const conv = V.convs[convId];
  if (!conv) throw new Error('Conversación no encontrada.');
  pause(conv, 'Pausado por Diego: no escribirle hasta reactivar', { total: true });
  touchConv(conv);
}

// Buffer: cada mensaje nuevo reinicia la espera, con un tope desde el primero.
function schedule(conv) {
  const prev = timers.get(conv.id);
  const first = prev?.first || Date.now();
  if (prev) clearTimeout(prev.timer);
  const wait = Math.max(1000, Math.min(BUFFER_S * 1000, first + BUFFER_MAX_S * 1000 - Date.now()));
  timers.set(conv.id, { first, timer: setTimeout(() => respond(conv.id), wait) });
}

async function respond(convId) {
  timers.delete(convId);
  const conv = V.convs[convId];
  if (!conv || !L.enabled || conv.pausa || conv.busy) return;
  const count = conv.msgs.length;
  conv.busy = true;
  touchConv(conv);
  let reply;
  try {
    reply = await sellerTurn(conv);
  } catch (e) {
    // Sin respuesta de la IA no se manda nada genérico: se avisa a Diego.
    log('vendedor', `No pudo responder a ${conv.title}: ${e.message}`, 'error');
    conv.msgs.push({ role: 'sistema', text: `No pudo responder: ${e.message}`, ts: Date.now() });
    conv.busy = false;
    touchConv(conv);
    return;
  }
  conv.busy = false;
  // Si mientras pensaba llegó otro mensaje del cliente o escribió una persona, no se envía: se vuelve a pensar con todo.
  if (conv.msgs.length !== count) { touchConv(conv); if (!conv.pausa) schedule(conv); return; }
  if (!L.enabled || conv.pausa) { touchConv(conv); return; }
  // "Ok, gracias", "👍", "Bien": una persona no contesta eso con otra despedida. El vendedor decide no responder.
  if (/^\s*SIN_RESPUESTA\b/.test(reply.text)) { log('vendedor', `${conv.title}: no hacía falta responder`, 'info'); touchConv(conv); return; }
  await deliver(conv, reply.text, reply.meta);
  if (conv.handoffPending) { conv.handoffPending = false; pause(conv, 'Pasó a una persona'); }
  if (puedeSeguir({ ...conv, busy: false })) {
    const step = conv.followups?.step || 0;
    const ps = pasos();
    if (step < ps.length) conv.followups = { ...(conv.followups || {}), step, next: enVentana(Date.now() + h1(ps[step].horas) * 3600e3) };
  }
  touchConv(conv);
}

// Una persona en el teléfono manda párrafos cortos: un texto de más de ~280 caracteres sale en 2 mensajes
// (3 si es muy largo), cortando entre párrafos o, si no hay, entre oraciones. El primer mensaje del chat no se divide.
function splitNatural(text, first) {
  if (first || text.length <= 280) return [text];
  const max = text.length > 700 ? 3 : 2;
  let paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length < 2) paras = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((p) => p.trim()).filter(Boolean) || [text];
  const target = text.length / max;
  const parts = [];
  for (const p of paras) {
    const last = parts.at(-1);
    if (last && (last.length < target * 0.8 || parts.length >= max)) parts[parts.length - 1] = `${last}${/\n/.test(text) ? '\n\n' : ' '}${p}`;
    else parts.push(p);
  }
  return parts.length ? parts : [text];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const clienteN = (conv) => conv.msgs.filter((m) => m.role === 'cliente').length;

// Tiempos de una persona: antes contestaba siempre a los ~20 s con un párrafo de 400 caracteres, y se notaba.
// Ahora: un rato "leyendo" y luego "escribiendo…" según el largo (unos 9-11 caracteres por segundo, de 3 a 22 s).
// Los envíos forzados (la demo que aprobó Diego, un aviso) salen con pausas cortas.
async function deliver(conv, text, meta, { force = false, aunPausado = false } = {}) {
  if (!text?.trim()) return false;
  // Pausa total: ningún envío automático sale, aunque venga forzado. Solo la demo que Diego manda con su botón.
  if (conv.pausa?.total && !meta?.demo) { log('vendedor', `${conv.title}: en pausa total, no se envió el mensaje automático`, 'info'); return false; }
  // Nunca el mismo texto dos veces en el mismo día (pasó tras reinicios y con mensajes seguidos del cliente).
  const repetido = conv.msgs.some((m) => m.role === 'bot' && Date.now() - m.ts < 20 * 3600e3 && norm(m.text) === norm(text));
  if (repetido && !force) { log('vendedor', `No se reenvió un mensaje repetido a ${conv.title}`, 'info'); return false; }
  if (YC.activo() && !conv.inst && !YC.ventanaAbierta(conv)) return fueraDeVentana(conv, text, meta);
  const { inst } = env(conv);
  const number = destino(conv);
  const first = !conv.msgs.some((m) => m.role === 'bot');
  const parts = splitNatural(text, first);
  const n0 = clienteN(conv);
  if (!force) await sleep(first ? rnd(2000, 6000) : rnd(4000, 14000)); // "leyendo"
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const typing = force ? Math.max(1500, Math.min(5000, part.length * 18)) : Math.max(3000, Math.min(22000, part.length * rnd(90, 110)));
    if (i > 0) await sleep(force ? rnd(700, 1500) : rnd(1500, 4000));
    await evo(`/chat/sendPresence/${inst}`, { number, presence: 'composing', delay: typing }).catch(() => {});
    await sleep(typing);
    // Si una persona tomó el chat (o se apagó el vendedor) mientras tanto, no se manda lo que falta.
    if (!force && ((conv.pausa && !conv.handoffPending && !aunPausado) || !L.enabled)) return false;
    // Si el cliente escribió otra cosa mientras "escribía", no se manda: se vuelve a pensar con todo (ya quedó agendado).
    if (!force && clienteN(conv) !== n0) { log('vendedor', `${conv.title} escribió de nuevo: se rehace la respuesta`, 'info'); return false; }
    const mm = { role: 'bot', text: part, ts: Date.now(), ...(i === 0 ? { meta } : {}) };
    conv.msgs.push(mm);
    try {
      const r = await evo(`/message/sendText/${inst}`, { number, text: part });
      if (r?.key?.id) { remember(L.sentIds, r.key.id); mm.wid = r.key.id; }
    } catch (e) {
      conv.msgs.push({ role: 'sistema', text: `No se pudo enviar: ${e.message}`, ts: Date.now() });
      log('vendedor', `Error al enviar a ${conv.title}: ${e.message}`, 'error');
      return false;
    }
  }
  return true;
}

// Primer mensaje de prospección (lo aprobó Diego): sale por el número de prospección y deja la conversación armada,
// con lo que se investigó del negocio, para que el vendedor atienda si responde.
export async function enviarProspecto({ inst, telefono, texto, prospecto }) {
  const phone = String(telefono).replace(/\D/g, '');
  if (!inst) throw new Error('Falta conectar el número de prospección.');
  if (!/^\d{11,15}$/.test(phone)) throw new Error(`Teléfono inválido: ${telefono}`);
  const conv = convFor(phone, null, inst);
  if (conv.msgs.some((m) => m.role === 'bot' || m.role === 'equipo')) throw new Error('A ese número ya se le escribió desde este WhatsApp.');
  conv.title = `${prospecto.empresa} · +${phone}`;
  conv.prospecto = prospecto;
  conv.contacto = { ...(conv.contacto || {}), empresa: prospecto.empresa, rubro: prospecto.rubro || '' };
  conv.iniciadaPorEquipo = Date.now();
  conv.pausa = null;
  const ok = await deliver(conv, texto, { prospeccion: true, fijo: true }, { force: true });
  touchConv(conv);
  if (!ok) throw new Error(conv.msgs.filter((m) => m.role === 'sistema').at(-1)?.text || 'No se pudo enviar');
  return conv.id;
}

// API oficial: pasadas 24 h desde el último mensaje del cliente solo salen plantillas aprobadas. Si hay una para este
// tipo de envío, sale esa (con su nombre y el enlace); si no, no se manda y se le avisa a Diego para que lo llame.
const paraLlamar = [];
let tLlamar = null;
async function fueraDeVentana(conv, text, meta = {}) {
  const p = plantillaPara(conv, meta || {});
  // Si la plantilla preferida todavía no está aprobada, sale la de respaldo (compromisos).
  if (p?.respaldo && !YC.aprobada(p.name)) { const r = p.respaldo; delete p.respaldo; Object.assign(p, r); }
  // Leads fríos: la versión nueva cuando Meta ya la aprobó.
  const leadNueva = { 1: 'cresova_lead_retomar', 4: 'cresova_lead_cierre' }[meta?.seguimiento];
  if (p && leadNueva && YC.aprobada(leadNueva)) p.name = leadNueva;
  if (p && YC.aprobada(p.name)) {
    try {
      const r = await YC.enviarPlantilla(destino(conv), p.name, p.params);
      const mm = { role: 'bot', text: textoDe(p.name, p.params), ts: Date.now(), meta: { ...(meta || {}), plantilla: p.name } };
      if (r?.key?.id) { remember(L.sentIds, r.key.id); mm.wid = r.key.id; }
      conv.msgs.push(mm);
      touchConv(conv);
      log('vendedor', `Ventana de 24 h cerrada con ${conv.title}: salió la plantilla ${p.name}`, 'info');
      return true;
    } catch (e) { log('vendedor', `No salió la plantilla ${p.name} a ${conv.title}: ${e.message}`, 'warn'); }
  }
  conv.msgs.push({ role: 'sistema', text: `Ventana de 24 h cerrada: WhatsApp no deja mandar mensajes libres a este cliente${p ? ` (la plantilla ${p.name} todavía no está aprobada)` : ''}. No se envió: «${String(text).slice(0, 160)}». Llamalo o mandale una plantilla desde Ventas.`, ts: Date.now() });
  touchConv(conv);
  paraLlamar.push({ cliente: conv.contacto?.empresa || conv.contacto?.nombre || conv.title, tel: String(conv.phone).replace(/^lid:/, ''), que: meta?.demo ? 'mandarle la demo' : meta?.seguimientoDemo ? 'seguimiento de la demo' : meta?.seguimiento ? 'seguimiento' : meta?.recontacto ? 'recontacto' : 'mensaje pendiente' });
  // Va a la sección Llamadas; ya no se manda un mensaje por cada una.
  const noSalio = paraLlamar.pop();
  import('./llamadas.mjs').then((l) => l.agregarLlamada(conv, `WhatsApp no dejó mandarle: ${noSalio?.que || 'un mensaje'} (más de 24 h sin escribir y la plantilla no salió).`, 'no_enviado')).catch(() => {});
  return false;
}

// Mensajes fijos que no escribe el modelo (cuenta del anticipo, bienvenida): salen aunque el chat esté tomado.
export async function enviarFijo(convId, texto, meta = {}) {
  const conv = V.convs[convId];
  if (!conv || conv.kind !== 'whatsapp') return false;
  const ok = await deliver(conv, texto, { fijo: true, ...meta }, { force: true });
  touchConv(conv);
  return ok;
}

// La imagen con las cuentas bancarias de Cresova (la sube Diego en Ventas → Playbook y reglas).
export const CUENTA_IMG = path.join(DATA_DIR, 'ventas-cuenta.jpg');
export async function enviarImagenCuenta(convId) {
  const conv = V.convs[convId];
  if (!conv || conv.kind !== 'whatsapp' || !fs.existsSync(CUENTA_IMG)) return false;
  if (YC.activo() && !conv.inst && !YC.ventanaAbierta(conv)) return false;
  const { inst } = env(conv);
  const number = destino(conv);
  const mm = { role: 'bot', text: '[Imagen: cuentas bancarias de Cresova]', ts: Date.now(), meta: { fijo: true, imagenCuenta: true } };
  conv.msgs.push(mm);
  try {
    const r = await evo(`/message/sendMedia/${inst}`, { number, mediatype: 'image', mimetype: 'image/jpeg', media: fs.readFileSync(CUENTA_IMG).toString('base64'), fileName: 'cuentas-cresova.jpg', caption: '' });
    if (r?.key?.id) { remember(L.sentIds, r.key.id); mm.wid = r.key.id; }
    touchConv(conv);
    return true;
  } catch (e) {
    conv.msgs.pop();
    log('vendedor', `No se pudo mandar la imagen de las cuentas a ${conv.title}: ${e.message}`, 'warn');
    return false;
  }
}

// Prueba para Diego: le llega a su propio WhatsApp exactamente lo que recibiría un cliente (imagen + mensaje del monto).
export async function pruebaCuenta({ monto = 4250, nombre = 'Juan' } = {}) {
  const { inst } = env();
  const cuenta = String(V.config.cuentaAnticipo || '').trim();
  if (!cuenta) throw new Error('Falta guardar la cuenta del anticipo.');
  if (fs.existsSync(CUENTA_IMG)) await evo(`/message/sendMedia/${inst}`, { number: OWNER, mediatype: 'image', mimetype: 'image/jpeg', media: fs.readFileSync(CUENTA_IMG).toString('base64'), fileName: 'cuentas-cresova.jpg', caption: '' });
  await sleep(1500);
  const texto = `¡Excelente ${nombre}! 🙌 Para arrancar es el 50 %: *L ${Number(monto).toLocaleString('en-US')}* (el otro 50 % al entregarte la página).

Podés depositar o transferir a:
${cuenta}

Cuando lo hagás, mandame la foto del comprobante por aquí y arrancamos.`;
  const r = await evo(`/message/sendText/${inst}`, { number: OWNER, text: texto });
  if (r?.key?.id) remember(L.sentIds, r.key.id);
  log('vendedor', 'Prueba del mensaje de la cuenta enviada a Diego', 'info');
  return { ok: true, imagen: fs.existsSync(CUENTA_IMG) };
}

// ---------- paso de cierre: comprobante del anticipo ----------
// Diego (4 nov 2026): el vendedor manda la cuenta solo; el comprobante lo valida Diego en la Bandeja. Al validarlo:
// se registra el pago, el proyecto pasa a "En progreso", el cliente recibe la bienvenida y el equipo se entera.
const COMPROBANTE = /comprobante|transferencia|transacci[oó]n|dep[oó]sito|referencia|n[uú]mero de (operaci[oó]n|autorizaci[oó]n)|banco|bac\b|atl[aá]ntida|ficohsa|banpa[ií]s|occidente|davivienda|lafise|tigo money|pago exitoso|enviado con [eé]xito/i;
function montoDe(t) {
  const m = String(t || '').match(/(?:L\.?|HNL|Lps?\.?)\s?(\d{1,3}(?:[,.]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/[,.](?=\d{3}\b)/g, '').replace(',', '.'));
  return n > 0 && n < 1e6 ? n : null;
}
function revisarComprobante(conv, { lectura = '', caption = '', archivo = null, documento = '' } = {}) {
  const cierre = conv.estado?.cierre;
  const pareceComprobante = COMPROBANTE.test(`${lectura} ${caption} ${documento}`);
  if (!pareceComprobante || (!cierre?.enviada && !/comprobante|transfer|dep[oó]sit|pago/i.test(`${caption} ${documento}`))) return;
  if (cierre?.comprobante && Date.now() - cierre.comprobante < 10 * 60e3) return; // dos fotos seguidas: una sola tarjeta
  const quien = conv.contacto?.empresa || conv.contacto?.nombre || conv.title;
  const monto = montoDe(lectura) || montoDe(caption);
  const esperado = cierre?.monto || null;
  conv.estado.cierre = { ...(cierre || {}), comprobante: Date.now(), montoLeido: monto };
  const img = archivo ? `/api/ventas/media/${conv.id}/${archivo}` : '';
  addDeliverable('vendedor', `💰 Comprobante de pago: ${quien}`, `**${quien}** mandó un comprobante de pago por WhatsApp.

- **Monto leído en el comprobante:** ${monto ? `L ${monto.toLocaleString('en-US')}` : 'no se pudo leer'}
- **Anticipo esperado:** ${esperado ? `L ${esperado.toLocaleString('en-US')}` : 'no se le había mandado la cuenta'}${cierre?.cotizacion ? ` (${cierre.cotizacion})` : ''}
- **Lo que se ve:** ${lectura || documento || 'sin lectura'}
${img ? `\n[Ver la imagen del comprobante](${img})\n` : ''}
Revisá tu banco antes de confirmar. Si entró: se registra el pago, el proyecto pasa a "En progreso", el cliente recibe la bienvenida y el equipo se entera.`,
    { kind: 'decision', summary: `${monto ? `L ${monto.toLocaleString('en-US')}` : 'Monto sin leer'}${esperado ? ` · esperado L ${esperado.toLocaleString('en-US')}` : ''}${cierre?.cotizacion ? ` · ${cierre.cotizacion}` : ''}`, question: '¿Entró el pago?', options: ['Sí, entró el pago', 'No ha entrado'], ventasConv: conv.id, pagoAnticipo: { conv: conv.id, monto: monto || esperado || null, cotizacion: cierre?.cotizacion || null, quoteId: cierre?.quoteId || null } });
  registrarEvento(conv.id, 'comprobante', monto ? `L ${monto}` : 'comprobante recibido');
  avisarDiego(`💰 *${quien}* mandó un comprobante de pago${monto ? ` por L ${monto.toLocaleString('en-US')}` : ''}. Revisá tu banco y confirmalo en la Bandeja.`).catch(() => {});
  log('vendedor', `Comprobante de pago de ${quien}${monto ? ` (L ${monto})` : ''}: espera que Diego lo valide`, 'approval');
}
export async function confirmarAnticipo({ conv: convId, monto, cotizacion, quoteId }, entro) {
  const conv = V.convs[convId];
  if (!conv) throw new Error('Conversación no encontrada.');
  const quien = conv.contacto?.empresa || conv.contacto?.nombre || conv.title;
  if (!entro) {
    conv.estado.cierre = { ...(conv.estado.cierre || {}), comprobante: null, rechazado: Date.now() };
    pause(conv, 'El comprobante no se confirmó: lo ve Diego');
    touchConv(conv);
    log('vendedor', `Comprobante de ${quien} sin confirmar: el chat queda con Diego`, 'warn');
    return { ok: true };
  }
  const db = await import('../cresova/db.mjs');
  const vend = await import('./vendedor.mjs');
  let p = quoteId ? null : null;
  if (db.enUso()) {
    let id = quoteId;
    if (!id && cotizacion) id = (await db.porNumero(cotizacion))?.id;
    if (!id) { const c0 = (await vend.fichaCliente(conv).catch(() => null))?.[0]; id = c0?.id; }
    if (!id) throw new Error('No encontré la cotización de este cliente para registrar el pago.');
    p = await db.pago(id, { monto: monto || conv.estado.cierre?.monto, nota: 'Anticipo validado por Diego (comprobante por WhatsApp)' });
    p = await db.mover(id, 'in_progress');
    vend.olvidarFicha(conv.id);
  }
  conv.estado.cierre = { ...(conv.estado.cierre || {}), validado: Date.now() };
  try { vend.marcarResultado(conv.id, 'ganado', `Anticipo pagado${monto ? ` (L ${monto})` : ''}`); } catch {}
  const nombre = conv.contacto?.nombre ? ` ${String(conv.contacto.nombre).split(' ')[0]}` : '';
  await enviarFijo(conv.id, `¡Listo${nombre}! ✅ Ya nos entró tu anticipo. Bienvenido a Cresova 🙌

Arrancamos con tu página. En estos días te escribo por aquí para pedirte lo que falte (logo en buena calidad, fotos de tu negocio y tus datos de contacto) y te voy mostrando los avances. Cualquier duda, escribime por aquí.`, { bienvenida: true });
  const resumen = `${quien} pagó el anticipo${monto ? ` de L ${Number(monto).toLocaleString('en-US')}` : ''}${p?.numero ? ` (${p.numero})` : ''}. El proyecto pasó a "En progreso" y el cliente recibió la bienvenida.`;
  addDeliverable('vendedor', `🎉 Venta cerrada: ${quien}`, `${resumen}\n\n${conv.anuncio?.titulo || conv.anuncio?.id ? `Vino del anuncio «${conv.anuncio.titulo || conv.anuncio.id}».` : 'No tiene anuncio registrado.'}`, { kind: 'informe' });
  log('vendedor', `🎉 Venta cerrada: ${resumen}`, 'ok');
  touchConv(conv);
  return { ok: true, proyecto: p?.numero || null };
}

// ---------- entrega: ¿le llegó al cliente? ----------
// Cada mensaje que sale guarda su id de WhatsApp. A los 10 minutos se pregunta a Evolution si llegó (dos palomitas) o
// si se leyó. Si sigue con una sola palomita, se le avisa a Diego (pasó con la demo de la Academia de fútbol).
async function revisarEntregas() {
  const { inst } = env();
  if (!inst) return;
  const ahora = Date.now();
  const nuevos = [];
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp') continue;
    let cambio = false;
    for (const m of c.msgs.slice(-25)) {
      if (!m.wid || m.entrega === 'leido' || (m.entrega === 'entregado' && ahora - m.ts > 3600e3)) continue;
      const edad = ahora - m.ts;
      if (edad < 10 * 60e3 || edad > 8 * 3600e3) continue;
      const r = await evo(`/chat/findMessages/${env(c).inst}`, { where: { key: { id: m.wid } }, page: 1, offset: 1 }).catch(() => null);
      const x = r?.messages?.records?.find((y) => y.key?.id === m.wid);
      if (!x) continue;
      const st = [x.status, ...(x.MessageUpdate || x.messageUpdate || []).map((u) => u.status)].filter(Boolean);
      const antes = m.entrega;
      m.entrega = st.some((v) => v === 'READ' || v === 'PLAYED') ? 'leido' : st.includes('DELIVERY_ACK') ? 'entregado' : 'pendiente';
      if (m.entrega !== antes) cambio = true;
      if (m.entrega === 'pendiente' && !m.avisoEntrega) nuevos.push({ c, m, edad });
    }
    if (cambio) touchConv(c);
  }
  const h = new Date(ahora - 6 * 3600e3).getUTCHours();
  if (!nuevos.length || h < 7 || h >= 21) return;
  for (const n of nuevos) n.m.avisoEntrega = ahora;
  avisarDiego(`⚠️ *Mensajes con una sola palomita* (más de 10 minutos sin llegarle al cliente):\n${nuevos.slice(0, 6).map((n) => `• ${n.c.contacto?.empresa || n.c.title}: "${String(n.m.text).slice(0, 70)}" (hace ${Math.round(n.edad / 60000)} min)`).join('\n')}\n\nPuede ser que el cliente no tenga señal o que el WhatsApp de Cresova esté desconectado. Revisalo en Ventas; si es importante, mandalo de nuevo.`).catch(() => {});
}
setInterval(() => revisarEntregas().catch((e) => log('vendedor', `Revisión de entregas: ${e.message}`, 'warn')), 4 * 60e3);

// ---------- chats tomados: lo que quedó sin contestar o prometido ----------
// Una vez por día (8:30, lunes a sábado) Diego recibe la lista de chats que quedaron colgando: chats que tomó una
// persona donde el cliente escribió algo (que no es solo "gracias") y nadie contestó en 12 h, o preguntas que el
// vendedor le hizo a Diego y siguen sin respuesta.
const GRACIAS = /^(?:[\s.,!¡?¿]*(?:ok(?:ey|i)?|okay|listo|bueno|va|vaya|dale|perfecto|excelente|gracias|muchas|mil|de acuerdo|entendido|sale|igualmente|saludos|bendiciones|diego|ingeniero|amigo|hermano|de antemano|a usted|a vos|a ti|👍|🙏|👌|😊|🙌|❤️|🤝)[\s.,!😊🙏👍👌🙌]*)+$/i;
// (Las promesas sin cumplir ya tienen su propio aviso: promesasPendientes, más abajo.)
export function chatsColgados() {
  const ahora = Date.now();
  const hace = (t) => { const hs = Math.round((ahora - t) / 3600e3); return hs < 48 ? `${hs} h` : `${Math.round(hs / 24)} días`; };
  const items = [];
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp' || c.optOut || c.estado?.resultado) continue;
    const nombre = c.contacto?.empresa || c.title;
    const con = c.estado?.consulta;
    if (con && !con.respondida && ahora - (con.ts || c.ts || ahora) > 2 * 3600e3) { items.push({ t: con.ts || 0, txt: `${nombre}: el vendedor te preguntó "${String(con.pregunta || '').slice(0, 90)}" (hace ${hace(con.ts || ahora)})` }); continue; }
    if (!c.pausa || c.pausa.existente) continue;
    const reales = c.msgs.filter((m) => !m.previo && m.role !== 'sistema');
    const ult = reales.at(-1);
    if (ult?.role === 'cliente' && !ult.auto && !GRACIAS.test(String(ult.text).trim()) && ahora - ult.ts > 12 * 3600e3 && ahora - ult.ts < 10 * 86400e3)
      items.push({ t: ult.ts, txt: `${nombre}: te escribió "${String(ult.text).slice(0, 80)}" hace ${hace(ult.ts)} y nadie contestó` });
  }
  return items.sort((a, b) => a.t - b.t).map((x) => x.txt);
}
setInterval(() => {
  const d = new Date(Date.now() - 6 * 3600e3);
  const dia = d.toISOString().slice(0, 10);
  if (d.getUTCDay() === 0 || d.getUTCHours() * 60 + d.getUTCMinutes() < 8 * 60 + 30 || d.getUTCHours() >= 12 || L.colgadosDia === dia) return;
  L.colgadosDia = dia;
  const items = chatsColgados();
  if (items.length) avisarDiego(`📌 *Chats que quedaron colgando* (${items.length}):\n${items.slice(0, 10).map((x) => `• ${x}`).join('\n')}${items.length > 10 ? `\n…y ${items.length - 10} más en Ventas.` : ''}\n\nSi ya lo resolviste por otro lado, ignoralo.`).catch(() => {});
}, 5 * 60e3);

// ---------- Diego ↔ Jarvis por WhatsApp ----------
let ownerBuf = { texts: [], timer: null };
function ownerSays(text) {
  ownerBuf.texts.push(text);
  clearTimeout(ownerBuf.timer);
  ownerBuf.timer = setTimeout(() => flushOwner(), 6000); // junta los mensajes seguidos
}
async function flushOwner(tries = 0) {
  const text = ownerBuf.texts.join('\n');
  if (!text) return;
  const { chatAgent, isRunning } = await import('../runner.mjs');
  if (isRunning('coordinador') && tries < 45) {
    // Jarvis está terminando otra cosa: lo intenta de nuevo en un rato (máximo ~15 min).
    if (tries === 0) sendOwner('Recibido, Diego. Estoy terminando otra cosa y sigo con lo tuyo enseguida.').catch(() => {});
    ownerBuf.timer = setTimeout(() => flushOwner(tries + 1), 20_000);
    return;
  }
  ownerBuf = { texts: [], timer: null };
  // Si la respuesta tarda, Diego se entera de que Jarvis está en eso (no hace falta para lo rápido).
  const ack = tries === 0 ? setTimeout(() => ackOwner(text).catch(() => {}), 25_000) : null;
  const reply = await chatAgent('coordinador', text, { canal: 'whatsapp' }).catch((e) => `Tuve un error: ${e.message}`);
  clearTimeout(ack);
  if (typeof reply === 'string' && reply.trim()) await sendOwner(reply).catch((e) => log('coordinador', `No pude responderle a Diego por WhatsApp: ${e.message}`, 'error'));
}
// "En eso estoy": una línea que dice qué va a hacer, escrita por un modelo rápido y barato (no gasta Claude).
async function ackOwner(pedido) {
  let line = 'Recibido, Diego. Estoy trabajando en eso; te escribo apenas lo tenga.';
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (key) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://cresova.com', 'X-Title': 'Oficina Cresova - Jarvis' },
        body: JSON.stringify({ model: TRANSCRIBE_MODEL, temperature: 0.4, max_tokens: 80, messages: [
          { role: 'system', content: 'Sos Jarvis, el asistente de Diego (dueño de Cresova). Escribí UNA sola frase corta en español (máximo 22 palabras, voseo) avisando que recibiste su pedido y que ya estás trabajando en eso, diciendo en concreto qué vas a hacer. Sin prometer plazos ni resultados, sin saludos largos, sin emojis.' },
          { role: 'user', content: String(pedido).slice(0, 2000) },
        ] }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = await res.json().catch(() => ({}));
      const t = String(j.choices?.[0]?.message?.content || '').trim().replace(/^["“]|["”]$/g, '');
      if (res.ok && t && t.length < 220) line = t;
    } catch {}
  }
  await sendOwner(line);
}
async function sendOwner(text) {
  const { inst } = env();
  // API oficial: si Diego no le escribió al número de ventas en las últimas 24 h, el aviso va por Discord.
  if (YC.activo() && !(L.ownerUltimo && Date.now() - L.ownerUltimo < 23.5 * 3600e3)) {
    const { mensajeDiscord } = await import('../voz.mjs');
    return mensajeDiscord(String(text));
  }
  const clean = String(text).replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/^#+\s*/gm, '').trim();
  await evo(`/chat/sendPresence/${inst}`, { number: OWNER, presence: 'composing', delay: 1500 }).catch(() => {});
  const r = await evo(`/message/sendText/${inst}`, { number: OWNER, text: clean });
  if (r?.key?.id) remember(L.sentIds, r.key.id);
}
// Avisos que Jarvis decide mandar: tope de 3 por día y nunca de noche (hora de Honduras).
L.ownerPings ||= [];
export async function messageOwner(text, { recordatorio = false, pdf = null } = {}) {
  const h = new Date(Date.now() - 6 * 3600e3).getUTCHours();
  L.ownerPings = (L.ownerPings || []).filter((t) => Date.now() - t < 24 * 3600e3);
  // Lo que Diego mismo agendó sale a la hora que eligió; los avisos por cuenta de Jarvis tienen tope y horario.
  if (!recordatorio) {
    if (h < 7 || h >= 21) return { ok: false, error: 'Es de noche en Honduras: dejalo para mañana.' };
    if (L.ownerPings.length >= 3) return { ok: false, error: 'Ya van 3 avisos hoy.' };
  }
  await sendOwner(text);
  if (pdf) {
    const { inst } = env();
    await evo(`/message/sendMedia/${inst}`, { number: OWNER, mediatype: 'document', mimetype: 'application/pdf', media: pdf.base64, fileName: pdf.fileName, caption: '' }).catch((e) => log('coordinador', `No pude adjuntar el PDF: ${e.message}`, 'warn'));
  }
  L.ownerPings.push(Date.now());
  saveNow();
  log('coordinador', 'Le escribió a Diego por WhatsApp', 'info');
  return { ok: true };
}

// ---------- seguimientos ----------
const hnNow = () => { const d = new Date(Date.now() - 6 * 3600e3); return { h: d.getUTCHours(), day: d.getUTCDay() }; };
// Los clientes escriben sobre todo de 11 a 16 h. Un seguimiento que vence de noche o de madrugada no sale a las 8:00
// en ráfaga con los demás: se mueve a la mañana siguiente entre 10:00 y 12:30, a una hora distinta para cada uno.
const VENTANA = { desde: 10, hasta: 16.5 };
function enVentana(ts) {
  const d = new Date(ts - 6 * 3600e3);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (FU_HOURS.days.includes(d.getUTCDay()) && h >= VENTANA.desde && h < VENTANA.hasta) return ts;
  const dia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (h >= VENTANA.hasta) dia.setUTCDate(dia.getUTCDate() + 1);
  while (!FU_HOURS.days.includes(dia.getUTCDay())) dia.setUTCDate(dia.getUTCDate() + 1);
  return dia.getTime() + 6 * 3600e3 + VENTANA.desde * 3600e3 + Math.round(rnd(0, 150)) * 60e3;
}
if (!V.migManual20261104) {
  V.migManual20261104 = Date.now();
  setTimeout(() => {
    for (const c of Object.values(V.convs)) {
      if (c.kind !== 'whatsapp' || !c.pausa || c.pausa.existente) continue;
      const reales = c.msgs.filter((m) => !m.previo && m.role !== 'sistema');
      const ult = reales.at(-1);
      if (ult?.role !== 'equipo' || Date.now() - ult.ts > 10 * 86400e3) continue;
      if (DEMO_RE.test(ult.text) || c.postDemo?.next) manualComoSeguimiento(c, ult.text);
    }
  }, 5000);
}
for (const c of Object.values(V.convs)) { // lo que ya estaba agendado también se acomoda
  if (c.followups?.next) c.followups.next = enVentana(c.followups.next);
  if (c.postDemo?.next) c.postDemo.next = enVentana(c.postDemo.next);
}
// Los seguimientos genéricos son para leads nuevos que no contestaron. Un recontacto, alguien que ya recibió su demo,
// alguien a quien el vendedor le prometió escribir en una fecha o un cliente ya cerrado tienen su propio flujo.
const puedeSeguir = (c) => c.kind === 'whatsapp' && !c.pausa && !c.busy && !c.estado.noCalificado && !c.estado.demo && !c.estado.humano
  && !c.recontacto && !c.estado.demoEnviada && !c.estado.demoCreadaTs && !c.estado.resultado && !c.optOut && !(c.agenda || []).some((a) => !a.hecho);

async function followupTick() {
  if (!L.enabled) return;
  const { h, day } = hnNow();
  if (!FU_HOURS.days.includes(day) || h < FU_HOURS.start || h >= FU_HOURS.end) return;
  L.lastFollowups = L.lastFollowups.filter((t) => Date.now() - t < 3600e3);
  if (L.lastFollowups.length >= FU_HOURLY_CAP) return;
  if (L.lastFollowups.length && Date.now() - Math.max(...L.lastFollowups) < (L.gapSeguimiento || FU_MIN_GAP_MS)) return;
  const due = Object.values(V.convs).filter((c) => c.followups?.next && c.followups.next <= Date.now() && puedeSeguir(c))
    .sort((a, b) => a.followups.next - b.followups.next)[0];
  if (due) await sendFollowup(due);
}

// El seguimiento le llega al cliente DESPUÉS de un silencio: el bot tiene que saber cuánto tiempo pasó y retomar,
// no seguir la charla como si le acabaran de contestar (6 nov: "Va, entonces la armamos…" un día después;
// "Hola Gerencia…" repitiendo el precio).
const haceCuanto = (ms) => { const h = Math.round(ms / 3600e3); return h < 1 ? 'menos de una hora' : h < 36 ? `${h} horas` : `${Math.round(h / 24)} días`; };
function instruccionSeguimiento(conv, paso) {
  const ultCliente = [...conv.msgs].reverse().find((m) => m.role === 'cliente');
  const ultNuestro = [...conv.msgs].reverse().find((m) => m.role === 'bot' || m.role === 'equipo');
  const nombre = nombreSaludo(conv);
  const saludo = nombre === 'qué tal' ? 'Hola' : `Hola ${nombre}`;
  return [
    '# SEGUIMIENTO: el cliente NO respondió',
    `Su último mensaje fue hace ${ultCliente ? haceCuanto(Date.now() - ultCliente.ts) : '(nunca escribió)'}; tu último mensaje fue hace ${ultNuestro ? haceCuanto(Date.now() - ultNuestro.ts) : '(ninguno)'}. Este mensaje le llega DESPUÉS de ese silencio: NO es la continuación inmediata de la charla.`,
    `- Empezá retomando, como alguien que vuelve a escribir: "${saludo}, te escribo para retomar lo de tu página…" o "${saludo}, quedamos pendientes con la demo de…". NUNCA empieces como si te acabara de contestar ("Va", "Buenísimo", "Perfecto", "Listo", "Entonces").`,
    '- En media frase recordale qué quedó pendiente y para qué: poder trabajar su página y que empiece a darle el beneficio que busca (que lo encuentren en Google, que le escriban por WhatsApp, verse serio con clientes nuevos), según su rubro.',
    ...(ultNuestro ? [`- Tu último mensaje (sin respuesta) fue: «${String(ultNuestro.text).slice(0, 300)}». No lo vuelvas a preguntar ni a pedir igual: el cliente ya lo leyó y no contestó.`] : []),
    '- Estructura: (1) saludo + que retomás, (2) qué gana con su página, (3) una propuesta concreta para avanzar que no le exija lo mismo que ya no contestó.',
    '- No repitas la pregunta ni el pedido de tu último mensaje con las mismas palabras. Si faltaba un dato (nombre del negocio, logo), ofrecé avanzar con lo que ya tenés: "si querés la armamos con el nombre X y después la ajustamos".',
    '- Si ya le dijiste el precio o lo que incluye, no lo repitas.',
    `- Saludá con «${saludo}». Nunca uses como nombre palabras como Gerencia, Ventas, Info o Admin, ni títulos (Abog., Lic., Ing.).`,
    '- Un solo mensaje corto (2 o 3 líneas).',
    ...(paso ? [`Lo que toca en este paso: ${paso.pista}`] : []),
  ].join('\n');
}

async function sendFollowup(due) {
  const ps = pasos();
  const step = due.followups?.step || 0;
  const paso = ps[step];
  due.followups = { ...(due.followups || {}), step: step + 1, next: null };
  if (!paso) return { ok: false, motivo: 'No quedan pasos de seguimiento.' };
  if (due.msgs.at(-1)?.role === 'cliente') return { ok: false, motivo: 'El cliente fue el último en escribir.' }; // no es un seguimiento
  remember(L.lastFollowups, Date.now(), 50);
  L.gapSeguimiento = Math.round(rnd(6, 15) * 60e3);
  try {
    const r = await sellerTurn(due, { proactivo: true, extraSystem: instruccionSeguimiento(due, paso) });
    if (/NO_ENVIAR|SIN_RESPUESTA/.test(r.text) || due.pausa || due.msgs.at(-1)?.role === 'cliente') return { ok: false, motivo: 'El vendedor decidió no escribirle.' };
    await deliver(due, r.text, { ...r.meta, seguimiento: step + 1 });
    (SG.stats[step] ||= { enviados: 0, respondidos: 0 }).enviados += 1;
    due.followups.ultimo = { step, ts: Date.now() };
    if (step + 1 < ps.length) due.followups.next = enVentana(Date.now() + (ps[step + 1].horas - paso.horas) * 3600e3);
    log('vendedor', `Seguimiento ${step + 1} a ${due.title}`, 'info');
    return { ok: true };
  } catch (e) {
    // Si falla, no se manda nada (en Velforce un fallo mandaba mensajes que no venían al caso).
    log('vendedor', `Seguimiento no enviado a ${due.title}: ${e.message}`, 'warn');
    return { ok: false, motivo: e.message };
  } finally {
    touchConv(due);
  }
}

// Todo lo que va a salir solo, por cliente: seguimientos de lead, de la demo y lo que el vendedor prometió (agenda).
export function proximosSeguimientos({ cliente = '' } = {}) {
  const nz = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = nz(cliente);
  const hn = (t) => new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(t);
  const out = [];
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp') continue;
    const nombre = c.contacto?.empresa || c.title;
    if (q && !nz(`${c.title} ${c.contacto?.empresa || ''} ${c.contacto?.nombre || ''} ${c.phone}`).includes(q)) continue;
    if (c.followups?.next && puedeSeguir(c)) out.push({ cuando: c.followups.next, cliente: nombre, que: `Seguimiento de lead ${(c.followups.step || 0) + 1} de ${pasos().length}` });
    if (c.postDemo?.next) out.push({ cuando: c.postDemo.next, cliente: nombre, que: `Seguimiento de la demo ${(c.postDemo.step || 0) + 1} de ${POST_DEMO.length}${seguimientoDemoPermitido(c, c.postDemo.next) ? '' : ' (en espera: el cliente escribió o el chat lo tiene una persona)'}` });
    for (const a of c.agenda || []) if (!a.hecho && a.at) out.push({ cuando: a.at, cliente: nombre, que: `Mensaje agendado por el vendedor: ${String(a.motivo || '').slice(0, 120)}` });
  }
  out.sort((a, b) => a.cuando - b.cuando);
  return out.slice(0, 60).map((x) => `${hn(x.cuando)} · ${x.cliente} · ${x.que}`);
}

// ---------- seguimientos: lo que ve y ajusta Diego ----------
export function seguimientosInfo() {
  const agenda = Object.values(V.convs).filter((c) => c.followups?.next && puedeSeguir(c)).sort((a, b) => a.followups.next - b.followups.next)
    .map((c) => ({ id: c.id, title: c.contacto?.empresa || c.title, next: c.followups.next, step: c.followups.step || 0 }));
  return { pasos: SG.pasos, stats: SG.stats, horario: FU_HOURS, topeHora: FU_HOURLY_CAP, agenda, enVivo: L.enabled };
}
export function setPasos(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('Tiene que haber al menos un paso.');
  const limpio = list.slice(0, 8).map((p) => ({ horas: Math.max(1, Math.min(24 * 90, Math.round(Number(p.horas) || 0))), activo: p.activo !== false, pista: String(p.pista || '').trim().slice(0, 800) }))
    .filter((p) => p.pista).sort((a, b) => a.horas - b.horas);
  if (!limpio.length) throw new Error('Cada paso necesita una indicación para el vendedor.');
  SG.pasos = limpio;
  saveNow();
  log('vendedor', 'Diego ajustó los pasos de seguimiento', 'info');
  return seguimientosInfo();
}
export async function followupNow(convId) {
  const c = V.convs[convId];
  if (!c || !puedeSeguir(c)) throw new Error('Este chat no está para seguimiento (pausado, con vos o ya cerrado).');
  if (!L.enabled) throw new Error('El vendedor está apagado.');
  return sendFollowup(c);
}
export function cancelFollowup(convId) {
  const c = V.convs[convId];
  if (!c) throw new Error('Conversación no encontrada.');
  c.followups = { ...(c.followups || {}), step: pasos().length, next: null };
  log('vendedor', `Seguimientos cancelados para ${c.title}`, 'info');
  touchConv(c);
  return { ok: true };
}
setInterval(() => followupTick().catch(() => {}), 60_000);

// Encendido automático: Diego pidió que el vendedor atienda apenas el modelo funcione.
setInterval(async () => {
  if (L.enabled || !L.autoStart) return;
  try {
    const { testKey } = await import('../secrets.mjs');
    if ((await testKey('OPENROUTER_API_KEY'))?.state === 'ok') { await setLive(true); log('vendedor', 'La llave de OpenRouter ya funciona: el vendedor se encendió solo', 'ok'); }
  } catch {}
}, 3 * 60e3);
export function setAutoStart(on) { L.autoStart = Boolean(on); saveNow(); return L.autoStart; }

// Al reiniciar la oficina: si un cliente escribió hace poco y quedó sin respuesta, se le responde.
setTimeout(() => {
  if (!L.enabled) return;
  for (const c of Object.values(V.convs)) {
    const last = c.msgs?.at(-1);
    if (c.kind === 'whatsapp' && !c.pausa && !timers.has(c.id) && last?.role === 'cliente' && Date.now() - last.ts < 15 * 60e3) schedule(c);
  }
}, 8000);

// ---------- avisos a Diego (de día; de noche quedan para las 7:00) ----------
L.avisos ||= [];
export async function avisarDiego(texto) {
  const h = new Date(Date.now() - 6 * 3600e3).getUTCHours();
  if (h >= 7 && h < 21) return messageOwner(texto, { recordatorio: true }).catch(() => {});
  L.avisos.push({ texto, ts: Date.now() });
  saveNow();
}
setInterval(() => {
  const h = new Date(Date.now() - 6 * 3600e3).getUTCHours();
  if (h < 7 || h >= 21 || !L.avisos.length) return;
  const juntos = L.avisos.splice(0).map((a) => `• ${a.texto}`).join('\n');
  saveNow();
  messageOwner(`Buenos días, Diego. Esto quedó de anoche:\n${juntos}`, { recordatorio: true }).catch(() => {});
}, 5 * 60e3);

// Los chats que ya estaban pausados con el botón pasan a pausa total (9 nov).
for (const c of Object.values(V.convs)) if (c.pausa?.motivo === 'Pausado por Diego' && !c.pausa.total) { c.pausa.total = true; for (const a of c.agenda || []) if (!a.hecho) { a.hecho = Date.now(); a.resultado = 'cancelado: chat en pausa'; } }

// Lo que no pide respuesta no se avisa (queda en Ventas): agradecimientos, "ok", stickers, una foto o un audio suelto.
// Cierres de conversación: "perfecto, estaremos pendiente", "está bien, cualquier horario", "lo importante es que quede
// bien". No piden nada: no se le contesta solo ni se retoma el chat (12 nov: Elvin, Consulab y Erick recibieron mensajes
// del bot horas después de que Diego ya les había respondido).
const CIERRE = /(pendiente|est[aá] bien|perfecto|gracias|listo|de acuerdo|entendido|excelente|genial|ok\b|okey|\bva\b|dale|quede|voy viendo|lo reviso|lo veo|reviso bien|saludos|bendiciones|feliz (d[ií]a|tarde|noche)|buenas noches)/i;
const esCierre = (t) => { const x = String(t || '').trim(); return SIN_RESPUESTA.test(x) || (!/\?/.test(x) && x.length <= 100 && CIERRE.test(x)); };
// ¿El cliente dejó algo que pide respuesta? Mira todos sus mensajes desde lo último que le escribimos.
function esperaRespuesta(c) {
  const ms = c.msgs.filter((m) => !m.previo && m.role !== 'sistema');
  const pend = [];
  for (let i = ms.length - 1; i >= 0 && ms[i].role === 'cliente'; i--) pend.push(ms[i]);
  return pend.length > 0 && pend.some((m) => !esCierre(m.text));
}
// Diego escribió en este chat hace poco: él lo está atendiendo y el bot no se mete.
const diegoReciente = (c, horas = 12) => c.msgs.some((m) => m.role === 'equipo' && !m.previo && Date.now() - m.ts < horas * 3600e3);
const SIN_RESPUESTA = /^\s*(ok(ey|i)?|okay|vale|dale|listo|perfecto|gracias|muchas gracias|mil gracias|bien|excelente|genial|sí|si|👍|🙏|👌|🙌|😊|❤️|\[mensaje no soportado\]|\[el cliente envió (una imagen|un sticker|un audio)[^\]]*\])[\s.!¡😊🙏👍🙌]*$/i;

// Escalada (6 nov): un chat pausado que sigue sin respuesta no se puede quedar en visto.
//   2 h → segundo aviso a Diego con cuánto lleva esperando.
//   4 h → contesta el bot: si era un lead que tomó Diego, el bot lo retoma; si es un cliente (en proyecto o que pasó
//         a una persona), solo un acuse corto y Diego sigue a cargo. Solo de 7:00 a 21:00 (hora de Honduras).
const ESCALA_AVISO = 2 * 3600e3, ESCALA_BOT = 4 * 3600e3;
setInterval(async () => {
  const h = new Date(Date.now() - 6 * 3600e3).getUTCHours();
  if (h < 7 || h >= 21 || !L.enabled) return;
  const aviso = [];
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp' || !c.pausa || c.optOut || c.busy || c.inst) continue;
    const last = c.msgs.filter((m) => !m.previo && m.role !== 'sistema').at(-1);
    if (!last || last.role !== 'cliente') continue;
    const espera = Date.now() - last.ts;
    if (espera < ESCALA_AVISO || espera > 24 * 3600e3 || !esperaRespuesta(c)) continue;
    c.escala ||= {};
    const quien = c.contacto?.empresa || c.contacto?.nombre || c.title;
    if (c.escala.aviso !== last.ts) {
      c.escala.aviso = last.ts;
      aviso.push(`• *${quien}* lleva ${Math.round(espera / 3600e3)} h esperando: "${String(last.text).slice(0, 140)}"`);
    }
    if (c.pausa.total || espera < ESCALA_BOT || c.escala.bot === last.ts) continue;
    // Si Diego le escribió en las últimas 12 h, él lleva el chat: solo el aviso, el bot no retoma ni manda acuse.
    if (diegoReciente(c)) continue;
    c.escala.bot = last.ts;
    const tomadoPorDiego = !c.pausa.existente && !c.estado?.humano && /persona escribi|Diego tom|empez[oó] una persona/i.test(c.pausa.motivo || '');
    if (tomadoPorDiego) {
      log('vendedor', `${quien}: 4 h sin respuesta en un chat que había tomado Diego. El bot lo retoma`, 'warn');
      try { resume(c.id); } catch {}
    } else {
      if (c.escala.acuseTs && Date.now() - c.escala.acuseTs < 24 * 3600e3) { touchConv(c); continue; } // un acuse por día como máximo
      c.escala.acuseTs = Date.now();
      const nombre = String(c.contacto?.nombre || '').trim().split(/\s+/)[0];
      const ok = await deliver(c, `Hola${nombre ? ` ${nombre}` : ''}, recibimos tu mensaje. Diego lo está revisando y te responde lo antes posible.`, { acuse: true, fijo: true }, { force: true }).catch(() => false);
      log('vendedor', `${quien}: 4 h sin respuesta (cliente con Diego). ${ok ? 'Se le mandó un acuse' : 'No se pudo mandar el acuse'}`, ok ? 'info' : 'warn');
    }
    touchConv(c);
  }
  saveNow();
  if (aviso.length) avisarDiego(`⏰ *${aviso.length === 1 ? 'Un cliente sigue' : `${aviso.length} clientes siguen`} sin respuesta* (bot pausado):\n${aviso.join('\n')}\nA las 4 h el bot contesta solo, salvo en los chats con pausa total: retoma los leads que tomaste vos y a los clientes les manda un acuse.`).catch(() => {});
}, 5 * 60e3);

// Un contacto pausado (ya existía, o lo estás atendiendo vos) escribió y nadie le contestó en 10 minutos.
setInterval(() => {
  const juntos = [];
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp' || !c.pausa) continue;
    const last = c.msgs.at(-1);
    if (!last || last.role !== 'cliente' || Date.now() - last.ts < 10 * 60e3 || Date.now() - last.ts > 24 * 3600e3) continue;
    if (c.alertado && c.alertado >= last.ts) continue;
    c.alertado = last.ts;
    if (SIN_RESPUESTA.test(String(last.text || ''))) continue;
    const quien = c.contacto?.empresa || c.contacto?.nombre || c.title;
    juntos.push(`• *${quien}* (+${String(c.phone).replace(/^lid:/, '')}): "${String(last.text).slice(0, 160)}"`);
    log('vendedor', `Aviso a Diego: ${quien} escribió con el bot pausado`, 'warn');

  }
  if (juntos.length) avisarDiego(`📩 *${juntos.length === 1 ? 'Te escribió un cliente' : `Te escribieron ${juntos.length} clientes`}* (el bot está pausado en ${juntos.length === 1 ? 'ese chat' : 'esos chats'}):\n${juntos.join('\n')}\nContestales desde el teléfono o reactivá el bot en Ventas.`);
}, 2 * 60e3);

// ---------- compromisos del cliente (Fase 2): el seguimiento sale solo ----------
// Lo llama ventas/compromisos.mjs, que ya decidió que toca y que se puede. Sale aunque Diego haya tomado el chat
// desde el teléfono (ahí es donde se perdían): si el cliente contesta, Diego recibe el aviso de siempre y a las 4 h
// el bot retoma. En pausa total no sale (deliver lo frena).
export async function seguirCompromiso(convId, texto, k) {
  const conv = V.convs[convId];
  if (!conv) return { ok: false, error: 'No existe la conversación.' };
  const antes = conv.msgs.length;
  const ok = await deliver(conv, texto, { compromiso: k, fijo: true }, { force: true }).catch(() => false);
  const nuevo = conv.msgs.slice(antes).find((m) => m.role === 'bot');
  const via = nuevo?.meta?.plantilla ? `plantilla ${nuevo.meta.plantilla}` : nuevo ? 'mensaje directo' : null;
  registrarEvento(conv.id, 'seguimiento_compromiso', ok ? via : 'no salió');
  touchConv(conv);
  const quien = conv.contacto?.empresa || conv.contacto?.nombre || conv.title;
  log('vendedor', `${quien}: seguimiento del compromiso ${ok ? `enviado (${via})` : 'no salió'}`, ok ? 'ok' : 'warn');
  if (ok) avisarDiego(`🤝 *${quien}*: le escribí solo por lo que dijo ("${String(k.cita || '').slice(0, 110)}").\nMensaje: "${String(nuevo?.text || texto).slice(0, 220)}"`).catch(() => {});
  return { ok, via, texto: nuevo?.text || texto };
}

// ---------- reuniones por Google Meet (11 nov) ----------
// El cliente pidió una reunión y en 15 min nadie le contestó (casi siempre porque Diego tomó el chat desde el
// teléfono y el bot quedó en pausa): el bot le ofrece horarios libres reales y retoma el chat para agendar cuando elija.
export async function ofrecerReunionAuto(convId, motivo = '') {
  const conv = V.convs[convId];
  if (!conv || conv.optOut || conv.pausa?.total) return { ok: false, error: 'no se puede escribir a este chat' };
  const ci = await import('./citas.mjs');
  if (!ci.conectado()) return { ok: false, error: 'calendario no conectado' };
  const opciones = await ci.huecos({ cuantos: 3 });
  if (!opciones.length) return { ok: false, error: 'sin espacios libres' };
  const nombre = nombreSaludo(conv);
  const lista = opciones.map((o) => o.texto);
  const texto = `Hola${nombre === 'qué tal' ? '' : ` ${nombre}`}, claro, hagamos la reunión por Google Meet (unos 45 min, pueden entrar todos los que quieras). Tengo libre ${lista.length > 1 ? `${lista.slice(0, -1).join(', ')} o ${lista.at(-1)}` : lista[0]}. ¿Cuál te queda mejor?`;
  const ok = await deliver(conv, texto, { reunion: true, fijo: true }, { force: true }).catch(() => false);
  if (!ok) return { ok: false, error: 'no salió el mensaje' };
  conv.estado.reunionOfrecida = { opciones, ts: Date.now(), auto: true };
  // El bot retoma el chat para agendar con agendar_reunion cuando el cliente elija.
  if (conv.pausa && !conv.pausa.total) { try { resume(conv.id); } catch {} }
  registrarEvento(conv.id, 'reunion_ofrecida', lista.join(' | '));
  touchConv(conv);
  const quien = conv.contacto?.empresa || conv.contacto?.nombre || conv.title;
  log('vendedor', `${quien}: pidió reunión y se le ofrecieron horarios solos`, 'ok');
  avisarDiego(`📅 *${quien}* pidió una reunión${motivo ? ` ("${String(motivo).slice(0, 100)}")` : ''} y nadie le contestó en 15 min. Le ofrecí: ${lista.join(', ')}. El bot retomó el chat para agendarla en tu Google Calendar cuando elija.`).catch(() => {});
  return { ok: true, opciones };
}
export async function recordarReunion(convId, texto) {
  const conv = V.convs[convId];
  if (!conv || conv.optOut || conv.pausa?.total) return false;
  const ok = await deliver(conv, texto, { reunionRecordatorio: true, fijo: true }, { force: true }).catch(() => false);
  touchConv(conv);
  return ok;
}

// ---------- promesas pendientes ----------
// Lo que más se perdió en la auditoría no fue del bot: "a las 8 le paso la información" (Elias, que preguntó cómo pagar),
// "dejame te saco los costos", una consulta escalada que nadie contestó en una semana. Cada promesa de una persona del
// equipo (o del bot cuando pasa el chat a una persona) queda anotada hasta que se le vuelve a escribir al cliente.
const PROMESA = /\b(te|le|les) (paso|pasamos|mando|mandamos|env[ií]o|enviamos|comparto|compartimos|confirmo|confirmamos|aviso|avisamos|comento|comentamos|saco|sacamos|escribo|escribimos|apoyo|llamo|llamamos)\b|ma[ñn]ana (te|le|les|se lo|se la|lo|la)\b|\ben la tarde\b|\ba las \d|\bd[eé]j[ae]me\b|\bquedo pendiente\b|\bya (te|le) (comento|confirmo|aviso)\b|\bpronto un miembro\b|\bse comunicar[aá]\b|\bte escribe por aqu[ií]\b/i;
export function promesasPendientes() {
  const out = [];
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp' || c.optOut || c.estado?.resultado) continue;
    const ms = c.msgs.filter((m) => !m.previo && !m.auto && m.role !== 'sistema');
    // La última promesa de una persona (o del bot al pasar el chat) y si después se le volvió a escribir.
    let i = ms.length - 1;
    const esPromesa = (t) => PROMESA.test(t) && !/https?:\/\/|\.cresova\.com|\b(te|le|les) (comparto|mando|env[ií]o|paso) ya\b|\baqu[ií] (est[aá]|te|le)\b/i.test(t) && !/\bya (te|le|les) (compartimos|compart[ií]|mandamos|mand[eé]|enviamos|envi[eé]|pasamos|pas[eé])\b/i.test(t); // "ya le compartimos la demo" es un hecho, no una promesa
    while (i >= 0 && !((ms[i].role === 'equipo' || (ms[i].role === 'bot' && c.pausa)) && esPromesa(ms[i].text))) i--;
    if (i < 0) continue;
    const prom = ms[i];
    const despues = ms.slice(i + 1);
    // Lo que se le escribe enseguida ("jajaja dale") no cumple la promesa; algo media hora después, sí cuenta.
    if (despues.some((m) => (m.role === 'equipo' || (m.role === 'bot' && m.meta?.puente == null)) && m.ts - prom.ts > 30 * 60e3)) continue;
    const horas = (Date.now() - prom.ts) / 3600e3;
    if (horas < 3 || horas > 10 * 24) continue;
    const ultCli = despues.filter((m) => m.role === 'cliente').at(-1);
    out.push({ conv: c.id, cliente: c.contacto?.empresa || c.contacto?.nombre || c.title, telefono: String(c.phone).replace(/^lid:/, ''), promesa: String(prom.text).slice(0, 220), hace_horas: Math.round(horas), cliente_escribio_despues: ultCli ? String(ultCli.text).slice(0, 160) : null, ts: prom.ts });
  }
  return out.sort((a, b) => a.ts - b.ts);
}
setInterval(() => {
  const { h } = hnNow();
  if (h < 7 || h >= 20) return;
  const nuevas = [];
  for (const p of promesasPendientes()) {
    const c = V.convs[p.conv];
    if (!c || (c.promesaAvisada && c.promesaAvisada >= p.ts)) continue;
    c.promesaAvisada = p.ts;
    // Además queda como pendiente para hoy en Negocio → Pendientes (con su cliente, si está en la base).
    import('../cresova/db.mjs').then(async (db) => {
      if (!db.enUso()) return;
      const neg = await import('../cresova/negocio.mjs');
      const tel = String(p.telefono).replace(/\D/g, '').slice(-8);
      const [cli] = tel.length === 8 ? await db.q(`select id from clients where regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like $1 order by created_at desc limit 1`, [`%${tel}`]) : [];
      await neg.guardarTarea(null, { title: `Cumplirle a ${p.cliente}: ${p.promesa}`.slice(0, 200), due_date: new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10), priority: 'high', client_id: cli?.id || null, notes: `Se le prometió hace ${p.hace_horas} h por WhatsApp (+${p.telefono}).${p.cliente_escribio_despues ? ` Después escribió: "${p.cliente_escribio_despues}"` : ''}`, category: 'promesa' });
    }).catch((e) => log('vendedor', `No se pudo crear el pendiente de la promesa a ${p.cliente}: ${e.message}`, 'warn'));
    nuevas.push(`• *${p.cliente}* (+${p.telefono}), hace ${p.hace_horas} h: "${p.promesa}"${p.cliente_escribio_despues ? `. Después te dijo: "${p.cliente_escribio_despues}"` : ''}`);
    log('vendedor', `Promesa pendiente con ${p.cliente} (hace ${p.hace_horas} h)`, 'warn');
  }
  // Diego pidió que las promesas no le lleguen por WhatsApp: quedan como pendientes en Negocio → Pendientes.
  // Solo si la base propia no está en uso (no hay dónde anotarlas) se le avisa por WhatsApp.
  if (nuevas.length) {
    saveNow();
    import('../cresova/db.mjs').then((db) => { if (!db.enUso()) avisarDiego(`⏰ *${nuevas.length === 1 ? 'Promesa pendiente' : `${nuevas.length} promesas pendientes`}* (se les dijo que les escribíamos y todavía no):\n${nuevas.join('\n')}`); }).catch(() => {});
  }
  // Un chat que el bot pasó a una persona: si el cliente escribió y en 2 h nadie le contestó, el bot le da una
  // respuesta puente (una vez al día) para que no sienta que lo dejaron hablando solo.
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp' || !L.enabled || c.pausa?.motivo !== 'Pasó a una persona' || c.optOut) continue;
    const last = c.msgs.filter((m) => !m.previo).at(-1);
    if (!last || last.role !== 'cliente' || last.auto || Date.now() - last.ts < 2 * 3600e3 || Date.now() - last.ts > 20 * 3600e3) continue;
    if (!esperaRespuesta(c) || diegoReciente(c, 4)) continue; // "gracias" o "perfecto" no piden respuesta
    if (c.puente && Date.now() - c.puente < 24 * 3600e3) continue;
    c.puente = Date.now();
    const texto = ['Perdón la espera 🙏 Ya le recordé a Diego lo tuyo; te escribe por aquí apenas se desocupe.', 'Disculpa la demora. Diego ya tiene tu mensaje y te responde por aquí en cuanto pueda 🙌', 'Perdón que no te hemos contestado, ya le pasé tu mensaje a Diego otra vez para que te escriba hoy por aquí.'][Math.floor(Math.random() * 3)];
    deliver(c, texto, { puente: true }, { force: true }).then(() => touchConv(c)).catch(() => {});
    avisarDiego(`⌛ *${c.contacto?.empresa || c.title}* lleva más de 2 h esperando que alguien le conteste: "${String(last.text).slice(0, 160)}". Le mandé un mensaje de espera; escribile vos.`);
  }
  // Respondió a su demo (aunque el mensaje haya entrado por el historial o con el bot pausado).
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp' || !c.estado?.demoEnviada || c.estado.respondioDemo) continue;
    const r = c.msgs.find((m) => m.role === 'cliente' && !m.auto && m.ts > c.estado.demoEnviada);
    if (r) { c.estado.respondioDemo = r.ts; registrarEvento(c.id, 'respondio_demo', String(r.text).slice(0, 140)); touchConv(c); }
  }
}, 10 * 60e3);

// Diego respondió una consulta en la Bandeja: el vendedor se la manda al cliente con sus palabras.
export async function relayAnswer(convId, respuesta) {
  const conv = V.convs[convId];
  if (!conv || conv.kind !== 'whatsapp') return;
  if (conv.estado.consulta) conv.estado.consulta.respondida = Date.now();
  if (!respuesta?.trim()) return;
  if (conv.pausa || !L.enabled) { log('vendedor', `Respuesta del equipo para ${conv.title} guardada: el bot está pausado o apagado`, 'warn'); return; }
  const r = await sellerTurn(conv, { extraSystem: `# RESPUESTA DEL EQUIPO\nEl equipo respondió la consulta del cliente ("${conv.estado.consulta?.pregunta || ''}"): ${respuesta}\nEscribile al cliente ahora con esa respuesta, con tus palabras, corto y claro, y cerrá con UNA pregunta para avanzar.` });
  await deliver(conv, r.text, { ...r.meta, respuestaEquipo: true });
  touchConv(conv);
}

// Desarrollo le manda la demo al cliente (Diego aprieta el botón) y arranca el seguimiento post-demo.
// Seguimiento de la demo (rediseñado el 6 nov). Si el cliente no responde:
//   24 h  mensaje del bot (distinto si abrió o no la demo)
//   72 h  mensaje del bot: un beneficio para su rubro + si quiere ajustar algo (50 % al empezar, 50 % al entregar)
//   día 5 llamada: va a la lista "para llamar" de Diego con el contexto (no se le escribe al cliente)
//   día 7 cierre con respeto: ¿avanzamos o la guardamos?
//   día 30 recontacto con una razón nueva; después queda archivada con su motivo.
// Si responde, el camino depende de lo que dice (ver respuestaDemo): le gusta → cuenta y anticipo; pide cambios →
// Luis ajusta y la demo nueva reinicia esto; duda u objeción → el bot responde y Diego recibe el caso para llamar.
const POST_DEMO = [
  { horas: 24, plantilla: 'cresova_demo_vista', pista: (c) => (c.estado?.demoVista ? `Ya abrió la demo (${c.estado.demoVista.veces} ${c.estado.demoVista.veces === 1 ? 'vez' : 'veces'}). Preguntale qué le pareció, mencionando algo concreto de SU página (una sección o detalle). Una sola pregunta.` : 'Todavía NO abrió la demo. Preguntale con naturalidad si le llegó bien el enlace y si lo pudo abrir desde el celular. Una sola pregunta, sin presionar.') },
  { horas: 72, plantilla: 'cresova_demo_ajustes', nueva: 'cresova_demo_ajuste', pista: () => 'Retomá la demo con un beneficio concreto para su rubro y preguntá si quiere ajustar algo antes de arrancar. Recordá que el pago es 50 % al empezar y 50 % al entregar.' },
  { horas: 120, llamada: true },
  { horas: 168, plantilla: 'cresova_cierre', nueva: 'cresova_demo_decision', pista: () => 'Cerrá el ciclo con respeto: preguntá con una pregunta de sí o no si avanzamos esta semana o si la dejamos guardada para más adelante. Si tiene dudas que prefiere hablar, ofrecé que Diego le llame. Sin presionar ni inventar urgencias.' },
  { horas: 720, plantilla: 'cresova_recontacto', nueva: 'cresova_demo_cierre', pista: () => 'Recontacto a 30 días de la demo. Dale UNA razón nueva y concreta para retomarla (algo de su rubro o de la temporada) y preguntá con sí o no si quiere que la retomemos. Sin reclamar que no respondió.' },
];
export async function sendDemo(convId, url, nombre) {
  const conv = V.convs[convId];
  if (!conv || conv.kind !== 'whatsapp') throw new Error('Conversación de WhatsApp no encontrada.');
  if (!/^https?:\/\/\S+$/.test(String(url || ''))) throw new Error('La demo no tiene enlace.');
  // El mensaje de la demo NO lo escribe el modelo: antes ignoraba la instrucción y mandaba un "gracias" sin el enlace.
  // Es un texto fijo con el enlace en texto plano; si Diego aprobó el envío, sale aunque el bot esté pausado.
  // Sin nombre de pila: el dato guardado a veces es el del negocio (salía "¡Hola CF!").
  const texto = `¡Hola! 👋 Ya está lista la demo de la página de ${nombre}:

${url}

Ábrela desde tu celular y échale un vistazo. Es una versión demostrativa: podemos cambiar fotos, textos, servicios y lo que quieras. ¿Qué te parece? Cuéntame y la ajustamos.`;
  const ok = await deliver(conv, texto, { demo: url, fijo: true }, { force: true });
  if (!ok || !conv.msgs.some((m) => m.role === 'bot' && m.meta?.demo === url && String(m.text).includes(url))) throw new Error('WhatsApp no aceptó el mensaje con la demo.');
  conv.estado.demoEnviada = Date.now();
  conv.estado.demoUrl = url;
  conv.postDemo = { step: 0, next: enVentana(Date.now() + h1(POST_DEMO[0].horas) * 3600e3) };
  registrarEvento(conv.id, 'demo_enviada', url);
  log('vendedor', `Demo enviada a ${conv.title}: ${url}`, 'ok');
  touchConv(conv);
}
// Llamadas que tocan por el seguimiento de las demos: se juntan y le llegan a Diego en un solo mensaje de Discord.
const llamadasDemo = [];
let tLlamadasDemo = null;
function paraLlamarDemo(conv, motivo) {
  const e = conv.estado || {};
  const dias = e.demoEnviada ? Math.floor((Date.now() - e.demoEnviada) / 86400e3) : null;
  const vista = e.demoVista ? `la abrió ${e.demoVista.veces} ${e.demoVista.veces === 1 ? 'vez' : 'veces'}` : 'no la abrió';
  const ultCliente = conv.msgs.filter((m) => m.role === 'cliente' && !m.previo).at(-1);
  llamadasDemo.push(`• *${conv.contacto?.empresa || conv.contacto?.nombre || conv.title}* (+${String(conv.phone).replace(/^lid:/, '')}): ${motivo}. Demo hace ${dias ?? '?'} días, ${vista}.${e.demoUrl ? ` ${e.demoUrl}` : ''}${ultCliente ? `\n   Último mensaje suyo: "${String(ultCliente.text).slice(0, 120)}"` : ''}`);
  registrarEvento(conv.id, 'para_llamar', motivo);
  log('vendedor', `Para llamar: ${conv.title} (${motivo})`, 'info');
  // Va a la sección Llamadas; ya no se manda un mensaje por cada una.
  import('./llamadas.mjs').then((l) => l.agregarLlamada(conv, `${motivo}. Demo hace ${dias ?? '?'} días, ${vista}.`, 'seguimiento')).catch(() => {});
  llamadasDemo.length = 0;
}
function sigueDemo(c, step) {
  if (step + 1 < POST_DEMO.length) c.postDemo = { ...c.postDemo, step: step + 1, next: enVentana(Date.now() + (POST_DEMO[step + 1].horas - POST_DEMO[step].horas) * 3600e3) };
  else { c.postDemo = { ...c.postDemo, step: POST_DEMO.length, next: null }; c.estado.demoArchivada = { motivo: 'Sin respuesta después del recontacto de 30 días', ts: Date.now() }; registrarEvento(c.id, 'demo_archivada', 'sin respuesta'); }
}
setInterval(async () => {
  if (!L.enabled) return;
  const { h, day } = hnNow();
  if (!FU_HOURS.days.includes(day) || h < FU_HOURS.start || h >= FU_HOURS.end) return;
  const due = Object.values(V.convs).find((c) => c.kind === 'whatsapp' && c.postDemo?.next && c.postDemo.next <= Date.now() && !c.busy && !c.optOut && !c.estado?.demoArchivada);
  if (!due) return;
  const step = due.postDemo.step;
  const paso = POST_DEMO[step];
  due.postDemo = { ...due.postDemo, next: null };
  if (!paso) return;
  // Ya tiene la cuenta o pagó: no se le pregunta más por la demo. Lo sigue la cobranza y aparece en Llamadas.
  if (AVANZADAS.includes(etapaDe(due))) { touchConv(due); return; }
  if (due.msgs.filter((m) => !m.previo && m.role !== 'sistema').at(-1)?.role === 'cliente') return; // lo atiende la conversación
  try {
    // Chat tomado por Diego (o cliente que pasó a una persona): el seguimiento no se pierde, pasa a la lista de llamadas.
    if (!seguimientoDemoPermitido(due) || due.estado.humano) { paraLlamarDemo(due, `tocaba el seguimiento ${step + 1} de su demo y el chat lo tenés vos`); sigueDemo(due, step); return; }
    if (paso.llamada) { paraLlamarDemo(due, '5 días sin responder a su demo'); sigueDemo(due, step); return; }
    const r = await sellerTurn(due, { proactivo: true, extraSystem: `${instruccionSeguimiento(due, null)}

# SEGUIMIENTO DE LA DEMO (paso ${step + 1} de ${POST_DEMO.length}; el cliente no respondió)\nLa demo que le mandamos: ${due.estado.demoUrl || ''}\n${paso.pista(due)}\nNo repitas tu último mensaje. Si no corresponde escribir, respondé exactamente NO_ENVIAR.` });
    if (/NO_ENVIAR|SIN_RESPUESTA/.test(r.text) || !seguimientoDemoPermitido(due)) { sigueDemo(due, step); return; }
    await deliver(due, r.text, { ...r.meta, seguimientoDemo: step + 1, plantillaDemo: paso.nueva && YC.aprobada(paso.nueva) ? paso.nueva : paso.plantilla }, { aunPausado: Boolean(due.pausa) });
    sigueDemo(due, step);
    registrarEvento(due.id, 'seguimiento_demo', `Seguimiento ${step + 1} de ${POST_DEMO.length}`);
    log('vendedor', `Seguimiento de demo ${step + 1} a ${due.title}`, 'info');
  } catch (e) { log('vendedor', `Seguimiento de demo no enviado a ${due.title}: ${e.message}`, 'warn'); }
  finally { touchConv(due); }
}, 3 * 60e3);

// ---------- la respuesta del cliente a su demo ----------
const RESP_DEMO = [
  ['no', /\b(no me interesa|ya no,? gracias|no,? gracias|ya tengo (p[aá]gina|quien)|otro proveedor|no estoy interesad)/i],
  ['cambios', /(quiero cambios|cambi[oa]r?|ajust|modific|agreg|quit[ae]|otro color|otra foto|otras fotos|corregir)/i],
  ['objecion', /(caro|precio|presupuesto|lo (voy a )?pienso|pensarlo|m[aá]s adelante|ahorita no|ahora no|no tengo|consultar|mi socio|mi esposa|mi esposo|tengo dudas)/i],
  ['gusta', /(me gust|me encant|qued[oó] (bonit|bien|lind|excelent)|est[aá] (bonit|bien|lind|excelent|super)|excelente|perfect[oa]|avancemos|arranquemos|adelante|c[oó]mo (pago|hago el pago|depos)|n[uú]mero de cuenta|anticipo)/i],
];
// Las palabras clave dan una primera lectura inmediata; a los 25 s (ya con todos sus mensajes) la IA confirma qué quiso decir.
const lecturasIA = new Map();
function respuestaDemo(conv, text) {
  const tipo = RESP_DEMO.find(([, re]) => re.test(String(text || '')))?.[0];
  if (tipo) aplicarRespuesta(conv, tipo, text, 'palabras');
  clearTimeout(lecturasIA.get(conv.id));
  lecturasIA.set(conv.id, setTimeout(async () => {
    lecturasIA.delete(conv.id);
    const r = await leerRespuesta(conv).catch(() => null);
    if (r) { aplicarRespuesta(conv, r.tipo, r.texto || text, 'ia', r.motivo); touchConv(conv); }
  }, 25_000));
}
function aplicarRespuesta(conv, tipo, text, fuente, motivo = '') {
  if (tipo === 'neutro') return; // todavía no dijo qué le pareció: no se toca nada
  const e = conv.estado;
  const igual = e.respuestaDemo?.tipo === tipo && e.respuestaDemo.ts >= (e.demoEnviada || 0);
  e.respuestaDemo = { tipo, texto: String(text).slice(0, 200), motivo, fuente, ts: Date.now() };
  if (igual) return; // la IA confirmó lo que ya se había detectado: no se repiten las acciones
  if (e.demoArchivada && tipo !== 'no') delete e.demoArchivada;
  registrarEvento(conv.id, 'respuesta_demo', `${tipo}: ${String(text).slice(0, 120)}`);
  if (tipo === 'no') {
    e.demoArchivada = { motivo: String(text).slice(0, 200), ts: Date.now() };
    if (conv.postDemo) conv.postDemo = { ...conv.postDemo, next: null };
  }
  // Duda u objeción: el bot la responde en la conversación, y Diego recibe el caso por si una llamada la destraba.
  if (tipo === 'objecion' && !(e.llamadaObjecion && Date.now() - e.llamadaObjecion < 7 * 86400e3)) { e.llamadaObjecion = Date.now(); paraLlamarDemo(conv, `tiene una duda u objeción: "${String(text).slice(0, 100)}"`); }
}

// Respondió y la conversación se enfrió (el último en escribir fue el bot hace más de 48 h): el seguimiento sigue
// desde el paso de ajustes en vez de morir. No aplica si Luis está haciendo cambios o si ya pagó.
setInterval(() => {
  if (!L.enabled) return;
  for (const c of Object.values(V.convs)) {
    const e = c.estado || {};
    if (c.kind !== 'whatsapp' || !e.demoEnviada || e.demoArchivada || c.optOut || c.busy || c.postDemo?.next || e.cierre?.validado || e.cierre?.comprobante) continue;
    const reales = c.msgs.filter((m) => !m.previo && m.role !== 'sistema');
    const ult = reales.at(-1);
    if (!ult || ult.role === 'cliente' || Date.now() - ult.ts < 48 * 3600e3) continue;
    // Chat que tomó Diego y quedó quieto: el bot no escribe, pero el caso va a la lista de llamadas (una vez por semana).
    if (c.pausa) {
      if (!(e.llamadaPausa && Date.now() - e.llamadaPausa < 7 * 86400e3)) { e.llamadaPausa = Date.now(); paraLlamarDemo(c, `el chat lo tenés vos y lleva ${Math.floor((Date.now() - ult.ts) / 86400e3)} días sin movimiento`); touchConv(c); }
      continue;
    }
    if (!reales.some((m) => m.role === 'cliente' && m.ts > e.demoEnviada)) continue; // nunca respondió: eso lo lleva la secuencia normal
    if (e.cambiosPedidos?.ts > e.demoEnviada && Date.now() - e.cambiosPedidos.ts < 5 * 86400e3) continue;
    const paso = Math.max(1, Math.min(c.postDemo?.step ?? 1, POST_DEMO.length - 1));
    if (c.postDemo?.reactivado === ult.ts) continue;
    c.postDemo = { ...(c.postDemo || {}), step: paso, next: enVentana(Date.now()), reactivado: ult.ts };
    log('vendedor', `${c.title}: respondió a su demo y la conversación se enfrió; sigue el seguimiento (paso ${paso + 1})`, 'info');
    touchConv(c);
  }
}, 10 * 60e3);

// Le gustó y se le mandó la cuenta, pero no pagó: a las 48 h recordatorio del anticipo, a las 72 h, a la lista de llamadas.
setInterval(async () => {
  if (!L.enabled) return;
  const { h, day } = hnNow();
  if (!FU_HOURS.days.includes(day) || h < FU_HOURS.start || h >= FU_HOURS.end) return;
  const db = await import('../cresova/db.mjs');
  for (const c of Object.values(V.convs)) {
    const ci = c.estado?.cierre;
    if (c.kind !== 'whatsapp' || !ci?.enviada || ci.comprobante || ci.validado || c.optOut || c.busy) continue;
    const t = Date.now() - ci.enviada;
    if (t > 14 * 86400e3) continue;
    if (ci.quoteId && db.enUso()) {
      try { const [p] = await db.q('select coalesce(sum(amount), 0)::float as p from quote_payments where quote_id = $1', [ci.quoteId]); if (p?.p > 0) { c.estado.cierre = { ...ci, validado: ci.validado || Date.now() }; continue; } } catch {}
    }
    if (t >= 48 * 3600e3 && !ci.recordado) {
      c.estado.cierre = { ...ci, recordado: Date.now() };
      const nombre = String(c.contacto?.nombre || '').trim().split(/\s+/)[0];
      const ok = await deliver(c, `Hola${nombre ? ` ${nombre}` : ''}, te escribo por el anticipo de tu página web. ¿Te comparto de nuevo los datos para el pago?`, { anticipo: true, fijo: true }, { force: true }).catch(() => false);
      registrarEvento(c.id, 'recordatorio_anticipo', ok ? 'enviado' : 'no salió');
      log('vendedor', `${c.title}: recordatorio del anticipo ${ok ? 'enviado' : 'no salió'}`, ok ? 'info' : 'warn');
      touchConv(c);
      return; // uno por vuelta
    }
    if (t >= 72 * 3600e3 && !ci.llamada) { c.estado.cierre = { ...ci, llamada: Date.now() }; paraLlamarDemo(c, 'le gustó y se le mandó la cuenta, pero no ha pagado el anticipo (72 h)'); touchConv(c); }
  }
}, 10 * 60e3);

// ¿Abrió la demo? Lo registra el servidor de las vistas previas (solo la página principal, sin robots ni nuestras revisiones).
export function vistaDemo(proyecto) {
  const c = Object.values(V.convs).find((x) => x.kind === 'whatsapp' && String(x.estado?.demoUrl || '').includes(`/${proyecto}/`));
  if (!c) return;
  const v = c.estado.demoVista || { primera: Date.now(), veces: 0, ultima: 0 };
  if (Date.now() - v.ultima < 20 * 60e3) { v.ultima = Date.now(); c.estado.demoVista = v; return; } // misma visita
  v.veces += 1; v.ultima = Date.now();
  c.estado.demoVista = v;
  if (v.veces === 1) { registrarEvento(c.id, 'abrio_demo', proyecto); log('vendedor', `${c.title} abrió su demo`, 'ok'); }
  touchConv(c);
}

// Una sola vez: las demos viejas que tenían pendiente el mensaje de cierre (se trabaron mientras Meta aprobaba las
// plantillas) pasan al recontacto de 30 días en vez de recibir un "cierre" fuera de lugar; las que terminaron la
// secuencia sin respuesta también quedan con su recontacto.
setTimeout(() => {
  if (V.migracionPostDemo2) return;
  let n = 0;
  for (const c of Object.values(V.convs)) {
    const e = c.estado || {};
    if (c.kind !== 'whatsapp' || !e.demoEnviada || c.optOut || e.demoArchivada) continue;
    const dias = (Date.now() - e.demoEnviada) / 86400e3;
    const pd = c.postDemo;
    const ultReal = c.msgs.filter((m) => !m.previo && m.role !== 'sistema').at(-1);
    if (pd?.next && pd.step >= 2 && dias > 8) { c.postDemo = { ...pd, step: 4, next: enVentana(Math.max(Date.now() + n * 3600e3, e.demoEnviada + 30 * 86400e3)) }; n++; }
    else if (pd?.next && pd.step === 2) c.postDemo = { ...pd, step: 3 }; // el viejo paso 3 (cierre) es ahora el 4
    else if (!pd?.next && pd && ultReal?.role !== 'cliente' && !e.cierre?.validado && dias > 7 && !e.respondioDemo) { c.postDemo = { ...pd, step: 4, next: enVentana(Math.max(Date.now() + n * 3600e3, e.demoEnviada + 30 * 86400e3)) }; n++; }
  }
  V.migracionPostDemo2 = Date.now();
  saveNow();
  log('vendedor', `Seguimiento de demos: ${n} demo(s) viejas pasaron al recontacto de 30 días`, 'info');
}, 20e3);

// ---------- imágenes del cliente ----------
const MEDIA_DIR = path.join(DATA_DIR, 'ventas-media');
const MAX_IMG_LEIDAS = 5; // imágenes que se leen con IA por tanda
const TANDA_IMG_MS = 30 * 60e3; // fotos dentro de 30 min cuentan como la misma tanda
async function guardarImagen(conv, m) {
  const { inst } = env(conv);
  const media = await evo(`/chat/getBase64FromMediaMessage/${inst}`, { message: { key: m.key, message: m.message }, convertToMp4: false });
  if (!media?.base64) throw new Error('Evolution no devolvió la imagen');
  const mime = String(media.mimetype || 'image/jpeg');
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const dir = path.join(MEDIA_DIR, conv.id);
  fs.mkdirSync(dir, { recursive: true });
  const name = `imagen-${Date.now().toString(36)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(media.base64, 'base64'));
  (conv.imagenes ||= []).push({ archivo: name, ts: Date.now(), texto: m.message?.imageMessage?.caption || '' });
  touchConv(conv);
  // Si su demo ya está en Desarrollo, la imagen entra al proyecto.
  if (!(conv.estado?.cierre?.enviada && Date.now() - conv.estado.cierre.enviada < 14 * 86400e3)) {
    const dev = await import('../desarrollo/proyectos.mjs');
    dev.imagenDeVenta(conv.id, path.join(dir, name)).catch(() => {});
  }
  return { base64: media.base64, mime };
}
export function archivoMedia(convId, archivo) {
  if (!/^[\w-]+$/.test(convId) || !/^[\w.-]+\.(jpg|png|webp)$/.test(archivo)) return null;
  const f = path.join(MEDIA_DIR, convId, archivo);
  return fs.existsSync(f) ? f : null;
}
export const imagenesDe = (convId) => (V.convs[convId]?.imagenes || []).map((i) => path.join(MEDIA_DIR, convId, i.archivo)).filter((f) => fs.existsSync(f));

// ---------- recontacto de cotizaciones pendientes ----------
// Mensajes que Martín redactó y Diego aprobó: salen de a poco (tope diario, en horario, separados)
// y desde ahí el vendedor atiende la conversación con el contexto de la cotización.
let ultimoRecontacto = 0;
setInterval(async () => {
  if (!L.enabled) return;
  const { h, day } = hnNow();
  if (!FU_HOURS.days.includes(day) || h < FU_HOURS.start || h >= FU_HOURS.end) return;
  const rc = await import('./recontacto.mjs');
  const it = rc.siguiente(); // ya respeta el tope diario de cada ritmo
  if (!it) return;
  // Separación: 4 a 8 min con clientes que ya conocen a Cresova; 20 a 30 min con contactos fríos.
  const gap = it.previo ? 4 * 60e3 : 20 * 60e3;
  if (Date.now() < ultimoRecontacto + gap) return;
  ultimoRecontacto = Date.now() + Math.random() * (it.previo ? 4 : 10) * 60e3;
  try { await enviarRecontacto(it, rc); }
  catch (e) { it.error = e.message; log('vendedor', `Recontacto no enviado a ${it.empresa || it.cliente}: ${e.message}`, 'warn'); }
}, 60e3);

// Conversación para un cliente viejo (de antes del bot): la crea si no existe y trae su historial. La usan la
// cobranza y la posventa. Devuelve null si pidió que no lo contactemos o no califica.
export async function convParaTelefono(telefono, titulo) {
  const rc = await import('./recontacto.mjs');
  const tel = rc.telKey(telefono);
  if (!tel || tel.length < 11) throw new Error('Teléfono inválido');
  let conv = rc.convDe(tel);
  if (!conv) {
    conv = newConv({ title: `${titulo || 'Cliente'} · +${tel}`, kind: 'whatsapp', phone: tel });
    conv.followups = { step: 0, next: null };
    conv.outbox = [];
    conv.contacto = { ...(conv.contacto || {}), empresa: titulo || '' };
    await importarHistorial(conv).catch(() => {});
    saveNow();
  }
  if (conv.optOut || conv.estado?.noCalificado) return null;
  return conv;
}

async function enviarRecontacto(it, rc) {
  let conv = rc.convDe(it.tel);
  if (conv?.busy) return;
  if (!conv) {
    conv = newConv({ title: `${it.empresa || it.cliente} · +${it.tel}`, kind: 'whatsapp', phone: it.tel });
    conv.followups = { step: 0, next: null };
    conv.outbox = [];
  }
  await importarHistorial(conv).catch((e) => log('vendedor', `No pude traer el historial de ${it.empresa || it.cliente}: ${e.message}`, 'warn'));
  // Si una persona del equipo ya está hablando con él (o pidió que no lo contactemos), no se le escribe.
  if (conv.optOut || conv.estado?.noCalificado || (conv.pausa && !conv.pausa.existente)) {
    it.estado = 'descartado';
    it.motivo = conv.optOut || conv.estado?.noCalificado ? 'Pidió que no lo contactemos o no califica' : 'Ya lo atiende una persona del equipo';
    saveNow();
    log('vendedor', `Recontacto omitido para ${it.empresa || it.cliente}: ${it.motivo}`, 'warn');
    return;
  }
  conv.pausa = null;
  conv.handoffPending = false;
  conv.recontacto = { nombre: it.empresa || it.cliente, cotizacion: it.cotizacion, total: it.total, moneda: it.moneda, proyecto: it.proyecto, contexto: it.contexto, notas: String(it.notas || '').slice(0, 1200), vendedorAntes: it.vendedor, ts: Date.now() };
  conv.estado.cotizacion ||= it.cotizacion;
  conv.estado.precioDado = true;
  if (it.proyecto === 'demo_sent') conv.estado.demoEnviada ||= Date.parse(it.enviada) || Date.now();
  if (it.empresa) conv.contacto.empresa ||= it.empresa;
  await deliver(conv, it.mensaje, { recontacto: it.cotizacion });
  if (!conv.msgs.some((m) => m.meta?.recontacto === it.cotizacion)) throw new Error('WhatsApp no lo aceptó');
  rc.marcarEnviado(it, conv.id);
  registrarEvento(conv.id, 'recontacto', `Cotización ${it.cotizacion}`);
  // Si ya vio la demo, siguen los toques post-demo (beneficio a los 3 días, llamada con Diego a la semana).
  if (it.proyecto === 'demo_sent') conv.postDemo = { step: 1, next: enVentana(Date.now() + 72 * 3600e3) };
  log('vendedor', `Recontacto enviado a ${it.empresa || it.cliente} (${it.cotizacion})`, 'ok');
  touchConv(conv);
}

// ---------- agenda: lo que el vendedor prometió ("te escribo mañana", "en enero") ----------
setInterval(async () => {
  if (!L.enabled) return;
  const { h, day } = hnNow();
  if (!FU_HOURS.days.includes(day) || h < FU_HOURS.start || h >= FU_HOURS.end) return;
  for (const conv of Object.values(V.convs)) {
    if (conv.kind !== 'whatsapp' || conv.busy) continue;
    const item = (conv.agenda || []).find((a) => !a.hecho && a.at <= Date.now());
    if (!item) continue;
    item.hecho = Date.now();
    const quien = conv.contacto?.empresa || conv.title;
    if (conv.optOut || conv.estado?.noCalificado) { item.resultado = 'omitido: no contactar'; touchConv(conv); break; }
    if (conv.pausa && !conv.pausa.existente) {
      item.resultado = 'pausado';
      avisarDiego(`📅 Hoy tocaba escribirle a *${quien}*: ${item.motivo}. Está en pausa (lo tenés vos), así que no le escribí.`).catch(() => {});
      touchConv(conv);
      break;
    }
    const ult = conv.msgs.at(-1);
    if (ult?.role === 'cliente' && Date.now() - ult.ts < 24 * 3600e3) { item.resultado = 'el cliente escribió primero'; touchConv(conv); break; }
    try {
      const r = await sellerTurn(conv, { proactivo: true, extraSystem: `# SEGUIMIENTO QUE PROMETISTE\nLe dijiste al cliente que le escribirías hoy. Motivo: ${item.motivo}\nEscribile ahora, breve y natural, retomando eso; una sola pregunta al final. No te presentes de nuevo. Si no corresponde escribir, respondé exactamente NO_ENVIAR.` });
      if (/NO_ENVIAR|SIN_RESPUESTA/.test(r.text)) item.resultado = 'no correspondía';
      else {
        const ok = await deliver(conv, r.text, { ...r.meta, agenda: item.id }, { force: true });
        item.resultado = ok ? 'enviado' : 'falló';
        log('vendedor', `Seguimiento prometido ${ok ? 'enviado a' : 'NO enviado a'} ${quien}: ${item.motivo.slice(0, 70)}`, ok ? 'ok' : 'warn');
      }
    } catch (e) { item.resultado = `error: ${e.message}`; log('vendedor', `Seguimiento prometido no enviado a ${quien}: ${e.message}`, 'warn'); }
    finally { touchConv(conv); }
    break; // uno por vuelta
  }
}, 60e3);
export const agendaPendiente = () => Object.values(V.convs).flatMap((c) => (c.agenda || []).filter((a) => !a.hecho).map((a) => ({ conv: c.id, cliente: c.contacto?.empresa || c.title, cuando: new Date(a.at - 6 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), motivo: a.motivo }))).sort((a, b) => a.cuando.localeCompare(b.cuando));

// Diego manda una plantilla a mano desde Ventas (ventana cerrada).
export async function mandarPlantilla(convId, name, paramsExtra = null) {
  const conv = V.convs[convId];
  if (!conv || conv.kind !== 'whatsapp') throw new Error('Conversación de WhatsApp no encontrada.');
  if (!YC.aprobada(name)) throw new Error('Esa plantilla todavía no está aprobada por Meta.');
  const nombre = nombreSaludo(conv);
  const demo = conv.estado?.demoUrl || conv.msgs.slice().reverse().find((m) => m.meta?.demo)?.meta?.demo || '';
  // paramsExtra: null en una posición = el nombre del cliente (ej. [null, enlace] para la reseña).
  const params = paramsExtra ? paramsExtra.map((p) => (p == null ? nombre : String(p))) : name === 'cresova_demo_lista' ? [nombre, demo] : [nombre];
  if (name === 'cresova_demo_lista' && !demo) throw new Error('Este cliente no tiene demo enviada.');
  const r = await YC.enviarPlantilla(destino(conv), name, params);
  const mm = { role: 'equipo', text: textoDe(name, params), ts: Date.now(), desdeOficina: true, meta: { plantilla: name } };
  if (r?.key?.id) { remember(L.sentIds, r.key.id); mm.wid = r.key.id; }
  conv.msgs.push(mm);
  touchConv(conv);
  return { ok: true };
}

// Diego mandó la demo a mano (o desde el teléfono antes de que se registrara): arrancan los seguimientos de la demo.
export function iniciarPostDemo(convId) {
  const conv = V.convs[convId];
  if (!conv || conv.kind !== 'whatsapp') throw new Error('Conversación de WhatsApp no encontrada.');
  conv.estado.demoEnviada ||= Date.now();
  conv.postDemo = { step: 0, next: enVentana(Date.now() + h1(POST_DEMO[0].horas) * 3600e3), manual: Date.now() };
  touchConv(conv);
  log('vendedor', `Seguimientos de la demo activados para ${conv.contacto?.empresa || conv.title}`, 'info');
  return { ok: true, proximo: conv.postDemo.next };
}

// Borrador del próximo seguimiento, SIN mandarlo (para revisar el tono). Trabaja sobre una copia de la conversación.
export async function borradorSeguimiento(convId) {
  const conv = V.convs[convId];
  if (!conv) throw new Error('Conversación no encontrada.');
  const copia = { ...conv, msgs: [...conv.msgs], estado: { ...(conv.estado || {}) } };
  const paso = pasos()[Math.min(conv.followups?.step || 0, pasos().length - 1)];
  const r = await sellerTurn(copia, { proactivo: true, extraSystem: instruccionSeguimiento(copia, paso) });
  return { cliente: conv.title, paso: (conv.followups?.step || 0) + 1, texto: r.text };
}
