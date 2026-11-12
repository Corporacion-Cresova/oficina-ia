// Compromisos del cliente (Fase 1, 11 nov 2026). Lo que el cliente dijo que iba a hacer ("lo consulto con mis
// ingenieros", "el viernes deposito", "mañana le mando el logo") queda anotado con la fecha en que toca preguntarle.
// Caso de origen: Elvin Ayestas dijo que iba a mostrar su demo a sus ingenieros y nadie le volvió a escribir en 2 días.
// Lo lee Gemini 30 s después de que el cliente escribe. Esta fase SOLO anota y muestra (ficha, Llamadas, CEO):
// no le escribe a ningún cliente.
// Estado (lo calcula el código, no la IA):
//   futuro     todavía no llega la fecha de revisar
//   toca       llegó la fecha y nadie de Cresova le escribió después
//   preguntado ya le escribimos (bot o Diego) y el cliente no ha contestado
import { state, log, saveNow } from '../state.mjs';
import { textoGemini } from './imagen.mjs';

const DIA = 864e5;
const HN = 6 * 3600e3;
const V = () => state.ventas || {};
const fechaHN = (ts = Date.now()) => new Date(ts - HN).toISOString().slice(0, 10);
const inicioDia = (f) => Date.parse(`${f}T06:00:00Z`); // 00:00 en Honduras
const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || '')) && !Number.isNaN(Date.parse(f));
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const CONFIANZAS = ['alta', 'media', 'baja'];
const TIPOS = ['pago', 'consulta', 'material', 'demo', 'reunion', 'otro'];

// Días hábiles: lunes a sábado.
export function sumarHabiles(f, n) {
  const d = new Date(`${f}T12:00:00Z`);
  for (let k = 0; k < n;) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0) k++; }
  return d.toISOString().slice(0, 10);
}

const reales = (conv) => (conv.msgs || []).filter((m) => !m.previo && m.role !== 'sistema');
const ultimoCliente = (conv) => reales(conv).filter((m) => m.role === 'cliente').at(-1);

function promptPara(conv) {
  const ahora = new Date(Date.now() - HN);
  const desde = Date.now() - 37 * DIA;
  const rol = { cliente: 'CLIENTE', bot: 'CRESOVA(bot)', equipo: 'CRESOVA(Diego)' };
  const chat = reales(conv).filter((m) => m.ts >= desde).slice(-40).map((m) => {
    const d = new Date(m.ts - HN);
    return `[${DIAS[d.getUTCDay()].slice(0, 3)} ${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}] ${rol[m.role] || m.role}: ${String(m.text || '').slice(0, 300)}`;
  }).join('\n');
  return `Hoy es ${DIAS[ahora.getUTCDay()]} ${fechaHN()}, ${ahora.toISOString().slice(11, 16)} (hora de Honduras). Días hábiles: lunes a sábado.
Este es un chat de WhatsApp entre Cresova (agencia de páginas web en Honduras) y un cliente.

${chat}

Pregunta: ¿quedó ABIERTO un compromiso del CLIENTE? Es algo que el cliente dijo que iba a hacer, que define si la venta avanza, y que todavía no hizo en el chat.
Ejemplos: consultarlo con su socio, esposa o ingenieros; pagar o depositar ("el viernes deposito"); mandar el logo, fotos o información; revisar la demo con calma y avisar; avisar cuando tenga el dinero; confirmar una reunión.
NO cuenta:
- "gracias", "ok", "perfecto" solos, saludos o preguntas.
- Lo que el cliente ya cumplió más adelante en el chat (por ejemplo, dijo que mandaría fotos y las mandó).
- Promesas de Cresova (del bot o de Diego). Esas se siguen aparte.
- Un "no me interesa" claro.
- Temas de soporte o de un proyecto que ya se está haciendo o ya se entregó (correos, accesos, ajustes, revisar algo técnico): eso lo sigue Diego, no es parte de la venta.
Si después del compromiso el cliente volvió a escribir y lo resolvió o lo cambió, usá solo lo más reciente.

revisar_el: si dio una fecha, el día hábil siguiente a esa fecha. Si no dio fecha, 2 días hábiles después del mensaje. Si dijo algo como "la próxima semana" o "en enero", el primer día hábil de ese período.
pregunta: una sola pregunta corta, tuteando, que retome justo ese compromiso. Sin presionar. Sin saludo (el saludo lo pone el sistema).
recordatorio: lo que quedó pendiente dicho al cliente, tuteando, en minúscula, máximo 10 palabras y sin punto final. Ejemplo: "mostrarle la demo a tus ingenieros" o "el depósito del anticipo".
tipo: pago (pagar, depositar, anticipo), consulta (consultarlo con alguien), material (mandar logo, fotos, textos o información), demo (revisar la demo), reunion (confirmar o tener una reunión o llamada) u otro.
delicado: true si el motivo es de salud, un duelo, un problema familiar o algo personal (ahí la pregunta la hace una persona con cuidado).

Respondé solo este JSON:
{"hay": true|false, "que": "máximo 12 palabras", "cita": "palabras exactas del cliente", "dicho_el": "YYYY-MM-DD", "fecha_dicha": "YYYY-MM-DD o null", "revisar_el": "YYYY-MM-DD", "pregunta": "...", "recordatorio": "...", "tipo": "pago|consulta|material|demo|reunion|otro", "confianza": "alta|media|baja", "delicado": true|false}
Si hay=false, mandá solo {"hay": false}.`;
}

async function conOpenRouter(prompt) {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.TRANSCRIBE_MODEL || 'google/gemini-3.5-flash-lite', temperature: 0, max_tokens: 700, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) return null;
    return String((await r.json()).choices?.[0]?.message?.content || '').trim() || null;
  } catch { return null; }
}

// Le pregunta a la IA. Devuelve null si no se pudo leer (no se toca nada), {hay:false} o el compromiso limpio.
export async function leer(conv) {
  if (!ultimoCliente(conv)) return { hay: false };
  const prompt = promptPara(conv);
  // Gemini directo corta por límite de velocidad cuando se leen muchos chats seguidos (66 de 89 fallaron en la
  // primera carga): un reintento a los 15 s y, si sigue sin responder, el mismo tipo de modelo por OpenRouter.
  let t = await textoGemini(prompt).catch(() => null);
  if (!t) { await new Promise((ok) => setTimeout(ok, 15_000)); t = await textoGemini(prompt).catch(() => null); }
  if (!t) t = await conOpenRouter(prompt);
  if (!t) return null;
  let j;
  try { j = JSON.parse(String(t).replace(/```(json)?/g, '').trim()); } catch { return null; }
  if (!j || j.hay !== true) return { hay: false };
  // Las fechas de la IA se corrigen si traen otro año (pasó: "2020-11-03"): mismo día y mes en el año correcto, y
  // si aun así no caen en un rango con sentido, la regla fija.
  const hoy = fechaHN();
  const anio = (f) => { if (!esFecha(f)) return null; const g = `${hoy.slice(0, 4)}${f.slice(4)}`; return esFecha(g) ? g : null; };
  let dicho = anio(j.dicho_el);
  if (!dicho || dicho > hoy || Date.parse(hoy) - Date.parse(dicho) > 40 * DIA) dicho = fechaHN(ultimoCliente(conv).ts);
  let dicha = esFecha(j.fecha_dicha) ? j.fecha_dicha : null;
  if (dicha && dicha < dicho) dicha = anio(dicha);
  if (dicha && dicha < dicho) dicha = null;
  let revisar = esFecha(j.revisar_el) ? j.revisar_el : null;
  if (revisar && revisar < dicho) revisar = anio(revisar);
  // La fecha de la IA se acepta si tiene sentido (no antes de lo dicho, no a más de 4 meses); si no, la regla fija.
  if (!revisar || revisar < dicho || Date.parse(revisar) - Date.parse(dicho) > 120 * DIA) revisar = dicha ? sumarHabiles(dicha, 1) : sumarHabiles(dicho, 2);
  return {
    hay: true,
    que: String(j.que || '').slice(0, 120),
    cita: String(j.cita || '').slice(0, 240),
    dicho_el: dicho,
    fecha_dicha: dicha,
    revisar_el: revisar,
    pregunta: String(j.pregunta || '').slice(0, 240),
    recordatorio: String(j.recordatorio || '').replace(/[\n\r]+/g, ' ').replace(/[.\s]+$/, '').slice(0, 80),
    tipo: TIPOS.includes(j.tipo) ? j.tipo : 'otro',
    confianza: CONFIANZAS.includes(j.confianza) ? j.confianza : 'media',
    delicado: j.delicado === true,
  };
}

// Guarda lo leído en el chat. Si ya no hay compromiso, el anterior pasa al historial como cerrado.
export function aplicar(conv, r, { leidoHasta = ultimoCliente(conv)?.ts || Date.now() } = {}) {
  if (!r) return false;
  const e = (conv.estado ||= {});
  e.compromisoLeido = leidoHasta;
  const prev = e.compromiso;
  if (!r.hay) {
    if (!prev) return false;
    e.compromisos = [...(e.compromisos || []), { ...prev, cerrado: Date.now(), como: 'el cliente respondió' }].slice(-10);
    delete e.compromiso;
    log('vendedor', `${conv.title}: compromiso cerrado ("${prev.que}")`, 'info');
    return true;
  }
  // El mismo compromiso: no se reinicia la fecha ni el seguimiento; solo se completan campos nuevos.
  if (prev && prev.que === r.que && prev.revisar_el === r.revisar_el) {
    const faltan = ['recordatorio', 'tipo'].filter((x) => !prev[x] && r[x]);
    for (const x of faltan) prev[x] = r[x];
    return faltan.length > 0;
  }
  if (prev) e.compromisos = [...(e.compromisos || []), { ...prev, cerrado: Date.now(), como: 'lo reemplazó uno nuevo' }].slice(-10);
  // Si es el mismo compromiso releído (mismo día o misma cita), conserva el seguimiento que ya salió.
  const mismo = prev && (prev.dicho_el === r.dicho_el || prev.cita === r.cita);
  e.compromiso = { ...r, ts: Date.now(), ...(mismo && prev.seguimiento ? { seguimiento: prev.seguimiento } : {}) };
  delete e.compromiso.hay;
  log('vendedor', `${conv.title}: compromiso del cliente anotado ("${r.que}", revisar el ${r.revisar_el})`, 'info');
  if (r.tipo === 'reunion' && !mismo) revisarReunion(conv, r);
  return true;
}

// El cliente pidió una reunión: si a los 15 min nadie le contestó, el bot le ofrece horarios del calendario de Diego.
// Solo para pedidos recientes (no en la carga inicial de chats viejos) y de 7:00 a 21:00.
function revisarReunion(conv, r) {
  const u = ultimoCliente(conv);
  if (!u || Date.now() - u.ts > 3 * 3600e3) return;
  setTimeout(async () => {
    try {
      const e = conv.estado || {};
      const h = new Date(Date.now() - HN).getUTCHours();
      if (h < 7 || h >= 21 || e.compromiso?.tipo !== 'reunion') return;
      if (e.reunion?.estado === 'agendada' && e.reunion.inicio > Date.now()) return;
      if (e.reunionOfrecida && Date.now() - e.reunionOfrecida.ts < 2 * DIA) return;
      const ult = reales(conv).at(-1);
      if (!ult || ult.role !== 'cliente') return; // alguien ya le contestó (Diego o el bot)
      const w = await import('./whatsapp.mjs');
      await w.ofrecerReunionAuto(conv.id, r.cita);
      saveNow();
    } catch (err) { log('vendedor', `Reunión automática: ${err.message}`, 'warn'); }
  }, 15 * 60e3);
}

// Se llama cada vez que el cliente escribe: espera 30 s para leer con todos sus mensajes juntos.
const esperas = new Map();
export function programar(conv) {
  if (conv.kind !== 'whatsapp' || conv.optOut) return;
  clearTimeout(esperas.get(conv.id));
  esperas.set(conv.id, setTimeout(async () => {
    esperas.delete(conv.id);
    const hasta = ultimoCliente(conv)?.ts;
    const r = await leer(conv).catch(() => null);
    if (aplicar(conv, r, { leidoHasta: hasta })) saveNow();
  }, 30_000));
}

const esGenerico = (m) => !m.meta?.compromiso && !m.meta?.reunion && Boolean(m.meta && (m.meta.fijo || m.meta.plantilla || m.meta.anticipo || m.meta.seguimiento || m.meta.seguimientoDemo || m.meta.recontacto || m.meta.acuse || m.meta.puente));

export function estadoDe(conv) {
  const c = conv.estado?.compromiso;
  if (!c) return null;
  const hoy = fechaHN();
  if (hoy < c.revisar_el) return 'futuro';
  // Ya le preguntamos: Cresova le escribió desde el día siguiente al compromiso (el "perfecto, quedo a la espera"
  // del mismo día no cuenta como seguimiento).
  // Los avisos genéricos automáticos (recordatorio del anticipo, plantillas de secuencia, acuses) no cuentan: no
  // preguntan por lo que el cliente dijo.
  const corte = Math.min(inicioDia(c.revisar_el), inicioDia(c.dicho_el) + DIA);
  const preguntamos = reales(conv).some((m) => m.ts >= corte && (m.role === 'equipo' || (m.role === 'bot' && !esGenerico(m))));
  return preguntamos ? 'preguntado' : 'toca';
}

export const NOMBRE_ESTADO = { futuro: 'Todavía no toca', toca: 'Toca preguntar', preguntado: 'Ya le preguntamos, no responde' };

// Todos los compromisos abiertos, con su estado. Para Llamadas, la ficha y el CEO.
export function abiertos() {
  const out = [];
  for (const c of Object.values(V().convs || {})) {
    if (c.kind !== 'whatsapp' || c.optOut || !c.estado?.compromiso) continue;
    if (c.estado?.resultado?.tipo === 'ganado') continue;
    const k = c.estado.compromiso;
    const estado = estadoDe(c);
    const dias = Math.max(0, Math.floor((Date.now() - inicioDia(k.revisar_el)) / DIA));
    out.push({ conv: c.id, cliente: c.contacto?.empresa || c.contacto?.nombre || c.title, telefono: String(c.phone || '').replace(/^lid:/, ''), ...k, estado, dias_vencido: estado === 'futuro' ? 0 : dias, pausa_total: Boolean(c.pausa?.total), ya_cliente: pagados.ok ? pagados.set.has(ult8(c.phone)) : null });
  }
  const orden = { toca: 0, preguntado: 1, futuro: 2 };
  return out.sort((a, b) => orden[a.estado] - orden[b.estado] || a.revisar_el.localeCompare(b.revisar_el));
}

export function resumen() {
  const l = abiertos();
  return { toca: l.filter((x) => x.estado === 'toca').length, preguntado: l.filter((x) => x.estado === 'preguntado').length, futuro: l.filter((x) => x.estado === 'futuro').length, lista: l.filter((x) => x.estado !== 'futuro').slice(0, 12).map((x) => ({ cliente: x.cliente, que: x.que, cita: x.cita, revisar_el: x.revisar_el, estado: x.estado, confianza: x.confianza, delicado: x.delicado, pregunta: x.pregunta })) };
}

// Primera carga (y para volver a correrla a mano): lee los chats donde el cliente escribió en los últimos N días y
// que no se han leído desde su último mensaje. Una lectura cada 4 s para no saturar Gemini. Solo anota.
let cargando = false;
export async function cargaInicial({ dias = 30, seco = false, forzar = false } = {}) {
  if (cargando) return { ok: false, error: 'Ya se está corriendo.' };
  cargando = true;
  const desde = Date.now() - dias * DIA;
  const res = { leidos: 0, con_compromiso: 0, fallaron: 0, encontrados: [] };
  try {
    for (const c of Object.values(V().convs || {})) {
      const u = ultimoCliente(c);
      if (c.kind !== 'whatsapp' || c.optOut || !u || u.ts < desde) continue;
      if (!seco && !forzar && c.estado?.compromisoLeido >= u.ts) continue;
      const r = await leer(c).catch(() => null);
      res.leidos++;
      if (!r) { res.fallaron++; continue; }
      if (r.hay) { res.con_compromiso++; res.encontrados.push({ cliente: c.contacto?.empresa || c.contacto?.nombre || c.title, ...r }); }
      if (!seco) aplicar(c, r, { leidoHasta: u.ts });
      await new Promise((ok) => setTimeout(ok, 6000));
    }
    if (!seco) saveNow();
    log('vendedor', `Compromisos${seco ? ' (prueba en seco)' : ''}: ${res.leidos} chats leídos, ${res.con_compromiso} con compromiso, ${res.fallaron} sin lectura`, 'info');
  } finally { cargando = false; }
  return { ok: true, seco, ...res };
}
// Al arrancar la oficina, una vez por versión: anota los compromisos de los chats de los últimos 30 días.
// Versión 2 (Fase 2): vuelve a leer todo para sumar "recordatorio" y "tipo", que usa el envío automático.
const VERSION_CARGA = 4; // 3: Gemini no respondió en la mayoría; 4: fechas con el año equivocado
setTimeout(() => {
  const v = V();
  if (!v.convs || v.compromisosVersion >= VERSION_CARGA) return;
  v.compromisosVersion = VERSION_CARGA;
  v.compromisosCargados = Date.now();
  saveNow();
  cargaInicial({ dias: 30, forzar: true }).catch((e) => log('vendedor', `Compromisos: la carga inicial falló: ${e.message}`, 'warn'));
}, 120_000);

// ---------- Fase 2 (11 nov 2026): el seguimiento sale solo ----------
// Cuando llega la fecha y nadie le preguntó, el bot le escribe al cliente por ESE compromiso. Con la ventana de 24 h
// abierta sale la pregunta tal cual; cerrada, la plantilla "cresova_compromiso" (si Meta ya la aprobó) o la más
// parecida según el tipo. Una sola vez por compromiso. Si no contesta, a los 3 días hábiles pasa a Llamadas.
// Nunca: confianza baja, casos delicados (salud, duelo), pausa total, contacto que ya existía, pidió no ser contactado,
// ya es cliente (pagó o aceptó una cotización en la base), sin plantilla que hable de eso, Diego le
// escribió en las últimas 24 h, el bot le escribió en las últimas 20 h, vencido hace más de 7 días.
// Límites: lunes a sábado de 9:00 a 18:00 (Honduras), máximo 8 por día. Se apaga con config.compromisosAuto = false.
const AUTO = { maxDia: 8, desde: 9, hasta: 18, maxVencido: 7 };

function textoSeguimiento(conv, k, nombre) {
  let p = String(k.pregunta || '').trim();
  if (!p) return null;
  if (nombre !== 'qué tal' && p.toLowerCase().startsWith(nombre.toLowerCase())) return `Hola ${p}`; // "Elvin, ¿qué te dijo…?"
  const i = p.startsWith('¿') ? 1 : 0;
  p = p.slice(0, i) + p.charAt(i).toLowerCase() + p.slice(i + 1);
  return nombre === 'qué tal' ? `Hola, ${p}` : `Hola ${nombre}, ${p}`;
}

// Clientes que ya pagaron algo (o aceptaron una cotización): con ellos el compromiso suele ser de soporte o del
// proyecto ("ahorita reviso los correos") y no se les escribe solo. Se lee de la base cada 10 min.
const ult8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const pagados = { set: new Set(), ts: 0, ok: false };
async function cargarPagados() {
  if (Date.now() - pagados.ts < 10 * 60e3) return;
  try {
    const cdb = await import('../cresova/db.mjs');
    if (!cdb.enUso()) return;
    const rows = await cdb.q(`select qq.client_phone, c.phone as c_phone from quotes qq left join clients c on c.id = qq.client_id
      where qq.status = 'accepted' or exists (select 1 from quote_payments p where p.quote_id = qq.id)`);
    pagados.set = new Set(rows.flatMap((r) => [ult8(r.client_phone), ult8(r.c_phone)]).filter((x) => x.length === 8));
    pagados.ts = Date.now(); pagados.ok = true;
  } catch (e) { pagados.ok = false; log('vendedor', `Compromisos: no se pudo leer quién ya pagó (${e.message}); no sale ninguno`, 'warn'); }
}
// ¿Hay plantilla que hable de lo mismo si la ventana de 24 h está cerrada?
async function hayPlantilla(conv, k) {
  const ultCli = ultimoCliente(conv);
  if (ultCli && Date.now() - ultCli.ts < 23 * 3600e3) return true; // ventana abierta: sale la pregunta tal cual
  const [{ plantillaPara }, YC] = await Promise.all([import('./plantillas.mjs'), import('./ycloud.mjs')]);
  const p = plantillaPara(conv, { compromiso: { recordatorio: k.recordatorio || '', tipo: k.tipo || 'otro', demo: Boolean(conv.estado?.demoUrl) } });
  if (!p) return false;
  if (YC.aprobada(p.name)) return true;
  return Boolean(p.respaldo && YC.aprobada(p.respaldo.name));
}

// Por qué un compromiso NO sale solo (null = sí sale).
function motivoNo(conv, k, ahora = Date.now()) {
  if (k.estado !== 'toca') return k.estado === 'preguntado' ? 'ya le preguntamos' : 'todavía no toca';
  if (k.seguimiento) return 'ya se le mandó el seguimiento';
  if (k.confianza === 'baja') return 'la IA no está segura';
  if (k.delicado) return 'es delicado: lo pregunta una persona';
  if (k.pausa_total || conv.pausa?.total) return 'chat en pausa total';
  if (conv.optOut) return 'pidió que no lo contactemos';
  if (conv.estado?.cierre?.comprobante || conv.estado?.cierre?.validado || conv.estado?.resultado) return 'ya pagó o el caso está cerrado';
  if (!pagados.ok) return 'no se pudo revisar si ya es cliente';
  if (pagados.set.has(ult8(conv.phone)) || conv.estado?.posventa) return 'ya es cliente (tiene pagos o ya se le entregó): lo sigue Diego';
  if (conv.pausa?.existente) return 'contacto que ya existía: el vendedor no lo atiende';
  if (k.dias_vencido > AUTO.maxVencido) return `vencido hace ${k.dias_vencido} días (muy viejo para escribir solo)`;
  const ms = reales(conv);
  if (ms.some((m) => m.role === 'equipo' && ahora - m.ts < DIA)) return 'Diego le escribió en las últimas 24 h';
  if (ms.some((m) => m.role === 'bot' && ahora - m.ts < 20 * 3600e3)) return 'el bot le escribió en las últimas 20 h';
  if (ms.some((m) => m.role === 'cliente' && ahora - m.ts < 2 * 3600e3)) return 'el cliente escribió hace menos de 2 h';
  return null;
}

let siguiendo = false;
export async function seguirCompromisos({ seco = false } = {}) {
  const v = V();
  const cfg = (v.config ||= {});
  if (!seco && cfg.compromisosAuto === false) return { ok: false, apagado: true };
  const h = new Date(Date.now() - HN);
  const enHorario = h.getUTCDay() !== 0 && h.getUTCHours() >= AUTO.desde && h.getUTCHours() < AUTO.hasta;
  if (!seco && !enHorario) return { ok: false, fuera_de_horario: true };
  if (siguiendo) return { ok: false, error: 'Ya está corriendo.' };
  siguiendo = true;
  const out = { enviados: [], saltados: [], seco };
  try {
    const hoy = fechaHN();
    v.compromisosEnvios = (v.compromisosEnvios || []).filter((t) => Date.now() - t < 3 * DIA);
    let cupo = AUTO.maxDia - v.compromisosEnvios.filter((t) => fechaHN(t) === hoy).length;
    const { nombreSaludo } = await import('./plantillas.mjs');
    await cargarPagados();
    for (const k of abiertos()) {
      const conv = V().convs?.[k.conv];
      if (!conv) continue;
      const no = motivoNo(conv, k) || (await hayPlantilla(conv, k) ? null : 'ventana cerrada y no hay plantilla que hable de eso: va a Llamadas');
      if (no) { if (k.estado === 'toca') out.saltados.push({ cliente: k.cliente, motivo: no }); continue; }
      const texto = textoSeguimiento(conv, k, nombreSaludo(conv));
      if (!texto) { out.saltados.push({ cliente: k.cliente, motivo: 'sin pregunta' }); continue; }
      if (cupo <= 0) { out.saltados.push({ cliente: k.cliente, motivo: `ya salieron ${AUTO.maxDia} hoy` }); continue; }
      if (seco) { out.enviados.push({ cliente: k.cliente, texto, recordatorio: k.recordatorio, tipo: k.tipo }); cupo--; continue; }
      const wa = await import('./whatsapp.mjs');
      const r = await wa.seguirCompromiso(conv.id, texto, { recordatorio: k.recordatorio || '', tipo: k.tipo || 'otro', cita: k.cita, demo: Boolean(conv.estado?.demoUrl) }).catch((e) => ({ ok: false, error: e.message }));
      conv.estado.compromiso.seguimiento = { ts: Date.now(), ok: Boolean(r?.ok), via: r?.via || null, texto: r?.texto || texto };
      v.compromisosEnvios.push(Date.now());
      cupo--;
      out.enviados.push({ cliente: k.cliente, ok: Boolean(r?.ok), via: r?.via, texto: r?.texto || texto, error: r?.error });
      saveNow();
      await new Promise((ok) => setTimeout(ok, 20_000));
    }
  } finally { siguiendo = false; }
  if (!seco && out.enviados.length) log('vendedor', `Compromisos: ${out.enviados.filter((x) => x.ok).length} seguimiento(s) enviado(s) solos`, 'info');
  return { ok: true, ...out };
}
setInterval(() => { seguirCompromisos().catch((e) => log('vendedor', `Compromisos: el seguimiento automático falló: ${e.message}`, 'warn')); }, 10 * 60e3);

export function configurarAuto(activo) {
  const cfg = (V().config ||= {});
  cfg.compromisosAuto = Boolean(activo);
  saveNow();
  log('vendedor', `Seguimiento automático de compromisos ${activo ? 'encendido' : 'apagado'}`, 'info');
  return { ok: true, activo: cfg.compromisosAuto };
}
