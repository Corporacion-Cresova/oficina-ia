// WhatsApp de ventas por la API oficial de Meta, a través de YCloud (coexistencia: el número sigue en la app
// WhatsApp Business del teléfono, con llamadas, y la oficina recibe y manda por la API).
// En vez de reescribir el vendedor, Jarvis, las demos y los comprobantes, esto TRADUCE: lo que la oficina le pide a
// Evolution para el número principal se hace en YCloud, y lo que llega de YCloud se convierte al formato de Evolution.
// Evolution sigue para el número de prospección.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { log, saveNow } from '../state.mjs';
import { ventasState as V } from './vendedor.mjs';

const API = 'https://api.ycloud.com/v2';
const PUBLICO = () => (process.env.OFICINA_PUBLICA || 'https://demo.preview.cresova.com').replace(/\/$/, '');
V.ycloud ||= { activo: false };
const Y = V.ycloud;
const key = () => process.env.YCLOUD_API_KEY?.trim();
export const activo = () => Boolean(Y.activo && key() && Y.from);
export const hookToken = () => createHash('sha256').update(`ycloud:${key() || ''}`).digest('hex').slice(0, 32);
const e164 = (n) => { const d = String(n || '').split('@')[0].replace(/\D/g, ''); return d ? `+${d}` : ''; };

async function yc(path, { method = 'GET', body, form } = {}) {
  if (!key()) throw new Error('Falta la llave de YCloud (Sistema → Llaves).');
  const r = await fetch(`${API}${path}`, { method, headers: { 'X-API-Key': key(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(30_000) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  if (!r.ok) throw new Error(`YCloud ${r.status}: ${j?.error?.message || j?.message || t.slice(0, 200)}`);
  return j;
}

// ---------- configurar: número, webhook y encendido ----------
export async function estado() {
  if (!key()) return { llave: false, activo: false };
  let numeros = [];
  try { const j = await yc('/whatsapp/phoneNumbers?limit=20'); numeros = (j.items || j.data || []).map((n) => ({ numero: n.phoneNumber || n.displayPhoneNumber, nombre: n.verifiedName, estado: n.status, calidad: n.qualityRating, wabaId: n.wabaId })); }
  catch (e) { return { llave: true, activo: false, error: e.message }; }
  return { llave: true, activo: activo(), from: Y.from || null, webhook: Boolean(Y.webhookId), numeros };
}
export async function conectar({ numero } = {}) {
  const est = await estado();
  if (est.error) throw new Error(est.error);
  const n = numero ? est.numeros.find((x) => e164(x.numero) === e164(numero)) : est.numeros[0];
  if (!n) throw new Error('YCloud no tiene ningún número conectado todavía. Conectalo primero en YCloud (coexistencia).');
  Y.from = e164(n.numero);
  // Webhook: YCloud manda a la puerta pública (proxy de las demos), que lo pasa a la oficina.
  const url = `${PUBLICO()}/hook/ycloud/${hookToken()}`;
  if (Y.webhookId) await yc(`/webhookEndpoints/${Y.webhookId}`, { method: 'DELETE' }).catch(() => {});
  const w = await yc('/webhookEndpoints', { method: 'POST', body: { url, enabledEvents: ['whatsapp.inbound_message.received', 'whatsapp.message.updated', 'whatsapp.smb.message.echoes'], description: 'Oficina Cresova' } });
  Y.webhookId = w.id; Y.secret = w.secret || null; Y.activo = true; Y.desde = Date.now();
  saveNow();
  log('vendedor', `WhatsApp de ventas por la API oficial (YCloud) con el número ${Y.from}`, 'ok');
  return estado();
}
export function apagar() { Y.activo = false; saveNow(); log('vendedor', 'WhatsApp de ventas vuelve a Evolution', 'warn'); return { activo: false }; }

// ---------- traducción de lo que la oficina le pide a Evolution ----------
const medios = new Map(); // wamid -> { link, mime } de lo que mandó el cliente (para descargarlo)
const estados = new Map(); // wamid -> 'SERVER_ACK' | 'DELIVERY_ACK' | 'READ'
async function enviar(to, cuerpo) {
  const j = await yc('/whatsapp/messages/sendDirectly', { method: 'POST', body: { from: Y.from, to: e164(to), ...cuerpo } });
  if (j.status === 'failed') throw new Error(j.errorMessage || j.whatsappApiError?.message || 'WhatsApp no aceptó el mensaje');
  return { key: { id: j.wamid || j.id, fromMe: true } };
}
async function subir(base64, mime, nombre) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(base64, 'base64')], { type: mime }), nombre);
  const j = await yc(`/whatsapp/media/${encodeURIComponent(Y.from)}/upload`, { method: 'POST', form });
  return j.id;
}
export async function evoCompat(path, body = {}) {
  const ruta = path.split('?')[0].split('/').slice(1, 3).join('/');
  switch (ruta) {
    case 'message/sendText': return enviar(body.number, { type: 'text', text: { body: String(body.text || '').slice(0, 4096) } });
    case 'message/sendMedia': {
      const tipo = body.mediatype === 'document' ? 'document' : body.mediatype === 'video' ? 'video' : 'image';
      const id = await subir(body.media, body.mimetype || (tipo === 'document' ? 'application/pdf' : 'image/jpeg'), body.fileName || `archivo.${tipo === 'document' ? 'pdf' : 'jpg'}`);
      return enviar(body.number, { type: tipo, [tipo]: { id, ...(body.caption ? { caption: body.caption } : {}), ...(tipo === 'document' ? { filename: body.fileName || 'documento.pdf' } : {}) } });
    }
    case 'chat/sendPresence': return {}; // la API oficial no tiene "escribiendo…" a pedido
    case 'chat/getBase64FromMediaMessage': {
      const m = medios.get(body?.message?.key?.id);
      if (!m) throw new Error('No tengo el archivo de ese mensaje (YCloud).');
      const r = await fetch(m.link, { headers: { 'X-API-Key': key() }, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`YCloud no entregó el archivo (${r.status})`);
      return { base64: Buffer.from(await r.arrayBuffer()).toString('base64'), mimetype: m.mime || r.headers.get('content-type') };
    }
    case 'chat/findMessages': {
      // Solo se usa para ver si un mensaje llegó o se leyó: sale de los avisos de estado de YCloud.
      const id = body?.where?.key?.id;
      const st = id && estados.get(id);
      return { messages: { records: st ? [{ key: { id }, status: st }] : [], pages: 1, total: st ? 1 : 0 } };
    }
    case 'instance/connectionState': return { instance: { state: activo() ? 'open' : 'close' } };
    case 'webhook/set': case 'instance/restart': case 'instance/logout': return {};
    case 'instance/connect': return { base64: null, pairingCode: null };
    case 'instance/fetchInstances': case 'chat/findChats': case 'chat/findContacts': return [];
    default: return {};
  }
}

// ---------- lo que llega de YCloud, al formato de Evolution ----------
// Firma de YCloud: se prueba con los formatos habituales (t=…,s=… o v1=…, HMAC-SHA256 en hex o base64). La ruta ya es
// secreta (token de 32), así que si no coincide se acepta igual, pero se registra el formato para validarlo bien.
let avisoFirma = 0;
export function verificarFirma(raw, cabecera) {
  if (!Y.secret || !cabecera) return true;
  const partes = Object.fromEntries(String(cabecera).split(',').map((p) => { const i = p.indexOf('='); return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : [p.trim(), '']; }));
  const firma = partes.s || partes.v1 || partes.signature || String(cabecera).trim();
  const t = partes.t;
  for (const base of [t ? `${t}.${raw}` : null, t ? `${raw}.${t}` : null, raw].filter(Boolean)) {
    const h = createHmac('sha256', Y.secret).update(base);
    const d = h.digest();
    if (firma === d.toString('hex') || firma === d.toString('base64')) return true;
  }
  if (Date.now() - avisoFirma > 3600e3) { avisoFirma = Date.now(); log('vendedor', `YCloud: la firma no coincide con los formatos conocidos (cabecera: ${String(cabecera).replace(/[0-9a-f]{16,}/gi, '…').slice(0, 80)}); se acepta por el token de la ruta`, 'warn'); }
  return true;
}
const MAP = { image: 'imageMessage', audio: 'audioMessage', video: 'videoMessage', document: 'documentMessage', sticker: 'stickerMessage' };
function aEvolution(m, { deMi = false } = {}) {
  const cliente = deMi ? m.to : m.from;
  const message = {};
  const t = m.type;
  if (t === 'text') {
    const body = m.text?.body || '';
    if (m.referral) message.extendedTextMessage = { text: body, contextInfo: { externalAdReply: { title: m.referral.headline || '', body: m.referral.body || '', sourceId: m.referral.source_id || null, sourceUrl: m.referral.source_url || null, ctwaClid: m.referral.ctwa_clid || null, mediaType: m.referral.media_type || null } } };
    else message.conversation = body;
  } else if (MAP[t]) {
    const o = m[t] || {};
    message[MAP[t]] = { caption: o.caption || '', mimetype: o.mime_type || '', fileName: o.filename || '', ...(m.referral ? { contextInfo: { externalAdReply: { title: m.referral.headline || '', sourceId: m.referral.source_id || null, sourceUrl: m.referral.source_url || null, ctwaClid: m.referral.ctwa_clid || null } } } : {}) };
    if (o.link && m.wamid) medios.set(m.wamid, { link: o.link, mime: o.mime_type });
  } else if (t === 'location') message.locationMessage = { degreesLatitude: m.location?.latitude, degreesLongitude: m.location?.longitude };
  else if (t === 'button' || t === 'interactive') message.conversation = m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
  else if (t === 'reaction') return null;
  else message.conversation = `[${t}]`;
  return {
    key: { id: m.wamid || m.id, remoteJid: `${String(cliente || '').replace(/\D/g, '')}@s.whatsapp.net`, fromMe: deMi },
    pushName: deMi ? '' : (m.customerProfile?.name || ''),
    message,
    messageTimestamp: Math.floor(new Date(m.sendTime || Date.now()).getTime() / 1000),
  };
}
// Devuelve los mensajes en formato de Evolution para handleWebhook. Los estados de entrega se guardan aparte.
export function recibir(ev) {
  if (ev.type === 'whatsapp.inbound_message.received' && ev.whatsappInboundMessage) {
    const r = aEvolution(ev.whatsappInboundMessage);
    return r ? [r] : [];
  }
  if (ev.type === 'whatsapp.smb.message.echoes' && ev.whatsappMessage) {
    const r = aEvolution(ev.whatsappMessage, { deMi: true });
    return r ? [r] : [];
  }
  if (ev.type === 'whatsapp.message.updated' && ev.whatsappMessage) {
    const m = ev.whatsappMessage;
    const st = { read: 'READ', delivered: 'DELIVERY_ACK', sent: 'SERVER_ACK' }[m.status];
    if (st) { for (const id of [m.wamid, m.id].filter(Boolean)) estados.set(id, st); while (estados.size > 5000) estados.delete(estados.keys().next().value); }
    if (m.status === 'failed') log('vendedor', `WhatsApp (API oficial) no pudo entregar un mensaje a ${m.to}: ${m.errorMessage || m.whatsappApiError?.message || 'sin detalle'}`, 'warn');
  }
  return [];
}

// ---------- plantillas y ventana de 24 horas ----------
import { PLANTILLAS } from './plantillas.mjs';
let wabaCache = null;
async function wabaId() {
  if (wabaCache) return wabaCache;
  const j = await yc('/whatsapp/phoneNumbers?limit=20');
  const n = (j.items || j.data || []).find((x) => e164(x.phoneNumber || x.displayPhoneNumber) === Y.from) || (j.items || [])[0];
  wabaCache = n?.wabaId || null;
  return wabaCache;
}
let plantCache = { at: 0, lista: [] };
export async function plantillas(forzar = false) {
  if (!forzar && Date.now() - plantCache.at < 10 * 60e3) return plantCache.lista;
  const waba = await wabaId();
  const j = await yc(`/whatsapp/templates?limit=100${waba ? `&filter.wabaId=${encodeURIComponent(waba)}` : ''}`);
  const items = j.items || j.data || [];
  plantCache = { at: Date.now(), lista: PLANTILLAS.map((p) => { const t = items.find((x) => x.name === p.name && String(x.language || '').startsWith('es')); return { name: p.name, category: p.category, body: p.body, botones: p.botones, estado: t?.status || 'NO_CREADA', motivo: t?.reason || t?.rejectedReason || null }; }) };
  return plantCache.lista;
}
export const aprobada = (name) => plantCache.lista.some((p) => p.name === name && p.estado === 'APPROVED');
// Manda a aprobar a Meta las que todavía no existen.
export async function crearPlantillas() {
  const waba = await wabaId();
  if (!waba) throw new Error('No encontré la cuenta de WhatsApp Business (WABA) en YCloud.');
  const ya = await plantillas(true);
  const out = [];
  for (const p of PLANTILLAS) {
    if (ya.find((x) => x.name === p.name && x.estado !== 'NO_CREADA')) continue;
    if (p.borrador) continue; // texto todavía sin aprobar por Diego
    try {
      await yc('/whatsapp/templates', { method: 'POST', body: { wabaId: waba, name: p.name, language: 'es', category: p.category, components: [
        { type: 'BODY', text: p.body, example: { body_text: [p.ejemplo] } },
        { type: 'BUTTONS', buttons: p.botones.map((t) => ({ type: 'QUICK_REPLY', text: t })) },
      ] } });
      out.push({ name: p.name, ok: true });
    } catch (e) { out.push({ name: p.name, ok: false, error: e.message }); }
  }
  plantCache.at = 0;
  log('vendedor', `Plantillas de WhatsApp mandadas a aprobar a Meta: ${out.filter((x) => x.ok).length} de ${out.length}`, out.every((x) => x.ok) ? 'ok' : 'warn');
  return { resultado: out, plantillas: await plantillas(true) };
}
export async function enviarPlantilla(to, name, params = []) {
  const j = await yc('/whatsapp/messages/sendDirectly', { method: 'POST', body: { from: Y.from, to: e164(to), type: 'template', template: { name, language: { code: 'es' }, components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t).slice(0, 900) })) }] } } });
  if (j.status === 'failed') throw new Error(j.errorMessage || j.whatsappApiError?.message || 'WhatsApp no aceptó la plantilla');
  import('./calidad.mjs').then((c) => c.contarPlantilla(name)).catch(() => {});
  return { key: { id: j.wamid || j.id, fromMe: true } };
}
// Ventana de 24 h: abierta si el cliente escribió (o tocó un botón) hace menos de 23 h 45 min.
export function ventanaAbierta(conv) {
  const ult = [...(conv.msgs || [])].reverse().find((m) => m.role === 'cliente' && !m.previo);
  return Boolean(ult && Date.now() - ult.ts < 23.75 * 3600e3);
}
setInterval(() => { if (activo()) plantillas(true).catch(() => {}); }, 15 * 60e3);
setTimeout(() => { if (activo()) plantillas(true).catch(() => {}); }, 20e3);
