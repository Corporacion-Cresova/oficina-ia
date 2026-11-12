// Reporte para decidir: adquisición, demos, ventas y operación de un período. Cada número sale de los chats, la base o Meta;
// lo que no se registra se devuelve como null para que la pantalla diga "Sin registrar" en vez de inventarlo.
import { q } from './db.mjs';
import { state } from '../state.mjs';
import { etapaDe, ETAPAS_VENTA } from '../ventas/etapa.mjs';
import { grupoMotivo } from './negocio.mjs';

const DIA = 864e5;
const tel8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const PAISES = [['504', 'Honduras'], ['502', 'Guatemala'], ['503', 'El Salvador'], ['505', 'Nicaragua'], ['506', 'Costa Rica'], ['507', 'Panamá'], ['52', 'México'], ['57', 'Colombia'], ['58', 'Venezuela'], ['51', 'Perú'], ['54', 'Argentina'], ['56', 'Chile'], ['34', 'España'], ['1', 'Estados Unidos o Canadá']];
const paisDe = (tel) => { const d = String(tel || '').startsWith('lid:') ? '' : String(tel || '').replace(/\D/g, ''); return d ? PAISES.find(([p]) => d.startsWith(p))?.[1] || 'Otro' : 'Sin número visible'; };
const prom = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
const dias1 = (ms) => (ms == null ? null : Math.round((ms / DIA) * 10) / 10);

export async function reportePeriodo({ desde, hasta }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(hasta || '')) throw new Error('Fechas inválidas.');
  const ini = Date.parse(`${desde}T00:00:00-06:00`);
  const fin = Math.min(Date.parse(`${hasta}T23:59:59-06:00`), Date.now());
  const dentro = (t) => t != null && t >= ini && t <= fin;
  const { ventasState: V } = await import('../ventas/vendedor.mjs');
  const pauta = await import('../pauta/index.mjs');
  const dev = await import('../desarrollo/proyectos.mjs');
  const g = await pauta.gastoRango(desde, new Date(fin - 6 * 3600e3).toISOString().slice(0, 10));

  // ---------- Contactos ----------
  const todos = Object.values(V.convs || {}).filter((c) => c.kind === 'whatsapp' && !c.pausa?.existente && (c.msgs || []).some((m) => m.role === 'cliente' && !m.previo));
  const vistos = new Set();
  const contactos = todos.filter((c) => { if (!dentro(c.ts)) return false; const k = tel8(c.phone) || c.id; if (vistos.has(k)) return false; vistos.add(k); return true; }).sort((a, b) => a.ts - b.ts);
  const camp = {};
  const filaC = (n) => (camp[n] ||= { campana: n, gasto: 0, contactos: 0, conversacionesMeta: 0, demos: 0 });
  for (const a of Object.values(g.anuncios || {})) { const f = filaC(a.campana || 'Sin campaña identificada'); f.gasto += a.gasto; f.conversacionesMeta += a.conversacionesMeta; }
  const paises = {};
  for (const c of contactos) {
    const a = c.anuncio?.id ? g.anuncios?.[c.anuncio.id] : null;
    const n = a?.campana || (c.anuncio ? 'Anuncio sin campaña identificada' : 'Sin anuncio (orgánico, directo o prospección)');
    const f = filaC(n);
    f.contactos++;
    if (c.estado?.demoEnviada) f.demos++;
    const p = paisDe(c.phone);
    paises[p] = (paises[p] || 0) + 1;
  }
  const campanas = Object.values(camp).map((f) => ({ ...f, gasto: Math.round(f.gasto), costoContacto: f.gasto && f.contactos ? Math.round(f.gasto / f.contactos) : null })).sort((a, b) => b.gasto - a.gasto || b.contactos - a.contactos);
  const inversion = g.error ? null : Math.round(campanas.reduce((s, f) => s + f.gasto, 0));

  // ---------- Demos ----------
  const aceptoTs = (c) => c.estado?.pidioDemo || c.estado?.demoCreadaTs || (c.estado?.demo ? c.ts : null);
  const aceptaron = todos.filter((c) => dentro(aceptoTs(c)));
  const enviadas = todos.filter((c) => dentro(c.estado?.demoEnviada));
  const et = enviadas.map(etapaDe);
  const aprobadas = et.filter((e) => ['gusto', 'cuenta', 'comprobante', 'pago'].includes(e)).length;
  const rechazadas = et.filter((e) => e === 'nointeresa').length;
  const sinRespuesta = et.filter((e) => e === 'enviada').length;
  const esperas = todos.map((c) => (c.estado?.demoEnviada && aceptoTs(c) && dentro(c.estado.demoEnviada) ? c.estado.demoEnviada - aceptoTs(c) : null)).filter((x) => x != null && x >= 0);
  const proyectos = dev.listarProyectos();
  const conProyecto = new Set(proyectos.map((p) => p.origen?.conv).filter(Boolean));
  const sinArmar = todos.filter((c) => aceptoTs(c) && Date.now() - aceptoTs(c) < 30 * DIA && !c.estado?.demoEnviada && !conProyecto.has(c.id) && !c.estado?.demoArchivada);
  const pendientesHoy = proyectos.filter((p) => p.estado === 'nuevo' && !p.trabajando).length + sinArmar.length;
  const construccionHoy = proyectos.filter((p) => p.trabajando || p.estado === 'armando').length;

  // ---------- Ventas y cobros ----------
  const vt = await q(`select qq.id, qq.client_phone, c.phone as c_phone, qq.created_at, qq.accepted_at, qq.delivered_at, qq.project_status, qq.status, coalesce(nullif(qq.total_hnl, 0), qq.total)::float as total, qq.motivo_no_cierre, qq.responded_at, qq.quote_number, coalesce(c.business_name, qq.client_company, qq.client_name) as cliente from quotes qq left join clients c on c.id = qq.client_id`);
  const pagos = await q(`select quote_id, amount::float as amount, paid_at from quote_payments order by paid_at, created_at`);
  const porCot = new Map();
  for (const p of pagos) { if (!porCot.has(p.quote_id)) porCot.set(p.quote_id, []); porCot.get(p.quote_id).push(p); }
  const ts = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00-06:00` : d).getTime() : null);
  const convPorTel = new Map();
  for (const c of todos) { const k = tel8(c.phone); if (k && (!convPorTel.has(k) || c.ts < convPorTel.get(k))) convPorTel.set(k, c.ts); }
  const aceptadas = vt.filter((r) => r.status === 'accepted' && dentro(ts(r.accepted_at)));
  const pagado = (r) => (porCot.get(r.id) || []).reduce((s, p) => s + p.amount, 0);
  const conAnticipo = aceptadas.filter((r) => pagado(r) >= r.total * 0.5 - 1);
  let anticipos = 0, cobrado = 0;
  for (const r of vt) {
    let acumulado = 0;
    const tope = r.total * 0.5;
    for (const p of porCot.get(r.id) || []) {
      const parte = Math.max(0, Math.min(p.amount, tope - acumulado));
      acumulado += p.amount;
      if (dentro(ts(p.paid_at))) { anticipos += parte; cobrado += p.amount; }
    }
  }
  const valor = aceptadas.reduce((s, r) => s + r.total, 0);
  const perdidas = vt.filter((r) => r.status === 'rejected' && dentro(ts(r.responded_at) ?? ts(r.created_at)));
  const motivos = {};
  for (const r of perdidas) { const m = String(r.motivo_no_cierre || '').trim(); const k = m ? grupoMotivo(m) : 'Sin motivo anotado'; motivos[k] = (motivos[k] || 0) + 1; }
  const tiempos = vt.map((r) => { const l = porCot.get(r.id); if (!l?.length || !dentro(ts(l[0].paid_at))) return null; const ini2 = Math.min(convPorTel.get(tel8(r.c_phone || r.client_phone)) ?? Infinity, ts(r.created_at)); const d = ts(l[0].paid_at) - ini2; return d >= 0 ? d : null; }).filter((x) => x != null);

  // Personas detrás de cada número.
  const convTel = new Map();
  for (const c of todos) { const k = tel8(c.phone); if (k && !convTel.has(k)) convTel.set(k, c.id); }
  const pc = (c, detalle = '') => ({ conv: c.id, nombre: (c.contacto?.empresa || c.contacto?.nombre || c.title || ''), tel: String(c.phone || '').replace(/^lid:/, ''), detalle });
  const pq = (r, detalle = '') => ({ conv: convTel.get(tel8(r.c_phone || r.client_phone)) || null, tel: r.c_phone || r.client_phone || '', nombre: r.cliente || r.quote_number, detalle: [r.quote_number, `L ${Math.round(r.total).toLocaleString('en-US')}`, detalle].filter(Boolean).join(' · ') });
  const enviadasEt = enviadas.map((c) => [c, etapaDe(c)]);
  const entregados = vt.filter((r) => dentro(ts(r.delivered_at)));
  const entrega = entregados.map((r) => ts(r.delivered_at) - ts(r.accepted_at)).filter((x) => x > 0);
  const activosHoy = vt.filter((r) => r.status === 'accepted' && r.project_status !== 'delivered').length;

  return {
    desde, hasta, meta_error: g.error || null,
    adquisicion: { inversion, conversacionesMeta: campanas.reduce((s, f) => s + f.conversacionesMeta, 0), contactosConAnuncio: contactos.filter((c) => c.anuncio).length, contactos: contactos.length, costoContacto: inversion && contactos.length ? Math.round(inversion / contactos.length) : null, campanas, paises: Object.entries(paises).map(([pais, n]) => ({ pais, n })).sort((a, b) => b.n - a.n) },
    demos: { aceptaron: aceptaron.length, pendientesHoy, construccionHoy, enviadas: enviadas.length, aprobadas, rechazadas, sinRespuesta, diasAEnvio: dias1(prom(esperas)), muestraEnvio: esperas.length },
    ventas: { aceptaron: aceptadas.length, pendientesAnticipo: aceptadas.length - conAnticipo.length, pagaronAnticipo: conAnticipo.length, anticipos: Math.round(anticipos), cobrado: Math.round(cobrado), valor: Math.round(valor), ticket: aceptadas.length ? Math.round(valor / aceptadas.length) : null, perdidos: perdidas.length, motivos: Object.entries(motivos).map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n).slice(0, 6), diasAPago: dias1(prom(tiempos)), muestraPago: tiempos.length },
    operacion: { iniciados: aceptadas.length, entregados: entregados.length, activosHoy, diasEntrega: dias1(prom(entrega)), horasHumanas: null },
    meta_cobro: state.ceo?.meta || 100000,
    listas: {
      contactos: contactos.map((c) => pc(c, c.anuncio ? 'vino de anuncio' : '')),
      aceptaronDemo: aceptaron.map((c) => pc(c)),
      enviadas: enviadasEt.map(([c, e]) => pc(c, ETAPAS_VENTA[e] || '')),
      aprobadas: enviadasEt.filter(([, e]) => ['gusto', 'cuenta', 'comprobante', 'pago'].includes(e)).map(([c, e]) => pc(c, ETAPAS_VENTA[e] || '')),
      rechazadas: enviadasEt.filter(([, e]) => e === 'nointeresa').map(([c]) => pc(c)),
      sinRespuesta: enviadasEt.filter(([, e]) => e === 'enviada').map(([c]) => pc(c, 'no respondió la demo')),
      aceptaron: aceptadas.map((r) => pq(r)),
      pagaron: conAnticipo.map((r) => pq(r, 'pagó anticipo')),
      pendientes: aceptadas.filter((r) => !conAnticipo.includes(r)).map((r) => pq(r, `pagado L ${Math.round(pagado(r)).toLocaleString('en-US')}`)),
      perdidos: perdidas.map((r) => pq(r, r.motivo_no_cierre ? grupoMotivo(r.motivo_no_cierre) : 'sin motivo anotado')),
      entregados: entregados.map((r) => pq(r)),
    },
  };
}
