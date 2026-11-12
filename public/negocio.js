// Módulos de negocio de la oficina: cotizaciones, tesorería, clientes, pendientes y analíticas.
// Leen y escriben la base propia de Cresova (/api/cresova/...). Los indicadores copian los de cresova.com.
import { columnas, linea, barras, embudo } from './graficas.js';
import { cargarReporte } from './reporte.js';
import { cargarAnuncios, datosAnuncios, ventasDelPeriodo } from './anuncios.js';
import { pagina, controles } from './paginas.js';
import { reg } from './lista.js';
export const NEGOCIO = ['publicacion', 'cotizaciones', 'proyectos', 'tesoreria', 'clientes', 'pendientes', 'ceo', 'llamadas', 'analiticas'];

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const L = (n, cur = 'HNL') => `${({ HNL: 'L', USD: '$', EUR: '€', MXN: 'MX$' })[cur] || 'L'} ${Number(n || 0).toLocaleString('es-HN', { maximumFractionDigits: 2 })}`;
const fecha = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('es-HN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const hoy = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const tel = (t) => String(t || '').replace(/\D/g, '');

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`/api/cresova${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}
const aviso = (e) => alert(e.message || e);
const caja = (id) => document.getElementById(id);
const fallo = (el, e) => { el.innerHTML = `<div class="empty">${esc(e.message || e)}${/conectada/.test(e.message || '') ? ' <a href="#/sistema">Ir a Sistema → Llaves</a>' : ''}</div>`; };

const EST = { draft: 'Borrador', sent: 'Enviada', accepted: 'Aceptada', rejected: 'Rechazada', expired: 'Expirada' };
const ETAPA = { pending_demo: 'Pendiente demo', demo_sent: 'Demo enviada', in_revisions: 'Demo enviada', approved: 'Aprobado', client_approved: 'Aprobado', in_progress: 'En progreso', awaiting_approval: 'Esperando aprobación', finished: 'Terminado', delivered: 'Entregado' };
const COBRO = { one_time: 'Pago único', monthly: 'Mensual', yearly: 'Anual' };
const ICON_TEL = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';
// Teléfono para pegar en el buscador de WhatsApp: los de Honduras, los 8 dígitos; los de afuera, completos con +.
const telParaCopiar = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('504') ? d.slice(3) : d.length === 8 ? d : `+${d}`; };
async function copiarTel(btn) {
  const v = telParaCopiar(btn.dataset.tel || btn.dataset.czTel);
  let ok = false;
  try { await navigator.clipboard.writeText(v); ok = true; } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: v });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
  }
  window.toast?.(ok ? `Teléfono copiado: ${v}` : `No se pudo copiar. El número es ${v}`, ok ? 'ok' : 'error');
  const antes = btn.innerHTML;
  btn.innerHTML = ok ? '✓' : '!'; btn.title = ok ? `Copiado: ${v}` : v;
  setTimeout(() => { btn.innerHTML = antes; }, 1400);
}
window.copiarTel = copiarTel;
// Llamadas: el número a la vista (9876-5432) y un botón para copiarlo. Los "lid:" de WhatsApp no son teléfonos.
const telValido = (t) => { const d = tel(t); return d.length >= 8 && d.length <= 13; };
const telVisible = (t) => { const v = telParaCopiar(t); return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4)}` : v; };
const ICON_COPIAR = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const kpi = (label, valor, pista = '', tono = '') => `<div class="ng-kpi ${tono}"><small>${esc(label)}</small><b>${valor}</b>${pista ? `<span>${pista}</span>` : ''}</div>`;
const chipEstado = (s) => `<span class="ng-st ${esc(s)}">${esc(EST[s] || s || '—')}</span>`;

let cache = { cuentas: null, productos: null, vendedores: null, categorias: null };
const cuentas = async () => (cache.cuentas ||= await api('/cuentas'));
const categorias = async () => (cache.categorias ||= await api('/categorias'));

export function cargarNegocio(view, arg) {
  const f = { cotizaciones: arg ? () => editorCotizacion(arg) : listaCotizaciones, tesoreria: () => tesoreria(arg || 'resumen'), clientes: arg ? () => fichaCliente(arg) : listaClientes, pendientes, ceo, llamadas, analiticas, publicacion }[view];
  if (f) f().catch((e) => fallo(caja(`ng-${view}`), e));
}
const ir = (h) => { location.hash = h; };

// =================== COTIZACIONES ===================
const fc = { estado: null, q: '', saldo: false };
async function listaCotizaciones() {
  const el = caja('ng-cotizaciones');
  const d = await api(`/cotizaciones?estado=all&q=${encodeURIComponent(fc.q)}`);
  if (!fc.estado) fc.estado = d.porEstado.draft ? 'draft' : d.porEstado.sent ? 'sent' : 'all';
  const k = d.kpis;
  const lista = d.lista.filter((r) => (fc.estado === 'all' || r.status === fc.estado) && (!fc.saldo || r.saldo > 0));
  const pipe = [['draft', 'Borrador (histórico)', k.pipeline.borrador], ['sent', 'Enviadas (histórico)', k.pipeline.enviadas], ['accepted', 'Aceptadas (este mes)', k.pipeline.aceptadasMes]];
  const totPipe = pipe.reduce((a, [, , v]) => a + v.monto, 0) || 1;
  el.innerHTML = `
    <header class="ng-head"><div><h1>Cotizaciones</h1><p>Generá, enviá y dale seguimiento</p></div><button class="btn principal" data-ng="nueva-cot">+ Nueva cotización</button></header>
    <div class="ng-label">Pipeline · qué está en juego</div>
    <div class="ng-kpis c4">
      ${kpi('Pendientes de respuesta', L(k.pendientes.monto), `${k.pendientes.n} enviadas sin decisión`)}
      ${kpi('Aprobado este mes', L(k.aprobadoMes.monto), `<em class="${k.aprobadoMes.delta >= 0 ? 'up' : 'down'}">${k.aprobadoMes.delta >= 0 ? '▲' : '▼'} ${Math.abs(k.aprobadoMes.delta)}%</em> vs mes pasado (${L(k.aprobadoMes.anterior)})`, 'ok')}
      ${kpi('Recurrente activo', `${L(k.recurrente)} / mes`, 'Membresías en aceptadas', 'ok')}
      ${kpi('Tasa de cierre', `${k.cierre.pct}%`, k.cierre.decididas ? `${k.cierre.aceptadas} de ${k.cierre.decididas} decididas` : 'Sin decisiones aún')}
    </div>
    <div class="ng-label">Cobranza · qué falta entrar a caja</div>
    <div class="ng-kpis c3">${kpi('Cobrado (histórico)', L(k.cobrado), '', 'ok')}${kpi('Por cobrar (aprobado)', L(k.porCobrar), '', 'warn')}${kpi('Cobrado este mes', L(k.cobradoMes))}</div>
    <div class="ng-card"><div class="ng-label">Pipeline activo <span>Total ${L(totPipe === 1 ? 0 : totPipe)}</span></div>
      <div class="ng-bar">${pipe.map(([s, , v]) => `<i class="ng-st-bg ${s}" style="width:${(v.monto / totPipe) * 100}%" title="${esc(EST[s])}: ${L(v.monto)}"></i>`).join('')}</div>
      <div class="ng-legend">${pipe.map(([s, t, v]) => `<span><i class="ng-st-bg ${s}"></i>${t} <b>${L(v.monto)}</b> (${v.n})</span>`).join('')}</div></div>
    <div class="ng-filtros">
      <input type="search" class="ng-in" id="ng-cot-q" placeholder="Buscar por cliente, empresa o número" value="${esc(fc.q)}">
      <button class="chip ${fc.saldo ? 'on' : ''}" data-ng="cot-saldo">💰 Con saldo pendiente (${d.lista.filter((r) => r.saldo > 0 && (fc.estado === 'all' || r.status === fc.estado)).length})</button>
      <div class="ng-tabs">${['draft', 'sent', 'accepted', 'rejected', 'all'].map((s) => `<button class="tab-btn ${fc.estado === s ? 'on' : ''}" data-ng="cot-estado" data-v="${s}">${s === 'all' ? 'Todas' : EST[s]}<small>${s === 'all' ? d.lista.length : d.porEstado[s] || 0}</small></button>`).join('')}</div>
    </div>
    <div class="ng-card ng-tabla-wrap"><table class="ng-tabla">
      <thead><tr><th>Número</th><th>Cliente</th><th>Vendedor</th><th class="r">Total</th><th class="r">Pagado</th><th class="r">Saldo</th><th>Estado</th><th>Creada</th><th class="r">Acciones</th></tr></thead>
      <tbody>${lista.map((r) => {
        const pct = r.total_hnl ? Math.min(100, Math.round((r.pagado / r.total_hnl) * 100)) : 0;
        return `<tr data-ng="abrir-cot" data-id="${r.id}">
          <td class="mono">${esc(r.quote_number)}</td>
          <td><b class="${r.client_phone ? 'fi-enlace' : ''}" ${r.client_phone ? `data-ficha="tel:${esc(r.client_phone)}" title="Ver todo de este cliente"` : ''}>${esc(r.client_name || '')}</b>${r.client_company ? `<small>${esc(r.client_company)}</small>` : ''}</td>
          <td>${esc((r.vendedor || '—').split(' ')[0])}</td>
          <td class="r"><b>${L(r.total, r.currency)}</b>${r.currency && r.currency !== 'HNL' ? `<small>≈ ${L(r.total_hnl)}</small>` : ''}${r.mensual ? `<small class="okc">+ ${L(r.mensual, r.currency)}/mes</small>` : ''}</td>
          <td class="r ${r.pagado <= 0 ? 'muted' : pct >= 100 ? 'okc' : 'warnc'}">${L(r.pagado)}${r.pagado > 0 && pct < 100 ? ' <span class="ng-tag warn">Parcial</span>' : ''}</td>
          <td class="r ${r.saldo === 0 ? 'okc' : r.status === 'accepted' ? 'warnc' : ''}">${L(r.saldo)}</td>
          <td>${chipEstado(r.status)}${r.project_status ? `<small class="ng-etapa">${esc(ETAPA[r.project_status] || r.project_status)}</small>` : ''}</td>
          <td class="muted">${fecha(r.created_at)}</td>
          <td class="r ng-acc">${r.client_phone ? `<button class="btn sm ghost ng-ico" data-ng="copiar-tel" data-tel="${esc(r.client_phone)}" title="Copiar teléfono (${esc(r.client_phone)})">${ICON_TEL}</button>` : ''}<button class="btn sm ghost" data-ng="pdf-cot" data-id="${r.id}" title="Imprimir o guardar en PDF">🖨️</button><button class="btn sm ghost" data-ng="borrar-cot" data-id="${r.id}" data-n="${esc(r.quote_number)}" title="Eliminar">🗑️</button></td>
        </tr>`;
      }).join('') || `<tr><td colspan="9" class="empty">${d.lista.length ? 'Sin resultados con estos filtros.' : 'Sin cotizaciones todavía.'}</td></tr>`}</tbody>
    </table></div>`;
}

const lineaVacia = () => ({ name: '', description: '', unit_price: 0, quantity: 1, billing: 'one_time' });
let cot = null;
async function editorCotizacion(id) {
  const el = caja('ng-cotizaciones');
  const [prods, vends, ctas] = await Promise.all([cache.productos ||= api('/productos'), cache.vendedores ||= api('/vendedores'), cuentas()]);
  cache.productos = await prods; cache.vendedores = await vends;
  cot = id === 'nueva'
    ? { id: null, status: 'draft', currency: 'HNL', fx_rate: 1, discount_type: 'percent', discount_value: 0, tax_enabled: false, tax_rate: 15, items: [lineaVacia()], pagos: [], valid_until: new Date(Date.now() + 15 * 86400e3).toISOString().slice(0, 10) }
    : await api(`/cotizaciones/${id}`);
  if (!cot.items?.length) cot.items = [lineaVacia()];
  const campo = (k, label, tipo = 'text', extra = '') => `<label>${label}<input class="ng-in" data-c="${k}" type="${tipo}" value="${esc(tipo === 'date' && cot[k] ? String(cot[k]).slice(0, 10) : cot[k] ?? '')}" ${extra}></label>`;
  el.innerHTML = `
    <header class="ng-head"><div><a class="link" href="#/cotizaciones">← Cotizaciones</a><h1>${cot.id ? esc(cot.quote_number) : 'Nueva cotización'}</h1>${cot.id ? `<p>${chipEstado(cot.status)} ${cot.project_status ? `<span class="ng-etapa">${esc(ETAPA[cot.project_status] || '')}</span>` : ''} · creada ${fecha(cot.created_at)}${cot.vendedor ? ` · ${esc(cot.vendedor)}` : ''}</p>` : ''}</div>
      <div class="ng-acciones">${cot.id ? `<select class="ng-in" data-ng="cot-cambiar-estado"><option value="">Cambiar estado…</option>${Object.entries(EST).filter(([k]) => k !== cot.status).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button class="btn" data-ng="duplicar-cot">Duplicar</button><button class="btn" data-ng="pdf-cot" data-id="${cot.id}">🖨️ PDF</button>${cot.demo_url ? `<a class="btn" href="${esc(cot.demo_url)}" target="_blank" rel="noopener">Ver demo</a>` : ''}` : ''}<button class="btn ok" data-ng="guardar-cot">Guardar</button></div></header>
    <div class="ng-grid2">
      <div class="ng-card"><h2>Cliente</h2><div class="ng-form">
        ${campo('client_name', 'Nombre del contacto')}${campo('client_company', 'Empresa / negocio')}${campo('client_phone', 'Teléfono')}${campo('client_email', 'Correo', 'email')}${campo('client_rtn', 'RTN')}
        <label>Vendedor<select class="ng-in" data-c="seller_id"><option value="">—</option>${cache.vendedores.map((v) => `<option value="${v.id}" ${v.id === cot.seller_id ? 'selected' : ''}>${esc(v.display_name)}</option>`).join('')}</select></label>
      </div></div>
      <div class="ng-card"><h2>Condiciones</h2><div class="ng-form">
        <label>Moneda<select class="ng-in" data-c="currency">${['HNL', 'USD', 'EUR', 'MXN'].map((m) => `<option ${m === cot.currency ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        ${campo('fx_rate', 'Tipo de cambio a L', 'number', 'step="0.01"')}${campo('valid_until', 'Válida hasta', 'date')}
        <label>Descuento<span class="ng-row"><select class="ng-in" data-c="discount_type"><option value="percent" ${cot.discount_type !== 'amount' ? 'selected' : ''}>%</option><option value="amount" ${cot.discount_type === 'amount' ? 'selected' : ''}>Monto</option></select><input class="ng-in" data-c="discount_value" type="number" step="0.01" value="${esc(cot.discount_value ?? 0)}"></span></label>
        <label class="ng-check"><input type="checkbox" data-c="tax_enabled" ${cot.tax_enabled ? 'checked' : ''}> Cobrar ISV <input class="ng-in sm" data-c="tax_rate" type="number" value="${esc(cot.tax_rate ?? 15)}">%</label>
      </div></div>
    </div>
    <div class="ng-card"><h2>Tipo de propuesta</h2><div class="chips" id="ng-tipo"></div><p class="note" id="ng-tipo-nota"></p></div>
    <div id="ng-estrategica"></div>
    <div class="ng-card"><h2>Conceptos</h2>
      <div id="ng-items" class="ng-items2"></div>
      <div class="ng-row"><select class="ng-in" data-ng="agregar-producto"><option value="">＋ Agregar del catálogo…</option>${cache.productos.map((p) => `<option value="${p.id}">${esc(p.name)} · ${L(p.base_price)}</option>`).join('')}</select><button class="btn" data-ng="agregar-linea">＋ Concepto libre</button></div>
      <div id="ng-totales" class="ng-totales"></div>
    </div>
    <div class="ng-grid2">
      <div class="ng-card"><h2>Notas para el cliente</h2><textarea class="ng-in" data-c="notes" rows="5">${esc(cot.notes || '')}</textarea></div>
      <div class="ng-card"><h2>Brief para desarrollo</h2><textarea class="ng-in" data-c="dev_brief" rows="5" placeholder="Lo que Píxel o el programador necesita saber">${esc(cot.dev_brief || '')}</textarea></div>
    </div>
    ${cot.id ? `<div class="ng-card"><h2>Pagos <span class="muted">${L(cot.pagado)} de ${L(cot.total_hnl || cot.total)} · saldo ${L(cot.saldo)}</span></h2>
      <table class="ng-tabla"><thead><tr><th>Fecha</th><th class="r">Monto</th><th>Método</th><th>Cuenta</th><th>Referencia</th><th></th></tr></thead><tbody>
      ${cot.pagos.map((p) => `<tr><td>${fecha(p.paid_at)}</td><td class="r"><b>${L(p.amount)}</b></td><td>${esc(p.method || '')}</td><td>${esc(p.cuenta || 'Sin cuenta')}</td><td class="muted">${esc(p.reference || p.notes || '')}</td><td class="r"><button class="btn sm ghost" data-ng="borrar-pago" data-id="${p.id}">🗑️</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin pagos todavía.</td></tr>'}
      </tbody></table>
      <div class="ng-row ng-pago"><input class="ng-in" id="pg-monto" type="number" step="0.01" placeholder="Monto" value="${cot.saldo ? Math.round(cot.saldo / (cot.pagado ? 1 : 2)) : ''}"><input class="ng-in" id="pg-fecha" type="date" value="${hoy()}">
        <select class="ng-in" id="pg-metodo">${['transfer', 'cash', 'card', 'paypal', 'other'].map((m) => `<option value="${m}">${({ transfer: 'Transferencia', cash: 'Efectivo', card: 'Tarjeta', paypal: 'PayPal', other: 'Otro' })[m]}</option>`).join('')}</select>
        <select class="ng-in" id="pg-cuenta"><option value="">Cuenta…</option>${ctas.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <input class="ng-in" id="pg-ref" placeholder="Referencia"><button class="btn ok" data-ng="agregar-pago">Registrar pago</button></div>
    </div>` : ''}
    ${cot.id ? `<div class="ng-zona"><button class="btn no" data-ng="borrar-cot" data-id="${cot.id}" data-n="${esc(cot.quote_number)}">Eliminar cotización</button></div>` : ''}`;
  pintarItems();
  pintarTipo();
}

// ---------- Tipo de propuesta: web (normal), proyecto grande o Agente de IA (estos dos usan la Propuesta estratégica) ----------
const TIPO_COT = {
  web: ['Página web', 'Propuesta comercial, con condiciones de página web.'],
  grande: ['Proyecto grande o sistema', 'Propuesta estratégica: problema, resultados, módulos, fases e inversión.'],
  agente: ['Agente de IA', 'Propuesta estratégica con implementación, mensualidad y condiciones propias de un agente.'],
};
let plantillaAgente = null;
const tipoCot = () => (!cot.is_enterprise ? 'web' : cot.enterprise_data?.tipo === 'agente' ? 'agente' : 'grande');
async function cambiarTipoCot(v) {
  if (v === 'web') cot.is_enterprise = false;
  else {
    cot.is_enterprise = true;
    const e = (cot.enterprise_data ||= {});
    if (v === 'agente') {
      e.tipo = 'agente';
      plantillaAgente ||= await api('/plantilla-agente');
      for (const [k, val] of Object.entries(plantillaAgente.datos)) if (e[k] == null || e[k] === '' || (Array.isArray(e[k]) && !e[k].length)) e[k] = structuredClone(val);
      if (cot.items.every((i) => !String(i.name || '').trim())) cot.items = structuredClone(plantillaAgente.conceptos);
    } else delete e.tipo;
  }
  pintarTipo();
  pintarItems();
}
function faltantesPropuesta() {
  if (tipoCot() === 'web') return [];
  const e = cot.enterprise_data || {};
  const f = [[e.project_title, 'el título'], [e.problem_diagnosis, 'el problema'], [e.solution_summary, 'la solución'], [(e.value_props || []).length, 'los resultados esperados'], [(e.architecture || []).length, 'los módulos'], [(e.phases || []).length, 'las fases']].filter(([x]) => !x).map(([, t]) => t);
  if (cot.items.some((i) => String(i.name || '').trim() && !Number(i.unit_price))) f.push('los precios de los conceptos');
  if (/\[cantidad\]/.test(e.tipo === 'agente' ? e.cond_mes || '' : '')) f.push('la cantidad de conversaciones al mes');
  return f;
}
function pintarFaltantes() {
  const el = $('#ng-faltan');
  if (!el) return;
  const f = faltantesPropuesta();
  el.className = f.length ? 'ng-aviso' : 'ng-aviso ok';
  el.textContent = f.length ? `Para que el PDF salga completo falta: ${f.join(', ')}.` : 'Lista para generar el PDF.';
}
function pintarTipo() {
  const v = tipoCot();
  $('#ng-tipo').innerHTML = Object.entries(TIPO_COT).map(([k, [t]]) => `<button class="chip ${k === v ? 'on' : ''}" data-ng="cot-tipo" data-v="${k}">${t}</button>`).join('');
  $('#ng-tipo-nota').textContent = TIPO_COT[v][1];
  const caja2 = $('#ng-estrategica');
  if (v === 'web') { caja2.innerHTML = ''; return; }
  const e = (cot.enterprise_data ||= {});
  const area = (k, t, ph = '', filas = 4) => `<label>${t}<textarea class="ng-in" data-e="${k}" rows="${filas}" placeholder="${esc(ph)}">${esc(e[k] || '')}</textarea></label>`;
  caja2.innerHTML = `<div class="ng-card"><h2>Contenido de la propuesta</h2><p id="ng-faltan"></p>
    <div class="ng-form">
      <label>Título del proyecto<input class="ng-in" data-e="project_title" value="${esc(e.project_title || '')}"></label>
      <label>Persona de contacto (portada)<input class="ng-in" data-c="client_contact_name" value="${esc(cot.client_contact_name || '')}"></label>
      <label>Cargo<input class="ng-in" data-c="client_contact_role" value="${esc(cot.client_contact_role || '')}"></label>
    </div>
    <div class="ng-grid2 ng-esp">
      ${area('problem_diagnosis', 'El problema del cliente', 'Qué le pasa hoy, con sus palabras y datos si los hay. Un párrafo por línea.', 6)}
      ${area('solution_summary', 'La solución', 'Qué le vamos a construir y cómo le resuelve el problema.', 6)}
    </div>
    <label class="ng-esp">Resultados esperados<textarea class="ng-in" data-e-lista="value_props" rows="5" placeholder="Uno por línea. Medibles, por ejemplo: responder consultas en menos de 1 minuto.">${esc((e.value_props || []).join('\n'))}</textarea></label>
  </div>
  <div class="ng-card"><h2>Módulos</h2><div class="ng-filas">${(e.architecture || []).map((m, k) => `<div class="ng-fila"><div class="ng-form"><label>Nombre<input class="ng-in" data-mod="name" data-k="${k}" value="${esc(m.name || '')}"></label><label>Qué hace<textarea class="ng-in" data-mod="description" data-k="${k}" rows="2">${esc(m.description || '')}</textarea></label></div><button class="btn sm ghost" data-ng="e-quitar" data-l="architecture" data-k="${k}">Quitar</button></div>`).join('')}</div><button class="btn sm ng-esp" data-ng="e-agregar" data-l="architecture">＋ Módulo</button></div>
  <div class="ng-card"><h2>Fases</h2><div class="ng-filas">${(e.phases || []).map((f, k) => `<div class="ng-fila"><div class="ng-form"><label>Fase<input class="ng-in" data-fase="name" data-k="${k}" value="${esc(f.name || '')}"></label><label>Duración<input class="ng-in" data-fase="duration" data-k="${k}" value="${esc(f.duration || '')}"></label><label>Entregables (uno por línea)<textarea class="ng-in" data-fase="deliverables" data-k="${k}" rows="3">${esc((f.deliverables || []).join('\n'))}</textarea></label></div><button class="btn sm ghost" data-ng="e-quitar" data-l="phases" data-k="${k}">Quitar</button></div>`).join('')}</div><button class="btn sm ng-esp" data-ng="e-agregar" data-l="phases">＋ Fase</button></div>
  <div class="ng-card"><h2>Condiciones</h2><div class="ng-grid2">${area('cond_mes', 'Qué incluye la mensualidad')}${area('cond_terceros', 'Costos externos')}${area('cond_tiempo', 'Tiempo')}${area('cond_piloto', 'Piloto y ajustes')}${area('cond_datos', 'Uso de datos')}${area('cond_propiedad', 'Propiedad')}${area('cond_limites', 'Límites')}</div><p class="note">Las que dejés vacías no salen en el PDF.</p></div>`;
  pintarFaltantes();
}

function totalesCot(c = cot) {
  const sub = (b) => c.items.filter((i) => (i.billing || 'one_time') === b).reduce((a, i) => a + Number(i.unit_price || 0) * Number(i.quantity || 0), 0);
  const setup = sub('one_time');
  const desc = c.discount_type === 'amount' ? Number(c.discount_value || 0) : setup * (Number(c.discount_value || 0) / 100);
  const base = Math.max(0, setup - desc);
  const isv = c.tax_enabled ? base * (Number(c.tax_rate || 0) / 100) : 0;
  return { setup, desc, isv, total: base + isv, mensual: sub('monthly'), anual: sub('yearly') };
}
function pintarItems() {
  const tb = $('#ng-items');
  if (!tb) return;
  // Cada concepto es una tarjeta: nombre grande, descripción que crece con el texto y los números en su propia columna.
  const filas = (t) => Math.min(14, Math.max(3, String(t || '').split('\n').length + Math.ceil(String(t || '').length / 90)));
  tb.innerHTML = cot.items.map((i, k) => `<div class="ng-item" data-k="${k}">
    <div class="ng-item-txt">
      <label><span>Concepto ${cot.items.length > 1 ? k + 1 : ''}</span><input class="ng-in ng-item-nombre" data-i="name" value="${esc(i.name)}" placeholder="Ej.: Página web Pro"></label>
      <label><span>Descripción</span><textarea class="ng-in" data-i="description" rows="${filas(i.description)}" placeholder="Qué incluye. Una línea por cosa; una línea que termina en «:» se ve como título en el PDF.">${esc(i.description || '')}</textarea></label>
    </div>
    <div class="ng-item-num">
      <label><span>Cobro</span><select class="ng-in" data-i="billing">${Object.entries(COBRO).map(([v, t]) => `<option value="${v}" ${v === (i.billing || 'one_time') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div class="ng-item-cp">
        <label><span>Cant.</span><input class="ng-in num" data-i="quantity" type="number" step="1" min="1" value="${esc(i.quantity ?? 1)}"></label>
        <label><span>Precio</span><input class="ng-in num" data-i="unit_price" type="number" step="0.01" value="${esc(i.unit_price ?? 0)}"></label>
      </div>
      <div class="ng-item-sub"><span>Subtotal</span><b>${L(Number(i.unit_price || 0) * Number(i.quantity || 0), cot.currency)}</b></div>
      <button class="btn sm ghost" data-ng="quitar-linea" data-k="${k}">Quitar</button>
    </div>
  </div>`).join('');
  pintarTotales();
}
function pintarTotales() {
  const t = totalesCot();
  const el = $('#ng-totales');
  if (el) el.innerHTML = `<div><span>Subtotal</span><b>${L(t.setup, cot.currency)}</b></div>${t.desc ? `<div><span>Descuento</span><b>− ${L(t.desc, cot.currency)}</b></div>` : ''}${t.isv ? `<div><span>ISV</span><b>${L(t.isv, cot.currency)}</b></div>` : ''}
    <div class="tot"><span>Total del proyecto</span><b>${L(t.total, cot.currency)}</b></div>${t.mensual ? `<div><span>Mensual</span><b>${L(t.mensual, cot.currency)} / mes</b></div>` : ''}${t.anual ? `<div><span>Anual</span><b>${L(t.anual, cot.currency)} / año</b></div>` : ''}`;
}

async function guardarCot() {
  const datos = { ...Object.fromEntries(['client_name', 'client_company', 'client_phone', 'client_email', 'client_rtn', 'client_contact_name', 'client_contact_role', 'seller_id', 'currency', 'fx_rate', 'valid_until', 'discount_type', 'discount_value', 'tax_enabled', 'tax_rate', 'notes', 'dev_brief'].map((k) => [k, cot[k]])), items: cot.items, client_id: cot.client_id || null, is_enterprise: Boolean(cot.is_enterprise), enterprise_data: cot.enterprise_data || null };
  const r = cot.id ? await api(`/cotizaciones/${cot.id}`, { method: 'PUT', body: datos }) : await api('/cotizaciones', { method: 'POST', body: datos });
  if (!cot.id) ir(`#/cotizaciones/${r.id}`); else editorCotizacion(cot.id);
}

// Hoja imprimible (el navegador la guarda como PDF).
// Descripción de un concepto para el PDF: "Incluye:" como subtítulo, las líneas siguientes como lista.
function descPdf(txt) {
  const lineas = String(txt || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  let html = '', lista = false;
  const cerrar = () => { if (lista) { html += '</ul>'; lista = false; } };
  for (const l of lineas) {
    if (/:$/.test(l)) { cerrar(); html += `<div class="sub">${esc(l.slice(0, -1))}</div><ul>`; lista = true; continue; }
    const m = l.match(/^([^:]{2,30}):\s+(.+)$/);
    if (!lista && m) { html += `<p><b>${esc(m[1])}:</b> ${esc(m[2])}</p>`; continue; }
    if (lista) html += `<li>${esc(l.replace(/^[-•*]\s*/, '').replace(/\.$/, ''))}</li>`;
    else html += `<p>${esc(l)}</p>`;
  }
  cerrar();
  return html;
}
// El PDF se arma en el servidor (cresova/cotizacion-pdf.mjs): el mismo para todos, listo para mandar al cliente.
function pdfCotizacion(id) {
  window.open(`/api/cresova/cotizaciones/${id}/pdf`, '_blank', 'noopener');
}

// =================== TESORERÍA ===================
const ft = { periodo: 'mes' };
const rango = () => {
  const d = new Date(Date.now() - 6 * 3600e3), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const iso = (a, b, c) => new Date(Date.UTC(a, b, c)).toISOString().slice(0, 10);
  return ({ mes: [iso(y, m, 1), iso(y, m + 1, 0)], anterior: [iso(y, m - 1, 1), iso(y, m, 0)], tres: [iso(y, m - 2, 1), iso(y, m + 1, 0)], anio: [iso(y, 0, 1), iso(y, 11, 31)] })[ft.periodo];
};
const SUB_T = [['resumen', 'Resumen'], ['gastos', 'Gastos'], ['cuentas', 'Cuentas'], ['fijos', 'Costos fijos'], ['planilla', 'Planilla']];
async function tesoreria(sub) {
  const el = caja('ng-tesoreria');
  const nav = `<header class="ng-head"><div><h1>Tesorería</h1><p>Lo que entra, lo que sale y cuánto queda</p></div><div class="ng-acciones"><button class="btn" data-ng="t-retiro">Registrar retiro</button><button class="btn principal" data-ng="t-gasto">Registrar gasto</button></div></header>
    <div class="ng-tabs">${SUB_T.map(([k, t]) => `<a class="tab-btn ${sub === k ? 'on' : ''}" href="#/tesoreria/${k}">${t}</a>`).join('')}</div>`;
  if (sub === 'gastos') return gastosVista(el, nav);
  if (sub === 'cuentas') return cuentasVista(el, nav);
  if (sub === 'fijos') {
    const f = await api('/costos-fijos');
    el.innerHTML = `${nav}<div class="ng-card ng-tabla-wrap"><table class="ng-tabla"><thead><tr><th>Nombre</th><th>Proveedor</th><th>Categoría</th><th>Frecuencia</th><th>Día</th><th class="r">Monto</th></tr></thead><tbody>
      ${f.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.vendor || '')}</td><td>${esc(x.categoria || '')}</td><td>${esc(({ monthly: 'Mensual', quarterly: 'Trimestral', yearly: 'Anual' })[x.frequency] || x.frequency || '')}</td><td>${esc(x.due_day || '')}</td><td class="r">${L(x.amount, x.currency)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin costos fijos.</td></tr>'}</tbody></table></div>`;
    return;
  }
  if (sub === 'planilla') {
    const [p, yo] = await Promise.all([api('/planilla'), api('/personales').catch(() => null)]);
    const mesN = (m) => new Date(`${m}-15`).toLocaleDateString('es-HN', { month: 'long', year: 'numeric' });
    el.innerHTML = `${nav}${yo ? `<div class="ng-card"><h2>Lo que recibiste vos</h2><p class="note">Tus gastos personales y retiros cuentan como parte de tu nómina: ya están descontados del negocio.</p>
      <div class="ng-tabla-wrap"><table class="ng-tabla"><thead><tr><th>Mes</th><th class="r">Nómina pagada</th><th class="r">Gastos personales y retiros</th><th class="r">Total recibido</th></tr></thead><tbody>${yo.meses.map((m) => `<tr><td><b>${mesN(m.mes)}</b></td><td class="r">${L(m.nomina)}</td><td class="r">${L(m.personales)}${m.n ? ` <small>${m.n}</small>` : ''}</td><td class="r"><b>${L(m.nomina + m.personales)}</b></td></tr>`).join('')}</tbody></table></div>
      ${yo.recientes.length ? `<details><summary class="link">Últimos gastos personales y retiros</summary>${yo.recientes.map((r) => `<div class="ng-linea"><span>${esc(String(r.description || '').replace(/\s*\[ref:[^\]]*\]/, ''))}<small>${fecha(r.fecha)}${r.cuenta ? ` · ${esc(r.cuenta)}` : ''}</small></span><b>${L(r.monto)}</b></div>`).join('')}</details>` : ''}</div>` : ''}<div class="ng-card ng-tabla-wrap"><table class="ng-tabla"><thead><tr><th>Mes</th><th>Vendedor</th><th class="r">Base</th><th class="r">Comisión</th><th class="r">Total</th><th>Pagado</th><th>Cuenta</th></tr></thead><tbody>
      ${p.map((x) => `<tr><td>${esc(String(x.period_month || '').slice(0, 7))}</td><td>${esc(x.vendedor || '')}</td><td class="r">${L(x.base_amount)}</td><td class="r">${L(x.commission_amount)}</td><td class="r"><b>${L(x.total_amount)}</b></td><td>${fecha(x.paid_at)}</td><td>${esc(x.cuenta || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin pagos de planilla.</td></tr>'}</tbody></table></div>`;
    return;
  }
  const [desde, hasta] = rango();
  const r = await api(`/tesoreria?desde=${desde}&hasta=${hasta}`);
  const maxMes = Math.max(1, ...r.meses.flatMap((m) => [m.ingresos, m.gastos]));
  const maxCat = Math.max(1, ...r.porCategoria.map((c) => c.monto));
  el.innerHTML = `${nav}
    <div class="ng-filtros"><div class="ng-tabs">${[['mes', 'Este mes'], ['anterior', 'Mes anterior'], ['tres', 'Últimos 3 meses'], ['anio', 'Este año']].map(([k, t]) => `<button class="tab-btn ${ft.periodo === k ? 'on' : ''}" data-ng="t-periodo" data-v="${k}">${t}</button>`).join('')}</div><span class="muted">${fecha(r.desde)} – ${fecha(r.hasta)}</span></div>
    ${r.sinCuenta.n ? `<div class="ng-alerta">⚠️ <b>${r.sinCuenta.n} pago(s) sin cuenta asignada · ${L(r.sinCuenta.monto)}</b>. El saldo real puede ser mayor. <a class="btn sm" href="#/tesoreria/cuentas">Asignar ahora</a></div>` : ''}
    ${r.sinCategoria ? `<div class="ng-alerta"><span><b>${r.sinCategoria} gastos sin categoría.</b> Hay sugerencias listas para aplicar con un clic.</span><a class="btn sm" href="#/tesoreria/gastos">Clasificar</a></div>` : ''}
    <div class="ng-kpis c2">
      ${kpi('Saldo esperado en cuentas', L(r.saldo), `Después de pagos pendientes: <b>${L(r.saldo - r.por_pagar)}</b>${r.por_pagar ? ` · ${L(r.por_pagar)} por pagar` : ''}`, r.saldo >= 0 ? 'ok big' : 'bad big')}
      <div class="ng-kpi"><small>Saldo por cuenta</small>${r.cuentas.map((c) => `<div class="ng-linea"><span>${esc(c.name)}</span><b class="${c.saldo >= 0 ? 'okc' : 'badc'}">${L(c.saldo)}</b></div>`).join('')}</div>
    </div>
    <div class="ng-kpis c5">${kpi('Ingresos', L(r.ingresos), 'Pagos recibidos en el período', 'ok')}${kpi('Gastos', L(r.gastos), 'Pagados, sin dinero de clientes', 'bad')}${kpi('Utilidad estimada', L(r.utilidad), 'Ingresos − gastos', r.utilidad >= 0 ? 'ok' : 'bad')}${kpi('Por cobrar', L(r.por_cobrar), 'Saldo de aceptadas', 'info')}${kpi('Publicidad Cresova', L(r.publicidad), r.administrado ? `+ ${L(r.administrado)} de clientes` : '', 'bad')}</div>
    <div class="ng-grid2">
      <div class="ng-card"><h2>Ingresos vs gastos (6 meses)</h2><div class="ng-chart">${r.meses.map((m) => `<div class="ng-mes"><div class="ng-barras"><i class="in" style="height:${(m.ingresos / maxMes) * 100}%" title="Ingresos ${L(m.ingresos)}"></i><i class="out" style="height:${(m.gastos / maxMes) * 100}%" title="Gastos ${L(m.gastos)}"></i></div><small>${new Date(`${m.mes}-15`).toLocaleDateString('es-HN', { month: 'short' })}</small><small class="${m.ingresos - m.gastos >= 0 ? 'okc' : 'badc'}">${L(Math.round(m.ingresos - m.gastos))}</small></div>`).join('')}</div>
        <div class="ng-legend"><span><i class="in"></i>Ingresos</span><span><i class="out"></i>Gastos</span><span>abajo: utilidad</span></div></div>
      <div class="ng-card"><h2>Gastos por categoría</h2>${r.porCategoria.map((c) => `<div class="ng-cat"><span>${esc(c.categoria)} <small>(${c.n})</small></span><div class="ng-bar"><i class="out" style="width:${(c.monto / maxCat) * 100}%"></i></div><b>${L(c.monto)}</b></div>`).join('') || '<div class="empty">Sin gastos en el período.</div>'}</div>
    </div>
    <div class="ng-card"><h2>Próximos pagos pendientes</h2>${r.proximos.map((e) => `<div class="ng-linea"><span><b>${esc(e.description || '')}</b><small>${esc(e.vendor || '')} · ${fecha(e.expense_date)}</small></span><b>${L(e.amount, e.currency)}</b></div>`).join('') || '<div class="empty">Sin gastos pendientes.</div>'}</div>`;
}

const fg = { q: '', categoria: '', estado: '', sinCategoria: false };
async function gastosVista(el, nav) {
  const [desde, hasta] = rango();
  let sug = null;
  const [lista, cats, ctas] = await Promise.all([api(`/gastos?desde=${fg.sinCategoria ? '' : desde}&hasta=${fg.sinCategoria ? '' : hasta}&q=${encodeURIComponent(fg.q)}&categoria=${fg.categoria}&estado=${fg.estado}&sinCategoria=${fg.sinCategoria ? 1 : ''}`), categorias(), cuentas()]);
  try { sug = await api('/gastos-sugerencias'); } catch {}
  const opt = (arr, sel, vacio) => `<option value="">${vacio}</option>${arr.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.label || x.name)}</option>`).join('')}`;
  el.innerHTML = `${nav}
    <div class="ng-filtros">
      <input type="search" class="ng-in" id="ng-g-q" placeholder="Buscar descripción o proveedor" value="${esc(fg.q)}">
      <select class="ng-in" data-ng="g-filtro" data-k="categoria">${opt(cats, fg.categoria, 'Todas las categorías')}</select>
      <select class="ng-in" data-ng="g-filtro" data-k="estado"><option value="">Todos</option><option value="paid" ${fg.estado === 'paid' ? 'selected' : ''}>Pagados</option><option value="pending" ${fg.estado === 'pending' ? 'selected' : ''}>Pendientes</option></select>
      <button class="chip ${fg.sinCategoria ? 'on' : ''}" data-ng="g-sincat">🏷️ Sin categoría</button>
      <span class="muted">${fg.sinCategoria ? 'Todas las fechas' : `${fecha(desde)} – ${fecha(hasta)} (cambialo en Resumen)`} · ${lista.length} gastos · ${L(lista.reduce((a, g) => a + Number(g.amount_hnl || 0), 0))}</span>
    </div>
    ${sug && (sug.grupos.length || sug.sinSugerencia.n) ? `<div class="ng-card g-sug"><h2>Gastos sin categoría <span class="muted">${sug.grupos.reduce((s, g) => s + g.n, 0) + sug.sinSugerencia.n} en total</span></h2>
      ${sug.grupos.map((g) => `<div class="g-sug-f"><span><b>${esc(g.label)}</b><small>${g.n} ${g.n === 1 ? 'gasto' : 'gastos'} · ${L(g.monto)} · ${esc(g.proveedores.join(', '))} · ${esc(g.motivo)}</small></span><button class="btn ok sm" data-ng="g-aplicar" data-cat="${esc(g.category_id)}" data-ids="${esc(g.ids.join(','))}">Aplicar</button></div>`).join('')}
      ${sug.sinSugerencia.n ? `<p class="note">${sug.sinSugerencia.n} sin sugerencia (${L(sug.sinSugerencia.monto)})${sug.sinSugerencia.personales ? `, de ellos ${sug.sinSugerencia.personales} marcados como personales` : ''}: ${esc(sug.sinSugerencia.ejemplos.join(', '))}. Esos los clasificás vos en la tabla.</p>` : ''}</div>` : ''}
    <details class="ng-card"><summary class="btn principal sm">+ Registrar gasto</summary><div class="ng-form ng-nuevo" id="ng-g-nuevo">
      <label>Fecha<input class="ng-in" data-g="expense_date" type="date" value="${hoy()}"></label><label>Monto<input class="ng-in" data-g="amount" type="number" step="0.01"></label>
      <label>Moneda<select class="ng-in" data-g="currency"><option>HNL</option><option>USD</option></select></label><label>Tipo de cambio<input class="ng-in" data-g="fx_rate" type="number" step="0.01" value="1"></label>
      <label>Descripción<input class="ng-in" data-g="description"></label><label>Proveedor<input class="ng-in" data-g="vendor"></label>
      <label>Categoría<select class="ng-in" data-g="category_id">${opt(cats, '', '—')}</select></label><label>Cuenta<select class="ng-in" data-g="account_id">${opt(ctas, '', '—')}</select></label>
      <label>Estado<select class="ng-in" data-g="status"><option value="paid">Pagado</option><option value="pending">Pendiente</option></select></label>
      <div><button class="btn ok" data-ng="g-crear">Guardar gasto</button></div></div></details>
    <div class="ng-card ng-tabla-wrap"><table class="ng-tabla"><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Cuenta</th><th>Estado</th><th class="r">Monto</th><th></th></tr></thead><tbody>
      ${lista.map((g) => `<tr data-gid="${g.id}"><td>${fecha(g.paid_at || g.expense_date)}</td><td><b>${esc(g.description || '')}</b><small>${esc(g.vendor || '')}${g.source === 'n8n' ? ' · 📧 n8n' : ''}${g.quote_number ? ` · ${esc(g.quote_number)}` : ''}</small></td>
        <td><select class="ng-in sm" data-ng="g-campo" data-k="category_id">${opt(cats, g.category_id, '— sin categoría —')}</select></td>
        <td><select class="ng-in sm" data-ng="g-campo" data-k="account_id">${opt(ctas, g.account_id, '—')}</select></td>
        <td><select class="ng-in sm" data-ng="g-campo" data-k="status"><option value="paid" ${g.status === 'paid' ? 'selected' : ''}>Pagado</option><option value="pending" ${g.status === 'pending' ? 'selected' : ''}>Pendiente</option></select></td>
        <td class="r"><b>${L(g.amount, g.currency)}</b>${g.currency && g.currency !== 'HNL' ? `<small>≈ ${L(g.amount_hnl)}</small>` : ''}</td><td class="r"><button class="btn sm ghost" data-ng="g-borrar">🗑️</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin gastos con estos filtros.</td></tr>'}
    </tbody></table></div>`;
}

async function cuentasVista(el, nav) {
  const [r, sinCta, trans] = await Promise.all([api('/tesoreria'), api('/pagos-sin-cuenta'), api('/transferencias')]);
  const ctas = r.cuentas;
  const opt = (sel) => `<option value="">Cuenta…</option>${ctas.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  el.innerHTML = `${nav}
    <div class="ng-kpis c3">${ctas.map((c) => kpi(c.name, L(c.saldo), esc(c.holder || ''), c.saldo >= 0 ? 'ok' : 'bad')).join('')}</div>
    <div class="ng-card"><h2>Pagos de clientes sin cuenta (${sinCta.length})</h2>
      ${sinCta.map((p) => `<div class="ng-linea"><span><b>${esc(p.client_company || p.client_name || '')}</b><small>${esc(p.quote_number)} · ${fecha(p.paid_at)}</small></span><b>${L(p.amount)}</b><select class="ng-in sm" data-ng="asignar-cuenta" data-id="${p.id}">${opt('')}</select></div>`).join('') || '<div class="empty">Todos los pagos tienen cuenta. 👍</div>'}</div>
    <div class="ng-card"><h2>Transferir entre cuentas</h2><div class="ng-row"><select class="ng-in" id="tr-desde">${opt('')}</select>→<select class="ng-in" id="tr-hacia">${opt('')}</select><input class="ng-in" id="tr-monto" type="number" step="0.01" placeholder="Monto"><input class="ng-in" id="tr-fecha" type="date" value="${hoy()}"><input class="ng-in" id="tr-nota" placeholder="Nota"><button class="btn ok" data-ng="transferir">Transferir</button></div>
      ${trans.map((t) => `<div class="ng-linea"><span>${fecha(t.transfer_date)} · ${esc(t.desde || '?')} → ${esc(t.hacia || '?')}<small>${esc(t.notes || t.reference || '')}</small></span><b>${L(t.amount)}</b></div>`).join('')}</div>`;
}

// =================== CLIENTES ===================
const fcl = { q: '', estado: '', pag: 0 };
let clTodos = [];
async function listaClientes(recargar = true) {
  const el = caja('ng-clientes');
  if (recargar) clTodos = await api(`/clientes?q=${encodeURIComponent(fcl.q)}`);
  const cuenta = (k) => (k ? clTodos.filter((c) => c.status === k).length : clTodos.length);
  const l = clTodos.filter((c) => !fcl.estado || c.status === fcl.estado);
  const TAM = 25;
  fcl.pag = Math.min(fcl.pag, Math.max(0, Math.ceil(l.length / TAM) - 1));
  el.innerHTML = `<header class="ng-head"><div><h1>Clientes</h1><p>${l.length} ${fcl.q ? 'con esa búsqueda' : l.length === 1 ? 'cliente' : 'clientes'}</p></div><button class="btn principal" data-ng="nuevo-cliente">+ Nuevo cliente</button></header>
    <div class="ng-filtros"><input type="search" class="ng-in" id="ng-cl-q" placeholder="Buscar nombre, negocio, teléfono o rubro" value="${esc(fcl.q)}">
      <div class="ng-tabs">${[['', 'Todos'], ['active', 'Activos'], ['lead', 'Prospectos'], ['paused', 'Pausados'], ['closed', 'Cerrados']].map(([k, t]) => `<button class="tab-btn ${fcl.estado === k ? 'on' : ''}" data-ng="cl-estado" data-v="${k}">${t} <small>${cuenta(k)}</small></button>`).join('')}</div></div>
    <div class="ng-card ng-tabla-wrap"><table class="ng-tabla"><thead><tr><th>Cliente</th><th>Rubro</th><th>Teléfono</th><th>Estado</th><th class="r">Cotizaciones</th><th class="r">Vendido</th><th class="r">Pagado</th><th>Última</th></tr></thead><tbody>
      ${pagina(l, fcl.pag, TAM).map((c) => `<tr data-ng="abrir-cliente" data-id="${c.id}"><td><b class="fi-enlace" data-ficha="cliente:${c.id}" title="Ver todo de este cliente">${esc(c.business_name || c.name)}</b>${c.business_name && c.name ? `<small>${esc(c.name)}</small>` : ''}</td><td>${esc(c.sector || '')}</td><td>${esc(c.phone || '')}</td>
        <td><span class="ng-st ${esc(c.status)}">${esc(({ lead: 'Prospecto', active: 'Activo', paused: 'Pausado', closed: 'Cerrado' })[c.status] || c.status || '')}</span></td><td class="r">${c.cotizaciones}</td><td class="r">${L(c.vendido)}</td><td class="r">${L(c.pagado)}</td><td class="muted">${fecha(c.ultima || c.created_at)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Sin clientes.</td></tr>'}
    </tbody></table></div>${controles(l.length, fcl.pag, TAM, 'data-cl-pg')}`;
}
let cli = null;
async function fichaCliente(id) {
  const el = caja('ng-clientes');
  cli = id === 'nuevo' ? { id: null, status: 'lead', cotizaciones: [], tareas: [] } : await api(`/clientes/${id}`);
  const campo = (k, label) => `<label>${label}<input class="ng-in" data-cl="${k}" value="${esc(cli[k] ?? '')}"></label>`;
  el.innerHTML = `<header class="ng-head"><div><a class="link" href="#/clientes">← Clientes</a><h1>${esc(cli.business_name || cli.name || 'Nuevo cliente')}</h1></div><div class="ng-acciones">${cli.phone ? `<button class="btn" data-ng="copiar-tel" data-tel="${esc(cli.phone)}" title="Copiar teléfono">${ICON_TEL} Copiar teléfono</button>` : ''}<button class="btn ok" data-ng="guardar-cliente">Guardar</button></div></header>
    <div class="ng-card"><div class="ng-form">${campo('name', 'Nombre')}${campo('business_name', 'Negocio')}${campo('phone', 'Teléfono')}${campo('email', 'Correo')}${campo('sector', 'Rubro')}${campo('rtn', 'RTN')}${campo('website_url', 'Sitio web')}
      <label>Estado<select class="ng-in" data-cl="status">${[['lead', 'Prospecto'], ['active', 'Activo'], ['paused', 'Pausado'], ['closed', 'Cerrado']].map(([k, t]) => `<option value="${k}" ${cli.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <label>Notas<textarea class="ng-in" data-cl="notes" rows="3">${esc(cli.notes || '')}</textarea></label></div>
    ${cli.id ? `<div class="ng-card"><h2>Cotizaciones</h2>${cli.cotizaciones.map((x) => `<a class="ng-linea" href="#/cotizaciones/${x.id}"><span><b>${esc(x.quote_number)}</b> ${chipEstado(x.status)} <small>${esc(ETAPA[x.project_status] || '')} · ${fecha(x.created_at)}</small></span><b>${L(x.total, x.currency)}<small>pagado ${L(x.pagado)}</small></b></a>`).join('') || '<div class="empty">Sin cotizaciones.</div>'}</div>
    <div class="ng-card"><h2>Pendientes</h2>${cli.tareas.map((t) => `<div class="ng-linea"><span>${t.status === 'done' ? '✅' : '⬜'} ${esc(t.title)}</span><small>${fecha(t.due_date)}</small></div>`).join('') || '<div class="empty">Sin pendientes.</div>'}</div>
    ${cli.whatsapp ? `<div class="ng-card"><h2>Ventas</h2><div class="ng-ficha">
      <div><small>Lo atiende</small><b>${esc(cli.whatsapp.atiende)}</b></div>
      ${cli.whatsapp.etapa ? `<div><small>Etapa de venta</small><b>${esc(cli.whatsapp.etapa)}</b></div>` : ''}
      <div><small>Demo</small><b>${cli.whatsapp.demo ? `<a href="${esc(cli.whatsapp.demo)}" target="_blank" rel="noopener">Ver demo</a>${cli.whatsapp.demoEnviada ? ` · enviada ${fecha(new Date(cli.whatsapp.demoEnviada).toISOString())}` : ''}` : 'Sin demo enviada'}</b></div>
      <div><small>Paso de cierre</small><b>${cli.whatsapp.cierre?.validado ? '✅ Anticipo pagado' : cli.whatsapp.cierre?.comprobante ? 'Comprobante esperando tu validación' : cli.whatsapp.cierre?.enviada ? `Cuenta enviada (L ${Number(cli.whatsapp.cierre.monto || 0).toLocaleString('en-US')})` : 'Todavía no'}</b></div>
    </div>${cli.whatsapp.proximos?.length ? `<h3 class="ng-sub">Va a salir solo</h3>${cli.whatsapp.proximos.map((x) => `<div class="ng-linea"><span>${esc(x)}</span></div>`).join('')}` : '<p class="muted">No tiene mensajes programados.</p>'}</div>
    <div class="ng-card"><h2>Conversación de WhatsApp <span class="muted">${cli.whatsapp.anuncio ? `vino del anuncio «${esc(cli.whatsapp.anuncio.titulo || cli.whatsapp.anuncio.id || '')}»` : 'sin anuncio registrado'}${cli.whatsapp.pausa ? ` · bot en pausa: ${esc(cli.whatsapp.pausa)}` : ''}</span></h2>
      <div class="ng-chat">${cli.whatsapp.mensajes.map((m) => `<div class="ng-msg ${m.quien}${m.previo ? ' previo' : ''}"><small>${({ cliente: esc(cli.business_name || cli.name || 'Cliente'), bot: 'Vendedor IA', equipo: 'Equipo' })[m.quien]} · ${new Date(m.ts).toLocaleString('es-HN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Tegucigalpa' })}</small>${esc(m.texto).replace(/\n/g, '<br>')}</div>`).join('') || '<div class="empty">Sin mensajes.</div>'}</div>
      <div class="ng-row"><a class="btn" href="#/ventas">Abrir en Ventas</a></div></div>` : cli.phone ? '<div class="ng-card"><h2>Conversación de WhatsApp</h2><div class="empty">Este número no ha escrito al WhatsApp de ventas desde que la oficina atiende (o fue por tu teléfono personal).</div></div>' : ''}` : ''}`;
}

// =================== PENDIENTES ===================
const fp = { estado: 'pending', tipo: 'todas', mas: false };
let tkLista = [];
const tkVencida = (t) => t.status !== 'done' && t.due_date && String(t.due_date).slice(0, 10) < hoy();
const tkAuto = (t) => t.source === 'auto' || t.source === 'velforce';
const DIA_MS = 864e5;
const tkViejas = () => tkLista.filter((t) => tkAuto(t) && tkVencida(t) && Date.now() - new Date(`${String(t.due_date).slice(0, 10)}T12:00:00`).getTime() > 30 * DIA_MS);
async function pendientes(recargar = true) {
  const el = caja('ng-pendientes');
  if (recargar) tkLista = await api(`/tareas?estado=${fp.estado}`);
  const b = document.getElementById('badge-pendientes');
  if (b && fp.estado === 'pending') b.textContent = tkLista.filter(tkVencida).length || '';
  const l = tkLista.filter((t) => fp.tipo === 'todas' || (fp.tipo === 'auto' ? tkAuto(t) : !tkAuto(t)));
  const fila = (t) => `<div class="ng-tarea ${t.status === 'done' ? 'hecha' : ''} ${tkVencida(t) ? 'vencida' : ''}" data-tid="${t.id}">
      <input type="checkbox" data-ng="tk-check" ${t.status === 'done' ? 'checked' : ''}><span class="ng-prio ${esc(t.priority)}"></span>
      <span class="t"><b>${esc(t.title)}</b><small>${[t.cliente || t.cliente_nombre, t.quote_number, t.source === 'velforce' ? 'Velforce' : t.source === 'auto' ? 'automática' : ''].filter(Boolean).map(esc).join(' · ')}</small></span>
      <small class="${tkVencida(t) ? 'badc' : 'muted'}">${t.due_date ? fecha(t.due_date) : ''}</small><button class="btn sm ghost" data-ng="tk-borrar">Quitar</button></div>`;
  const h = hoy();
  const venc = l.filter(tkVencida).sort((a, b2) => String(b2.due_date).localeCompare(String(a.due_date)));
  const deHoy = l.filter((t) => String(t.due_date || '').slice(0, 10) === h);
  const prox = l.filter((t) => t.due_date && String(t.due_date).slice(0, 10) > h);
  const sin = l.filter((t) => !t.due_date);
  const hechas = fp.estado !== 'pending' ? l.filter((t) => t.status === 'done' && !tkVencida(t) && String(t.due_date || '').slice(0, 10) <= h && t.due_date) : [];
  const grupo = (t, lst, abierto = true) => (lst.length ? `<details class="ng-card tk-g" ${abierto ? 'open' : ''}><summary>${t} <small>${lst.length}</small></summary>${lst.map(fila).join('')}</details>` : '');
  const TOPE = 15, visibles = fp.mas ? venc : venc.slice(0, TOPE), viejas = tkViejas();
  el.innerHTML = `<header class="ng-head"><div><h1>Pendientes</h1><p>${l.length} tareas · las de los agentes están en Equipo → Tablero</p></div></header>
    <div class="ng-card ng-row tk-nuevo"><input class="ng-in" id="tk-titulo" placeholder="Nuevo pendiente…"><input class="ng-in" id="tk-fecha" type="date"><select class="ng-in" id="tk-prio"><option value="medium">Prioridad media</option><option value="high">Alta</option><option value="low">Baja</option></select><button class="btn ok" data-ng="tk-crear">Agregar</button></div>
    <div class="ng-filtros"><div class="ng-tabs">${[['pending', 'Por hacer'], ['done', 'Hechas'], ['all', 'Todas']].map(([k, t]) => `<button class="tab-btn ${fp.estado === k ? 'on' : ''}" data-ng="tk-estado" data-v="${k}">${t}</button>`).join('')}</div>
      <div class="chips">${[['todas', 'Todas'], ['mias', 'Las mías'], ['auto', 'Automáticas']].map(([k, t]) => `<button class="chip ${fp.tipo === k ? 'on' : ''}" data-ng="tk-tipo" data-v="${k}">${t}</button>`).join('')}</div></div>
    ${fp.estado === 'pending' && viejas.length ? `<div class="ng-alerta"><span><b>${viejas.length} tareas automáticas</b> llevan más de 30 días vencidas.</span><button class="btn sm" data-ng="tk-limpiar">Marcarlas como hechas</button></div>` : ''}
    ${grupo('Hoy', deHoy)}${grupo('Próximas', prox)}
    ${venc.length ? `<details class="ng-card tk-g" open><summary>Vencidas <small>${venc.length}</small></summary>${visibles.map(fila).join('')}${venc.length > TOPE && !fp.mas ? `<button class="btn sm" data-ng="tk-mas">Ver las ${venc.length - TOPE} restantes</button>` : ''}</details>` : ''}
    ${grupo('Sin fecha', sin, false)}${grupo('Hechas', hechas, false)}
    ${l.length ? '' : '<div class="ng-card empty">Nada por aquí.</div>'}`;
}

// =================== CEO ===================
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('es-HN', { maximumFractionDigits: 0 }));
async function ceo() {
  const el = caja('ng-ceo');
  const p = await fetch('/api/ceo').then((r) => r.json());
  const m = p.marcador;
  const pct = Math.min(100, Math.round((m.cobrado_mes / m.meta) * 100));
  const fila = (t, v) => `<div class="cz-dato"><small>${esc(t)}</small><b>${v}</b></div>`;
  const RES = { 'funcionó': 'bien', 'no funcionó': 'mal', 'no concluyente': 'neutro' };
  const cambio = (c) => `<article class="cz-cambio ${esc(c.estado)}">
    <div class="cz-c-top"><b>${esc(c.cambio)}</b><span class="cz-est ${c.estado === 'cerrado' ? RES[c.resultado] || 'neutro' : c.vence ? 'vence' : 'abierto'}">${esc(c.estado === 'cerrado' ? c.resultado : c.vence ? 'Toca revisar' : `Se revisa el ${c.revisar_el}`)}</span></div>
    <p>${esc(c.por_que)}</p>
    <div class="cz-num"><div><small>Antes</small><b>${num(c.antes)}</b></div><div><small>Predijo</small><b>${num(c.prediccion)}</b></div><div><small>${c.estado === 'cerrado' ? 'Después' : 'Hoy'}</small><b>${num(c.estado === 'cerrado' ? c.despues : c.serie?.at(-1)?.valor)}</b></div><span>${esc(p.metricas[c.metrica]?.nombre || c.metrica)}</span></div>
    ${c.aprendizaje ? `<p class="cz-ap"><b>Aprendió:</b> ${esc(c.aprendizaje)}</p>` : ''}
    ${c.revertido ? `<p class="muted">${esc(c.revertido.por)} volvió a la versión anterior.</p>` : c.se_puede_revertir ? `<div><button class="btn sm no" data-ng="ceo-revertir" data-v="${esc(c.id)}">Volver a como estaba</button></div>` : ''}
  </article>`;
  el.innerHTML = `<header class="ng-head"><div><h1>CEO</h1><p>Meta: ${L(m.meta)} cobrados al mes</p></div></header>
    <div class="ng-card cz-meta">
      <div class="cz-gran"><b>${L(m.cobrado_mes)}</b><span>cobrados este mes, faltan ${L(m.falta)}</span></div>
      <div class="cz-barra"><i style="width:${pct}%"></i></div>
      <div class="cz-datos">${fila('Hace falta por día', L(m.necesario_por_dia))}${fila('Días que quedan', m.dias_restantes)}${fila('Anticipos cobrados', m.anticipos_mes)}${fila('Por cobrar', L(m.por_cobrar))}${fila('Demos (7 días)', m.demos_7d)}${fila('Leads (7 días)', m.leads_7d)}${fila('Llamadas por hacer', m.llamadas)}</div>
    </div>
    ${p.checklist?.length ? `<div class="ng-card"><h2>Revisión de hoy</h2>${p.tema_del_dia ? `<p class="muted">Tema a fondo: ${esc(p.tema_del_dia.tema)}</p>` : ''}<div class="cz-chk">${p.checklist.map((a) => `<div class="cz-area ${esc(a.estado)}" title="${esc(a.accion || a.nota)}"><b>${esc(a.nombre)}</b><small>${a.revisada ? esc(a.nota) || 'Revisada' : 'Sin revisar todavía'}</small>${a.accion ? `<span>${esc(a.accion)}</span>` : ''}</div>`).join('')}</div></div>` : ''}
    ${p.embudo ? `<div class="ng-card"><h2>Dónde está cada venta</h2><p class="muted">Clientes con demo o cuenta de los últimos 30 días.</p><div class="cz-datos">${[['Demo enviada', p.embudo.enviada], ['Respondió', p.embudo.respondio], ['Le gustó', p.embudo.gusto], ['Pidió cambios', p.embudo.cambios], ['Tiene dudas', p.embudo.dudas], ['Cuenta enviada', p.embudo.cuenta], ['Comprobante', p.embudo.comprobante], ['Pagó', p.embudo.pago]].map(([t, v]) => `<div class="cz-dato"><small>${t}</small><b>${v}</b></div>`).join('')}</div></div>` : ''}
    ${p.equipo ? `<div class="ng-card"><h2>Qué cuesta y qué trae cada área</h2><p class="muted">Últimos 30 días. Los leads sin origen conocido aparecen como "sin dato" (${p.equipo.fuentes_30d.sin_dato?.leads || 0}).</p><div class="ng-tabla-wrap"><table class="ng-tabla"><thead><tr><th>Área</th><th class="r">Entregas (7 d)</th><th class="r">Costo IA estimado</th><th class="r">Leads</th><th class="r">Demos</th><th class="r">Anticipos</th></tr></thead><tbody>${p.equipo.areas.map((a) => `<tr><td>${esc({ contenido: 'Contenido', pauta: 'Anuncios', ventas: 'Ventas', prospeccion: 'Prospección', direccion: 'Dirección' }[a.area])}</td><td class="r">${a.entregas_7d}</td><td class="r">${a.costo_ia_usd_estimado == null ? '—' : `US$ ${a.costo_ia_usd_estimado}`}</td><td class="r">${a.leads_30d || '—'}</td><td class="r">${a.demos_30d || '—'}</td><td class="r">${a.anticipos_30d || '—'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    ${p.aprendizajes?.length ? `<div class="ng-card"><h2>Lo que ya sabemos que funciona</h2>${p.aprendizajes.map((a) => `<div class="cz-dec"><b>${esc(a.que)}</b><span>${esc(a.aprendizaje)}</span><small>${esc(a.resultado)}: ${esc(a.evidencia)}</small><div><button class="btn sm ghost" data-ng="ceo-olvidar" data-v="${esc(a.id)}">Quitar</button></div></div>`).join('')}</div>` : ''}
    ${p.grandes?.length ? `<div class="ng-card"><h2>Proyectos grandes abiertos</h2>${p.grandes.map((g) => `<div class="cz-ent"><div><b>${esc(g.cliente)}</b><small>${g.dias_abierta} días abierta</small></div><div><b>${L(g.total)}</b><small>${esc(g.situacion || (g.ultimo_contacto ? `Último contacto: ${g.ultimo_contacto.fecha}` : 'Sin contacto registrado'))}</small></div><div>${g.proximo_paso ? `<span>${esc(g.proximo_paso)}</span><small class="${g.vencida ? 'badc' : ''}">${g.fecha_objetivo ? `Para el ${esc(g.fecha_objetivo)}` : ''}</small>` : '<small>Sin próximo paso todavía</small>'}</div></div>`).join('')}</div>` : ''}
    ${p.entregas?.length ? `<div class="ng-card"><h2>Entregas que destraban plata</h2><p class="muted">${L(p.entregas.reduce((s, e) => s + e.saldo, 0))} se cobran cuando estos proyectos se entreguen.</p>${p.entregas.map((e) => `<div class="cz-ent"><div><b>${esc(e.cliente)}</b><small>${e.dias_desde_aceptada} días desde que aceptó</small></div><div><b>${L(e.saldo)}</b><small>${esc(e.quien)}: ${esc(e.detalle)}</small></div><div>${e.proximo_paso ? `<span>${esc(e.proximo_paso)}</span><small class="${e.vencida ? 'badc' : ''}">${e.fecha_objetivo ? `Para el ${esc(e.fecha_objetivo)}` : ''}</small>` : '<small>Sin próximo paso todavía</small>'}</div></div>`).join('')}</div>` : ''}
    <div class="ng-card"><h2>Hoy</h2>${p.diario[0] ? `<small class="cz-f">${esc(p.diario[0].fecha)}</small><p class="cz-texto">${esc(p.diario[0].texto).replace(/\n/g, '<br>')}</p>` : '<p class="muted">Cuando haga su primera revisión, el resumen aparece acá.</p>'}${p.preguntasEquipo ? `<p class="muted">${p.preguntasEquipo} pregunta(s) del equipo esperando su respuesta.</p>` : ''}</div>
    ${p.ab ? `<div class="ng-card"><h2>Prueba del bot: ${esc(p.ab.nombre)}</h2><p class="muted">Se compara: ${esc(p.ab.metrica_nombre)}. Se revisa el ${esc(p.ab.revisar_el)}.</p><div class="cz-num"><div><small>A (bot actual)</small><b>${p.ab.tasa_A_pct} %</b><small>${p.ab.A.leads} leads</small></div><div><small>B (con el cambio)</small><b>${p.ab.tasa_B_pct} %</b><small>${p.ab.B.leads} leads</small></div><span>${esc(p.ab.veredicto)}. Mínimo ${p.ab.minimo_por_grupo} leads por grupo.</span></div></div>` : ''}
    <div><h2 class="cz-h">Cambios, antes y después</h2>${p.cambios.length ? `<div class="cz-lista">${p.cambios.map(cambio).join('')}</div>` : '<div class="ng-card empty">Cada cambio que haga va a aparecer acá con cómo estaba antes, qué predijo y qué pasó.</div>'}</div>
    ${p.decisiones.length ? `<div class="ng-card"><h2>Lo que resolvió sin preguntarte</h2>${p.decisiones.map((d) => `<div class="cz-dec"><b>${esc(d.pregunta)}</b><span>${esc(d.respuesta)}</span><small>${esc(d.motivo)}</small></div>`).join('')}</div>` : ''}
    ${p.pausados.length ? `<div class="ng-card"><h2>Agentes en pausa</h2>${p.pausados.map((x) => `<div class="cz-dec"><b>${esc(x.agente)}</b><span>Hasta el ${esc(x.hasta)}</span><small>${esc(x.motivo)}</small></div>`).join('')}</div>` : ''}`;
}

// =================== LLAMADAS ===================
const TIPO_LLAMADA = { cuenta: 'Tiene la cuenta', persona: 'Pidió una persona', interes: 'Le interesó', anticipo: 'Falta anticipo', pedida: 'Te la pidió el equipo', compromiso: 'Dijo que haría algo', promesa: 'Promesa pendiente', no_enviado: 'No salió el mensaje', seguimiento: 'Seguimiento' };
let llLista = [], llFiltro = 'todas';
const llAbiertas = new Set();
async function llamadas(recargar = true) {
  const el = caja('ng-llamadas');
  if (recargar) llLista = await fetch('/api/ventas/llamadas').then((r) => r.json());
  const b = document.getElementById('badge-llamadas');
  if (b) b.textContent = llLista.length || '';
  const tipos = [...new Set(llLista.map((c) => c.tipo))];
  if (llFiltro !== 'todas' && !tipos.includes(llFiltro)) llFiltro = 'todas';
  const l = llLista.filter((c) => llFiltro === 'todas' || c.tipo === llFiltro);
  el.innerHTML = `<header class="ng-head"><div><h1>Llamadas</h1><p>${llLista.length ? `${llLista.length === 1 ? '1 cliente' : `${llLista.length} clientes`} por llamar, primero los más cerca de comprar` : 'No hay llamadas pendientes'}</p></div></header>
    ${tipos.length > 1 ? `<div class="chips"><button class="chip ${llFiltro === 'todas' ? 'on' : ''}" data-ng="ll-filtro" data-v="todas">Todas <small>${llLista.length}</small></button>${tipos.map((k) => `<button class="chip ${llFiltro === k ? 'on' : ''}" data-ng="ll-filtro" data-v="${esc(k)}">${esc(TIPO_LLAMADA[k] || k)} <small>${llLista.filter((c) => c.tipo === k).length}</small></button>`).join('')}</div>` : ''}
    ${l.length ? `<div class="ng-llamadas">${l.map((c) => `<details class="ng-card ng-llamada" data-lkey="${esc(c.key)}" ${llAbiertas.has(c.key) ? 'open' : ''}>
      <summary class="ll-res"><div class="ll-nom"><b class="fi-enlace" data-ficha="conv:${esc(c.convId)}" title="Ver todo de este cliente">${esc(c.cliente)}</b><span class="ll-tipo ${esc(c.tipo)}">${esc(TIPO_LLAMADA[c.tipo] || c.tipo)}</span>${c.monto ? `<b class="ll-monto">${L(c.monto)}</b>` : ''}<p>${esc(c.motivo)}</p></div><div class="ll-btns">${telValido(c.telefono) ? `<button class="btn ll-copiar" data-ng="copiar-tel" data-tel="${esc(c.telefono)}" title="Copiar teléfono">${ICON_COPIAR}<span>${esc(telVisible(c.telefono))}</span></button><a class="btn ok" href="tel:+${tel(c.telefono)}">Llamar</a>` : '<span class="ll-sintel">Sin número</span>'}</div></summary>
      <div class="ll-det">
        <p class="ll-cont">${[c.contacto && c.contacto !== c.cliente ? c.contacto : '', c.rubro, telValido(c.telefono) ? `+${tel(c.telefono)}` : ''].filter(Boolean).map(esc).join(' · ')}</p>
        ${c.otros.length ? `<ul class="ll-otros">${c.otros.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
        <p class="ll-decir"><b>Qué decirle:</b> ${esc(c.sugerencia)}</p>
        ${c.ultimos.length ? `<div class="ll-chat">${c.ultimos.map((m) => `<div class="${m.de === 'Cliente' ? 'cli' : ''}"><small>${esc(m.de)}, ${new Date(m.ts).toLocaleString('es-HN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small><span>${esc(m.texto)}</span></div>`).join('')}</div>` : ''}
        <div class="ll-links">${c.demo ? `<a class="link" href="${esc(c.demo)}" target="_blank" rel="noopener">Ver demo</a>` : ''}</div>
        <textarea class="ng-in ll-nota" rows="2" maxlength="500" placeholder="Qué te dijo (queda en la conversación)"></textarea>
        <div class="ng-acciones"><button class="btn ok" data-ng="ll-res" data-v="hecha">Ya lo llamé</button><button class="btn" data-ng="ll-res" data-v="no_contesto">No contestó</button><button class="btn no" data-ng="ll-res" data-v="descartada">Quitar</button></div>
      </div>
    </details>`).join('')}</div>` : '<div class="ng-card empty">Cuando alguien necesite una llamada, aparece acá con lo que tenés que saber.</div>'}`;
}

// =================== ANALÍTICAS ===================
let anVista = 'resumen';
async function analiticas() {
  const el = caja('ng-analiticas');
  const [a, meta] = await Promise.all([api('/analiticas?meses=6'), api('/meta').catch(() => null)]);
  const pc = (x, y) => (y ? Math.round((x / y) * 100) : null);
  const Lr = (n) => `L ${Math.round(n || 0).toLocaleString('en-US')}`;
  const Lk = (n) => (n >= 1000 ? `L ${Math.round(n / 1000)}k` : Lr(n));
  const mes = (m) => new Date(`${m}-15`).toLocaleDateString('es-HN', { month: 'short' }).replace('.', '');
  const mesL = (m) => new Date(`${m}-15`).toLocaleDateString('es-HN', { month: 'long', year: 'numeric' });
  const C = a.cohortes;
  const tot = C.reduce((s, c) => ({ cl: s.cl + c.clientes, co: s.co + c.cotizaciones, de: s.de + c.demos, ac: s.ac + c.aceptadas, en: s.en + c.entregadas, ve: s.ve + c.vendido, pu: s.pu + c.publicidad }), { cl: 0, co: 0, de: 0, ac: 0, en: 0, ve: 0, pu: 0 });
  const m = a.cobro_mes, avance = Math.min(100, (m.este / m.meta) * 100);
  const delta = m.anterior ? Math.round(((m.este - m.anterior) / m.anterior) * 100) : null;
  const max = a.metas.costo_por_venta_maximo;
  const cv = tot.ac ? tot.pu / tot.ac : null;
  const conPub = C.filter((c) => c.aceptadas && c.publicidad);
  const decididos = a.sin_motivo + a.motivos.reduce((s, x) => s + x.n, 0);
  el.innerHTML = `<header class="ng-head"><div><h1>Analíticas de ventas</h1><p>Lo que entra, lo que se cierra y lo que se cobra</p></div><div class="ng-tabs"><button class="tab-btn ${anVista === 'resumen' ? 'on' : ''}" data-ng="an-vista" data-v="resumen">Resumen</button><button class="tab-btn ${anVista === 'anuncios' ? 'on' : ''}" data-ng="an-vista" data-v="anuncios">Anuncios</button><button class="tab-btn ${anVista === 'reporte' ? 'on' : ''}" data-ng="an-vista" data-v="reporte">Reporte para decidir</button></div></header>
    <div id="an-reporte" ${anVista === 'reporte' ? '' : 'hidden'}></div><div id="an-anuncios" ${anVista === 'anuncios' ? '' : 'hidden'}></div><div id="an-resumen" ${anVista === 'resumen' ? '' : 'hidden'}>
    <div class="ng-card" id="an-embudo"><h2>De la entrada a la venta</h2><div class="empty">Cargando…</div></div>
    <div id="an-ventas"></div>
    <div class="ng-card an-meta"><div><small>Cobrado este mes</small><b>${Lr(m.este)}</b><span>de ${Lr(m.meta)}${delta == null ? '' : ` · <em class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta} %</em> contra el mes pasado a esta fecha`}</span></div><div class="an-prog" data-tip="Avance: ${Math.round(avance)} % de la meta"><i style="width:${avance}%"></i></div></div>
    <div class="ng-kpis c4">${kpi('Clientes nuevos', tot.cl, 'en 6 meses')}${kpi('Demo a venta', pc(tot.ac, tot.de) == null ? '—' : `${pc(tot.ac, tot.de)} %`, `${tot.ac} ventas de ${tot.de} demos`, 'ok')}${kpi('Vendido', Lr(tot.ve), 'cotizaciones aceptadas', 'ok')}${kpi('Costo por venta', cv == null ? '—' : Lr(cv), `Publicidad ${Lr(tot.pu)}${max ? ` · máximo ${Lr(max)}` : ''}`, cv && max && cv > max ? 'bad' : '')}</div>
    <div class="ng-grid2">
      <div class="ng-card"><h2>Cobrado por mes</h2>${columnas(C.map((c) => ({ et: mes(c.mes), v: c.cobrado, texto: Lk(c.cobrado), tip: `${mesL(c.mes)}: ${Lr(c.cobrado)} cobrados` })), { ref: { v: m.meta, et: `Meta ${Lk(m.meta)}` } })}</div>
      <div class="ng-card"><h2>De demo a venta</h2>${linea(C.map((c, i) => ({ et: mes(c.mes), v: pc(c.aceptadas, c.demos) || 0, texto: `${pc(c.aceptadas, c.demos) ?? 0} %`, abierto: i >= C.length - 2, tip: `${mesL(c.mes)}: ${c.aceptadas} ventas de ${c.demos} demos` })))}<p class="note">Los dos últimos meses, con punto hueco, todavía pueden subir: hay clientes decidiendo.</p></div>
      <div class="ng-card"><h2>Embudo de 6 meses</h2>${barras([['Cotizaciones', tot.co, tot.co], ['Demos', tot.de, tot.co], ['Aceptadas', tot.ac, tot.de], ['Entregadas', tot.en, tot.ac]].map(([et, v, prev], i) => ({ et, v, texto: v, nota: i ? `${pc(v, prev) ?? 0} % del paso anterior` : '' })))}</div>
      <div class="ng-card"><h2>Costo por venta</h2>${conPub.length ? columnas(conPub.map((c) => { const v = c.publicidad / c.aceptadas; return { et: mes(c.mes), v, texto: Lk(v), tip: `${mesL(c.mes)}: ${Lr(v)} por venta (${Lr(c.publicidad)} en ${c.aceptadas} ventas)` }; }), { ref: max ? { v: Number(max), et: `Máximo ${Lr(max)}` } : null }) : '<div class="empty">Sin ventas con publicidad.</div>'}</div>
      <div class="ng-card" id="an-semanas"><h2>Personas nuevas por semana</h2><div class="empty">Cargando…</div></div>
      <div class="ng-card" id="an-fuentes"><h2>De dónde vienen</h2><div class="empty">Cargando…</div></div>
      <div class="ng-card"><h2>Por qué no se cerró</h2>${a.sin_motivo ? `<div class="ng-alerta"><span><b>${a.sin_motivo} de ${decididos}</b> cotizaciones rechazadas no tienen motivo anotado.</span></div>` : ''}${a.motivos.length ? barras(a.motivos.map((x) => ({ et: x.motivo, v: x.n }))) : '<div class="empty">Sin motivos anotados.</div>'}</div>
      <div class="ng-card"><h2>Proyectos por etapa</h2>${barras(a.etapas.map((e) => ({ et: e.label, v: e.n })))}</div>
    </div>
    <div class="ng-kpis c3">${kpi('Cotización a demo', `${a.tiempos?.dias_a_demo ?? '—'} días`, 'promedio de 180 días')}${kpi('Demo a aceptada', `${a.tiempos?.dias_a_cierre ?? '—'} días`, 'promedio de 180 días')}${kpi('Aceptada a entregada', `${a.tiempos?.dias_a_entrega ?? '—'} días`, 'promedio de 180 días')}</div>
    <details class="ng-card pa-det"><summary>Ver el detalle por mes</summary><div class="ng-tabla-wrap"><table class="ng-tabla an-tabla"><thead><tr><th>Mes</th><th class="r">Clientes</th><th class="r">Cotizaciones</th><th class="r">Demos</th><th class="r">Aceptadas</th><th class="r">Demo a venta</th><th class="r">Entregadas</th><th class="r">Vendido</th><th class="r">Cobrado</th><th class="r">Publicidad</th><th class="r">Costo por venta</th></tr></thead><tbody>
      ${C.map((c) => `<tr><td><b>${mesL(c.mes)}</b></td><td class="r">${c.clientes}</td><td class="r">${c.cotizaciones}</td><td class="r">${c.demos}</td><td class="r">${c.aceptadas}</td><td class="r">${pc(c.aceptadas, c.demos) ?? 0} %</td><td class="r">${c.entregadas}</td><td class="r">${Lr(c.vendido)}</td><td class="r">${Lr(c.cobrado)}</td><td class="r">${Lr(c.publicidad)}</td><td class="r">${c.aceptadas && c.publicidad ? Lr(c.publicidad / c.aceptadas) : '—'}</td></tr>`).join('')}
    </tbody></table></div></details>
    ${meta ? `<div class="ng-card"><h2>Meta (API de conversiones) <span class="muted">${meta.configurado ? `dataset ${esc(meta.dataset)} · llave: ${esc(meta.llave)}` : 'sin configurar: Sistema → Llaves → Meta'}</span></h2>
      <div class="ng-linea"><span>Cotizaciones reportadas como <b>Lead</b></span><b>${meta.leads}${meta.ultimo_lead ? `<small>última ${fecha(meta.ultimo_lead)}</small>` : ''}</b></div>
      <div class="ng-linea"><span>Ventas reportadas como <b>Purchase</b></span><b>${meta.compras}${meta.ultima_compra ? `<small>última ${fecha(meta.ultima_compra)}</small>` : ''}</b></div>
      ${meta.con_error ? `<div class="ng-alerta">⚠️ ${meta.con_error} sin poder enviar: ${esc(meta.ultimo_error || '')}</div>` : ''}
      <p class="note">Se envían solas cada hora: Lead cuando se crea una cotización y Purchase cuando se acepta. Así Meta aprende qué anuncios traen ventas.</p></div>` : ''}
</div>`;
  pintarEmbudo().catch(() => {});
  if (anVista === 'reporte') cargarReporte(document.getElementById('an-reporte'));
  if (anVista === 'anuncios') cargarAnuncios(document.getElementById('an-anuncios'));
  datosAnuncios('mes').then((a) => { const v = document.getElementById('an-ventas'); if (v) v.innerHTML = ventasDelPeriodo(a); }).catch(() => {});
}

// Embudo de arriba: se recarga solo al cambiar el periodo o el origen.
const fe = { dias: 30, fuente: 'todas' };
const FUENTE = { todas: 'Todos', pauta: 'Anuncios', prospeccion: 'Prospección', contenido: 'Contenido', referido: 'Referidos', referidos: 'Referidos', otro: 'Otros', sin_dato: 'Sin dato' };
const nFuente = (k) => FUENTE[k] || k.charAt(0).toUpperCase() + k.slice(1);
async function pintarEmbudo() {
  const el = document.getElementById('an-embudo');
  if (!el) return;
  const e = await fetch(`/api/ventas/embudo/entrada?dias=${fe.dias}&fuente=${fe.fuente}`).then((r) => r.json());
  if (!document.getElementById('an-embudo')) return;
  const fuentes = ['todas', ...e.fuentes.map((f) => f.fuente)];
  const fechaP = (t) => new Date(t).toLocaleDateString('es-HN', { day: 'numeric', month: 'short' });
  const gente = e.personas.filter((x) => fe.fuente === 'todas' || x.fuente === fe.fuente).map((x) => ({ ...x, detalle: [x.etapa, `entró ${fechaP(x.ts)}`, nFuente(x.fuente)].filter(Boolean).join(' · ') }));
  e.pasos.forEach((p, i) => { const llegaron = gente.filter((x) => x.nivel >= i), quedaron = gente.filter((x) => x.nivel === i); p.lista = reg(p.et, i < e.pasos.length - 1 ? [{ t: 'Se quedaron en este paso', personas: quedaron }, { t: 'Llegaron a este paso', personas: llegaron }] : [{ t: 'Llegaron a este paso', personas: llegaron }]); });
  const hayDatos = e.pasos[0]?.n > 0;
  el.innerHTML = `<div class="em-cab"><div><h2>De la entrada a la venta</h2><p class="note">Personas que escribieron en este periodo y hasta dónde llegaron. Tocá un paso para ver quiénes son.</p></div>
    <div class="ng-tabs">${[7, 30, 90, 180].map((d) => `<button class="tab-btn ${fe.dias === d ? 'on' : ''}" data-ng="em-dias" data-v="${d}">${d} días</button>`).join('')}</div></div>
    <div class="chips">${fuentes.map((k) => `<button class="chip ${fe.fuente === k ? 'on' : ''}" data-ng="em-fuente" data-v="${esc(k)}">${esc(nFuente(k))}</button>`).join('')}</div>
    ${hayDatos ? embudo(e.pasos) : '<div class="empty">Nadie entró en este periodo con este origen.</div>'}`;
  const se = document.getElementById('an-semanas');
  if (se) se.innerHTML = `<h2>Personas nuevas por semana</h2>${columnas(e.semanas.map((s) => { const et = new Date(s.desde).toLocaleDateString('es-HN', { day: 'numeric', month: 'numeric' }); return { et, v: s.n, texto: String(s.n), tip: `Semana del ${et}: ${s.n} personas` }; }))}`;
  const fu = document.getElementById('an-fuentes');
  if (fu) fu.innerHTML = `<h2>De dónde vienen</h2><p class="note">En los últimos ${e.dias} días.</p>${e.fuentes.length ? barras(e.fuentes.map((f) => ({ lista: reg(`Vinieron de ${nFuente(f.fuente)}`, e.personas.filter((x) => x.fuente === f.fuente).map((x) => ({ ...x, detalle: x.etapa }))), et: nFuente(f.fuente), v: f.entraron, nota: `${f.demos} demos · ${f.pagaron} pagaron`, tip: `${nFuente(f.fuente)}: ${f.entraron} entraron, ${f.demos} con demo, ${f.pagaron} pagaron` }))) : '<div class="empty">Sin personas en este periodo.</div>'}`;
}

// =================== eventos ===================
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-ng]');
  if (!t) return;
  const a = t.dataset.ng;
  try {
    if (a === 'copiar-tel') { e.stopPropagation(); if (t.closest('summary')) e.preventDefault(); return copiarTel(t); }
    if (a === 'nueva-cot') return ir('#/cotizaciones/nueva');
    if (a === 'abrir-cot') { if (e.target.closest('a,button,select,input')) return; return ir(`#/cotizaciones/${t.dataset.id}`); }
    if (a === 'cot-estado') { fc.estado = t.dataset.v; return listaCotizaciones(); }
    if (a === 'cot-saldo') { fc.saldo = !fc.saldo; return listaCotizaciones(); }
    if (a === 'an-vista') { anVista = t.dataset.v; document.querySelectorAll('[data-ng="an-vista"]').forEach((b) => b.classList.toggle('on', b.dataset.v === anVista)); for (const k of ['resumen', 'reporte', 'anuncios']) document.getElementById(`an-${k}`).hidden = anVista !== k; if (anVista === 'reporte') cargarReporte(document.getElementById('an-reporte')); if (anVista === 'anuncios') cargarAnuncios(document.getElementById('an-anuncios')); return; }
    if (a === 'em-dias') { fe.dias = Number(t.dataset.v); return pintarEmbudo(); }
    if (a === 'em-fuente') { fe.fuente = t.dataset.v; return pintarEmbudo(); }
    if (a === 'pdf-cot') {
      e.stopPropagation();
      // Desde el editor guarda primero, para que el PDF salga con lo que estás viendo.
      if (cot?.id === t.dataset.id && $('#ng-items')) { const w = window.open('about:blank', '_blank'); await guardarCot(); if (w) w.location = `/api/cresova/cotizaciones/${cot.id}/pdf`; return; }
      return pdfCotizacion(t.dataset.id);
    }
    if (a === 'duplicar-cot') { const r = await api(`/cotizaciones/${cot.id}/duplicar`, { method: 'POST', body: {} }); return ir(`#/cotizaciones/${r.id}`); }
    if (a === 'cot-tipo') return cambiarTipoCot(t.dataset.v);
    if (a === 'e-agregar') { const e2 = (cot.enterprise_data ||= {}); (e2[t.dataset.l] ||= []).push(t.dataset.l === 'phases' ? { name: '', duration: '', deliverables: [] } : { name: '', description: '' }); return pintarTipo(); }
    if (a === 'e-quitar') { cot.enterprise_data[t.dataset.l].splice(Number(t.dataset.k), 1); return pintarTipo(); }
    if (a === 'borrar-cot') {
      e.stopPropagation();
      if (!confirm(`¿Eliminar ${t.dataset.n} con sus conceptos y pagos? No se puede deshacer.`)) return;
      await api(`/cotizaciones/${t.dataset.id}`, { method: 'DELETE' });
      return location.hash.split('/').length > 2 ? ir('#/cotizaciones') : listaCotizaciones();
    }
    if (a === 'guardar-cot') { t.disabled = true; try { await guardarCot(); } finally { t.disabled = false; } return; }
    if (a === 'agregar-linea') { cot.items.push(lineaVacia()); return pintarItems(); }
    if (a === 'quitar-linea') { cot.items.splice(Number(t.dataset.k), 1); if (!cot.items.length) cot.items.push(lineaVacia()); return pintarItems(); }
    if (a === 'agregar-pago') {
      const monto = Number($('#pg-monto').value);
      if (!(monto > 0)) return alert('Poné el monto del pago.');
      await api(`/cotizaciones/${cot.id}/pago`, { method: 'POST', body: { monto, fecha: $('#pg-fecha').value, metodo: $('#pg-metodo').value, cuenta: $('#pg-cuenta').value || null, referencia: $('#pg-ref').value } });
      return editorCotizacion(cot.id);
    }
    if (a === 'borrar-pago') { if (!confirm('¿Eliminar este pago?')) return; await api(`/pagos/${t.dataset.id}`, { method: 'DELETE' }); return editorCotizacion(cot.id); }
    if (a === 't-periodo') { ft.periodo = t.dataset.v; return tesoreria('resumen'); }
    if (a === 't-retiro' || a === 't-gasto') return dialogoDinero(a === 't-retiro' ? 'retiro' : 'gasto');
    if (a === 'td-guardar') return guardarDinero(t);
    if (a === 'td-cerrar') return document.getElementById('t-dlg')?.close();
    if (a === 'g-sincat') { fg.sinCategoria = !fg.sinCategoria; return tesoreria('gastos'); }
    if (a === 'g-aplicar') { t.disabled = true; const r = await api('/gastos-categorizar', { method: 'POST', body: { ids: t.dataset.ids.split(','), category_id: t.dataset.cat } }); window.toast?.(`${r.actualizados} gastos clasificados`); return tesoreria('gastos'); }
    if (a === 'g-crear') {
      const datos = Object.fromEntries([...document.querySelectorAll('#ng-g-nuevo [data-g]')].map((i) => [i.dataset.g, i.value]));
      await api('/gastos', { method: 'POST', body: datos });
      return tesoreria('gastos');
    }
    if (a === 'g-borrar') { if (!confirm('¿Eliminar este gasto?')) return; await api(`/gastos/${t.closest('[data-gid]').dataset.gid}`, { method: 'DELETE' }); return tesoreria('gastos'); }
    if (a === 'transferir') {
      await api('/transferencias', { method: 'POST', body: { desde: $('#tr-desde').value, hacia: $('#tr-hacia').value, monto: $('#tr-monto').value, fecha: $('#tr-fecha').value, nota: $('#tr-nota').value } });
      return tesoreria('cuentas');
    }
    if (a === 'nuevo-cliente') return ir('#/clientes/nuevo');
    if (a === 'abrir-cliente') return ir(`#/clientes/${t.dataset.id}`);
    if (a === 'cl-estado') { fcl.estado = t.dataset.v; fcl.pag = 0; return listaClientes(false); }
    if (a === 'tk-tipo') { fp.tipo = t.dataset.v; fp.mas = false; return pendientes(false); }
    if (a === 'tk-mas') { fp.mas = true; return pendientes(false); }
    if (a === 'll-filtro') { llFiltro = t.dataset.v; return llamadas(false); }
    if (a === 'tk-limpiar') {
      const l = tkViejas();
      if (!confirm(`Se marcarán como hechas ${l.length} tareas automáticas vencidas hace más de 30 días. ¿Continuar?`)) return;
      t.disabled = true;
      for (const x of l) await api(`/tareas/${x.id}`, { method: 'PUT', body: { status: 'done' } });
      return pendientes();
    }
    if (a === 'guardar-cliente') {
      const datos = Object.fromEntries([...document.querySelectorAll('[data-cl]')].map((i) => [i.dataset.cl, i.value]));
      const r = cli.id ? await api(`/clientes/${cli.id}`, { method: 'PUT', body: datos }) : await api('/clientes', { method: 'POST', body: datos });
      return cli.id ? fichaCliente(cli.id) : ir(`#/clientes/${r.id}`);
    }
    if (a === 'tk-estado') { fp.estado = t.dataset.v; fp.mas = false; return pendientes(); }
    if (a === 'tk-crear') {
      const title = $('#tk-titulo').value.trim();
      if (!title) return;
      await api('/tareas', { method: 'POST', body: { title, due_date: $('#tk-fecha').value, priority: $('#tk-prio').value } });
      return pendientes();
    }
    if (a === 'ceo-revertir') {
      if (!confirm('¿Volver a como estaba antes de este cambio?')) return;
      const r = await fetch(`/api/ceo/cambios/${t.dataset.v}/revertir`, { method: 'POST' });
      if (!r.ok) alert((await r.json().catch(() => ({}))).error || 'No se pudo volver atrás.');
      return ceo();
    }
    if (a === 'ceo-olvidar') { if (!confirm('¿Quitar este aprendizaje de la memoria del equipo?')) return; await fetch(`/api/ceo/aprendizajes/${t.dataset.v}/quitar`, { method: 'POST' }); return ceo(); }
    if (a === 'll-res') {
      const art = t.closest('[data-lkey]');
      await fetch('/api/ventas/llamadas/resolver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: art.dataset.lkey, resultado: t.dataset.v, nota: art.querySelector('.ll-nota').value.trim() }) });
      return llamadas();
    }
    if (a === 'tk-borrar') { if (!confirm('¿Eliminar este pendiente?')) return; await api(`/tareas/${t.closest('[data-tid]').dataset.tid}`, { method: 'DELETE' }); return pendientes(); }
  } catch (err) { aviso(err); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.c && cot) { cot[t.dataset.c] = t.type === 'checkbox' ? t.checked : t.value; return pintarTotales(); }
    if (cot && (t.dataset.e || t.dataset.eLista || t.dataset.mod || t.dataset.fase)) {
      const ed = (cot.enterprise_data ||= {}), lineas = (v) => v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      if (t.dataset.e) ed[t.dataset.e] = t.value;
      else if (t.dataset.eLista) ed[t.dataset.eLista] = lineas(t.value);
      else if (t.dataset.mod) ed.architecture[Number(t.dataset.k)][t.dataset.mod] = t.value;
      else ed.phases[Number(t.dataset.k)][t.dataset.fase] = t.dataset.fase === 'deliverables' ? lineas(t.value) : t.value;
      return pintarFaltantes();
    }
    if (t.dataset.i && cot) {
      const k = Number(t.closest('[data-k]').dataset.k);
      cot.items[k][t.dataset.i] = ['quantity', 'unit_price'].includes(t.dataset.i) ? Number(t.value) : t.value;
      pintarItems();
      return pintarFaltantes();
    }
    const a = t.dataset.ng;
    if (a === 'agregar-producto' && t.value) {
      const p = cache.productos.find((x) => x.id === t.value);
      if (cot.items.length === 1 && !cot.items[0].name) cot.items = [];
      cot.items.push({ product_id: p.id, name: p.name, description: p.description || '', unit_price: Number(p.base_price || 0), list_price: Number(p.base_price || 0), quantity: 1, billing: /mensual|monthly/i.test(p.kind || '') ? 'monthly' : /anual|yearly/i.test(p.kind || '') ? 'yearly' : 'one_time' });
      t.value = '';
      return pintarItems();
    }
    if (a === 'cot-cambiar-estado' && t.value) { await api(`/cotizaciones/${cot.id}/estado`, { method: 'POST', body: { estado: t.value } }); return editorCotizacion(cot.id); }
    if (a === 'g-filtro') { fg[t.dataset.k] = t.value; return tesoreria('gastos'); }
    if (a === 'g-campo') { await api(`/gastos/${t.closest('[data-gid]').dataset.gid}`, { method: 'PUT', body: { [t.dataset.k]: t.value } }); t.classList.add('ok-flash'); setTimeout(() => t.classList.remove('ok-flash'), 800); return; }
    if (a === 'asignar-cuenta' && t.value) { await api(`/pagos/${t.dataset.id}/cuenta`, { method: 'POST', body: { cuenta: t.value } }); return tesoreria('cuentas'); }
    if (a === 'tk-check') { await api(`/tareas/${t.closest('[data-tid]').dataset.tid}`, { method: 'PUT', body: { status: t.checked ? 'done' : 'pending' } }); return pendientes(); }
  } catch (err) { aviso(err); }
});

// Búsquedas: esperan a que dejes de escribir.
let espera = null;
document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (!['ng-cot-q', 'ng-g-q', 'ng-cl-q'].includes(id)) return;
  clearTimeout(espera);
  espera = setTimeout(() => {
    const v = e.target.value;
    const pos = e.target.selectionStart;
    const vuelta = () => { const el = document.getElementById(id); if (el) { el.focus(); el.setSelectionRange(pos, pos); } };
    if (id === 'ng-cot-q') { fc.q = v; listaCotizaciones().then(vuelta); }
    if (id === 'ng-g-q') { fg.q = v; tesoreria('gastos').then(vuelta); }
    if (id === 'ng-cl-q') { fcl.q = v; fcl.pag = 0; listaClientes().then(vuelta); }
  }, 350);
});


// Paginación de Clientes, llamadas abiertas y contadores del menú desde que se abre la oficina.
document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-cl-pg]'); if (b && !b.disabled) { fcl.pag = Number(b.dataset.clPg); listaClientes(false).then(() => document.getElementById('ng-clientes')?.scrollIntoView()); } });
document.addEventListener('toggle', (e) => { const k = e.target.dataset?.lkey; if (k) { if (e.target.open) llAbiertas.add(k); else llAbiertas.delete(k); } }, true);
async function contadores() {
  try {
    const [ll, tk] = await Promise.all([fetch('/api/ventas/llamadas').then((r) => r.json()), api('/tareas?estado=pending')]);
    const a = document.getElementById('badge-llamadas'), b = document.getElementById('badge-pendientes');
    if (a && Array.isArray(ll)) a.textContent = ll.length || '';
    if (b && Array.isArray(tk)) b.textContent = tk.filter(tkVencida).length || '';
  } catch {}
}
setTimeout(contadores, 2500);
setInterval(contadores, 5 * 60e3);


// Registrar un retiro (dinero que sacaste para vos) o un gasto, desde cualquier pestaña de Tesorería.
async function dialogoDinero(tipo) {
  let d = document.getElementById('t-dlg');
  if (!d) { d = document.createElement('dialog'); d.id = 't-dlg'; d.className = 't-dlg'; document.body.appendChild(d); }
  const [ctas, cats] = await Promise.all([cuentas(), tipo === 'gasto' ? categorias() : []]);
  const opt = (arr) => arr.map((x) => `<option value="${x.id}">${esc(x.label || x.name)}</option>`).join('');
  d.innerHTML = `<form method="dialog" class="t-form" data-tipo="${tipo}">
    <h2>${tipo === 'retiro' ? 'Registrar un retiro' : 'Registrar un gasto'}</h2>
    <p class="note">${tipo === 'retiro' ? 'Dinero que sacaste para vos. Se descuenta de tu nómina y del saldo de la cuenta.' : 'Lo que pagó el negocio. Si es tuyo, elegí "Personal" y se descuenta de tu nómina.'}</p>
    <label>Monto (L)<input class="ng-in" name="monto" type="number" step="0.01" min="0" required></label>
    <label>Fecha<input class="ng-in" name="fecha" type="date" value="${hoy()}"></label>
    <label>${tipo === 'retiro' ? 'De qué cuenta salió' : 'Cuenta'}<select class="ng-in" name="cuenta"><option value="">—</option>${opt(ctas)}</select></label>
    ${tipo === 'gasto' ? `<label>Categoría<select class="ng-in" name="categoria"><option value="personal">Personal (se descuenta de tu nómina)</option>${opt(cats)}</select></label>
    <label>Proveedor<input class="ng-in" name="proveedor" placeholder="Ej.: Hostinger"></label>
    <label>Estado<select class="ng-in" name="estado"><option value="paid">Pagado</option><option value="pending">Pendiente</option></select></label>` : ''}
    <label>${tipo === 'retiro' ? 'Nota (opcional)' : 'Descripción'}<input class="ng-in" name="nota" placeholder="${tipo === 'retiro' ? 'Ej.: retiro del cajero' : 'Ej.: dominio de cliente'}"></label>
    <p class="t-err" hidden></p>
    <div class="ng-acciones"><button class="btn" type="button" data-ng="td-cerrar">Cancelar</button><button class="btn ok" type="button" data-ng="td-guardar">Guardar</button></div>
  </form>`;
  d.showModal();
  d.querySelector('[name="monto"]').focus();
}
async function guardarDinero(t) {
  const f = t.closest('form'), v = (k) => f.querySelector(`[name="${k}"]`)?.value || '';
  const err = f.querySelector('.t-err');
  try {
    if (!(Number(v('monto')) > 0)) throw new Error('Escribí el monto.');
    t.disabled = true;
    if (f.dataset.tipo === 'retiro') await api('/retiro', { method: 'POST', body: { monto: Number(v('monto')), fecha: v('fecha'), cuenta: v('cuenta'), nota: v('nota') } });
    else {
      const personal = v('categoria') === 'personal';
      await api('/gastos', { method: 'POST', body: { amount: Number(v('monto')), expense_date: v('fecha'), account_id: v('cuenta') || null, description: v('nota') || (personal ? 'Gasto personal' : v('proveedor') || 'Gasto'), vendor: personal ? 'Personal' : v('proveedor') || null, category_id: personal ? null : v('categoria'), status: v('estado') || 'paid' } });
    }
    document.getElementById('t-dlg').close();
    window.toast?.(f.dataset.tipo === 'retiro' ? 'Retiro registrado' : 'Gasto registrado');
    const sub = location.hash.split('/')[2] || 'resumen';
    tesoreria(sub);
  } catch (e) { err.textContent = e.message; err.hidden = false; t.disabled = false; }
}


// =================== PUBLICACIÓN (reglas fijas del sistema; solo Diego las cambia) ===================
async function publicacion() {
  const el = caja('ng-publicacion');
  const j = await fetch('/api/estudio/reglas').then((r) => r.json());
  if (j.error) throw new Error(j.error);
  const r = j.reglas, rv = j.reserva;
  const max = Math.max(rv.porDia, ...rv.dias.map((d) => d.videos));
  const diaN = (k) => new Date(`${k}T12:00:00`).toLocaleDateString('es-HN', { weekday: 'short', day: 'numeric' });
  el.innerHTML = `<header class="ng-head"><div><h1>Publicación</h1><p>Lo decide el sistema con estas reglas. Ningún agente puede programar, mover ni borrar publicaciones.</p></div></header>
    ${rv.baja ? `<div class="ng-alerta"><span><b>Reserva baja:</b> solo ${rv.diasLlenos} ${rv.diasLlenos === 1 ? 'día' : 'días'} con ${rv.porDia} videos programados (mínimo ${rv.minimo}). Hacen falta más videos aprobados.</span></div>` : ''}
    <div class="ng-kpis c4">${kpi('Videos por día', rv.porDia, 'TikTok y YouTube')}${kpi('Días con agenda llena', rv.diasLlenos, `desde mañana · mínimo ${rv.minimo}`, rv.baja ? 'bad' : 'ok')}${kpi('Aprobados sin programar', rv.aprobadosSinProgramar, 'se programan solos', rv.aprobadosSinProgramar ? 'warn' : '')}${kpi('Instagram y Facebook', `${r.igfbPorDia} al día`, `a las ${r.igfbHora}, el de mejor retención`)}</div>
    <div class="ng-grid2">
      <div class="ng-card"><h2>Reglas</h2>
        <div class="ng-form pu-form">
          <label>Horarios de TikTok y YouTube (hora de Honduras)<input class="ng-in" id="pu-horarios" value="${esc(r.horarios.join(', '))}"><small class="muted">Uno por video al día, separados por coma. Ej.: 07:00, 11:00, 13:30</small></label>
          <label>Separación mínima entre videos (minutos)<input class="ng-in" id="pu-sep" type="number" min="15" max="240" value="${r.separacionMin}"></label>
          <label>Hora de Instagram y Facebook<input class="ng-in" id="pu-ig" value="${esc(r.igfbHora)}"></label>
          <label>Reserva mínima (días de agenda llena)<input class="ng-in" id="pu-res" type="number" min="1" max="14" value="${r.reservaMinDias}"></label>
          <label class="ng-check"><input type="checkbox" id="pu-alt" ${r.alternarRubros ? 'checked' : ''}> No poner dos videos seguidos del mismo rubro</label>
        </div>
        <ul class="pu-fijas"><li>Al aprobar un video orgánico, se programa solo en el primer horario libre.</li><li>Instagram y Facebook: el sistema elige cada día, a las 10:00, el video con mejor retención al segundo 3 entre los que tienen al menos 48 h (últimos 30 días).</li><li>Los anuncios nunca entran a la agenda orgánica.</li><li>Cada 6 h se revisa la agenda y se mueven los choques; cada 3 h se avisa por Discord si una red queda 24 h sin publicar o si la reserva está baja.</li></ul>
        <div class="ng-acciones"><button class="btn ok" data-ng="pu-guardar">Guardar reglas</button><button class="btn" data-ng="pu-rellenar">Rellenar huecos de los próximos 3 días</button></div>
      </div>
      <div class="ng-card"><h2>Próximos 14 días</h2><div class="pu-dias">${rv.dias.map((d) => `<div class="pu-d ${d.videos < rv.porDia ? 'falta' : ''}" title="${d.videos} de ${rv.porDia}"><i style="height:${(d.videos / max) * 100}%"></i><b>${d.videos}</b><small>${diaN(d.dia)}</small></div>`).join('')}</div>
        ${j.igfb ? `<p class="note">Instagram y Facebook: <b>${esc(j.igfb.video)}</b> · ${esc(j.igfb.cuando)} · ${esc(j.igfb.motivo)}</p>` : ''}
        <h2 style="margin-top:8px">Lo que sale</h2>${rv.proximos.map((p) => `<div class="ng-linea"><span>${esc(String(p.video).replace(/\.mp4$/, ''))}</span><small>${esc(p.cuando)}</small></div>`).join('') || '<div class="empty">Nada programado.</div>'}</div>
    </div>`;
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest?.('[data-ng="pu-guardar"], [data-ng="pu-rellenar"]');
  if (!t) return;
  t.disabled = true;
  try {
    if (t.dataset.ng === 'pu-guardar') {
      const body = { horarios: document.getElementById('pu-horarios').value.split(',').map((x) => x.trim()).filter(Boolean), separacionMin: Number(document.getElementById('pu-sep').value), igfbHora: document.getElementById('pu-ig').value.trim(), reservaMinDias: Number(document.getElementById('pu-res').value), alternarRubros: document.getElementById('pu-alt').checked };
      const r = await fetch('/api/estudio/reglas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      window.toast?.('Reglas guardadas');
    } else {
      const r = await fetch('/api/estudio/rellenar-huecos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"dias":3}' });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      window.toast?.(`${j.length} videos adelantados`);
    }
    publicacion();
  } catch (err) { window.toast?.(err.message, 'error'); t.disabled = false; }
});
