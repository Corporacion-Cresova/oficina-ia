// Analíticas · Anuncios: qué campaña y qué anuncio traen ventas, cuánto cuesta cada cliente y qué conviene duplicar o apagar.
import { barras } from './graficas.js';
import { reg } from './lista.js';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const L = (n) => (n == null ? '—' : `L ${Math.round(n).toLocaleString('en-US')}`);
const x = (n) => (n == null ? '—' : `${n.toFixed(1)}x`);
const pad = (n) => String(n).padStart(2, '0');

function periodos() {
  const h = new Date(Date.now() - 6 * 3600e3), y = h.getUTCFullYear(), m = h.getUTCMonth();
  const f = (d) => d.toISOString().slice(0, 10);
  return {
    mes: ['Este mes', `${y}-${pad(m + 1)}-01`, f(h)],
    anterior: ['Mes pasado', f(new Date(Date.UTC(y, m - 1, 1))), f(new Date(Date.UTC(y, m, 0)))],
    noventa: ['Últimos 90 días', f(new Date(h.getTime() - 89 * 864e5)), f(h)],
  };
}
let periodo = 'mes';
export async function datosAnuncios(p = periodo) {
  const [, d, h] = periodos()[p];
  const r = await fetch(`/api/cresova/anuncios?desde=${d}&hasta=${h}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'No se pudo calcular.');
  return j;
}

// Vendido, con anticipo y cobrado: tres cosas distintas, con la lista de clientes de cada una.
export function ventasDelPeriodo(a, titulo = 'Ventas de este mes') {
  const fila = (v) => `<tr><td><b class="fi-enlace" ${v.telefono ? `data-ficha="tel:${esc(v.telefono)}"` : ''}>${esc(v.cliente || '')}</b><small>${esc(v.numero)}</small></td><td>${[v.vendida && 'Vendida', v.anticipo && 'Pagó anticipo', v.cobrado && !v.vendida && !v.anticipo && 'Cobro'].filter(Boolean).join(' · ')}</td><td class="r">${L(v.total)}</td><td class="r">${v.cobrado ? L(v.cobrado) : '—'}</td><td><span class="etq ${v.nivel === 'exacto' ? 'anuncio' : v.nivel === 'probable' ? 'espera' : ''}">${esc(v.origen)}</span></td></tr>`;
  const t = a.totales;
  const per = (l) => l.map((v) => ({ conv: v.conv, tel: v.telefono, nombre: v.cliente, detalle: `${v.numero} · L ${Math.round(v.total).toLocaleString('en-US')} · ${v.origen}` }));
  const lv = reg('Vendido', per(a.ventas.filter((v) => v.vendida))), la = reg('Ventas con anticipo', per(a.ventas.filter((v) => v.anticipo))), lc = reg('Cobrado', per(a.ventas.filter((v) => v.cobrado)));
  return `<div class="ng-card"><h2>${esc(titulo)}</h2>
    <div class="ng-kpis c3">
      <div class="ng-kpi ok" data-lista="${lv}"><small>Vendido</small><b>${L(t.vendido)}</b><span>${t.ventas} ${t.ventas === 1 ? 'cotización aceptada' : 'cotizaciones aceptadas'}</span></div>
      <div class="ng-kpi ok" data-lista="${la}"><small>Ventas con anticipo</small><b>${t.anticipos}</b><span>pagaron el 50 % · ${L(t.valorAnticipos)} en total</span></div>
      <div class="ng-kpi" data-lista="${lc}"><small>Cobrado</small><b>${L(t.cobrado)}</b><span>todo el dinero que entró, también saldos</span></div>
    </div>
    ${a.ventas.length ? `<details><summary class="link">Ver de qué clientes sale cada número</summary><div class="ng-tabla-wrap"><table class="ng-tabla an-tabla"><thead><tr><th>Cliente</th><th>Qué pasó</th><th class="r">Total</th><th class="r">Cobrado</th><th>Origen</th></tr></thead><tbody>${a.ventas.map(fila).join('')}</tbody></table></div></details>` : '<p class="muted">Sin ventas ni cobros en este período.</p>'}
  </div>`;
}

function pintar(el, a) {
  const p = a.pauta;
  const ads = a.campanas.flatMap((c) => c.anuncios.map((ad) => ({ ...ad, campana: c.campana })));
  const met = (t, v, s = '') => `<div class="pa-m"><small>${t}</small><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
  el.querySelector('#ad-cuerpo').innerHTML = `
    ${a.meta_error ? `<div class="ng-alerta"><span>No pude leer Meta: ${esc(a.meta_error)}</span></div>` : ''}
    <div class="ng-kpis c5">
      <div class="ng-kpi"><small>Inversión en anuncios</small><b>${L(p.inversion)}</b><span>${p.leads} leads · ${L(p.cpl)} c/u</span></div>
      <div class="ng-kpi ok"><small>Vendido por anuncios</small><b>${L(p.vendido)}</b><span>${p.ventas} ${p.ventas === 1 ? 'venta' : 'ventas'}</span></div>
      <div class="ng-kpi ${p.roas >= 3 ? 'ok' : p.roas ? 'warn' : ''}"><small>Retorno</small><b>${x(p.roas)}</b><span>lempiras vendidos por cada lempira</span></div>
      <div class="ng-kpi"><small>Costo de adquisición</small><b>${L(p.cac)}</b><span>${p.anticipos} ${p.anticipos === 1 ? 'cliente pagó' : 'clientes pagaron'} anticipo</span></div>
      <div class="ng-kpi"><small>Cobrado de anuncios</small><b>${L(p.cobrado)}</b><span>dinero que ya entró</span></div>
    </div>
    ${ventasDelPeriodo(a, 'Ventas del período')}
    <div class="ng-card"><h2>Por campaña</h2><p class="note">"Probable" = el cliente vino de Meta pero el chat no guardó el anuncio exacto; se cuenta en la campaña que más invirtió.</p>
      ${a.campanas.map((c) => `<details class="ad-camp" ${c === a.campanas[0] ? 'open' : ''}><summary><div class="pa-camp-n"><b>${esc(c.campana)}</b><span class="etq ${c.tono}">${esc(c.recomendacion)}</span></div>
        ${met('Inversión', L(c.inversion))}<div data-lista="${reg(`Leads · ${c.campana}`, c.personas)}">${met('Leads', c.leads + c.leadsProbables, c.leadsProbables ? `${c.leadsProbables} probables` : '')}</div><div data-lista="${reg(`Ventas · ${c.campana}`, a.ventas.filter((v) => v.vendida && v.campana === c.campana).map((v) => ({ conv: v.conv, tel: v.telefono, nombre: v.cliente, detalle: `${v.numero} · ${v.origen}` })))}">${met('Ventas', c.ventas, c.ventasProbables ? `${c.ventasProbables} probables` : '')}</div>${met('Vendido', L(c.vendido))}${met('Retorno', x(c.roas))}${met('Costo por cliente', L(c.cac))}</summary>
        ${c.anuncios.length ? `<div class="ng-tabla-wrap"><table class="ng-tabla an-tabla"><thead><tr><th>Anuncio</th><th class="r">Inversión</th><th class="r">Leads</th><th class="r">Costo / lead</th><th class="r">Calificados</th><th class="r">Demos</th><th class="r">Ventas</th><th class="r">Retorno</th><th>Qué hacer</th></tr></thead><tbody>
          ${c.anuncios.map((ad) => `<tr><td>${esc(String(ad.nombre).slice(0, 60))}</td><td class="r">${L(ad.inversion)}</td><td class="r">${ad.leads ? `<b class="lm-num" data-lista="${reg(`Leads · ${ad.nombre}`, ad.personas)}">${ad.leads}</b>` : 0}</td><td class="r">${L(ad.cpl)}</td><td class="r">${ad.calificados}</td><td class="r">${ad.demos}</td><td class="r">${ad.ventas}</td><td class="r">${x(ad.roas)}</td><td><span class="etq ${ad.tono}">${esc(ad.recomendacion)}</span></td></tr>`).join('')}
        </tbody></table></div>` : ''}</details>`).join('') || '<div class="empty">Sin inversión en este período.</div>'}
    </div>
    <div class="ng-grid2">
      <div class="ng-card"><h2>Costo por lead de cada anuncio</h2>${ads.filter((ad) => ad.cpl).length ? barras(ads.filter((ad) => ad.cpl).sort((m, n) => m.cpl - n.cpl).slice(0, 10).map((ad) => ({ et: String(ad.nombre).slice(0, 34), v: ad.cpl, texto: L(ad.cpl), tip: `${ad.nombre}: ${L(ad.cpl)} por lead (${ad.leads} leads)` }))) : '<div class="empty">Sin anuncios con leads conectados.</div>'}<p class="note">Más corto es mejor. Llega antes que las ventas, por eso sirve para decidir con poco volumen.</p></div>
      <div class="ng-card"><h2>Ventas de otros orígenes</h2>${a.otros.length ? barras(a.otros.map((o) => ({ et: o.origen, v: o.vendido, texto: L(o.vendido), nota: `${o.ventas} ${o.ventas === 1 ? 'venta' : 'ventas'} · ${L(o.cobrado)} cobrado` }))) : '<div class="empty">Todas las ventas del período vinieron de anuncios.</div>'}</div>
    </div>
    <p class="note">Qué hacer: "Duplicar" si vendió y devolvió 3 veces o más; "Mantener" si vendió; "Apagar o revisar" si gastó sin leads o más de L 600 sin calificados; "Juntando datos" si gastó menos de L 300. Con pocas ventas al mes, mirá también el costo por lead y por demo.</p>`;
}

export async function cargarAnuncios(el) {
  const P = periodos();
  el.innerHTML = `<div class="ng-tabs ad-per">${Object.entries(P).map(([k, [t]]) => `<button class="tab-btn ${periodo === k ? 'on' : ''}" data-ad-per="${k}">${t}</button>`).join('')}</div><div id="ad-cuerpo"><div class="empty">Calculando…</div></div>`;
  try { pintar(el, await datosAnuncios()); } catch (e) { el.querySelector('#ad-cuerpo').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  el.querySelectorAll('[data-ad-per]').forEach((b) => b.addEventListener('click', () => { periodo = b.dataset.adPer; cargarAnuncios(el); }));
}
