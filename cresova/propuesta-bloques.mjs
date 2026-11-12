// Bloques opcionales de la Propuesta estratégica (enterprise_data.extra): resumen, vistas de cómo se ve el producto y detalle comercial.
// Si una cotización no trae `extra`, el PDF queda exactamente como antes.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const titulo = (ey, h, intro) => `<div class="tit"><div class="ey">${esc(ey)}</div><h2>${esc(h)}</h2>${intro ? `<p class="intro">${esc(intro)}</p>` : ''}</div>`;

export const CSS = `
  .cuerpo { padding-top: 8mm; }
  header { height: 24mm; }
  h2 { font-size: 30px; }
  .intro { font-size: 13.5px; color: #333; }
  .txt { font-size: 13.5px; line-height: 1.65; color: #222; }
  .quote em { font-size: 18px; }
  .ind { margin-bottom: 3.5mm; }
  .ind b.t { font-size: 15px; }
  .val { background: #f6f6f6; border-top: 2px solid #dd2526; padding: 5mm; margin-bottom: 5mm; min-height: 34mm; }
  .val span { font-size: 13.5px; line-height: 1.5; font-weight: 600; }
  .val b { border: 0; padding: 0; margin-bottom: 1mm; width: auto; font-size: 24px; }
  .dos { gap: 5mm; }
  .notaf { font-size: 11px; }
  .dos.mod { gap: 0; }
  .mo { padding: 5mm 4mm 5mm 5mm; }
  .mo h3 { font-size: 14.5px; }
  .mo p { font-size: 11.5px; color: #444; }
  .mo ul { margin-top: 2mm; }
  .mo li { font-size: 10.8px; line-height: 1.45; color: #333; padding: 0 0 1mm 3.5mm; position: relative; }
  .mo li::before { content: ""; position: absolute; left: 0; top: 1.7mm; width: 1.2mm; height: 1.2mm; background: #dd2526; border-radius: 50%; }
  .fa { margin-bottom: 5mm; background: #f7f7f7; border-radius: 2mm; padding: 5mm 5mm 5mm 0; }
  .fa h3 { font-size: 17px; }
  .fa li { font-size: 12.3px; line-height: 1.55; }
  .fa .nec { margin-top: 2.5mm; padding-top: 2.5mm; border-top: 1px solid #e3e3e3; font-size: 11.5px; color: #555; }
  .fa .nec b { color: #dd2526; font-size: 8px; letter-spacing: .18em; display: block; margin-bottom: 1mm; }
  .it li { font-size: 10px; }
  .tm { margin-bottom: 4.5mm; }
  .tm div:last-child { font-size: 12.3px; line-height: 1.55; color: #222; }
  .cmp { font-size: 11.3px; }
  .cmp td { padding: 3mm; }
  .cmp th { font-size: 8px; }

  .rs { background: #0a0a0a; color: #fff; border-left: 2px solid #dd2526; border-radius: 2mm; padding: 7mm; margin-top: 5mm; }
  .rs .l, .lab3 { font-size: 7.6px; letter-spacing: .26em; font-weight: 700; color: #dd2526; }
  .rs p { font: 700 19px/1.3 "Times New Roman", Times, "Liberation Serif", serif; margin: 2.5mm 0 5mm; }
  .rs .g { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid #333; padding-top: 4mm; }
  .rs .g div { padding-right: 3mm; }
  .rs small { display: block; font-size: 7px; letter-spacing: .16em; color: #999; font-weight: 700; margin-bottom: 1mm; }
  .rs .g b { font-size: 14px; line-height: 1.25; display: block; }

  .sub2 { font: 700 17px "Times New Roman", Times, "Liberation Serif", serif; margin: 6mm 0 3mm; }
  .cards2 { display: grid; grid-template-columns: 1fr 1fr; gap: 3.5mm; }
  .card { background: #f6f6f6; border-radius: 2mm; padding: 4.5mm; }
  .card b { display: block; font-size: 13px; margin-bottom: 1mm; }
  .card span { font-size: 11.6px; line-height: 1.5; color: #444; }
  .pasos5 { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 0; position: relative; margin-top: 2mm; }
  .pasos5::before { content: ""; position: absolute; left: 8%; right: 8%; top: 6.5mm; height: 1px; background: #dd2526; }
  .pasos5 > div { position: relative; text-align: center; padding: 0 2mm; }
  .pasos5 em { display: grid; place-items: center; width: 13mm; height: 13mm; margin: 0 auto 2mm; border-radius: 50%; background: #0a0a0a; color: #fff; font: 700 15px "Times New Roman", Times, "Liberation Serif", serif; border: 2px solid #dd2526; }
  .pasos5 b { display: block; font-size: 12.2px; }
  .pasos5 span { font-size: 10.4px; line-height: 1.35; color: #555; display: block; margin-top: .8mm; }

  .demo { display: grid; grid-template-columns: 102mm 1fr; gap: 7mm; align-items: start; }
  .fono { background: #0a0a0a; border-radius: 6mm; padding: 2.5mm; }
  .fono .cab { color: #fff; padding: 2.5mm 3.5mm; display: flex; align-items: center; gap: 2.5mm; }
  .fono .av { width: 8.5mm; height: 8.5mm; border-radius: 50%; background: #dd2526; display: grid; place-items: center; font-weight: 700; font-size: 12px; }
  .fono .cab b { font-size: 12px; display: block; }
  .fono .cab small { font-size: 8.6px; color: #5fd38a; }
  .chat { background: #f0ece6; border-radius: 4mm; padding: 4mm; display: grid; gap: 3mm; }
  .bb { max-width: 86%; padding: 2.2mm 3mm; border-radius: 2.5mm; font-size: 12.4px; line-height: 1.42; background: #fff; }
  .bb.yo { justify-self: end; background: #dcf4cf; }
  .nota-d { display: grid; grid-template-columns: 9mm 1fr; gap: 2mm; margin-bottom: 8mm; }
  .nota-d em { display: grid; place-items: center; width: 8mm; height: 8mm; border-radius: 50%; background: #dd2526; color: #fff; font-style: normal; font-weight: 700; font-size: 11px; }
  .nota-d b { display: block; font-size: 14px; }
  .nota-d span { font-size: 12.4px; line-height: 1.45; color: #444; }
  .ilus { font-size: 9.6px; color: #888; font-style: italic; margin-top: 2mm; }

  .tri { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3.5mm; }
  .tri > div { border-radius: 2mm; padding: 5.5mm 4.5mm; min-height: 112mm; background: #f6f6f6; }
  .tri > div:nth-child(2) { background: #fdeeee; }
  .tri > div:nth-child(3) { background: #0a0a0a; color: #fff; }
  .tri h3 { font-size: 17px; margin-bottom: .6mm; }
  .tri small { font-size: 9.6px; color: #777; display: block; margin-bottom: 3mm; }
  .tri > div:nth-child(3) small { color: #aaa; }
  .tri li { font-size: 13.2px; line-height: 1.35; padding: 3.4mm 0; border-top: 1px solid rgba(128,128,128,.25); }

  .rep { background: #0a0a0a; color: #fff; border-radius: 3mm; padding: 7mm; }
  .ad { width: 100%; border-collapse: collapse; font-size: 12.2px; line-height: 1.4; }
  .ad th { text-align: left; padding: 3mm; font-size: 8px; letter-spacing: .14em; background: #eee; }
  .ad th:last-child { background: #dd2526; color: #fff; }
  .ad td { padding: 3mm; border-bottom: 1px solid #ececec; vertical-align: top; width: 50%; }
  .ad td:last-child { font-weight: 600; background: #fdf3f3; }
  .sig { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; }
  .sig div { background: #f6f6f6; border-top: 2px solid #dd2526; padding: 4mm; }
  .sig b { display: block; font: 700 22px "Times New Roman", Times, "Liberation Serif", serif; color: #dd2526; }
  .sig strong { display: block; font-size: 12.5px; margin: 1mm 0; }
  .sig span { font-size: 10.8px; line-height: 1.4; color: #555; }
  .rep .top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4mm; }
  .rep .top b { font-size: 14px; letter-spacing: .08em; }
  .rep .top span { font-size: 9.6px; color: #999; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2.5mm; }
  .tile { background: #1a1a1a; border-radius: 1.5mm; padding: 3.5mm; }
  .tile b { font: 700 31px/1.1 "Times New Roman", Times, "Liberation Serif", serif; color: #fff; display: block; }
  .tile.r b { color: #ff5a5b; }
  .tile span { font-size: 10.4px; line-height: 1.25; color: #aaa; display: block; margin-top: 1mm; }
  .barras { margin-top: 6mm; }
  .barra { display: grid; grid-template-columns: 42mm 1fr 10mm; align-items: center; gap: 3mm; font-size: 12px; margin-top: 3.5mm; }
  .barra i { display: block; height: 4mm; background: #dd2526; border-radius: 1mm; }
  .barra .tr { background: #2a2a2a; border-radius: 1mm; }
  .barra b { text-align: right; }

  .kb { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2mm; background: #f1f1f1; border-radius: 2mm; padding: 2.5mm; }
  .kb { padding: 3mm; }
  .kb .col h4 { font-size: 8.6px; letter-spacing: .1em; margin: 1mm 0 2mm; display: flex; justify-content: space-between; }
  .kb .tj { background: #fff; border-radius: 1.2mm; padding: 2.6mm 2.2mm; margin-bottom: 2mm; font-size: 10.2px; line-height: 1.32; border-left: 2px solid #dd2526; }
  .kb .tj.n { border-left-color: #0a0a0a; }
  .kb .tj.g { border-left-color: #999; }
  .kb .tj b { display: block; font-size: 11px; }
  .kb .tj small { color: #777; font-size: 9px; }
  .ficha { display: grid; grid-template-columns: 62mm 1fr; border: 1px solid #e3e3e3; border-radius: 2mm; overflow: hidden; }
  .ficha .iz { background: #0a0a0a; color: #fff; padding: 5mm; }
  .ficha .iz h3 { font-size: 15px; margin-bottom: 3mm; }
  .ficha .iz div { font-size: 11.6px; padding: 1.6mm 0; border-top: 1px solid #2c2c2c; display: flex; justify-content: space-between; gap: 2mm; }
  .ficha .iz span { color: #999; }
  .ficha .de { padding: 5mm; }
  .ev { display: grid; grid-template-columns: 18mm 1fr; font-size: 11.8px; padding: 2.2mm 0; border-bottom: 1px solid #eee; }
  .ev span { color: #888; }
  .matriz { width: 100%; border-collapse: collapse; font-size: 11.6px; }
  .matriz th { background: #0a0a0a; color: #fff; padding: 3mm; font-size: 8px; letter-spacing: .12em; text-align: center; }
  .matriz th:first-child, .matriz td:first-child { text-align: left; font-weight: 700; }
  .matriz td { padding: 2.8mm 3mm; border-bottom: 1px solid #ececec; text-align: center; }
  .matriz .si { color: #dd2526; font-weight: 700; }
  .matriz .no { color: #bbb; }

  .ni { background: #f6f6f6; border-radius: 2mm; padding: 5mm 6mm; margin-top: 5mm; }
  .ni .lab3 { display: block; margin-bottom: 2.5mm; }
  .ni ul { columns: 2; column-gap: 7mm; }
  .ni li { font-size: 11.3px; line-height: 1.4; padding: 0 0 1.6mm 3.5mm; position: relative; break-inside: avoid; }
  .ni li::before { content: "–"; position: absolute; left: 0; color: #dd2526; }
  .faq { padding: 3.5mm 0; border-bottom: 1px solid #e8e8e8; }
  .faq b { display: block; font: 700 14.5px "Times New Roman", Times, "Liberation Serif", serif; margin-bottom: 1mm; }
  .faq span { font-size: 12px; line-height: 1.5; color: #333; }
`;

const lista = (l) => (l || []).map((x) => `<li>${esc(x)}</li>`).join('');
const notas = (l) => (l || []).map((n, i) => `<div class="nota-d"><em>${i + 1}</em><div><b>${esc(n[0])}</b><span>${esc(n[1])}</span></div></div>`).join('');

export const resumen = (x, datos) => `<div class="rs"><div class="l">LA PROPUESTA EN BREVE</div><p>${esc(x.frase)}</p><div class="g">${datos.map(([k, v]) => `<div><small>${esc(k.toUpperCase())}</small><b>${esc(v)}</b></div>`).join('')}</div></div>`;

export const diagnostico = (x) => `
  ${x.retos ? `<div><div class="sub2">${esc(x.retos_titulo || 'Lo que debe resolverse')}</div></div><div class="cards2">${x.retos.map(([t, d]) => `<div class="card"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div>` : ''}
  ${x.pasos ? `<div><div class="sub2">${esc(x.pasos_titulo || 'Cómo funciona')}</div><div class="pasos5">${x.pasos.map(([t, d], i) => `<div><em>${i + 1}</em><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div></div>` : ''}`;

// `vista` puede ser una sola o una lista (propuesta que une agente + CRM: chat y tablero).
export const vista = (x) => [].concat(x.vista || []).map(unaVista).join('');
const unaVista = (v) => {
  if (!v) return '';
  if (v.tipo === 'chat') return `<div class="flujo" data-cab="c2">${titulo('ASÍ SE VERÍA', v.titulo, v.intro)}<div class="demo"><div><div class="fono"><div class="cab"><span class="av">V</span><div><b>Victoria AI</b><small>● En línea</small></div></div><div class="chat">${v.chat.map(([yo, t]) => `<div class="bb ${yo ? 'yo' : ''}">${esc(t).replace(/\n/g, '<br>')}</div>`).join('')}</div></div><div class="ilus">Ejemplo ilustrativo de conversación.</div></div><div>${notas(v.notas)}</div></div></div>`;
  return `<div class="flujo" data-cab="c2">${titulo('ASÍ SE VERÍA', v.titulo, v.intro)}<div class="kb">${v.columnas.map(([t, tjs]) => `<div class="col"><h4>${esc(t)}<span>${tjs.length}</span></h4>${tjs.map(([c, em, d]) => `<div class="tj ${em}"><b>${esc(c)}</b>${esc(d)}<br><small>${({ '': 'RIMP', n: 'Fénix', g: 'Conexión Festiva' })[em]}</small></div>`).join('')}</div>`).join('')}</div><div class="ilus">Datos ilustrativos.</div>${v.ficha ? `<div class="sub2">La ficha de cada cliente</div><div class="ficha"><div class="iz"><h3>${esc(v.ficha.nombre)}</h3>${v.ficha.datos.map(([k, d]) => `<div><span>${esc(k)}</span><b>${esc(d)}</b></div>`).join('')}</div><div class="de"><span class="lab3">HISTORIAL</span>${v.ficha.historial.map(([f, t]) => `<div class="ev"><span>${esc(f)}</span>${esc(t)}</div>`).join('')}</div></div>` : ''}${v.notas ? `<div class="sub2">Lo que gana su equipo</div><div class="cards2">${v.notas.map(([t, d]) => `<div class="card"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div>` : ''}</div>`;
};

export const operacion = (x) => {
  const c = x.control, m = x.matriz, f = x.flujo_cot;
  const pag = [];
  if (c) pag.push(`<div class="flujo" data-cab="c3">${titulo('EL CONTROL', c.titulo, c.intro)}<div class="tri">${c.columnas.map(([t, s, l]) => `<div><h3>${esc(t)}</h3><small>${esc(s)}</small><ul>${lista(l)}</ul></div>`).join('')}</div>${c.nota ? `<div class="ni"><span class="lab3">REGLA BASE</span><span style="font-size:13px;line-height:1.5">${esc(c.nota)}</span></div>` : ''}</div>`);
  if (f) pag.push(`<div class="flujo" data-cab="c3">${titulo('COTIZACIONES', f.titulo, f.intro)}<div class="pasos5">${f.pasos.map(([t, d], i) => `<div><em>${i + 1}</em><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div>${m ? `<div class="sub2">${esc(m.titulo)}</div><table class="matriz"><thead><tr>${m.columnas.map((h) => `<th>${esc(h.toUpperCase())}</th>`).join('')}</tr></thead><tbody>${m.filas.map((fl) => `<tr>${fl.map((v, i) => `<td class="${i && v === 'Sí' ? 'si' : i && v === '—' ? 'no' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}</div>`);
  // `reporte` también puede ser una lista (reporte diario del agente + panel del CRM).
  for (const r of [].concat(x.reporte || [])) pag.push(`<div class="flujo" data-cab="c3">${titulo('RESULTADOS', r.titulo, r.intro)}<div class="rep"><div class="top"><b>${esc(r.nombre)}</b><span>Datos ilustrativos</span></div><div class="tiles">${r.tiles.map(([n, t], i) => `<div class="tile ${i === 0 ? 'r' : ''}"><b>${esc(n)}</b><span>${esc(t)}</span></div>`).join('')}</div><div class="barras">${r.barras.map(([t, n]) => `<div class="barra"><span>${esc(t)}</span><div class="tr"><i style="width:${Math.round((n / Math.max(...r.barras.map((b) => b[1]))) * 100)}%"></i></div><b>${n}</b></div>`).join('')}</div></div>${r.usos ? `<div class="sub2">Lo que la dirección puede decidir con esto</div><div class="cards2">${r.usos.map(([t, d]) => `<div class="card"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div>` : ''}</div>`);
  return pag.join('');
};

export const noIncluye = (x) => (x.no_incluye ? `<div class="ni"><span class="lab3">NO INCLUIDO EN ESTA PROPUESTA</span><ul>${lista(x.no_incluye)}</ul></div>` : '');
// Cierra el flujo de condiciones y abre una hoja propia con preguntas, próximos pasos y el cierre.
export const faq = (x) => (x.faq ? `</div><div class="flujo" data-cab="c6">${titulo('ANTES DE DECIDIR', 'Preguntas frecuentes')}${x.faq.map(([p, r]) => `<div class="faq"><b>${esc(p)}</b><span>${esc(r)}</span></div>`).join('')}${x.siguientes ? `<div><div class="sub2">Próximos pasos</div><div class="sig">${x.siguientes.map(([t, d], i) => `<div><b>${i + 1}</b><strong>${esc(t)}</strong><span>${esc(d)}</span></div>`).join('')}</div></div>` : ''}` : '');
export const valorExtra = (x) => (x.antes_despues ? `<div><div class="sub2">${esc(x.antes_despues.titulo)}</div><table class="ad"><thead><tr><th>${esc(x.antes_despues.columnas[0].toUpperCase())}</th><th>${esc(x.antes_despues.columnas[1].toUpperCase())}</th></tr></thead><tbody>${x.antes_despues.filas.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table></div>` : '');
export const pulir = (html) => html.replace('Lo que vas a encontrar.', 'Contenido de la propuesta.').replace('revisamos avances contigo', 'revisamos avances con su equipo').replace('Responde este correo o escríbenos por WhatsApp para agendar', 'Responda este correo o escríbanos por WhatsApp para agendar').replace('y arrancamos en 48 horas', 'e iniciamos en 48 horas');
