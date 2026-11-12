// Recontacto de cotizaciones pendientes (las que dejó el equipo humano a medias).
// Martín revisa cada cotización y redacta el primer mensaje; Diego aprueba el lote en la Bandeja;
// el vendedor los envía de a poco (tope diario, en horario) y atiende las respuestas con el contexto.
import { log, saveNow, addDeliverable } from '../state.mjs';
import { callMcpTool } from '../connections.mjs';
import { ventasState as V } from './vendedor.mjs';

V.recontacto ||= { items: {}, porDia: 10, porDiaPrevio: 40, enviados: [] };
const R = V.recontacto;
R.items ||= {};
R.enviados ||= [];
R.porDiaPrevio ||= 40;
R.optOuts ||= []; // horas en que alguien pidió que no lo contactemos
 // clientes con los que ya hablamos: ritmo más rápido
// Los enviados se guardan como {t, previo}; los registros viejos eran solo la hora.
R.enviados = R.enviados.map((e) => (typeof e === 'number' ? { t: e, previo: true } : e));

export const ESTADOS = ['pendiente', 'propuesto', 'aprobado', 'enviado', 'respondio', 'descartado'];
export const telKey = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 8 ? `504${d}` : d; };
const parse = (r) => (typeof r === 'string' ? JSON.parse(r) : r);
const itemsDe = (r) => { const j = parse(r); return j?.result?.items || j?.items || []; };

// Trae del sistema Cresova las cotizaciones enviadas y en borrador que no se aprobaron.
// Las que ya maneja la oficina (demo armada aquí o cotización de esta conversación) quedan fuera.
export async function cargar() {
  const lista = [];
  const db = await import('../cresova/db.mjs');
  if (db.enUso()) {
    // Base propia: mismas columnas que devolvía el MCP (incluido el nombre del vendedor).
    lista.push(...(await db.q(`select q.*, json_build_object('display_name', s.display_name) as seller from quotes q left join sellers s on s.id = q.seller_id
      where q.status in ('sent', 'draft') order by q.created_at desc limit 400`)).map((x) => ({ ...x, created_at: x.created_at?.toISOString?.() || x.created_at, sent_at: x.sent_at?.toISOString?.() || x.sent_at })));
  } else {
    for (const status of ['sent', 'draft']) lista.push(...itemsDe(await callMcpTool('cresova', 'list_quotes', { status, limit: 200 })));
  }
  const yaEnOficina = new Set(Object.values(V.convs).map((c) => c.estado?.cotizacion).filter(Boolean));
  const porTel = new Map();
  const notasPorTel = {};
  for (const q of lista) {
    const tel = telKey(q.client_phone);
    if (!tel || tel.length < 10 || yaEnOficina.has(q.quote_number)) continue;
    (notasPorTel[tel] ||= []).push(String(q.notes || '').trim());
    const prev = porTel.get(tel);
    // Mismo teléfono con varias cotizaciones: queda la más reciente con monto.
    if (!prev || (Number(q.total) > 0 && (Number(prev.total) === 0 || q.created_at > prev.created_at))) porTel.set(tel, q);
  }
  let nuevos = 0;
  for (const [tel, q] of porTel) {
    const prev = R.items[q.quote_number];
    const base = {
      cotizacion: q.quote_number, tel, cliente: q.client_name, empresa: q.client_company || null,
      total: Number(q.total) || 0, moneda: q.currency || 'HNL', estadoCotizacion: q.status, proyecto: q.project_status,
      vendedor: q.seller?.display_name || null, creada: q.created_at, enviada: q.sent_at, notas: [...new Set((notasPorTel[tel] || []).filter(Boolean))].join('\n---\n').slice(0, 3000),
    };
    base.previo = Boolean(q.sent_at) || q.project_status === 'demo_sent' || hablado(tel);
    if (prev) Object.assign(prev, base);
    else { R.items[q.quote_number] = { ...base, estado: 'pendiente', ts: Date.now() }; nuevos++; }
  }
  saveNow();
  log('gerente_ventas', `Recontacto: ${porTel.size} cotizaciones pendientes cargadas (${nuevos} nuevas)`, 'info');
  return { total: Object.keys(R.items).length, nuevos };
}

// ¿Ya hubo conversación con ese número? (el cliente escribió o nosotros le escribimos)
const hablado = (tel) => Boolean(Object.values(V.convs).find((c) => c.kind === 'whatsapp' && telKey(c.phone) === tel && c.msgs.some((m) => ['cliente', 'bot', 'equipo'].includes(m.role))));
// Lo que ya se habló con ese número en la oficina (si existe), para que Martín y el vendedor tengan contexto.
export const convDe = (tel) => Object.values(V.convs).find((c) => c.kind === 'whatsapp' && telKey(c.phone) === tel) || null;
function historial(tel, n = 12) {
  const c = convDe(tel);
  if (!c) return null;
  return c.msgs.filter((m) => ['cliente', 'bot', 'equipo'].includes(m.role)).slice(-n)
    .map((m) => `[${new Date(m.ts).toLocaleDateString('es-HN')} ${m.role}] ${String(m.text).slice(0, 300)}`).join('\n');
}

export function lista({ estado } = {}) {
  return Object.values(R.items).filter((i) => !estado || i.estado === estado)
    .sort((a, b) => String(b.creada).localeCompare(String(a.creada)))
    .map((i) => ({ ...i, conversacionEnOficina: historial(i.tel) }));
}

export function proponer({ cotizacion, mensaje, contexto, descartar }) {
  const it = R.items[cotizacion];
  if (!it) throw new Error(`No está la cotización ${cotizacion}. Usá recontacto_cargar primero.`);
  if (['enviado', 'respondio'].includes(it.estado)) throw new Error('Esa ya se envió.');
  if (descartar) { it.estado = 'descartado'; it.motivo = String(descartar).slice(0, 300); }
  else {
    if (!String(mensaje || '').trim()) throw new Error('Falta el mensaje.');
    it.mensaje = String(mensaje).trim().slice(0, 900);
    it.contexto = String(contexto || '').trim().slice(0, 1500);
    it.estado = 'propuesto';
  }
  saveNow();
  return { cotizacion, estado: it.estado };
}

// Un solo pedido de aprobación con todos los mensajes propuestos.
export function pedirAprobacion() {
  const ps = Object.values(R.items).filter((i) => i.estado === 'propuesto');
  if (!ps.length) throw new Error('No hay mensajes propuestos.');
  const fmt = (n, m) => (m === 'HNL' ? `L ${n.toLocaleString('en-US')}` : `${m} ${n}`);
  const cuerpo = ps.map((i, k) => `### ${k + 1}. ${i.empresa || i.cliente} · ${i.cotizacion}\n+${i.tel} · ${fmt(i.total, i.moneda)} · ${i.proyecto === 'demo_sent' ? 'demo enviada' : 'demo pendiente'}${i.vendedor ? ` · antes: ${i.vendedor}` : ''}\n\n> ${i.mensaje.replace(/\n/g, '\n> ')}\n\n_Contexto para el vendedor:_ ${i.contexto || '—'}`).join('\n\n---\n\n');
  const descartados = Object.values(R.items).filter((i) => i.estado === 'descartado');
  const d = addDeliverable('gerente_ventas', `📞 Recontacto de ${ps.length} cotizaciones pendientes`,
    `Martín preparó el primer mensaje para cada cliente que quedó a medias. Si aprobás, el vendedor los manda de lunes a sábado de 8:00 a 18:00: rápido a los clientes con los que ya hablamos (hasta ${R.porDiaPrevio} por día) y despacio a los contactos fríos (hasta ${R.porDia} por día) y atiende las respuestas con el contexto de cada cotización. Si alguno quiere arrancar o pide algo especial, te lo pasa.\n\n${cuerpo}${descartados.length ? `\n\n---\n\n**No se recontactan (${descartados.length}):** ${descartados.map((i) => `${i.empresa || i.cliente} (${i.motivo})`).join(' · ')}` : ''}`,
    { kind: 'decision', summary: `${ps.length} mensajes listos · ${R.porDia} por día`, question: '¿Los enviamos?', options: ['Sí, enviarlos', 'Primero ajustar'], recontactoLote: ps.map((i) => i.cotizacion) });
  for (const i of ps) i.lote = d.id;
  saveNow();
  return { deliverable: d.id, mensajes: ps.length };
}

export function aprobarLote(ids) {
  let n = 0;
  for (const id of ids || []) { const it = R.items[id]; if (it?.estado === 'propuesto') { it.estado = 'aprobado'; it.aprobado = Date.now(); n++; } }
  saveNow();
  log('vendedor', `Recontacto: ${n} mensajes aprobados; salen de a poco (máximo ${R.porDia} por día)`, 'ok');
  return n;
}

// Dos ritmos: con clientes que ya conocen a Cresova se va rápido (porDiaPrevio al día); con contactos fríos, despacio (porDia al día).
export const tope = (previo) => (previo ? R.porDiaPrevio : R.porDia);
export const enviadosHoy = (previo) => R.enviados.filter((e) => Date.now() - e.t < 24 * 3600e3 && Boolean(e.previo) === Boolean(previo)).length;
export function siguiente() {
  if (R.pausado) return null;
  const aprobados = Object.values(R.items).filter((i) => i.estado === 'aprobado').sort((a, b) => String(b.creada).localeCompare(String(a.creada)));
  for (const previo of [true, false]) { const it = aprobados.find((i) => Boolean(i.previo) === previo); if (it && enviadosHoy(previo) < tope(previo)) return it; }
  return null;
}
export function marcarEnviado(it, convId) {
  it.estado = 'enviado'; it.enviadoTs = Date.now(); it.convId = convId;
  R.enviados.push({ t: Date.now(), previo: Boolean(it.previo) }); R.enviados = R.enviados.filter((e) => Date.now() - e.t < 7 * 86400e3);
  saveNow();
}
// El cliente respondió a un recontacto.
export function marcarRespondio(tel) {
  const it = Object.values(R.items).find((i) => i.tel === tel && i.estado === 'enviado');
  if (it) { it.estado = 'respondio'; it.respondio = Date.now(); saveNow(); }
}
export const resumen = () => Object.fromEntries(ESTADOS.map((e) => [e, Object.values(R.items).filter((i) => i.estado === e).length]));

// Los pedidos aprobados antes de que existieran los dos ritmos: se marcan según haya habido contacto.
for (const it of Object.values(R.items)) if (it.previo === undefined) it.previo = Boolean(it.enviada) || it.proyecto === 'demo_sent' || hablado(it.tel);
// Freno de emergencia: nada sale mientras esté pausado.
export function pausar(on, motivo = '') {
  R.pausado = Boolean(on);
  R.pausaMotivo = on ? String(motivo || 'Pausado').slice(0, 200) : '';
  saveNow();
  log('vendedor', on ? `Recontacto PAUSADO: ${R.pausaMotivo}` : 'Recontacto reanudado', on ? 'warn' : 'ok');
  return { pausado: R.pausado };
}
// Alguien pidió que no lo contactemos: no se le escribe más; si son 2 o más en un día, se frena todo y se avisa.
export function optOut(tel, texto) {
  const it = Object.values(R.items).find((i) => i.tel === tel);
  if (it && it.estado !== 'descartado') { it.estado = 'descartado'; it.motivo = `Pidió que no lo contactemos: "${String(texto).slice(0, 80)}"`; }
  R.optOuts = [...(R.optOuts || []).filter((t) => Date.now() - t < 24 * 3600e3), Date.now()];
  saveNow();
  if (R.optOuts.length >= 2 && !R.pausado) { pausar(true, 'Dos personas pidieron que no las contactemos en un día: revisá el tono antes de seguir'); return { pausadoAuto: true }; }
  return {};
}
export const estadoRecontacto = () => ({
  pausado: Boolean(R.pausado), pausaMotivo: R.pausaMotivo || '',
  resumen: resumen(),
  ritmo: { previo: { hoy: enviadosHoy(true), tope: R.porDiaPrevio }, frio: { hoy: enviadosHoy(false), tope: R.porDia } },
  items: Object.values(R.items).map((i) => ({ cotizacion: i.cotizacion, cliente: i.empresa || i.cliente, estado: i.estado, previo: i.previo, enviado: i.enviadoTs || null })),
});
