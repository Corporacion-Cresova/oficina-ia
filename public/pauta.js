// Tablero de Pauta (Meta Ads): cada anuncio juzgado por lo que trajo de verdad, no por conversaciones.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const L = (n) => (n == null ? '—' : `L ${Math.round(n).toLocaleString('es-HN')}`);
const fecha = (t) => (t ? new Date(t).toLocaleDateString('es-HN', { day: 'numeric', month: 'short' }) : '');
let dias = 30, D = null, filtro = 'todos', orden = 'gasto', abiertas = null;
const caja = () => document.getElementById('pa-root');
const kpi = (label, valor, pista = '', tono = '') => `<div class="ng-kpi ${tono}"><small>${esc(label)}</small><b>${valor}</b>${pista ? `<span>${pista}</span>` : ''}</div>`;

export async function cargarPauta() {
  const el = caja();
  if (!el) return;
  try {
    const hoyHn = new Date(Date.now() - 6 * 3600e3), f = (d) => d.toISOString().slice(0, 10);
    const [d, at] = await Promise.all([fetch(`/api/pauta?dias=${dias}`).then((r) => r.json()), fetch(`/api/cresova/anuncios?desde=${f(new Date(hoyHn.getTime() - (dias - 1) * 864e5))}&hasta=${f(hoyHn)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
    D = { ...d, atrib: at };
    pintar();
  }
  catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// Gastó y Meta no contó conversaciones = gasto perdido. Meta contó conversaciones pero no las tenemos = se perdió la conexión con el anuncio.
const sinLeads = (f) => f.gasto > 0 && !f.leads;
const sinAmarrar = (f) => sinLeads(f) && f.conversacionesMeta > 0;
const FILTROS = {
  todos: ['Todos', () => true],
  activos: ['Activos', (f) => f.estado === 'ACTIVE'],
  sinleads: ['Gastaron sin leads', sinLeads],
  ventas: ['Con ventas', (f) => f.ventas > 0],
};
const num0 = (v) => (v == null ? Infinity : v);
const ORDENES = {
  gasto: ['Más inversión', (a, b) => (b.gasto || 0) - (a.gasto || 0)],
  leads: ['Más leads', (a, b) => b.leads - a.leads || (b.gasto || 0) - (a.gasto || 0)],
  calificado: ['Mejor costo por calificado', (a, b) => num0(a.costoPorCalificado) - num0(b.costoPorCalificado)],
  ventas: ['Más ventas', (a, b) => b.ventas - a.ventas || (b.gasto || 0) - (a.gasto || 0)],
};
const ESTADO = { ACTIVE: 'Activo', PAUSED: 'Pausado', CAMPAIGN_PAUSED: 'Campaña pausada', ADSET_PAUSED: 'Conjunto pausado', ARCHIVED: 'Archivado', DELETED: 'Eliminado', WITH_ISSUES: 'Con problemas', PENDING_REVIEW: 'En revisión', DISAPPROVED: 'Rechazado' };
const etqEstado = (e) => (e ? `<span class="etq ${e === 'ACTIVE' ? 'bien' : e === 'DISAPPROVED' || e === 'WITH_ISSUES' ? 'error' : ''}">${esc(ESTADO[e] || e)}</span>` : '');

function alerta() {
  const l = (D.porAnuncio || []).filter(sinLeads);
  if (!l.length) return '';
  const total = l.reduce((s, f) => s + f.gasto, 0), am = l.filter(sinAmarrar);
  return `<div class="ng-alerta"><span><b>${l.length} anuncios gastaron ${L(total)} sin leads registrados.</b> ${am.length ? `En ${am.length} de ellos Meta sí contó conversaciones: hay que revisar por qué no quedaron conectadas.` : 'Meta tampoco contó conversaciones en ellos.'}</span>${filtro === 'sinleads' ? '' : '<button class="btn sm" data-pa-filtro="sinleads">Ver cuáles</button>'}</div>`;
}

function fichaAnuncio(f) {
  const nombre = f.nombreMeta || f.anuncio || '';
  const img = f.miniatura ? `<a class="pa-img" href="${esc(f.grande || f.miniatura)}" target="_blank" rel="noopener noreferrer"><img src="${esc(f.miniatura)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : `<span class="pa-img vacio">${esc(nombre.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || 'AD')}</span>`;
  const marca = f.ventas ? '<span class="etq bien">Vendió</span>' : sinAmarrar(f) ? `<span class="etq espera">${f.conversacionesMeta} chats en Meta sin conectar</span>` : sinLeads(f) ? '<span class="etq error">Gastó sin leads</span>' : '';
  return `<div class="pa-ad">${img}
    <div class="pa-ad-n"><b>${esc(nombre.slice(0, 90))}</b>${f.conjunto ? `<small>${esc(f.conjunto.slice(0, 70))}</small>` : ''}<div class="pa-etq">${etqEstado(f.estado)}${marca}</div></div>
    <div class="pa-m"><small>Inversión</small><b>${L(f.gasto)}</b></div><div class="pa-m"><small>Leads</small><b>${f.leads}</b></div><div class="pa-m"><small>Calificados</small><b>${f.calificados}</b></div><div class="pa-m"><small>Demos</small><b>${f.demos}</b></div><div class="pa-m"><small>Ventas</small><b>${f.ventas}</b></div><div class="pa-m"><small>Costo / calificado</small><b>${L(f.costoPorCalificado)}</b></div>
  </div>`;
}

function campanas() {
  const lista = (D.porAnuncio || []).filter(FILTROS[filtro][1]).slice().sort(ORDENES[orden][1]);
  const grupos = new Map();
  for (const f of lista) { const k = f.campana || 'Sin campaña identificada'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(f); }
  const orden2 = [...grupos.entries()].map(([nombre, ads]) => ({ nombre, ads, t: ads.reduce((s, f) => ({ gasto: s.gasto + (f.gasto || 0), leads: s.leads + f.leads, calificados: s.calificados + f.calificados, demos: s.demos + f.demos, ventas: s.ventas + f.ventas }), { gasto: 0, leads: 0, calificados: 0, demos: 0, ventas: 0 }) })).sort((a, b) => b.t.gasto - a.t.gasto);
  if (!orden2.length) return '<div class="ng-card empty">No hay anuncios con este filtro.</div>';
  abiertas ||= new Set([orden2[0].nombre]);
  return orden2.map(({ nombre, ads, t }) => {
    const estado = ads.find((a) => a.campanaEstado)?.campanaEstado;
    const cpl = t.leads && t.gasto ? L(t.gasto / t.leads) : '—';
    return `<details class="ng-card pa-camp" data-camp="${esc(nombre)}" ${abiertas.has(nombre) ? 'open' : ''}><summary>
      <div class="pa-camp-n"><b>${esc(nombre)}</b><small>${ads.length} ${ads.length === 1 ? 'anuncio' : 'anuncios'}</small>${etqEstado(estado)}</div>
      <div class="pa-m"><small>Inversión</small><b>${L(t.gasto)}</b></div><div class="pa-m"><small>Leads</small><b>${t.leads}</b></div><div class="pa-m"><small>Calificados</small><b>${t.calificados}</b></div><div class="pa-m"><small>Demos</small><b>${t.demos}</b></div><div class="pa-m"><small>Ventas</small><b>${t.ventas}</b></div><div class="pa-m"><small>Costo / lead</small><b>${cpl}</b></div>
    </summary><div class="pa-ads">${ads.map(fichaAnuncio).join('')}</div></details>`;
  }).join('');
}

function pintar() {
  const t = D.totales || {};
  const s = D.senales || {};
  const msj = s.mensajeria || {};
  const web = s.web || {};
  caja().innerHTML = `
    <header class="ng-head"><div><h1>Pauta (Meta Ads)</h1><p>Renata, Tomás y Sofía. Cada anuncio juzgado por lo que trajo de verdad: leads calificados, demos y ventas.</p></div>
      <div class="ng-tabs">${[7, 30, 90].map((d) => `<button class="tab-btn ${d === dias ? 'on' : ''}" data-pa-dias="${d}">${d} días</button>`).join('')}</div></header>
    ${D.errorGasto ? `<p class="note err">No pude leer el gasto de Meta: ${esc(D.errorGasto)}</p>` : ''}
    <div class="ng-kpis c5">
      ${kpi('Inversión', L(t.gasto), `${t.leads || 0} leads · ${L(t.costoPorLead)} c/u`)}
      ${kpi('Leads calificados', t.calificados || 0, `${L(t.costoPorCalificado)} c/u · ${t.basura || 0} basura${t.sinClasificar ? ` · ${t.sinClasificar} sin clasificar` : ''}`, 'info')}
      ${kpi('Demos', t.demos || 0, `${L(t.costoPorDemo)} c/u`, 'warn')}
      ${D.atrib ? kpi('Ventas', D.atrib.pauta.ventas, `${L(D.atrib.pauta.vendido)} vendidos · costo por cliente ${L(D.atrib.pauta.cac)} · <a href="#/analiticas" class="link">ver detalle</a>`, 'ok') : kpi('Ventas', t.ventas || 0, `${L(t.costoPorVenta)} c/u`, 'ok')}
      ${D.atrib ? kpi('Retorno', D.atrib.pauta.roas != null ? `${D.atrib.pauta.roas}x` : '—', 'incluye ventas probables de anuncios', D.atrib.pauta.roas >= 3 ? 'ok' : D.atrib.pauta.roas ? 'warn' : '') : kpi('Retorno', t.roas != null ? `${t.roas}x` : '—', `${L(t.ingresos)} vendidos`, t.roas >= 3 ? 'ok' : t.roas ? 'warn' : '')}
    </div>
    ${alerta()}
    <div class="pa-ctrl"><div class="chips">${Object.entries(FILTROS).map(([k, [t, fn]]) => `<button class="chip ${filtro === k ? 'on' : ''}" data-pa-filtro="${k}">${t} <small>${(D.porAnuncio || []).filter(fn).length}</small></button>`).join('')}</div>
      <label class="pa-orden">Ordenar por <select class="ng-in" data-pa-orden>${Object.entries(ORDENES).map(([k, [t]]) => `<option value="${k}" ${orden === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    ${campanas()}
    <details class="ng-card pa-det"><summary>Ver todos los anuncios en tabla</summary>
      <div class="ng-tabla-wrap"><table class="ng-tabla pa-tabla"><thead><tr><th>Anuncio</th><th>Inversión</th><th>Leads</th><th>Calificados</th><th>Basura</th><th>Demos</th><th>Ventas</th><th>Costo / calificado</th><th>Costo / venta</th></tr></thead><tbody>
      ${(D.porAnuncio || []).map((f) => {
        const motivos = Object.entries(f.motivosBasura || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([m, n]) => `${m} ${n}`).join(', ');
        return `<tr><td><b>${esc((f.nombreMeta || f.anuncio || '').slice(0, 60))}</b>${f.campana ? `<small>${esc(f.campana.slice(0, 50))}</small>` : ''}</td>
          <td>${L(f.gasto)}</td><td>${f.leads}</td><td>${f.calificados}${f.dudosos ? ` <small>+${f.dudosos} dudosos</small>` : ''}</td>
          <td>${f.basura}${f.pctBasura != null ? ` <small>${f.pctBasura} %</small>` : ''}${motivos ? `<small>${esc(motivos)}</small>` : ''}</td>
          <td>${f.demos}</td><td>${f.ventas}${f.ingresos ? ` <small>${L(f.ingresos)}</small>` : ''}</td><td>${L(f.costoPorCalificado)}</td><td>${L(f.costoPorVenta)}</td></tr>`;
      }).join('') || '<tr><td colspan="9" class="muted">Sin datos en este período.</td></tr>'}
      </tbody></table></div>
      </details>
    <p class="note">Calificados y basura los clasifica Sofía leyendo cada chat. Ventas = cotizaciones aceptadas en la base de Cresova.</p>
    <div class="pa-dos">
      <div class="ng-card"><h2>Señales a Meta</h2>
        <p>${msj.dataset ? `<span class="etq bien">Mensajería activa</span> dataset ${esc(msj.dataset)} · ${msj.enviados || 0} eventos amarrados al anuncio` : `<span class="etq ${msj.error ? 'error' : 'espera'}">Mensajería ${msj.error ? 'con error' : 'sin configurar'}</span>`}</p>
        ${msj.error ? `<p class="note err">${esc(msj.error)}</p>` : ''}
        <p class="muted">Envío web/sistema: ${web.leads ?? 0} leads y ${web.compras ?? 0} compras reportadas${web.con_error ? ` · ${web.con_error} con error` : ''}.</p>
      </div>
      <div class="ng-card"><h2>Anuncios en producción</h2>
        <div class="pa-pipe">${(D.pipeline || []).slice(0, 10).map((a) => `<div class="fila"><b>${esc(a.id)}</b> <span>${esc(a.ring)} · ${esc(a.concepto)}</span> <span class="etq ${a.etapa === 'medido' || a.etapa === 'en Meta' ? 'bien' : 'espera'}">${esc(a.etapa)}</span><small>${fecha(a.ts)}</small></div>`).join('') || '<p class="muted">Cuando Renata necesita un anuncio lo encarga con un brief; acá se ve por dónde va: brief → guion → edición → revisión → aprobado → en Meta → medido.</p>'}</div>
        ${D.calibracion?.porPersona ? `<p class="note">Calibración (predicciones que acertaron): ${Object.entries(D.calibracion.porPersona).map(([p, c]) => `${esc(p)} ${c.aciertos}/${c.tests}`).join(' · ')}</p>` : ''}
      </div>
      <div class="ng-card"><h2>Bitácora de pruebas</h2>
        ${(D.bitacora || []).slice(0, 8).map((e) => `<div class="pa-bit"><b>${esc(e.titulo)}</b> <span class="etq ${e.estado === 'cerrado' ? (e.acerto === 'sí' ? 'bien' : e.acerto === 'no' ? 'error' : '') : 'espera'}">${e.estado === 'cerrado' ? `acertó: ${esc(e.acerto || '—')}` : esc(e.estado)}</span>
          ${e.prediccion ? `<small>Predicción: ${esc(e.prediccion)}</small>` : ''}${e.resultado ? `<small>Resultado: ${esc(e.resultado)}</small>` : ''}${e.aprendizaje ? `<small>Aprendizaje: ${esc(e.aprendizaje)}</small>` : ''}<small>${fecha(e.ts)} · ${esc(e.por || '')}</small></div>`).join('') || '<p class="muted">Todavía no hay pruebas anotadas. Renata anota cada test con su predicción y lo cierra con el resultado.</p>'}
      </div>
    </div>`;
}

document.addEventListener('click', (e) => {
  const fl = e.target.closest('[data-pa-filtro]');
  if (fl && caja()?.contains(fl)) { filtro = fl.dataset.paFiltro; abiertas = filtro === 'todos' ? null : new Set((D.porAnuncio || []).filter(FILTROS[filtro][1]).map((f) => f.campana || 'Sin campaña identificada')); return pintar(); }
  const b = e.target.closest('[data-pa-dias]');
  if (!b || !caja()?.contains(b)) return;
  dias = Number(b.dataset.paDias);
  cargarPauta();
});

document.addEventListener('change', (e) => { if (e.target.matches?.('[data-pa-orden]')) { orden = e.target.value; pintar(); } });
// Recordar qué campañas están abiertas al filtrar u ordenar.
document.addEventListener('toggle', (e) => { const n = e.target.dataset?.camp; if (n && abiertas) { if (e.target.open) abiertas.add(n); else abiertas.delete(n); } }, true);
// Si Meta ya no entrega una imagen, queda el recuadro con las iniciales.
document.addEventListener('error', (e) => { if (e.target.closest?.('.pa-img')) { const c = e.target.closest('.pa-img'); c.classList.add('vacio'); c.textContent = 'AD'; } }, true);
