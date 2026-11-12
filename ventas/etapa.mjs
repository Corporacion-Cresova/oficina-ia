// Etapa de venta de cada cliente después de la demo: UNA sola definición que usan el pipeline, las llamadas, los
// seguimientos, el CEO, las pruebas A/B y los reportes.
// Cada cliente queda en la etapa más avanzada: pagó > comprobante > cuenta enviada > su respuesta a la demo.
import { state, log, saveNow } from '../state.mjs';
import { textoGemini } from './imagen.mjs';

export const ETAPAS_VENTA = { enviada: 'Demo enviada', respondio: 'Respondió', gusto: 'Le gustó', cambios: 'Pidió cambios', dudas: 'Tiene dudas', nointeresa: 'No le interesó', cuenta: 'Cuenta enviada', comprobante: 'Comprobante recibido', pago: 'Pagó' };
export const AVANZADAS = ['cuenta', 'comprobante', 'pago'];
const DIA = 864e5;
const V = () => state.ventas || {};

// Pagos registrados en la base: se refrescan cada 5 minutos para que el cálculo sea instantáneo.
let pagadas = new Set();
export async function refrescarPagos() {
  try {
    const db = await import('../cresova/db.mjs');
    if (!db.enUso()) return;
    pagadas = new Set((await db.q('select distinct qq.quote_number from quotes qq join quote_payments p on p.quote_id = qq.id')).map((r) => r.quote_number));
  } catch {}
}
setTimeout(refrescarPagos, 5000);
setInterval(refrescarPagos, 5 * 60e3);

// Cuándo le llegó la cuenta: por la herramienta del bot, por Martín, o porque un mensaje (también desde el teléfono)
// trae el número de cuenta. La plantilla "¿te comparto los datos?" no cuenta: ahí todavía no se mandó la cuenta.
function numerosCuenta() {
  return [...new Set(String(V().config?.cuentaAnticipo || '').match(/\d[\d-]{5,}\d/g) || [])].map((n) => n.replace(/-/g, ''));
}
export function cuentaTs(conv) {
  if (conv.estado?.cierre?.enviada) return conv.estado.cierre.enviada;
  const nums = numerosCuenta();
  const m = (conv.msgs || []).find((x) => ['bot', 'equipo'].includes(x.role) && (x.meta?.cuentaAnticipo || x.meta?.imagenCuenta || (nums.length && nums.some((n) => String(x.text || '').replace(/-/g, '').includes(n)))));
  return m?.ts || null;
}

export function etapaDe(conv) {
  const e = conv.estado || {};
  if (e.cierre?.validado || e.resultado?.tipo === 'ganado' || (e.cotizacion && pagadas.has(e.cotizacion))) return 'pago';
  if (e.cierre?.comprobante) return 'comprobante';
  if (cuentaTs(conv)) return 'cuenta';
  if (!e.demoEnviada) return null;
  if (e.demoArchivada) return 'nointeresa';
  const r = e.respuestaDemo;
  if (r && r.ts >= e.demoEnviada) {
    const t = { gusta: 'gusto', cambios: 'cambios', objecion: 'dudas', no: 'nointeresa' }[r.tipo];
    if (t) return t;
  }
  const respondio = (conv.msgs || []).some((m) => m.role === 'cliente' && !m.auto && !m.previo && m.ts > e.demoEnviada);
  return respondio ? 'respondio' : 'enviada';
}
export const etapaNombre = (conv) => ETAPAS_VENTA[etapaDe(conv)] || null;

// Foto del embudo: clientes cuya demo o cuenta es de los últimos N días, por etapa.
export function resumenEmbudo(dias = 30) {
  const desde = Date.now() - dias * DIA;
  const n = Object.fromEntries(Object.keys(ETAPAS_VENTA).map((k) => [k, 0]));
  for (const c of Object.values(V().convs || {})) {
    if (c.kind !== 'whatsapp') continue;
    const et = etapaDe(c);
    if (et && Math.max(c.estado?.demoEnviada || 0, cuentaTs(c) || 0) > desde) n[et]++;
  }
  return n;
}

// ---------- La IA lee qué quiso decir el cliente con su respuesta a la demo ----------
const TIPOS = ['gusta', 'cambios', 'objecion', 'no', 'neutro'];
export async function leerRespuesta(conv) {
  const e = conv.estado || {};
  if (!e.demoEnviada) return null;
  const desde = e.demoEnviada;
  const trozo = (conv.msgs || []).filter((m) => m.ts >= desde && !m.previo && m.role !== 'sistema' && !m.auto).slice(-14);
  if (!trozo.some((m) => m.role === 'cliente')) return null;
  const chat = trozo.map((m) => `${m.role === 'cliente' ? 'CLIENTE' : 'CRESOVA'}: ${String(m.text).slice(0, 400)}`).join('\n');
  const prompt = `A un cliente de Honduras le mandamos una demo de su página web. Esta es la conversación desde entonces:

${chat}

Clasificá la postura ACTUAL del cliente sobre la demo, según sus últimos mensajes:
- gusta: le gustó o quiere avanzar, o pregunta cómo pagar.
- cambios: quiere ajustes concretos a la demo, aunque le haya gustado.
- objecion: tiene una duda o freno (precio, tiempo, consultarlo, "lo pienso"), aunque diga que le gustó.
- no: dijo que no le interesa.
- neutro: todavía no dijo qué le pareció (saludos, "la voy a ver", preguntas sueltas).
No supongas nada que el cliente no haya dicho.
Respondé solo este JSON: {"tipo":"gusta|cambios|objecion|no|neutro","motivo":"máximo 12 palabras"}`;
  const t = await textoGemini(prompt).catch(() => null);
  if (!t) return null;
  try {
    const j = JSON.parse(String(t).replace(/```(json)?/g, '').trim());
    return TIPOS.includes(j.tipo) ? { tipo: j.tipo, motivo: String(j.motivo || '').slice(0, 120), texto: String(trozo.filter((m) => m.role === 'cliente').at(-1)?.text || '').slice(0, 200) } : null;
  } catch { return null; }
}

// Una sola vez sobre las demos ya enviadas. Solo actualiza la etiqueta: no escribe, no llama, no archiva.
export async function reclasificar({ dias = 45 } = {}) {
  const desde = Date.now() - dias * DIA;
  let leidas = 0;
  const conteo = {};
  for (const c of Object.values(V().convs || {})) {
    if (c.kind !== 'whatsapp' || !c.estado?.demoEnviada || c.estado.demoEnviada < desde) continue;
    const r = await leerRespuesta(c);
    if (!r) continue;
    const ult = (c.msgs || []).filter((m) => m.role === 'cliente' && !m.previo && !m.auto).at(-1);
    c.estado.respuestaDemo = { tipo: r.tipo, texto: r.texto, motivo: r.motivo, ts: ult?.ts || Date.now(), fuente: 'ia' };
    leidas++;
    conteo[r.tipo] = (conteo[r.tipo] || 0) + 1;
  }
  saveNow();
  log('vendedor', `Respuestas a demos reclasificadas: ${leidas}`, 'info');
  return { leidas, conteo, etapas: resumenEmbudo(dias) };
}

// ---------- Embudo desde que la persona entra ----------
// De dónde vino cada cliente: la misma definición para el CEO y las analíticas.
export const fuenteDe = (c) => { const o = String(c.contacto?.origen || '').toLowerCase(); return c.anuncio ? 'pauta' : c.prospecto ? 'prospeccion' : /tiktok|instagram|facebook|youtube/.test(o) ? 'contenido' : o === 'referido' ? 'referidos' : o === 'google' ? 'google' : o ? 'otros' : 'sin_dato'; };

const PASOS = ['Entraron', 'Conversaron', 'Demo enviada', 'Respondieron a la demo', 'Les gustó', 'Recibieron la cuenta', 'Pagaron'];
// Cada persona cuenta hasta el paso más avanzado que alcanzó, y también en los anteriores.
function nivel(c, pagos) {
  const reales = (c.msgs || []).filter((m) => m.role === 'cliente' && !m.previo && !m.auto);
  const et = etapaDe(c);
  const clave = String(c.phone || '').replace(/\D/g, '').slice(-8);
  if (et === 'pago' || (pagos.get(clave) || 0) >= c.ts - DIA) return 6;
  if (cuentaTs(c)) return 5;
  if (et === 'gusto') return 4;
  if (c.estado?.demoEnviada && et !== 'enviada') return 3;
  if (c.estado?.demoEnviada) return 2;
  return reales.length >= 2 ? 1 : 0;
}
export async function embudoEntrada({ dias = 30, fuente = 'todas' } = {}) {
  const pagos = new Map();
  try {
    const db = await import('../cresova/db.mjs');
    if (db.enUso()) for (const r of await db.q("select right(regexp_replace(coalesce(c.phone, qq.client_phone, ''), '\\D', '', 'g'), 8) as k, max(p.paid_at) as t from quote_payments p join quotes qq on qq.id = p.quote_id left join clients c on c.id = qq.client_id group by 1")) if (r.k?.length === 8) pagos.set(r.k, new Date(r.t).getTime());
  } catch {}
  const todos = Object.values(V().convs || {}).filter((c) => c.kind === 'whatsapp' && !c.pausa?.existente && (c.msgs || []).some((m) => m.role === 'cliente' && !m.previo));
  const desde = Date.now() - dias * DIA;
  const periodo = todos.filter((c) => c.ts >= desde);
  const lista = periodo.filter((c) => fuente === 'todas' || fuenteDe(c) === fuente);
  const nivPer = new Map(periodo.map((c) => [c.id, nivel(c, pagos)]));
  const niveles = lista.map((c) => nivPer.get(c.id));
  const pasos = PASOS.map((et, i) => ({ et, n: niveles.filter((x) => x >= i).length }));
  pasos.forEach((p, i) => { p.pct = pasos[0].n ? Math.round((p.n / pasos[0].n) * 100) : 0; p.delPrevio = i && pasos[i - 1].n ? Math.round((p.n / pasos[i - 1].n) * 100) : null; p.quedaron = i < pasos.length - 1 ? p.n - pasos[i + 1].n : 0; });
  const f = {};
  for (const c of periodo) { const k = fuenteDe(c); const x = (f[k] ||= { fuente: k, entraron: 0, demos: 0, pagaron: 0 }); const n = nivPer.get(c.id); x.entraron++; if (n >= 2) x.demos++; if (n >= 6) x.pagaron++; }
  // Personas nuevas por semana (últimas 8), sin depender del periodo elegido.
  const hoy = Date.now(), semanas = [];
  for (let i = 7; i >= 0; i--) { const fin = hoy - i * 7 * DIA, ini = fin - 7 * DIA; semanas.push({ desde: ini, n: todos.filter((c) => c.ts >= ini && c.ts < fin && (fuente === 'todas' || fuenteDe(c) === fuente)).length }); }
  const personas = periodo.slice().sort((a, b) => b.ts - a.ts).map((c) => ({ conv: c.id, nombre: (c.contacto?.empresa || c.contacto?.nombre || c.title || ''), tel: String(c.phone || '').replace(/^lid:/, ''), nivel: nivPer.get(c.id), fuente: fuenteDe(c), etapa: etapaNombre(c) || '', ts: c.ts }));
  return { dias, fuente, pasos, fuentes: Object.values(f).sort((a, b) => b.entraron - a.entraron), semanas, personas };
}
