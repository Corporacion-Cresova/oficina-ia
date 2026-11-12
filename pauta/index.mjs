// Departamento de Pauta (Meta Ads): la verdad de cada anuncio de punta a punta.
//   Gasto (Meta) → conversaciones → leads CALIFICADOS (los clasifica Sofía leyendo los chats) → demos → cotizaciones
//   → ventas (cotizaciones aceptadas en la base de Cresova). De ahí salen los costos que importan: por lead calificado,
//   por demo y por venta.
// Además, la bitácora de pruebas: cada test con su hipótesis y su PREDICCIÓN; al cerrarlo se anota el resultado y si
// se acertó. Así el equipo aprende qué funciona para Cresova y calibra su criterio.
import { randomUUID } from 'node:crypto';
import { state, saveNow, log } from '../state.mjs';

state.pauta ||= {};
const P = state.pauta;
P.bitacora ||= [];
P.anuncios ||= [];
const CUENTA = () => (process.env.META_AD_ACCOUNT || '').trim();
const tel8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const L = (n) => Math.round(Number(n || 0));

// ---------- gasto por anuncio (Meta) ----------
let insCache = { at: 0, dias: 0, v: null };
async function gastoPorAnuncio(dias = 30) {
  if (insCache.v && insCache.dias === dias && Date.now() - insCache.at < 30 * 60e3) return insCache.v;
  const token = process.env.METAADS_TOKEN?.trim();
  if (!token) return { error: 'Falta la llave de Meta (METAADS_TOKEN).', anuncios: {} };
  const desde = new Date(Date.now() - dias * 86400e3 - 6 * 3600e3).toISOString().slice(0, 10);
  const hasta = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  const url = `https://graph.facebook.com/v26.0/${CUENTA()}/insights?level=ad&fields=ad_id,ad_name,campaign_name,adset_name,spend,impressions,reach,frequency,cpm,actions&time_range=${encodeURIComponent(JSON.stringify({ since: desde, until: hasta }))}&limit=500&access_token=${encodeURIComponent(token)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(40_000) });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `Meta ${r.status}`);
    const anuncios = {};
    for (const a of j.data || []) {
      const conv = (a.actions || []).find((x) => /onsite_conversion\.messaging_conversation_started_7d/.test(x.action_type));
      anuncios[a.ad_id] = { adId: a.ad_id, nombre: a.ad_name, campana: a.campaign_name, conjunto: a.adset_name, gasto: Number(a.spend || 0), impresiones: Number(a.impressions || 0), alcance: Number(a.reach || 0), frecuencia: Number(a.frequency || 0), cpm: Number(a.cpm || 0), conversacionesMeta: Number(conv?.value || 0) };
    }
    insCache = { at: Date.now(), dias, v: { anuncios, moneda: 'HNL' } };
    return insCache.v;
  } catch (e) { return { error: e.message, anuncios: {} }; }
}

// Gasto por anuncio entre dos fechas, para el reporte por período.
const rangoCache = new Map();
export async function gastoRango(desde, hasta) {
  const k = `${desde}|${hasta}`, c = rangoCache.get(k);
  if (c && Date.now() - c.at < 30 * 60e3) return c.v;
  const token = process.env.METAADS_TOKEN?.trim();
  if (!token) return { error: 'Falta la llave de Meta (METAADS_TOKEN).', anuncios: {} };
  try {
    const anuncios = {};
    let url = `https://graph.facebook.com/v26.0/${CUENTA()}/insights?level=ad&fields=ad_id,ad_name,campaign_name,spend,actions&time_range=${encodeURIComponent(JSON.stringify({ since: desde, until: hasta }))}&limit=500&access_token=${encodeURIComponent(token)}`;
    for (let i = 0; url && i < 8; i++) {
      const r = await fetch(url, { signal: AbortSignal.timeout(40_000) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message || `Meta ${r.status}`);
      for (const a of j.data || []) { const conv = (a.actions || []).find((x) => /onsite_conversion\.messaging_conversation_started_7d/.test(x.action_type)); anuncios[a.ad_id] = { adId: a.ad_id, nombre: a.ad_name, campana: a.campaign_name, gasto: Number(a.spend || 0), conversacionesMeta: Number(conv?.value || 0) }; }
      url = j.paging?.next || null;
    }
    const v = { anuncios };
    rangoCache.set(k, { at: Date.now(), v });
    return v;
  } catch (e) { return { error: String(e.message).slice(0, 200), anuncios: {} }; }
}

// Imagen y estado de cada anuncio. Las direcciones de las imágenes de Meta caducan: se piden de nuevo cada 30 minutos.
let creaCache = { at: 0, v: null };
async function creativos() {
  if (creaCache.v && Date.now() - creaCache.at < 30 * 60e3) return creaCache.v;
  const token = process.env.METAADS_TOKEN?.trim();
  if (!token) return {};
  const v = {};
  try {
    let url = `https://graph.facebook.com/v26.0/${CUENTA()}/ads?fields=id,effective_status,campaign{id,effective_status},creative.thumbnail_width(320).thumbnail_height(320){thumbnail_url,image_url}&limit=200&access_token=${encodeURIComponent(token)}`;
    for (let i = 0; url && i < 6; i++) {
      const r = await fetch(url, { signal: AbortSignal.timeout(40_000) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message || `Meta ${r.status}`);
      for (const a of j.data || []) v[a.id] = { miniatura: a.creative?.thumbnail_url || a.creative?.image_url || null, grande: a.creative?.image_url || a.creative?.thumbnail_url || null, estado: a.effective_status || null, campanaEstado: a.campaign?.effective_status || null, campanaId: a.campaign?.id || null };
      url = j.paging?.next || null;
    }
    creaCache = { at: Date.now(), v };
  } catch (e) { log('media', `No se pudieron leer las imágenes de los anuncios: ${String(e.message).slice(0, 160)}`, 'warn'); return creaCache.v || {}; }
  return v;
}

// ---------- tablero: gasto + embudo + calidad + ventas ----------
export async function tablero(dias = 30) {
  const { ventasState: V } = await import('../ventas/vendedor.mjs');
  const desde = Date.now() - dias * 86400e3;
  const [g, crea] = await Promise.all([gastoPorAnuncio(dias), creativos()]);
  // Ventas reales: cotizaciones aceptadas en la base de Cresova, por teléfono.
  const ventas = new Map();
  try {
    const { q, configurado } = await import('../cresova/db.mjs');
    if (configurado()) for (const f of await q(`select qq.client_phone, c.phone as c_phone, qq.total_hnl, qq.total, qq.status, qq.project_status from quotes qq left join clients c on c.id = qq.client_id where qq.created_at >= now() - interval '${Math.min(180, dias + 60)} days'`)) {
      const k = tel8(f.c_phone || f.client_phone);
      if (k.length !== 8) continue;
      const v = ventas.get(k) || { cotizo: true, vendida: false, monto: 0 };
      if (f.status === 'accepted') { v.vendida = true; v.monto += Number(f.total_hnl ?? f.total ?? 0); }
      ventas.set(k, v);
    }
  } catch {}
  const filas = {};
  let sinClasificar = 0;
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp' || c.inst || c.ts < desde || c.pausa?.existente || !c.anuncio) continue;
    const id = c.anuncio.id || `t:${c.anuncio.titulo}`;
    const f = (filas[id] ||= { adId: c.anuncio.id || null, anuncio: c.anuncio.titulo || '(sin título)', leads: 0, calificados: 0, basura: 0, dudosos: 0, sinClasificar: 0, demos: 0, cotizaciones: 0, ventas: 0, ingresos: 0, motivosBasura: {} });
    f.leads++;
    const cal = c.estado?.calidadLead?.nivel;
    if (cal === 'calificado') f.calificados++;
    else if (cal === 'basura') { f.basura++; const m = c.estado.calidadLead.motivo || 'otro'; f.motivosBasura[m] = (f.motivosBasura[m] || 0) + 1; }
    else if (cal === 'dudoso') f.dudosos++;
    else { f.sinClasificar++; sinClasificar++; }
    if (c.estado?.demoEnviada) f.demos++;
    const vt = ventas.get(tel8(c.phone));
    if (vt?.cotizo) f.cotizaciones++;
    if (vt?.vendida) { f.ventas++; f.ingresos += vt.monto; }
  }
  // Gasto de Meta por anuncio (también los que gastaron y no trajeron chats).
  for (const [adId, a] of Object.entries(g.anuncios || {})) {
    const f = (filas[adId] ||= { adId, anuncio: a.nombre, leads: 0, calificados: 0, basura: 0, dudosos: 0, sinClasificar: 0, demos: 0, cotizaciones: 0, ventas: 0, ingresos: 0, motivosBasura: {} });
    Object.assign(f, { nombreMeta: a.nombre, campana: a.campana, conjunto: a.conjunto, gasto: a.gasto, frecuencia: a.frecuencia, cpm: a.cpm, conversacionesMeta: a.conversacionesMeta });
  }
  const costo = (g2, n) => (n > 0 && g2 > 0 ? L(g2 / n) : null);
  const lista = Object.values(filas).map((f) => ({ ...f, ...(crea[f.adId] || {}), gasto: L(f.gasto || 0), costoPorLead: costo(f.gasto, f.leads), costoPorCalificado: costo(f.gasto, f.calificados), costoPorDemo: costo(f.gasto, f.demos), costoPorVenta: costo(f.gasto, f.ventas), pctBasura: f.leads - f.sinClasificar > 0 ? Math.round((f.basura / (f.leads - f.sinClasificar)) * 100) : null }))
    .filter((f) => f.leads || f.gasto).sort((a, b) => (b.gasto || 0) - (a.gasto || 0) || b.leads - a.leads);
  const t = lista.reduce((s, f) => ({ gasto: s.gasto + (f.gasto || 0), leads: s.leads + f.leads, calificados: s.calificados + f.calificados, basura: s.basura + f.basura, demos: s.demos + f.demos, ventas: s.ventas + f.ventas, ingresos: s.ingresos + f.ingresos }), { gasto: 0, leads: 0, calificados: 0, basura: 0, demos: 0, ventas: 0, ingresos: 0 });
  let senales = null;
  try { const meta = await import('../cresova/meta.mjs'); const mm = await import('../cresova/meta-mensajeria.mjs'); senales = { web: await meta.estado().catch(() => null), mensajeria: mm.estado() }; } catch {}
  return {
    dias, moneda: 'L', errorGasto: g.error || null,
    totales: { ...t, gasto: L(t.gasto), ingresos: L(t.ingresos), costoPorLead: costo(t.gasto, t.leads), costoPorCalificado: costo(t.gasto, t.calificados), costoPorDemo: costo(t.gasto, t.demos), costoPorVenta: costo(t.gasto, t.ventas), roas: t.gasto ? Math.round((t.ingresos / t.gasto) * 100) / 100 : null, sinClasificar },
    porAnuncio: lista, senales, bitacora: P.bitacora.slice(-30).reverse(), pipeline: await pipeline(), calibracion: leer().calibracion,
  };
}

// ---------- calidad de leads (Sofía) ----------
export async function leadsSinClasificar({ dias = 7, limite = 25 } = {}) {
  const { ventasState: V } = await import('../ventas/vendedor.mjs');
  const desde = Date.now() - dias * 86400e3;
  return Object.values(V.convs)
    .filter((c) => c.kind === 'whatsapp' && !c.inst && c.ts >= desde && !c.pausa?.existente && !c.estado?.calidadLead && c.msgs.some((m) => m.role === 'cliente'))
    .sort((a, b) => a.ts - b.ts).slice(0, limite)
    .map((c) => ({
      conv_id: c.id, cliente: c.contacto?.empresa || c.contacto?.nombre || c.title, rubro: c.contacto?.rubro || '', anuncio: c.anuncio?.titulo || '(orgánico o directo)',
      llego: new Date(c.ts - 6 * 3600e3).toISOString().slice(0, 16).replace('T', ' '),
      estado: { vioPrecio: Boolean(c.estado?.precioDado), pidioDemo: Boolean(c.estado?.pidioDemo || c.estado?.demo), demoEnviada: Boolean(c.estado?.demoEnviada), noCalifica: c.estado?.noCalificado || null },
      mensajes: c.msgs.filter((m) => m.role !== 'sistema').slice(0, 16).map((m) => `${m.role === 'cliente' ? 'Cliente' : m.role === 'equipo' ? 'Diego' : 'Vendedor'}: ${String(m.text).slice(0, 220)}`),
    }));
}
export const MOTIVOS = ['curioso', 'empleo', 'busca algo gratis', 'otro país', 'sin negocio', 'presupuesto muy bajo', 'otro servicio', 'competencia', 'no respondió', 'otro'];
export async function clasificar({ conv_id, nivel, motivo = '', rubro = '', nota = '' }) {
  const { ventasState: V, touchConv, registrarEvento } = await import('../ventas/vendedor.mjs');
  const c = V.convs[conv_id];
  if (!c) throw new Error('Conversación no encontrada.');
  if (!['calificado', 'dudoso', 'basura'].includes(nivel)) throw new Error('Nivel inválido.');
  c.estado.calidadLead = { nivel, motivo: nivel === 'basura' ? String(motivo || 'otro').slice(0, 60) : '', rubro: String(rubro || '').slice(0, 60), nota: String(nota || '').slice(0, 300), ts: Date.now(), por: 'Sofía' };
  if (rubro && !c.contacto.rubro) c.contacto.rubro = String(rubro).slice(0, 60);
  touchConv(c);
  registrarEvento?.(conv_id, 'calidad_lead', `${nivel}${motivo ? `: ${motivo}` : ''}`);
  return { ok: true };
}

// ---------- bitácora de pruebas ----------
export function registrar({ tipo = 'test', titulo, hipotesis = '', prediccion = '', metrica = '', revisar_en_dias = 7, anuncios = [], por = 'Renata' }) {
  if (!titulo) throw new Error('Falta el título.');
  const e = { id: randomUUID().slice(0, 8), ts: Date.now(), tipo, titulo: String(titulo).slice(0, 160), hipotesis: String(hipotesis).slice(0, 600), prediccion: String(prediccion).slice(0, 300), metrica: String(metrica).slice(0, 120), revisar: Date.now() + Math.max(1, Math.min(60, Number(revisar_en_dias) || 7)) * 86400e3, anuncios: (anuncios || []).map(String).slice(0, 10), estado: tipo === 'test' ? 'en curso' : 'registrado', por };
  P.bitacora.push(e);
  if (P.bitacora.length > 300) P.bitacora.splice(0, P.bitacora.length - 300);
  saveNow();
  log('media', `Bitácora de pauta: ${e.titulo}`, 'info');
  return e;
}
export function cerrar({ id, resultado, aprendizaje, acerto }) {
  const e = P.bitacora.find((x) => x.id === id);
  if (!e) throw new Error('No existe esa entrada de la bitácora.');
  Object.assign(e, { estado: 'cerrado', cerrado: Date.now(), resultado: String(resultado || '').slice(0, 600), aprendizaje: String(aprendizaje || '').slice(0, 600), acerto: acerto === true ? 'sí' : acerto === false ? 'no' : 'en parte' });
  if (acerto === true || acerto === false) import('../memoria.mjs').then((m) => m.aprendizajeComprobado({ area: 'Anuncios', para: 'pauta', que: e.titulo, resultado: acerto ? 'funcionó' : 'no funcionó', evidencia: e.resultado, aprendizaje: e.aprendizaje, fuente: 'Bitácora de Pauta', ref: e.id })).catch(() => {});
  saveNow();
  return e;
}
export function leer({ estado } = {}) {
  const l = P.bitacora.filter((e) => !estado || e.estado === estado);
  const cerrados = P.bitacora.filter((e) => e.estado === 'cerrado' && e.acerto);
  return {
    entradas: l.slice(-60).reverse(),
    porRevisar: P.bitacora.filter((e) => e.estado === 'en curso' && e.revisar <= Date.now()).map((e) => ({ id: e.id, titulo: e.titulo, prediccion: e.prediccion })),
    calibracion: cerrados.length ? { tests: cerrados.length, aciertos: cerrados.filter((e) => e.acerto === 'sí').length, enParte: cerrados.filter((e) => e.acerto === 'en parte').length, porPersona: Object.fromEntries([...new Set(cerrados.map((e) => e.por))].map((p) => { const l = cerrados.filter((e) => e.por === p); return [p, { tests: l.length, aciertos: l.filter((e) => e.acerto === 'sí').length }]; })) } : null,
    aprendizajes: P.bitacora.filter((e) => e.aprendizaje).slice(-25).map((e) => `${new Date(e.cerrado || e.ts).toISOString().slice(0, 10)} · ${e.titulo}: ${e.aprendizaje}`),
  };
}

// ---------- pipeline de anuncios: brief de Renata → Mateo → Nico → edición → revisión → Meta → medición ----------
// Cada brief lleva una etiqueta [AD-xxxx] que va en el título de la tarea, los guiones y los videos: la etapa se
// calcula mirando dónde aparece esa etiqueta (no hace falta que nadie la actualice a mano).
export async function pedirAnuncio(b) {
  const id = `AD-${randomUUID().slice(0, 4).toUpperCase()}`;
  const e = { id, ts: Date.now(), ...b, estado: 'brief' };
  P.anuncios.push(e);
  if (P.anuncios.length > 200) P.anuncios.splice(0, P.anuncios.length - 200);
  const { createTask } = await import('../tareas.mjs');
  const t = createTask({
    assignee: 'guionista', createdBy: 'media', priority: 'alta',
    title: `[${id}] Anuncio ${b.ring}: ${b.concepto}`.slice(0, 140),
    description: `Renata (Jefa de Pauta) pide un ANUNCIO para Meta. Etiqueta: [${id}] — ponela al principio del título de tus guiones y pedí que los editores la pongan en el título del video: así el pipeline sabe por dónde va.

**Ring:** ${b.ring} · **Concepto:** ${b.concepto}
**Hipótesis:** ${b.hipotesis}
**Predicción:** ${b.prediccion}
**Gancho propuesto:** ${b.gancho}
**Formato:** ${b.formato}
**Filtro de calidad (obligatorio en el guion):** ${b.filtro_calidad}
**Textos del anuncio:** A) ${b.texto_a}  ·  B) ${b.texto_b}
**Titulares:** A) ${b.titular_a}  ·  B) ${b.titular_b}
${b.referencia ? `**Referencia:** ${b.referencia}\n` : ''}
Escribí 3 ejecuciones del MISMO concepto (test 3:2:2: misma idea, distinta ejecución), no tres ideas distintas. Pasáselas a Nico para el veredicto y que vayan a edición como ANUNCIO con prioridad.`,
  });
  e.tarea = t.id;
  registrar({ tipo: 'test', titulo: `[${id}] ${b.ring} · ${b.concepto}`, hipotesis: b.hipotesis, prediccion: b.prediccion, metrica: 'costo por lead calificado y por demo', revisar_en_dias: 14, por: 'Renata' });
  saveNow();
  log('media', `Pidió un anuncio al equipo creativo: [${id}] ${b.concepto}`, 'ok');
  return { id, tarea: t.id };
}
export async function pipeline() {
  const etapa = (e) => {
    const tag = `[${e.id}]`;
    const ds = state.deliverables.filter((d) => (d.title || '').includes(tag));
    const vids = ds.filter((d) => d.kind === 'video');
    const bit = P.bitacora.find((x) => x.titulo.startsWith(tag));
    if (bit?.estado === 'cerrado') return 'medido';
    if (vids.some((d) => d.meta?.anuncioId)) return 'en Meta';
    if (vids.some((d) => d.status === 'approved')) return 'aprobado';
    if (vids.some((d) => d.status === 'pending')) return 'en revisión';
    const enLinea = JSON.stringify(state.linea?.queue || []).includes(tag) || JSON.stringify(state.linea?.trabajando || []).includes(tag);
    if (enLinea || ds.some((d) => d.agentId === 'viralidad')) return 'en edición';
    const t = (state.tasks || []).find((x) => x.id === e.tarea);
    if (t && t.status !== 'pendiente') return 'guion';
    return 'brief';
  };
  return P.anuncios.slice(-30).reverse().map((e) => ({ id: e.id, ts: e.ts, ring: e.ring, concepto: e.concepto, prediccion: e.prediccion, etapa: etapa(e) }));
}
