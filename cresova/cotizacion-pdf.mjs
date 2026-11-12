// Cotizaciones en PDF con los dos diseños de Cresova (los que tenía cresova.com):
//  - "Propuesta estratégica": proyectos grandes (is_enterprise con enterprise_data). Portada negra, títulos serif, 6 capítulos.
//  - "Propuesta comercial": lo común. Encabezado negro con cuadro rojo, tarjeta de inversión y condiciones.
// Diferencias con los originales: las notas internas (chat, Velforce, vendedor IA) no van al cliente y el WhatsApp es el de ventas.
// El contenido se reparte en hojas A4 midiendo en el navegador, así nada se corta ni se encima.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cotizacion, totales } from './negocio.mjs';
import { ventasState as V } from '../ventas/vendedor.mjs';
import * as B from './propuesta-bloques.mjs';

const CATALOGO = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'ventas', 'semilla.json'), 'utf8')).catalogo;
const WHATSAPP = process.env.EMPRESA_WHATSAPP || '', CORREO = process.env.EMPRESA_CORREO || '', RAZON = process.env.EMPRESA_RAZON_SOCIAL || 'Mi Empresa', RTN = process.env.EMPRESA_RTN || '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SIGNO = { HNL: 'L', USD: '$', EUR: '€', MXN: 'MX$' };
const MONEDA = { HNL: 'Lempiras hondureñas', USD: 'Dólares', EUR: 'Euros', MXN: 'Pesos mexicanos' };
const dinero = (n, cur = 'HNL') => `${SIGNO[cur] || 'L'} ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fecha = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00-06:00` : d).toLocaleDateString('es-HN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Tegucigalpa' }) : '');
const notasCliente = (c) => (/creada? (por|desde)|vendedor ia|velforce|[uú]ltimos mensajes|pidió también|vio el precio|motivo:/i.test(String(c.notes || '')) ? '' : String(c.notes || '').trim());
const cuentas = () => String(V.config?.cuentaAnticipo || '').replace(/\p{Extended_Pictographic}️?\s*/gu, '').trim();
const parrafos = (t) => String(t || '').split(/\n\s*\n|\r?\n/).map((x) => x.trim()).filter(Boolean);

// Lo que incluye cada concepto: del catálogo si es un paquete; si no, las viñetas de su descripción.
function incluye(i) {
  const p = CATALOGO.find((x) => x.nombre === i.name);
  if (p) {
    const ls = String(p.descripcion || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const ini = ls.findIndex((l) => /^incluye\s*:?$/i.test(l));
    if (ini >= 0) { const fin = ls.findIndex((l, n) => n > ini && /:/.test(l)); return ls.slice(ini + 1, fin < 0 ? undefined : fin).map((l) => l.replace(/\.$/, '')); }
  }
  return String(i.description || '').split(/\r?\n|\s·\s/).map((x) => x.replace(/^[-•*+]\s*/, '').replace(/\.$/, '').trim()).filter((x) => x && !/^incluye\s*:?$/i.test(x));
}
const mantenimiento = (c) => CATALOGO.flatMap((p) => (c.items.some((i) => i.name === p.nombre) ? String(p.descripcion).split(/\r?\n/) : [])).find((l) => /^mantenimiento:/i.test(l.trim()))?.trim().replace(/^mantenimiento:\s*/i, '') || '';
const COBRO = { monthly: 'MENSUAL', yearly: 'ANUAL', one_time: 'PAGO ÚNICO' };
const sufijo = { monthly: '/mes', yearly: '/año' };
const importe = (i) => Number(i.unit_price) * Number(i.quantity ?? 1);
const base = (c) => {
  const t = totales(c.items, c);
  const cur = c.currency || 'HNL', mitad = Math.round(t.total / 2);
  return { t, cur, mitad, resto: t.total - mitad, desc: Math.max(0, t.subtotal_setup + t.tax_amount - t.total), dias: c.valid_until ? Math.max(1, Math.round((new Date(c.valid_until) - new Date(c.created_at)) / 864e5)) : 15 };
};

const CSS_BASE = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font: 400 10.5px/1.55 Helvetica, Arial, "Liberation Sans", sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  template, .flujo { display: none; }
  .hoja { position: relative; width: 210mm; height: 297mm; overflow: hidden; break-after: page; display: flex; flex-direction: column; }
  .hoja:last-child { break-after: auto; }
  .cuerpo { flex: 1; min-height: 0; }
  h1, h2, h3, h4, p { margin: 0; }
  ul { margin: 0; padding: 0; list-style: none; }
  .et { letter-spacing: .24em; font-weight: 700; }`;

// Reparte los bloques de cada .flujo en hojas y numera.
const PAGINAR = `(() => {
  const nueva = (tpl) => { const h = document.createElement('div'); h.className = 'hoja'; h.innerHTML = document.getElementById(tpl).innerHTML; document.body.appendChild(h); return h; };
  const primeras = {};
  for (const f of [...document.querySelectorAll('.flujo')]) {
    let h = nueva(f.dataset.cab), cuerpo = h.querySelector('.cuerpo');
    if (f.dataset.sec) primeras[f.dataset.sec] = [...document.querySelectorAll('.hoja')].length;
    for (const b of [...f.children]) {
      cuerpo.appendChild(b);
      if (cuerpo.scrollHeight > cuerpo.clientHeight + 1 && cuerpo.children.length > 1) { h = nueva(f.dataset.sig || f.dataset.cab); cuerpo = h.querySelector('.cuerpo'); cuerpo.appendChild(b); }
    }
    f.remove();
  }
  const hojas = [...document.querySelectorAll('.hoja')];
  hojas.forEach((h, i) => { h.querySelectorAll('.pg').forEach((e) => (e.textContent = i + 1)); h.querySelectorAll('.pgt').forEach((e) => (e.textContent = hojas.length)); });
  document.querySelectorAll('[data-ind]').forEach((e) => (e.textContent = String(primeras[e.dataset.ind] || '').padStart(2, '0')));
})();`;

// ---------- Propuesta comercial (lo común) ----------
function comercial(c) {
  const { t, cur, mitad, resto, desc, dias } = base(c);
  const para = c.client_contact_name || c.client_company || c.client_name || 'Cliente';
  const unicos = c.items.filter((i) => (i.billing || 'one_time') === 'one_time');
  const web = !unicos.length || unicos.some((i) => /web|p[aá]gina|landing/i.test(i.name));
  const objeto = web ? 'página web profesional' : unicos[0].name;
  const mant = mantenimiento(c), cta = cuentas(), notas = notasCliente(c);
  const marca = `<div class="cuadro"></div><div class="marca"><b>CRESOVA<i>.</i></b><span class="lema">CRECES &nbsp;·&nbsp; INNOVAS</span><small>${RAZON}<br>RTN: ${RTN}</small></div><div class="tipo"><span class="circ">D</span><span><b>PROPUESTA</b><br>COMERCIAL</span></div>`;
  const pie = `<footer><span class="et">CRESOVA</span><span class="sol">Soluciones web y desarrollo de software</span><span class="num">Página <b class="pg"></b> de <span class="pgt"></span></span></footer>`;
  const cond = [
    ['L', 'FORMA DE PAGO', '50% para iniciar el proyecto y 50% contra entrega, antes de publicación final.'],
    ['T', 'TIEMPO ESTIMADO', 'De 3 a 7 días hábiles, dependiendo del paquete y de la entrega oportuna de la información.'],
    ['C', 'INFORMACIÓN DEL CLIENTE', 'El cliente proporciona logotipo, fotografías, listado de servicios o productos, datos de contacto y cualquier información necesaria.'],
    ['A', 'AJUSTES', 'Se incluyen las rondas indicadas en cada paquete. Cambios adicionales se cotizan por separado.'],
    ['W', 'DOMINIO Y HOSTING', mant ? `Incluidos durante el primer año. ${mant.replace(/^el primer año va incluido;\s*/i, '').replace(/^./, (x) => x.toUpperCase())}` : 'Incluidos durante el primer año.'],
    ['F', 'VIGENCIA', `Precios y disponibilidad válidos hasta ${dias} días calendario después de la emisión.`],
    ...(cta ? [['B', 'DATOS PARA EL PAGO', esc(cta).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n+/g, '<br>')]] : []),
  ];
  return `<style>${CSS_BASE}
    .negro { background: #0a0a0a; color: #fff; position: relative; padding: 11mm 13.5mm 0; }
    .cuadro { position: absolute; left: 0; top: 0; width: 19mm; height: 20mm; background: #dd2526; }
    .marca { position: relative; }
    .marca b { font-size: 26px; letter-spacing: .14em; line-height: 1; display: block; }
    .marca i { color: #dd2526; font-style: normal; }
    .lema { display: block; font-size: 8px; letter-spacing: .32em; color: #b4b4b4; margin-top: 2mm; }
    .marca small { display: block; font-size: 6.8px; line-height: 1.55; color: #9a9a9a; margin-top: 1.5mm; }
    .tipo { position: absolute; right: 13.5mm; top: 9.5mm; display: flex; gap: 3mm; align-items: center; font-size: 7.6px; letter-spacing: .22em; color: #cfcfcf; line-height: 1.4; }
    .tipo b { color: #fff; }
    .circ { width: 10.5mm; height: 10.5mm; border: 1px solid #fff; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff; letter-spacing: 0; }
    .hero { height: 133mm; }
    .hero .cot { color: #dd2526; font-size: 7.4px; letter-spacing: .34em; font-weight: 700; margin-top: 11mm; }
    .hero h1 { font-size: 29px; line-height: 1.12; letter-spacing: -.02em; margin-top: 4mm; }
    .hero h1 em, .rojo { color: #dd2526; font-style: normal; }
    .barrita { width: 18mm; height: 1mm; background: #dd2526; margin-top: 4.5mm; }
    .hero p { font-size: 10.5px; color: #bcbcbc; max-width: 132mm; margin-top: 5mm; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); background: #171717; border: 1px solid #2a2a2a; border-radius: 2mm; margin-top: 5mm; padding: 3.5mm 0; }
    .meta div { padding: 0 5mm; border-left: 1px solid #333; }
    .meta div:first-child { border-left: 0; }
    .meta small, .lab { display: block; font-size: 6.6px; letter-spacing: .26em; color: #8e8e8e; font-weight: 700; }
    .meta b { font-size: 10.5px; display: block; margin-top: 1mm; }
    .meta span { font-size: 8px; color: #9a9a9a; }
    .corta { height: 36mm; }
    .banda { height: 9mm; background: #0a0a0a; border-top: 1px solid #2c2c2c; color: #a9a9a9; padding: 0 13.5mm; display: flex; justify-content: space-between; align-items: center; font-size: 7.4px; letter-spacing: .2em; font-weight: 700; }
    .banda b { color: #fff; }
    .cuerpo { padding: 0 13.5mm 5mm; }
    .uno .cuerpo { padding-top: 0; }
    footer { flex: none; height: 13mm; border-top: 1px solid #d8d8d8; padding: 0 13.5mm; display: flex; align-items: center; gap: 6mm; font-size: 8.5px; color: #666; }
    footer .et { color: #111; }
    footer .num { margin-left: auto; }
    .cinv { background: #fff; border: 1px solid #e0e0e0; border-radius: 3mm; padding: 5.5mm 7mm; margin-top: -7mm; position: relative; margin-bottom: 8mm; }
    .cinv .lab { color: #555; }
    .gran { font-size: 31px; font-weight: 700; letter-spacing: -.03em; line-height: 1.2; margin-top: 1.5mm; }
    .cinv small { color: #666; }
    .sub { font-size: 7.4px; letter-spacing: .26em; font-weight: 700; color: #333; margin: 0 0 3.5mm; }
    .paq { border: 1px solid #e0e0e0; border-radius: 3mm; padding: 6mm 6mm 5mm; margin-bottom: 3.5mm; }
    .paq .top { display: flex; align-items: center; gap: 4mm; }
    .ini { width: 11.5mm; height: 11.5mm; border-radius: 2mm; background: #0a0a0a; color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 15px; }
    .paq h3 { font-size: 15px; letter-spacing: .08em; text-transform: uppercase; }
    .paq .top small { color: #666; font-size: 9px; }
    .paq .pre { margin-left: auto; color: #dd2526; font-size: 18px; font-weight: 700; }
    .paq ul { columns: 2; column-gap: 8mm; margin-top: 5mm; }
    .paq li, .chk { position: relative; padding-left: 4.5mm; }
    .paq li { padding-bottom: 1.8mm; break-inside: avoid; font-size: 9.4px; }
    .paq li::before { content: "+"; position: absolute; left: 0; color: #dd2526; font-weight: 700; }
    .tres { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
    .tres div { background: #f7f7f7; border: 1px solid #ececec; border-radius: 2mm; padding: 3.5mm 4mm; font-size: 8.6px; color: #666; line-height: 1.4; }
    .tres b { display: block; color: #111; font-size: 9.6px; margin-bottom: .8mm; }
    h2 { font-size: 27px; letter-spacing: -.02em; line-height: 1.12; padding-top: 10mm; }
    .bar2 { width: 18mm; height: 1mm; background: #dd2526; margin: 3.5mm 0 5mm; }
    .intro { font-size: 10.5px; color: #333; margin-bottom: 7mm; }
    .tabla { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 6mm; }
    .tabla th { background: #0a0a0a; color: #fff; font-size: 7.4px; letter-spacing: .2em; padding: 3mm 4mm; text-align: right; }
    .tabla th:first-child { text-align: left; border-radius: 2mm 0 0 0; }
    .tabla th:last-child { border-radius: 0 2mm 0 0; }
    .tabla td { padding: 4mm; text-align: right; vertical-align: top; background: #fdeeee; font-size: 9.6px; }
    .tabla td:first-child { text-align: left; border-left: 2px solid #dd2526; }
    .tabla td.nor { background: #f7f7f7; }
    .tabla .cn b { font-size: 11px; }
    .tag { display: inline-block; background: #e4e4e4; font-size: 6.4px; letter-spacing: .16em; font-weight: 700; padding: .6mm 2mm; border-radius: 1mm; margin: 1mm 0; }
    .tabla .d { color: #666; font-size: 8.4px; line-height: 1.4; }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.5mm; margin-bottom: 5mm; }
    .grid3 div { display: flex; gap: 3mm; align-items: center; border: 1px solid #ececec; background: #fafafa; border-radius: 2mm; padding: 3mm; font-size: 8.8px; line-height: 1.35; min-height: 13mm; }
    .grid3 i { flex: none; width: 6.5mm; height: 6.5mm; border-radius: 50%; background: #fbd9d9; color: #dd2526; display: grid; place-items: center; font-style: normal; font-weight: 700; }
    .totn { background: #0a0a0a; color: #fff; border-radius: 3mm; padding: 5.5mm 5mm; display: grid; grid-template-columns: 1fr 1fr; align-items: center; margin-bottom: 3mm; }
    .totn .gran { font-size: 27px; }
    .totn .der { border-left: 1px solid #333; padding-left: 4mm; font-size: 9px; color: #aaa; }
    .totn .der div { display: flex; justify-content: space-between; padding: .6mm 0; }
    .totn .der b { color: #fff; }
    .crono { border: 1px solid #e0e0e0; border-radius: 3mm; padding: 4mm 3mm 3.5mm; }
    .crono .lab { padding-left: 2mm; color: #555; }
    .crono .pasos { display: grid; grid-template-columns: 1fr 1fr; position: relative; margin-top: 2mm; text-align: center; }
    .crono .pasos::before { content: ""; position: absolute; left: 35%; right: 35%; top: 4mm; height: 1mm; background: #eee; }
    .crono em { display: grid; place-items: center; width: 8.5mm; height: 8.5mm; border-radius: 50%; background: #dd2526; color: #fff; font-style: normal; font-weight: 700; margin: 0 auto 1.5mm; }
    .crono div div:last-child em { background: #0a0a0a; }
    .crono b { display: block; font-size: 8.6px; letter-spacing: .05em; }
    .crono span { color: #666; font-size: 8.6px; }
    .cond { display: grid; grid-template-columns: 11mm 42mm 1fr; align-items: center; background: #f7f7f7; border-radius: 2mm; padding: 2.8mm 4mm; margin-bottom: 1.8mm; }
    .cond em { width: 9mm; height: 9mm; border-radius: 50%; background: #fff; border: 1px solid #eee; color: #dd2526; font-style: normal; font-weight: 700; font-size: 12px; display: grid; place-items: center; }
    .cond b.t { font-size: 7.4px; letter-spacing: .2em; }
    .cond span { font-size: 9.4px; line-height: 1.5; color: #333; }
    .notas { border: 1px solid #e6e6e6; background: #fafafa; border-radius: 2mm; padding: 4mm; margin-top: 4mm; color: #555; white-space: pre-line; }
    .cta { background: #0a0a0a; color: #fff; border-radius: 3mm; padding: 7mm; margin-top: 5mm; display: flex; justify-content: space-between; align-items: center; gap: 8mm; }
    .cta h3 { font-size: 21px; line-height: 1.12; letter-spacing: -.01em; }
    .cta p { font-size: 9px; color: #b5b5b5; max-width: 75mm; margin-top: 2mm; }
    .cta div:last-child { text-align: right; color: #dd2526; font-weight: 700; font-size: 11px; line-height: 1.7; }
  </style>
  <template id="uno"><div class="negro hero">${marca}
    <div class="cot">${esc(c.quote_number)}</div>
    <h1>Cotización para<br>desarrollo de<br><em>${esc(objeto)}</em></h1><div class="barrita"></div>
    <p>Propuesta diseñada para fortalecer la presencia digital de su negocio, generar confianza y convertir visitas en clientes.</p>
    <div class="meta"><div><small>PREPARADO PARA</small><b>${esc(para)}</b></div><div><small>EMISIÓN</small><b>${fecha(c.created_at)}</b></div><div><small>VIGENCIA</small><b>${dias} días</b></div><div><small>MONEDA</small><b>${esc(cur)}</b><span>${MONEDA[cur] || ''}</span></div></div>
  </div><div class="cuerpo"></div>${pie}</template>
  <template id="sig"><div class="negro corta">${marca}</div><div class="banda"><span>PROPUESTA PARA <b>${esc(String(para).toUpperCase())}</b></span><span>${esc(c.quote_number)} · VIGENTE HASTA <b>${dias} DÍAS</b></span></div><div class="cuerpo"></div>${pie}</template>
  <div class="flujo" data-cab="uno" data-sig="sig">
    <div class="cinv"><span class="lab">INVERSIÓN TOTAL DEL PROYECTO</span><div class="gran">${dinero(t.total, cur)}</div><small>${t.tax_amount ? `ISV incluido.` : 'Valores sin ISV.'} Pago único del desarrollo.</small></div>
    <div class="sub">QUÉ INCLUYE SU PROPUESTA</div>
    ${c.items.map((i) => `<div class="paq"><div class="top"><span class="ini">${esc(String(i.name).trim()[0] || 'C')}</span><div><h3>${esc(String(i.name).replace(/\s*-\s*Landing Page$/i, ''))}</h3><small>${{ monthly: 'Pago mensual', yearly: 'Pago anual' }[i.billing] || 'Pago único'}</small></div><span class="pre">${dinero(importe(i), cur)}${sufijo[i.billing] || ''}</span></div><ul>${incluye(i).slice(0, 12).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}
    <div class="tres"><div><b>Entrega en días, no meses</b>De 3 a 7 días hábiles con la información completa.</div><div><b>Acompañamiento real</b>Diseño, configuración y publicación gestionados por Cresova.</div><div><b>Lista para vender</b>Optimizada para móvil y contacto directo por WhatsApp.</div></div>
  </div>
  <div class="flujo" data-cab="sig">
    <div><h2>Inversión y <span class="rojo">desglose</span></h2><div class="bar2"></div><p class="intro">Detalle claro de cada concepto incluido en la propuesta, con su precio unitario, descuentos aplicados e importe total.</p></div>
    <table class="tabla"><thead><tr><th>CONCEPTO</th><th>CANT.</th><th>P. LISTA</th><th>PRECIO</th><th>IMPORTE</th></tr></thead><tbody>${c.items.map((i) => `<tr><td class="cn ${i.is_recommended ? '' : 'nor'}"><b>${esc(i.name)}</b><br><span class="tag">${COBRO[i.billing || 'one_time']}${i.is_recommended ? ' · RECOMENDADA' : ''}</span><div class="d">${esc(incluye(i).slice(0, 3).join(' · ')).slice(0, 120)}</div></td><td class="${i.is_recommended ? '' : 'nor'}">${Number(i.quantity ?? 1)}</td><td class="${i.is_recommended ? '' : 'nor'}">${Number(i.list_price) > Number(i.unit_price) ? dinero(i.list_price, cur) : '—'}</td><td class="${i.is_recommended ? '' : 'nor'}">${dinero(i.unit_price, cur)}</td><td class="${i.is_recommended ? '' : 'nor'}"><b>${dinero(importe(i), cur)}${sufijo[i.billing] || ''}</b></td></tr>`).join('')}</tbody></table>
    <div class="sub">QUÉ INCLUYE ESTA INVERSIÓN</div>
    <div class="grid3">${c.items.flatMap(incluye).slice(0, 9).map((x) => `<div><i>+</i><span>${esc(x)}</span></div>`).join('')}</div>
    <div class="totn"><div><span class="lab">TOTAL A INVERTIR</span><div class="gran">${dinero(t.total, cur)}</div></div><div class="der"><div><span>Subtotal</span><b>${dinero(t.subtotal_setup, cur)}</b></div>${desc ? `<div><span>Descuento</span><b>− ${dinero(desc, cur)}</b></div>` : ''}${t.tax_amount ? `<div><span>ISV</span><b>${dinero(t.tax_amount, cur)}</b></div>` : ''}</div></div>
    <div class="crono"><span class="lab">CRONOGRAMA DE PAGO</span><div class="pasos"><div><em>1</em><b>INICIO</b><span>${dinero(mitad, cur)}</span></div><div><em>2</em><b>ENTREGA</b><span>${dinero(resto, cur)}</span></div></div></div>
  </div>
  <div class="flujo" data-cab="sig">
    <div><h2>Condiciones comerciales<br>y <span class="rojo">próximos pasos</span></h2><div class="bar2"></div></div>
    ${cond.map(([l, ti, tx]) => `<div class="cond"><em>${l}</em><b class="t">${ti}</b><span>${l === 'B' ? tx : esc(tx)}</span></div>`).join('')}
    ${notas ? `<div class="notas"><span class="lab">NOTAS</span>\n${esc(notas)}</div>` : ''}
    <div class="cta"><div><h3>Transformemos<br>su presencia digital</h3><p>Para reservar un cupo, se confirma el paquete elegido y se realiza el anticipo correspondiente.</p></div><div>WhatsApp ${WHATSAPP}<br>cresova.com</div></div>
  </div>`;
}

// ---------- Propuesta estratégica (proyectos grandes) ----------
function estrategica(c) {
  const e = c.enterprise_data;
  const { t, cur, mitad, resto, dias, desc } = base(c);
  // Plan de pago propio (p. ej. pago inicial + cuotas mensuales): [{ concepto, cuando, monto }]. Sin él, 50 % / 50 %.
  const plan = Array.isArray(e.plan_pago) && e.plan_pago.length ? e.plan_pago : null;
  const num = String(c.quote_number).split('-').pop().replace(/^0+/, ''), anio = String(c.quote_number).split('-')[1];
  const cliente = c.client_company || c.client_name || '';
  const agente = e.tipo === 'agente';
  const x = e.extra || null; // bloques adicionales de una propuesta más completa
  const conMes = agente || Boolean(e.cond_mes); // proyecto con implementación + mensualidad
  const CAP = [['01', 'Diagnóstico y propuesta'], ['02', 'Valor esperado'], ['03', 'Arquitectura del sistema'], ['04', 'Roadmap por fases'], ['05', 'Inversión'], ['06', 'Condiciones comerciales']];
  const plantilla = (id, n, titulo) => `<template id="${id}"><header><b class="s">${n}</b><span class="et">${esc(titulo.toUpperCase())}</span><span class="cot">${esc(c.quote_number)}</span></header><div class="cuerpo"></div><footer><div><b class="et">CRESOVA<i>.</i></b><small>${RAZON} · RTN ${RTN}</small></div><span>p. <span class="pg"></span> / <span class="pgt"></span></span></footer></template>`;
  const pares = (l, f) => { const out = []; for (let i = 0; i < l.length; i += 2) out.push(`<div class="dos">${l.slice(i, i + 2).map((x, k) => f(x, i + k)).join('')}</div>`); return out.join(''); };
  const titulo = (ey, h, intro) => `<div class="tit"><div class="ey">${ey}</div><h2>${h}</h2>${intro ? `<p class="intro">${intro}</p>` : ''}</div>`;
  const recurrente = t.subtotal_monthly ? `+ ${dinero(t.subtotal_monthly, cur)} /mes` : t.subtotal_yearly ? `+ ${dinero(t.subtotal_yearly, cur)} /año` : '';
  const html = `<style>${CSS_BASE}
    .serif, h2, header .s, .port h1 { font-family: "Times New Roman", Times, "Liberation Serif", serif; font-weight: 700; }
    .port { background: #0a0a0a; color: #fff; padding: 15mm 16mm 0; position: relative; }
    .port .top { display: flex; justify-content: space-between; align-items: center; }
    .port .logo { font-size: 20px; font-weight: 700; letter-spacing: .15em; }
    .port i, footer i { color: #dd2526; font-style: normal; }
    .port .pn { font-size: 7.2px; letter-spacing: .34em; color: #aaa; }
    .port .num { position: absolute; right: -8mm; top: 45mm; font: 700 330px/1 "Times New Roman", Times, "Liberation Serif", serif; color: #181818; letter-spacing: -.04em; }
    .port .linea { position: absolute; left: 116mm; top: 78mm; bottom: 72mm; width: 1px; background: #2c2c2c; }
    .port .pe { position: absolute; left: 16mm; top: 78mm; font-size: 7.2px; letter-spacing: .34em; color: #dd2526; font-weight: 700; }
    .port h1 { position: absolute; left: 16mm; top: 88mm; width: 95mm; font-size: 40px; line-height: 1.1; letter-spacing: -.02em; }
    .port .bl { position: absolute; left: 16mm; right: 16mm; bottom: 72mm; display: grid; grid-template-columns: 100mm 1fr; }
    .port .rule { width: 21mm; height: 1mm; background: #dd2526; margin-bottom: 7mm; }
    .port small.l { display: block; font-size: 6.8px; letter-spacing: .32em; color: #888; margin-bottom: 1.5mm; }
    .port .pp b { font-size: 16px; display: block; }
    .port .pp span { font-size: 9px; color: #aaa; line-height: 1.5; display: block; }
    .port .pr { align-self: end; border-top: 1px solid #333; padding-top: 5mm; }
    .port .pr b { font-size: 11px; display: block; }
    .port .pr span { font-size: 8.4px; color: #aaa; line-height: 1.5; display: block; }
    .port .fin { position: absolute; left: 16mm; right: 16mm; bottom: 15mm; border-top: 1px solid #232323; padding-top: 7mm; display: flex; justify-content: space-between; }
    .port .fin b { font-size: 11px; display: block; }
    .port .fin .der { text-align: right; }
    .port .fin .der b { color: #dd2526; }
    .hoja.port { height: 297mm; }
    header { flex: none; height: 30mm; border-bottom: 1.5px solid #e5e5e5; padding: 0 13.5mm; display: flex; align-items: center; gap: 4mm; }
    header .s { color: #dd2526; font-size: 29px; }
    header .et { font-size: 8.6px; letter-spacing: .34em; color: #666; }
    header .cot { margin-left: auto; font-size: 8.4px; letter-spacing: .12em; color: #777; }
    .cuerpo { padding: 9mm 13.5mm 4mm; }
    footer { flex: none; height: 16mm; background: #0a0a0a; color: #fff; padding: 0 13.5mm; display: flex; justify-content: space-between; align-items: center; }
    footer b { font-size: 9.5px; letter-spacing: .2em; display: block; }
    footer small { font-size: 7.4px; color: #9a9a9a; }
    footer > span { font-size: 8px; letter-spacing: .14em; color: #aaa; }
    .tit { margin-bottom: 7mm; }
    .ey { color: #dd2526; font-size: 7.6px; letter-spacing: .34em; font-weight: 700; margin-bottom: 2.5mm; }
    h2 { font-size: 26px; letter-spacing: -.015em; line-height: 1.15; }
    .intro { font-size: 11px; line-height: 1.6; margin-top: 4mm; }
    .txt { font-size: 11px; line-height: 1.65; margin-bottom: 4mm; }
    .quote { display: flex; gap: 3mm; margin: 8mm 0 5mm; }
    .quote b { font: 700 54px/.8 "Times New Roman", Times, "Liberation Serif", serif; color: #dd2526; }
    .quote em { font: italic 400 14px "Times New Roman", Times, "Liberation Serif", serif; }
    .ind { display: grid; grid-template-columns: 20mm auto 1fr 12mm; align-items: baseline; gap: 3mm; margin-bottom: 7mm; }
    .ind b.n { color: #dd2526; font: 700 25px "Times New Roman", Times, "Liberation Serif", serif; }
    .ind b.t { font: 700 16px "Times New Roman", Times, "Liberation Serif", serif; }
    .ind i { border-bottom: 1px dotted #bbb; }
    .ind .p { text-align: right; font-size: 9px; letter-spacing: .2em; font-weight: 700; color: #555; }
    .dos { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
    .val { margin-bottom: 8mm; }
    .val b { display: block; color: #dd2526; font: 700 19px "Times New Roman", Times, "Liberation Serif", serif; border-bottom: 1px solid #eee; padding-bottom: 2.5mm; width: 12mm; margin-bottom: 3mm; }
    .val span { font-size: 10.5px; line-height: 1.55; }
    .notaf { border-top: 1.5px solid #e5e5e5; padding-top: 4mm; color: #777; font-size: 9px; }
    .dos.mod { gap: 0; border-top: 1px solid #ececec; }
    .mo { display: grid; grid-template-columns: 17mm 1fr; padding: 6mm 4mm 7mm 6mm; border-right: 1px solid #ececec; }
    .mo:first-child { border-left: 1px solid #ececec; }
    .mo .n { color: #dd2526; font: 700 22px "Times New Roman", Times, "Liberation Serif", serif; }
    .mo small { font-size: 6.6px; letter-spacing: .3em; color: #777; font-weight: 700; }
    .mo h3 { font-size: 11.5px; line-height: 1.22; margin: 1mm 0 1mm; }
    .mo p { color: #555; font-size: 9.2px; line-height: 1.5; }
    .fa { display: grid; grid-template-columns: 22mm 1fr; margin-bottom: 7mm; position: relative; }
    .fa em { width: 13mm; height: 13mm; border-radius: 50%; background: #dd2526; color: #fff; display: grid; place-items: center; font-style: normal; font: 700 13px "Times New Roman", Times, "Liberation Serif", serif; margin-left: 3mm; }
    .fa .c { display: flex; justify-content: space-between; align-items: center; gap: 4mm; margin-bottom: 2mm; }
    .fa h3 { font: 700 13.5px "Times New Roman", Times, "Liberation Serif", serif; }
    .fa .du { background: #fbe4e4; color: #dd2526; font-size: 7px; letter-spacing: .14em; font-weight: 700; padding: 1mm 3mm; border-radius: 2mm; white-space: nowrap; }
    .fa li { font-size: 9.8px; line-height: 1.55; padding-left: 3mm; }
    .tb { display: grid; grid-template-columns: 1fr 26mm 36mm 30mm; background: #0a0a0a; color: #fff; font-size: 7.6px; letter-spacing: .2em; font-weight: 700; padding: 3.5mm 4mm; border-radius: 1.5mm 1.5mm 0 0; }
    .tb span:not(:first-child), .it .fi span:not(:first-child) { text-align: right; }
    .it { padding: 4mm; background: #f7f7f7; }
    .it.rec { background: #fdefef; border-left: 2px solid #dd2526; }
    .it .fi { display: grid; grid-template-columns: 1fr 26mm 36mm 30mm; align-items: start; font-size: 9.8px; padding-bottom: 3mm; border-bottom: 1px solid #e6e6e6; }
    .it b.n { font-size: 11.5px; }
    .tagr, .tagg, .tagb { display: inline-block; font-size: 6.2px; letter-spacing: .16em; font-weight: 700; padding: .5mm 2.4mm; border-radius: .8mm; margin: 1mm 1.5mm 0 0; }
    .tagr { background: #dd2526; color: #fff; }
    .tagg { background: #e5e5e5; color: #333; }
    .tagb { background: #1d5fd1; color: #fff; }
    .inc { color: #dd2526; font-size: 6.6px; letter-spacing: .24em; font-weight: 700; margin: 3mm 0 1.5mm; }
    .it ul { columns: 3; column-gap: 6mm; }
    .it li { font-size: 8.2px; line-height: 1.4; padding: 0 0 1.4mm 3.5mm; position: relative; break-inside: avoid; }
    .it li::before { content: ""; position: absolute; left: 0; top: 1.3mm; width: 1.3mm; height: 1.3mm; border-radius: 50%; background: #dd2526; }
    .par { display: grid; grid-template-columns: 1.27fr 1fr; gap: 5mm; }
    .tt { background: #0a0a0a; color: #fff; border-radius: 2mm; padding: 7mm 8mm; }
    .tt .l { font-size: 7.6px; letter-spacing: .26em; font-weight: 700; color: #b5b5b5; }
    .tt .fl { display: flex; justify-content: space-between; color: #bbb; font-size: 9.5px; margin-top: 1.5mm; }
    .tt .g { color: #dd2526; font: 700 46px/1.15 "Times New Roman", Times, "Liberation Serif", serif; letter-spacing: -.02em; margin-top: 2mm; }
    .tt .ba { width: 13mm; height: .9mm; background: #dd2526; margin: 2mm 0; }
    .tt em { color: #b5b5b5; font-size: 9px; display: block; }
    .tt .rec { border-top: 1px solid #fff; margin-top: 3mm; padding-top: 3mm; }
    .tt .rec b { color: #4d8ef0; font-size: 10px; }
    .fp { background: #f7f7f7; border: 1px solid #ececec; border-radius: 2mm; padding: 7mm 6mm; }
    .fp .l { color: #dd2526; font-size: 7.6px; letter-spacing: .26em; font-weight: 700; margin-bottom: 4mm; }
    .fp .fl { display: flex; justify-content: space-between; padding: 2mm 0; font-size: 9.8px; border-bottom: 1px solid #e9e9e9; }
    .fp .fl b { font: 700 12px "Times New Roman", Times, "Liberation Serif", serif; }
    .fp small { display: block; margin-top: 3mm; color: #777; font-size: 9px; }
    .fp .fl small { margin-top: .6mm; font-size: 8px; }
    .tm { display: grid; grid-template-columns: 37mm 1fr; margin-bottom: 7mm; }
    .tm .k::before { content: ""; display: block; width: 8.5mm; height: .9mm; background: #dd2526; margin-bottom: 2.5mm; }
    .tm .k { color: #dd2526; font-size: 7.4px; letter-spacing: .24em; font-weight: 700; }
    .tm div:last-child { font-size: 10.5px; line-height: 1.65; }
    .lis { background: #0a0a0a; color: #fff; border-left: 2px solid #dd2526; border-radius: 2mm; padding: 8mm 8mm; margin-top: 4mm; }
    .lis h3 { font: 700 21px "Times New Roman", Times, "Liberation Serif", serif; margin-bottom: 3mm; }
    .lis p { color: #aaa; font-size: 9.8px; line-height: 1.55; margin-bottom: 4mm; }
    .lis b { color: #dd2526; font-size: 10.8px; }
    .cmp { width: 100%; border-collapse: collapse; font-size: 9.4px; line-height: 1.4; }
    .cmp th { background: #0a0a0a; color: #fff; text-align: left; padding: 3mm; font-size: 7.4px; letter-spacing: .14em; }
    .cmp td { padding: 2.6mm 3mm; border-bottom: 1px solid #ececec; vertical-align: top; }
    .cmp td:first-child { font-weight: 700; width: 32%; }
    .cmp td:last-child { background: #fdf3f3; }
    ${x ? B.CSS : ''}
  </style>
  <div class="hoja port"><div class="top"><span class="logo">CRESOVA<i>.</i></span><span class="pn">PROPUESTA N.º ${esc(num)} / ${esc(anio)}</span></div><div class="num">${esc(num)}</div><div class="linea"></div><div class="pe">PROPUESTA ESTRATÉGICA</div><h1>${esc(e.project_title)}</h1>
    <div class="bl"><div class="pp"><div class="rule"></div><small class="l">PREPARADA PARA</small><b>${esc(cliente)}</b>${c.client_contact_name ? `<span>Contacto: ${esc(c.client_contact_name)}${c.client_contact_role ? ` · ${esc(c.client_contact_role)}` : ''}</span>` : ''}${c.client_rtn ? `<span>RTN: ${esc(c.client_rtn)}</span>` : ''}</div><div class="pr"><small class="l">PREPARADA POR</small><b>${esc(c.vendedor || RAZON)}</b><span>${RAZON}</span><span>${CORREO}</span></div></div>
    <div class="fin"><div><small class="l">EMITIDA</small><b>${fecha(c.created_at)}</b></div><div class="der"><small class="l">INVERSIÓN TOTAL</small><b>${dinero(t.total, cur)}</b>${recurrente ? `<small class="l" style="margin:1.5mm 0 0;letter-spacing:.04em;font-size:9px">${recurrente}</small>` : ''}</div></div></div>
  ${plantilla('c0', '00', 'Índice')}${CAP.map(([n, ti]) => plantilla(`c${Number(n)}`, n, ti)).join('')}
  <div class="flujo" data-cab="c0">${titulo('CONTENIDO', 'Lo que vas a encontrar.')}${CAP.map(([n, ti]) => `<div class="ind"><b class="n">${n}</b><b class="t">${esc(ti)}</b><i></i><span class="p" data-ind="${Number(n)}"></span></div>`).join('')}${x ? B.resumen(x, [['Implementación', dinero(t.total, cur)], ['Mensualidad', recurrente.replace('+ ', '').replace(' /mes', '') || '—'], ['Puesta en marcha', x.tiempo || ''], [x.dato_titulo || 'Alcance', x.dato || '']]) : ''}</div>
  <div class="flujo" data-cab="c1" data-sec="1">${titulo('EL PROBLEMA', 'Lo que resolvemos.')}${parrafos(e.problem_diagnosis).map((p) => `<p class="txt">${esc(p)}</p>`).join('')}<div class="quote"><b>“</b><em>Nuestra propuesta</em></div>${parrafos(e.solution_summary).map((p) => `<p class="txt">${esc(p)}</p>`).join('')}${x ? B.diagnostico(x) : ''}</div>
  <div class="flujo" data-cab="c2" data-sec="2">${titulo('VALOR ESPERADO', 'Resultados que esta inversión debe generar', 'Cada punto es un resultado medible del proyecto, no una promesa general.')}${pares(e.value_props || [], (v, i) => `<div class="val"><b>${String(i + 1).padStart(2, '0')}</b><span>${esc(v)}</span></div>`)}<div class="notaf">El objetivo es que la inversión se traduzca en resultados operativos y comerciales verificables.</div>${x ? B.valorExtra(x) : ''}</div>${x ? B.vista(x) : ''}
  <div class="flujo" data-cab="c3" data-sec="3">${titulo('LA CONSTRUCCIÓN', 'Cómo está construido.', 'Cada módulo cumple un rol específico y se conecta con el resto para formar un sistema robusto, escalable y mantenible en el tiempo.')}${(() => { const l = e.architecture || [], out = []; for (let i = 0; i < l.length; i += 2) out.push(`<div class="dos mod">${l.slice(i, i + 2).map((m, k) => `<div class="mo"><span class="n">${String(i + k + 1).padStart(2, '0')}</span><div><small>MÓDULO</small><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p>${m.puntos ? `<ul>${m.puntos.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div></div>`).join('')}</div>`); return out.join(''); })()}</div>
  ${e.comparativa?.filas?.length ? `<div class="flujo" data-cab="c3">${titulo('EL ALCANCE', esc(e.comparativa.titulo), esc(e.comparativa.intro || ''))}<table class="cmp"><thead><tr>${e.comparativa.columnas.map((x) => `<th>${esc(x.toUpperCase())}</th>`).join('')}</tr></thead><tbody>${e.comparativa.filas.map((f) => `<tr>${f.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
  ${x ? B.operacion(x) : ''}
  <div class="flujo" data-cab="c4" data-sec="4">${titulo('LA ENTREGA', 'Cómo lo entregamos.', 'Trabajamos en fases cortas con entregables tangibles. Al final de cada una revisamos avances contigo antes de continuar.')}${(e.phases || []).map((f, i) => `<div class="fa"><em>${i + 1}</em><div><div class="c"><h3>${esc(f.name)}</h3>${f.duration ? `<span class="du">${esc(f.duration)}</span>` : ''}</div><ul>${(f.deliverables || []).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>${f.necesitamos ? `<div class="nec"><b>QUÉ NECESITAMOS DE SU EQUIPO</b>${esc(f.necesitamos)}</div>` : ''}</div></div>`).join('')}</div>
  <div class="flujo" data-cab="c5" data-sec="5">${titulo('ESTRUCTURA DE INVERSIÓN', 'Alcance y propuesta económica.')}<div class="tb"><span>CONCEPTO</span><span>CANT</span><span>PRECIO</span><span>SUBTOTAL</span></div>${c.items.map((i) => `<div class="it ${i.is_recommended ? 'rec' : ''}"><div class="fi"><div><b class="n">${esc(i.name)}</b><br>${i.is_recommended ? '<span class="tagr">RECOMENDADA</span>' : ''}<span class="${i.billing && i.billing !== 'one_time' ? 'tagb' : 'tagg'}">${COBRO[i.billing || 'one_time']}</span></div><span>${Number(i.quantity ?? 1)}</span><span>${dinero(i.unit_price, cur)}${sufijo[i.billing] || ''}</span><span><b>${dinero(importe(i), cur)}${sufijo[i.billing] || ''}</b></span></div><div class="inc">INCLUYE</div><ul>${incluye(i).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}<div style="height:5mm"></div><div class="par"><div class="tt"><div class="l">INVERSIÓN DEL PROYECTO</div><div class="fl"><span>${conMes ? 'Implementación (pago único)' : 'Subtotal (pago único)'}</span><span>${dinero(t.subtotal_setup, cur)}</span></div>${desc ? `<div class="fl"><span>${esc(e.descuento_label || 'Descuento')}</span><span>− ${dinero(desc, cur)}</span></div>` : ''}<div class="g">${dinero(t.total, cur)}</div><div class="ba"></div><em>${conMes ? 'Inversión de implementación' : 'Inversión única del proyecto'} · ${MONEDA[cur] || cur}</em>${recurrente ? `<div class="rec"><b>${recurrente}</b><em>${conMes ? `Mensualidad: inicia cuando ${agente ? 'el agente' : 'el sistema'} entra en operación.` : 'Servicios recurrentes: no se suman al total del proyecto.'}</em></div>` : ''}</div>${plan ? `<div class="fp"><div class="l">PLAN DE PAGO</div>${plan.map((p) => `<div class="fl"><span>${esc(p.concepto)}<small>${esc(p.cuando)}</small></span><b>${dinero(p.monto, cur)}</b></div>`).join('')}</div>` : `<div class="fp"><div class="l">FORMA DE PAGO SUGERIDA</div><div class="fl"><span>Al aceptar</span><b>50%</b></div><div class="fl"><span>Entrega final</span><b>50%</b></div><small>${dinero(mitad, cur)} + ${dinero(resto, cur)}</small></div>`}</div>${x ? B.noIncluye(x) : ''}</div>
  <div class="flujo" data-cab="c6" data-sec="6">${titulo('LOS TÉRMINOS', 'Trabajemos juntos.')}
    <div class="tm"><div class="k">FORMA DE PAGO</div><div>${plan ? `${plan.map((p) => `${esc(p.concepto)}: ${dinero(p.monto, cur)}, ${esc(p.cuando.charAt(0).toLowerCase() + p.cuando.slice(1))}.`).join('<br>')}${e.cond_pago ? `<br>${esc(e.cond_pago)}` : ''}` : `50% al aceptar la propuesta para iniciar el proyecto.<br>${conMes ? '50% contra entrega, antes de salir en vivo.' : '50% contra entrega final, antes de publicación.'}`}${recurrente ? `<br>Servicios recurrentes: ${recurrente.replace('+ ', '')}.` : ''}<br>Transferencia bancaria.${cuentas() ? `<br><br>${esc(cuentas()).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n+/g, '<br>')}` : ''}</div></div>
    ${[['TIEMPO', e.cond_tiempo], ['MENSUALIDAD', e.cond_mes], ['COSTOS EXTERNOS', e.cond_terceros], ['PILOTO Y AJUSTES', e.cond_piloto], ['USO DE DATOS', e.cond_datos], ['LÍMITES', e.cond_limites]].filter(([, x]) => String(x || '').trim()).map(([k, x]) => `<div class="tm"><div class="k">${k}</div><div>${esc(x)}</div></div>`).join('')}
    <div class="tm"><div class="k">VIGENCIA</div><div>Esta propuesta tiene validez de ${dias} días desde su emisión. Precios expresados en ${MONEDA[cur] || cur}${t.tax_amount ? ', con I.S.V. incluido' : ', exentos de I.S.V. según Art. 15 Ley de I.S.V'}.</div></div>
    <div class="tm"><div class="k">PROPIEDAD</div><div>${e.cond_propiedad ? esc(e.cond_propiedad) : 'Todo el código fuente, contenido y activos entregados son propiedad del cliente al liquidar el proyecto.'}</div></div>
    <div class="tm"><div class="k">SIGUIENTE PASO</div><div>Al aceptar esta propuesta agendamos la reunión de kick-off e iniciamos ejecución en 48 horas.</div></div>
    ${x ? B.faq(x) : ''}
    <div class="lis"><h3>¿Listo para empezar?</h3><p>Responde este correo o escríbenos por WhatsApp para agendar la reunión de kick-off y arrancamos en 48 horas.</p><b>WhatsApp ${WHATSAPP} · ${CORREO}</b></div></div>`;
  return x ? B.pulir(html) : html;
}

export { PAGINAR };
export function htmlPropuesta(c) {
  const grande = c.is_enterprise && c.enterprise_data?.project_title;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(c.quote_number)}</title></head><body>${grande ? estrategica(c) : comercial(c)}</body></html>`;
}
export async function cotizacionHTML(id) {
  const c = await cotizacion(id);
  return c ? htmlPropuesta(c) : null;
}

let chromium = null;
export async function cotizacionPDF(id) {
  const html = await cotizacionHTML(id);
  if (!html) return null;
  chromium ||= createRequire(path.join(process.env.ESTUDIO_TOOLKIT || '/opt/estudio', 'package.json'))('playwright').chromium;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate(PAGINAR);
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally { await browser.close(); }
}
export async function nombrePDF(id) {
  const c = await cotizacion(id);
  const n = String(c?.client_company || c?.client_name || 'cliente').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  return `Propuesta-Cresova-${n}-${c?.quote_number || id}.pdf`;
}
