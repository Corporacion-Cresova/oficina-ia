// Atribución de ventas a la pauta, en tres niveles:
//  1. exacto: el chat trae el id del anuncio de Meta.
//  2. probable: vino de Meta (anuncio sin id, o el cliente está marcado como "meta_ads") → a la campaña que más invirtió ese mes.
//  3. otro origen: referido, prospección, contenido, WhatsApp directo o sin dato.
// Vendido = cotizaciones aceptadas. Con anticipo = pagaron al menos el 50 % (la regla de venta de Diego). Cobrado = dinero que entró.
import { q } from './db.mjs';

const DIA = 864e5;
const tel8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const ts = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00-06:00` : d).getTime() : null);
const fechaHn = (t) => new Date(t - 6 * 3600e3).toISOString().slice(0, 10);
const ORIGEN = { referido: 'Referido', prospeccion: 'Prospección', contenido: 'Contenido orgánico', whatsapp: 'WhatsApp directo', sin_dato: 'Sin dato' };

function recomendacion(f) {
  if (f.ventas >= 1 && f.roas >= 3) return ['Duplicar', 'bien'];
  if (f.ventas >= 1) return ['Mantener', 'bien'];
  if (f.inversion < 300) return ['Juntando datos', ''];
  // Meta contó chats pero la oficina no los tiene: no se puede juzgar el anuncio.
  if (!f.leads && f.conversacionesMeta) return ['Faltan chats conectados', 'espera'];
  if (!f.leads) return ['Apagar o revisar', 'error'];
  if (!f.calificados && f.inversion >= 600) return ['Apagar o revisar', 'error'];
  return ['Observar', 'espera'];
}

export async function anuncios({ desde, hasta }) {
  const ini = ts(desde), fin = Math.min(ts(hasta) + 12 * 3600e3, Date.now());
  const dentro = (t) => t != null && t >= ini && t <= fin;
  const pauta = await import('../pauta/index.mjs');
  const { ventasState: V } = await import('../ventas/vendedor.mjs');
  const { fuenteDe } = await import('../ventas/etapa.mjs');
  // Gasto del período y un mapa más largo de anuncio → campaña, para chats de anuncios que ya no gastan.
  const [g, mapa] = await Promise.all([pauta.gastoRango(desde, fechaHn(fin)), pauta.gastoRango(fechaHn(Date.now() - 180 * DIA), fechaHn(Date.now()))]);
  const campanaDe = (adId) => g.anuncios?.[adId]?.campana || mapa.anuncios?.[adId]?.campana || null;
  const nombreAd = (adId) => g.anuncios?.[adId]?.nombre || mapa.anuncios?.[adId]?.nombre || null;
  const campanas = {};
  const filaC = (n) => (campanas[n] ||= { personas: [], campana: n, inversion: 0, conversacionesMeta: 0, leads: 0, leadsProbables: 0, calificados: 0, demos: 0, ventas: 0, ventasExactas: 0, ventasProbables: 0, vendido: 0, anticipos: 0, cobrado: 0, anuncios: {} });
  const filaA = (c, adId, nombre) => (c.anuncios[adId] ||= { personas: [], adId, nombre: nombre || adId, inversion: 0, leads: 0, calificados: 0, demos: 0, ventas: 0, vendido: 0, anticipos: 0 });
  for (const a of Object.values(g.anuncios || {})) { const c = filaC(a.campana || 'Sin campaña'); c.inversion += a.gasto; c.conversacionesMeta += a.conversacionesMeta; const fa = filaA(c, a.adId, a.nombre); fa.inversion += a.gasto; fa.conversacionesMeta = (fa.conversacionesMeta || 0) + a.conversacionesMeta; }
  const principal = Object.values(campanas).sort((a, b) => b.inversion - a.inversion)[0]?.campana || 'Anuncios de Meta';

  // Chats por teléfono, para saber de dónde vino cada cliente.
  const convs = Object.values(V.convs || {}).filter((c) => c.kind === 'whatsapp');
  const porTel = new Map();
  for (const c of convs) { const k = tel8(c.phone); if (k && (!porTel.has(k) || (c.anuncio && !porTel.get(k).anuncio))) porTel.set(k, c); }
  const clientes = await q("select id, phone, source from clients");
  const fuenteCliente = new Map(clientes.map((c) => [tel8(c.phone), c.source]));
  const fuenteClienteId = new Map(clientes.map((c) => [c.id, c.source]));

  // Origen de un cliente: devuelve { nivel, campana, adId, origen }.
  const origenDe = (k, clientId) => {
    const c = porTel.get(k);
    if (c?.anuncio?.id) return { nivel: 'exacto', campana: campanaDe(c.anuncio.id) || principal, adId: c.anuncio.id, nombre: nombreAd(c.anuncio.id) || c.anuncio.titulo };
    const src = fuenteClienteId.get(clientId) || fuenteCliente.get(k);
    if (c?.anuncio || src === 'meta_ads') return { nivel: 'probable', campana: principal };
    const f = c ? fuenteDe(c) : null;
    const o = f && f !== 'pauta' ? f : src === 'referido' ? 'referido' : src === 'whatsapp' ? 'whatsapp' : 'sin_dato';
    return { nivel: 'otro', origen: ORIGEN[o] || o };
  };

  // Leads del período.
  for (const c of convs) {
    if (!dentro(c.ts) || c.pausa?.existente || !(c.msgs || []).some((m) => m.role === 'cliente' && !m.previo)) continue;
    const o = origenDe(tel8(c.phone), null);
    if (o.nivel === 'otro') continue;
    const fc = filaC(o.campana);
    if (o.nivel === 'exacto') fc.leads++; else fc.leadsProbables++;
    const cal = c.estado?.calidadLead?.nivel === 'calificado';
    if (cal) fc.calificados++;
    const per = { conv: c.id, nombre: (c.contacto?.empresa || c.contacto?.nombre || c.title || ''), tel: String(c.phone || '').replace(/^lid:/, ''), detalle: [o.nivel === 'probable' ? 'probable' : '', cal ? 'calificado' : '', c.estado?.demoEnviada ? 'demo enviada' : ''].filter(Boolean).join(' · ') };
    fc.personas.push(per);
    if (c.estado?.demoEnviada) fc.demos++;
    if (o.adId) { const a = filaA(fc, o.adId, o.nombre); a.personas.push(per); a.leads++; if (cal) a.calificados++; if (c.estado?.demoEnviada) a.demos++; }
  }

  // Ventas, anticipos y cobros del período.
  const cot = await q(`select qq.id, qq.quote_number, qq.client_id, qq.client_phone, c.phone as c_phone, coalesce(c.business_name, qq.client_company, qq.client_name) as cliente, qq.status, qq.accepted_at,
      coalesce(nullif(qq.total_hnl, 0), qq.total)::float as total from quotes qq left join clients c on c.id = qq.client_id where qq.status = 'accepted' or exists (select 1 from quote_payments p where p.quote_id = qq.id)`);
  const pagos = await q('select quote_id, amount::float as amount, paid_at from quote_payments order by paid_at, created_at');
  const porCot = new Map();
  for (const p of pagos) { if (!porCot.has(p.quote_id)) porCot.set(p.quote_id, []); porCot.get(p.quote_id).push(p); }
  const otros = {};
  const lista = [];
  let vendido = 0, anticipos = 0, cobrado = 0, nVendidas = 0, nAnticipos = 0;
  for (const r of cot) {
    const ps = porCot.get(r.id) || [];
    let acum = 0, tAnticipo = null;
    for (const p of ps) { acum += p.amount; if (tAnticipo == null && acum >= r.total * 0.5 - 1) tAnticipo = ts(p.paid_at); }
    const vendidaAqui = r.status === 'accepted' && dentro(ts(r.accepted_at));
    const anticipoAqui = dentro(tAnticipo);
    const cobradoAqui = ps.filter((p) => dentro(ts(p.paid_at))).reduce((s, p) => s + p.amount, 0);
    if (!vendidaAqui && !anticipoAqui && !cobradoAqui) continue;
    const o = origenDe(tel8(r.c_phone || r.client_phone), r.client_id);
    if (vendidaAqui) { vendido += r.total; nVendidas++; }
    if (anticipoAqui) { anticipos += r.total; nAnticipos++; }
    cobrado += cobradoAqui;
    lista.push({ conv: porTel.get(tel8(r.c_phone || r.client_phone))?.id || null, campana: o.campana || null, numero: r.quote_number, cliente: r.cliente, telefono: r.c_phone || r.client_phone || '', total: r.total, pagado: ps.reduce((s, p) => s + p.amount, 0), vendida: vendidaAqui, anticipo: anticipoAqui, cobrado: cobradoAqui, nivel: o.nivel, origen: o.nivel === 'otro' ? o.origen : o.nivel === 'exacto' ? `${o.campana} · ${o.nombre || 'anuncio'}` : `${o.campana} (probable)` });
    if (o.nivel === 'otro') { const x = (otros[o.origen] ||= { origen: o.origen, ventas: 0, vendido: 0, anticipos: 0, cobrado: 0 }); if (vendidaAqui) { x.ventas++; x.vendido += r.total; } if (anticipoAqui) x.anticipos++; x.cobrado += cobradoAqui; continue; }
    const fc = filaC(o.campana);
    if (vendidaAqui) { fc.ventas++; fc.vendido += r.total; if (o.nivel === 'exacto') fc.ventasExactas++; else fc.ventasProbables++; }
    if (anticipoAqui) fc.anticipos++;
    fc.cobrado += cobradoAqui;
    if (o.adId) { const a = filaA(fc, o.adId, o.nombre); if (vendidaAqui) { a.ventas++; a.vendido += r.total; } if (anticipoAqui) a.anticipos++; }
  }

  const ratios = (f) => ({ ...f, inversion: Math.round(f.inversion), vendido: Math.round(f.vendido || 0), cpl: f.inversion && (f.leads + (f.leadsProbables || 0)) ? Math.round(f.inversion / (f.leads + (f.leadsProbables || 0))) : null, costoCalificado: f.inversion && f.calificados ? Math.round(f.inversion / f.calificados) : null, cac: f.inversion && f.anticipos ? Math.round(f.inversion / f.anticipos) : null, roas: f.inversion ? Math.round((f.vendido / f.inversion) * 100) / 100 : null });
  const camp = Object.values(campanas).map((c) => {
    const ads = Object.values(c.anuncios).map(ratios).map((a) => { const [t, tono] = recomendacion(a); return { ...a, recomendacion: t, tono }; }).sort((a, b) => b.inversion - a.inversion);
    const r = ratios({ ...c, leads: c.leads });
    const [t, tono] = recomendacion({ ...r, leads: c.leads + c.leadsProbables });
    return { ...r, anuncios: ads, recomendacion: t, tono };
  }).sort((a, b) => b.inversion - a.inversion);
  const inv = camp.reduce((s, c) => s + c.inversion, 0);
  const deAnuncios = camp.reduce((s, c) => ({ ventas: s.ventas + c.ventas, vendido: s.vendido + c.vendido, anticipos: s.anticipos + c.anticipos, cobrado: s.cobrado + c.cobrado, leads: s.leads + c.leads + c.leadsProbables }), { ventas: 0, vendido: 0, anticipos: 0, cobrado: 0, leads: 0 });
  return {
    desde, hasta: fechaHn(fin), meta_error: g.error || null,
    totales: { vendido: Math.round(vendido), ventas: nVendidas, anticipos: nAnticipos, valorAnticipos: Math.round(anticipos), cobrado: Math.round(cobrado) },
    pauta: { inversion: inv, ...deAnuncios, vendido: Math.round(deAnuncios.vendido), cobrado: Math.round(deAnuncios.cobrado), cpl: inv && deAnuncios.leads ? Math.round(inv / deAnuncios.leads) : null, cac: inv && deAnuncios.anticipos ? Math.round(inv / deAnuncios.anticipos) : null, roas: inv ? Math.round((deAnuncios.vendido / inv) * 100) / 100 : null },
    campanas: camp, otros: Object.values(otros).map((o) => ({ ...o, vendido: Math.round(o.vendido), cobrado: Math.round(o.cobrado) })).sort((a, b) => b.vendido - a.vendido),
    ventas: lista.sort((a, b) => b.total - a.total),
  };
}
