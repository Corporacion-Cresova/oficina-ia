// Analíticas · Reporte para decidir: compara dos períodos con los datos de Meta, los chats y la base.
import { barras } from './graficas.js';
import { reg } from './lista.js';
// Filas del reporte que tienen la lista de personas detrás.
const CLAVE = { 'Contactos nuevos únicos': 'contactos', 'Aceptaron una demo': 'aceptaronDemo', 'Enviadas al cliente': 'enviadas', 'Aprobadas por el cliente': 'aprobadas', Rechazadas: 'rechazadas', 'Sin respuesta': 'sinRespuesta', 'Aceptaron comprar': 'aceptaron', 'Pagaron anticipo': 'pagaron', 'Pendientes de anticipo': 'pendientes', 'Clientes perdidos': 'perdidos', 'Proyectos entregados': 'entregados' };
const celda = (et, r, m, texto) => { const l = r.listas?.[CLAVE[et]]; return l?.length ? `<b class="lm-num" data-lista="${reg(`${et} · ${m.nombre}`, l)}">${esc(texto)}</b>` : esc(texto); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const L = (n) => (n == null ? null : `L ${Math.round(n).toLocaleString('en-US')}`);
const dias = (n) => (n == null ? null : `${n} ${n === 1 ? 'día' : 'días'}`);
const pad = (n) => String(n).padStart(2, '0');

function meses() {
  const hoy = new Date(Date.now() - 6 * 3600e3), l = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    l.push({ k: `${y}-${pad(m + 1)}`, desde: `${y}-${pad(m + 1)}-01`, hasta: i === 0 ? `${y}-${pad(m + 1)}-${pad(hoy.getUTCDate())}` : `${y}-${pad(m + 1)}-${pad(ult)}`, nombre: new Date(Date.UTC(y, m, 15)).toLocaleDateString('es-HN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/^./, (c) => c.toUpperCase()), parcial: i === 0 });
  }
  return l;
}
let A = null, B = null;

// filas: [etiqueta, función que da el texto, función que da el número para comparar, ¿subir es malo?]
function bloque(titulo, filas, a, b, notaFinal = '') {
  return `<div class="ng-card rp-b"><h2>${esc(titulo)}</h2><div class="ng-tabla-wrap"><table class="ng-tabla rp-t"><thead><tr><th></th><th class="r">${esc(A.nombre)}</th><th class="r">${esc(B.nombre)}${B.parcial ? ' (a hoy)' : ''}</th><th class="r">Cambio</th></tr></thead><tbody>
    ${filas.map(([et, tx, num, malo, hoy]) => {
      if (hoy) return `<tr><td>${esc(et)}</td><td class="r muted">—</td><td class="r"><b>${esc(tx(b) ?? '—')}</b> <small class="muted">hoy</small></td><td></td></tr>`;
      const va = num?.(a), vb = num?.(b);
      const dif = va != null && vb != null && va !== 0 ? Math.round(((vb - va) / Math.abs(va)) * 100) : null;
      const clase = dif == null || dif === 0 ? '' : (dif > 0) !== Boolean(malo) ? 'up' : 'down';
      return `<tr><td>${esc(et)}</td><td class="r">${celda(et, a, A, tx(a) ?? '—')}</td><td class="r"><b>${celda(et, b, B, tx(b) ?? '—')}</b></td><td class="r rp-c ${clase}">${dif == null ? '—' : `${dif > 0 ? '+' : ''}${dif} %`}</td></tr>`;
    }).join('')}
  </tbody></table></div>${notaFinal ? `<p class="note">${notaFinal}</p>` : ''}</div>`;
}

function conclusiones(a, b) {
  const l = [];
  const pagadas = b.adquisicion.campanas.filter((c) => c.gasto > 0);
  const sinContactos = pagadas.filter((c) => !c.contactos);
  const peor = pagadas.filter((c) => c.costoContacto).sort((x, y) => y.costoContacto - x.costoContacto)[0];
  const mejor = pagadas.filter((c) => c.costoContacto).sort((x, y) => x.costoContacto - y.costoContacto)[0];
  if (sinContactos.length) l.push(`${sinContactos.length === 1 ? 'Una campaña gastó' : `${sinContactos.length} campañas gastaron`} ${L(sinContactos.reduce((s, c) => s + c.gasto, 0))} sin contactos registrados: ${sinContactos[0].campana}.`);
  if (peor && mejor && peor !== mejor) l.push(`Tu contacto más barato viene de "${mejor.campana}" (${L(mejor.costoContacto)}); el más caro, de "${peor.campana}" (${L(peor.costoContacto)}).`);
  if (b.ventas.pendientesAnticipo) l.push(`${b.ventas.pendientesAnticipo} ${b.ventas.pendientesAnticipo === 1 ? 'cliente aceptó y no ha pagado' : 'clientes aceptaron y no han pagado'} el anticipo: es el dinero más cercano.`);
  if (b.demos.enviadas && b.demos.sinRespuesta / b.demos.enviadas >= 0.4) l.push(`${b.demos.sinRespuesta} de ${b.demos.enviadas} demos enviadas no tienen respuesta. El problema está después de mandarla.`);
  if (b.demos.diasAEnvio != null && b.demos.diasAEnvio > 3) l.push(`Una demo tarda ${b.demos.diasAEnvio} días en salir desde que el cliente la acepta.`);
  const sm = b.ventas.motivos.find((m) => m.motivo === 'Sin motivo anotado');
  if (sm && b.ventas.perdidos && sm.n / b.ventas.perdidos >= 0.5) l.push(`${sm.n} de ${b.ventas.perdidos} clientes perdidos no tienen motivo anotado.`);
  return l;
}

// Si Meta contó muchas más conversaciones que las que quedaron en la oficina, los contactos de ese mes están incompletos.
function incompleto(r, m) {
  const x = r.adquisicion;
  return x.conversacionesMeta >= 10 && x.contactosConAnuncio < x.conversacionesMeta * 0.5 ? `${esc(m.nombre)}: Meta contó ${x.conversacionesMeta} conversaciones y en la oficina hay ${x.contactosConAnuncio} contactos de anuncios. Para comparar meses, usá el costo por conversación de Meta.` : '';
}

function pintar(el, a, b) {
  const av = (r) => r.adquisicion, de = (r) => r.demos, ve = (r) => r.ventas, op = (r) => r.operacion;
  const c = conclusiones(a, b);
  const campBloque = (r, m) => `<div class="ng-card"><h2>Contactos por campaña · ${esc(m.nombre)}</h2><div class="ng-tabla-wrap"><table class="ng-tabla rp-t"><thead><tr><th>Campaña</th><th class="r">Inversión</th><th class="r">Contactos</th><th class="r">Costo / contacto</th><th class="r">Chats según Meta</th></tr></thead><tbody>${av(r).campanas.map((f) => `<tr><td>${esc(f.campana)}</td><td class="r">${L(f.gasto)}</td><td class="r">${f.contactos}</td><td class="r">${f.costoContacto == null ? '—' : L(f.costoContacto)}</td><td class="r">${f.conversacionesMeta || '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin datos.</td></tr>'}</tbody></table></div></div>`;
  el.querySelector('#rp-cuerpo').innerHTML = `
    ${c.length ? `<div class="ng-card rp-con"><h2>Qué mirar primero</h2><ul>${c.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${a.meta_error || b.meta_error ? `<div class="ng-alerta"><span>No pude leer Meta: ${esc(a.meta_error || b.meta_error)}</span></div>` : ''}
    <div class="ng-grid2">
    ${bloque('Adquisición', [
      ['Inversión en Meta', (r) => L(av(r).inversion), (r) => av(r).inversion, true],
      ['Contactos nuevos únicos', (r) => String(av(r).contactos), (r) => av(r).contactos],
      ['Conversaciones según Meta', (r) => String(av(r).conversacionesMeta), (r) => av(r).conversacionesMeta],
      ['Costo por conversación (Meta)', (r) => (av(r).conversacionesMeta ? L(av(r).inversion / av(r).conversacionesMeta) : null), (r) => (av(r).conversacionesMeta ? av(r).inversion / av(r).conversacionesMeta : null), true],
      ['Costo por contacto', (r) => L(av(r).costoContacto), (r) => av(r).costoContacto, true],
    ], a, b, incompleto(a, A) || incompleto(b, B))}
    ${bloque('Demos', [
      ['Aceptaron una demo', (r) => String(de(r).aceptaron), (r) => de(r).aceptaron],
      ['Enviadas al cliente', (r) => String(de(r).enviadas), (r) => de(r).enviadas],
      ['Aprobadas por el cliente', (r) => String(de(r).aprobadas), (r) => de(r).aprobadas],
      ['Rechazadas', (r) => String(de(r).rechazadas), (r) => de(r).rechazadas, true],
      ['Sin respuesta', (r) => String(de(r).sinRespuesta), (r) => de(r).sinRespuesta, true],
      ['Aceptación a envío', (r) => dias(de(r).diasAEnvio), (r) => de(r).diasAEnvio, true],
      ['Pendientes de construir', (r) => String(de(r).pendientesHoy), null, false, true],
      ['En construcción', (r) => String(de(r).construccionHoy), null, false, true],
    ], a, b)}
    ${bloque('Ventas y cobros', [
      ['Aceptaron comprar', (r) => String(ve(r).aceptaron), (r) => ve(r).aceptaron],
      ['Pagaron anticipo', (r) => String(ve(r).pagaronAnticipo), (r) => ve(r).pagaronAnticipo],
      ['Pendientes de anticipo', (r) => String(ve(r).pendientesAnticipo), (r) => ve(r).pendientesAnticipo, true],
      ['Anticipos cobrados', (r) => L(ve(r).anticipos), (r) => ve(r).anticipos],
      ['Total cobrado', (r) => L(ve(r).cobrado), (r) => ve(r).cobrado],
      ['Ventas cerradas', (r) => L(ve(r).valor), (r) => ve(r).valor],
      ['Ticket promedio', (r) => L(ve(r).ticket), (r) => ve(r).ticket],
      ['Clientes perdidos', (r) => String(ve(r).perdidos), (r) => ve(r).perdidos, true],
      ['Primer contacto a pago', (r) => dias(ve(r).diasAPago), (r) => ve(r).diasAPago, true],
    ], a, b, 'Las ventas cuentan en el mes en que se aceptaron. Los anticipos y cobros, en el mes en que se pagaron.')}
    ${bloque('Capacidad operativa', [
      ['Proyectos iniciados', (r) => String(op(r).iniciados), (r) => op(r).iniciados],
      ['Proyectos entregados', (r) => String(op(r).entregados), (r) => op(r).entregados],
      ['Tiempo promedio de entrega', (r) => dias(op(r).diasEntrega), (r) => op(r).diasEntrega, true],
      ['Horas humanas por proyecto', () => 'Sin registrar', null],
      ['Activos o pendientes', (r) => String(op(r).activosHoy), null, false, true],
    ], a, b, 'Las horas humanas no se registran hoy. Para medirlas hay que anotarlas por proyecto.')}
    </div>
    ${campBloque(b, B)}
    ${campBloque(a, A)}
    <div class="ng-grid2">
      <div class="ng-card"><h2>País de procedencia · ${esc(B.nombre)}</h2>${av(b).paises.length ? barras(av(b).paises.map((p) => ({ et: p.pais, v: p.n }))) : '<div class="empty">Sin contactos.</div>'}<p class="note">Se calcula por el código del número de WhatsApp.</p></div>
      <div class="ng-card"><h2>Motivos de pérdida · ${esc(B.nombre)}</h2>${ve(b).motivos.length ? barras(ve(b).motivos.map((m) => ({ et: m.motivo, v: m.n }))) : '<div class="empty">Sin clientes perdidos en este período.</div>'}</div>
    </div>`;
}

async function datos(m) {
  const r = await fetch(`/api/cresova/reporte-periodo?desde=${m.desde}&hasta=${m.hasta}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'No se pudo cargar el reporte.');
  return j;
}

export async function cargarReporte(el) {
  const l = meses();
  A ||= l[1]; B ||= l[0];
  const op = (s, m) => l.map((x) => `<option value="${x.k}" ${x.k === m.k ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('');
  el.innerHTML = `<div class="rp-sel"><label>Comparar <select class="ng-in" data-rp="a">${op('a', A)}</select></label><label>contra <select class="ng-in" data-rp="b">${op('b', B)}</select></label></div><div id="rp-cuerpo"><div class="empty">Cargando…</div></div>`;
  try {
    const [a, b] = await Promise.all([datos(A), datos(B)]);
    pintar(el, a, b);
  } catch (e) { el.querySelector('#rp-cuerpo').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  el.querySelectorAll('[data-rp]').forEach((s) => s.addEventListener('change', () => { const m = l.find((x) => x.k === s.value); if (s.dataset.rp === 'a') A = m; else B = m; cargarReporte(el); }));
}
