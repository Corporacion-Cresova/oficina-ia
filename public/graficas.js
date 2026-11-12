// Gráficas de la oficina en HTML: los textos no se deforman y se adaptan al ancho. Una serie, un solo color y detalle al pasar el mouse.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// items: [{ et, v, tip, texto }]; ref: { v, et } dibuja una línea de referencia.
export function columnas(items, { ref = null, alto = 170 } = {}) {
  const max = Math.max(1, ref?.v || 0, ...items.map((i) => i.v || 0)) * 1.08;
  const mayor = Math.max(...items.map((i) => i.v || 0));
  return `<div class="gf" style="height:${alto}px">
    ${ref ? `<div class="gf-ref" style="bottom:${(ref.v / max) * 100}%"><span>${esc(ref.et)}</span></div>` : ''}
    <div class="gf-cols">${items.map((i, n) => {
      const ver = i.v && (i.v === mayor || n === items.length - 1);
      return `<div class="gf-c" data-tip="${esc(i.tip)}"><div class="gf-bar" style="height:${Math.max(i.v ? 1.5 : 0, ((i.v || 0) / max) * 100)}%">${ver ? `<b>${esc(i.texto)}</b>` : ''}</div></div>`;
    }).join('')}</div>
  </div><div class="gf-ejes">${items.map((i) => `<span>${esc(i.et)}</span>`).join('')}</div>`;
}

// items: [{ et, v, tip, texto, abierto }]; abierto = mes que todavía puede cambiar (punto hueco).
export function linea(items, { alto = 170 } = {}) {
  const max = Math.max(1, ...items.map((i) => i.v || 0)) * 1.22;
  const x = (n) => (items.length < 2 ? 50 : ((n + 0.5) / items.length) * 100);
  const y = (v) => 100 - (v / max) * 100;
  const pts = items.map((i, n) => `${x(n)},${y(i.v || 0)}`).join(' ');
  return `<div class="gf" style="height:${alto}px">
    <svg class="gf-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--azul)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>
    ${items.map((i, n) => `<div class="gf-zona" style="left:${(n / items.length) * 100}%;width:${100 / items.length}%" data-tip="${esc(i.tip)}"></div><i class="gf-p ${i.abierto ? 'abierto' : ''}" style="left:${x(n)}%;top:${y(i.v || 0)}%"></i>${n === 0 || n === items.length - 1 ? `<b class="gf-et" style="left:${x(n)}%;top:${y(i.v || 0)}%">${esc(i.texto)}</b>` : ''}`).join('')}
  </div><div class="gf-ejes">${items.map((i) => `<span>${esc(i.et)}</span>`).join('')}</div>`;
}

// items: [{ et, v, texto, tip, nota }]
export function barras(items) {
  const max = Math.max(1, ...items.map((i) => i.v || 0));
  return `<div class="gf-h">${items.map((i) => `<div class="gf-f" ${i.lista ? `data-lista="${i.lista}"` : ''} data-tip="${esc(i.tip || `${i.et}: ${i.texto ?? i.v}`)}"><span class="gf-n">${esc(i.et)}${i.nota ? `<small>${esc(i.nota)}</small>` : ''}</span><div class="gf-t"><i style="width:${Math.max(i.v ? 1.5 : 0, ((i.v || 0) / max) * 100)}%"></i></div><b>${esc(i.texto ?? i.v)}</b></div>`).join('')}</div>`;
}

// Embudo: cada franja se angosta hacia la siguiente. pasos: [{ et, n, pct, delPrevio, quedaron }]
export function embudo(pasos) {
  const max = Math.max(1, pasos[0]?.n || 0);
  const ancho = (p) => (p ? Math.max(3, (p.n / max) * 100) : 0);
  const perdida = pasos.slice(1).reduce((b, p, i) => { const caida = pasos[i].n - p.n; return caida > (b?.caida || 0) ? { caida, i: i + 1 } : b; }, null);
  return `<div class="em">${pasos.map((p, i) => {
    const a = ancho(p), b = i < pasos.length - 1 ? ancho(pasos[i + 1]) : a * 0.8;
    return `<div class="em-f" ${p.lista ? `data-lista="${p.lista}"` : ''} data-tip="${esc(`${p.et}: ${p.n} personas. ${i < pasos.length - 1 ? `Se quedaron en este paso: ${p.quedaron}.` : ''}`)}">
      <div class="em-n"><b>${esc(p.et)}</b>${perdida?.i === i ? '<span class="etq espera">Aquí se pierde más</span>' : ''}</div>
      <div class="em-g"><i style="clip-path:polygon(${50 - a / 2}% 0,${50 + a / 2}% 0,${50 + b / 2}% 100%,${50 - b / 2}% 100%)"></i></div>
      <div class="em-v"><b>${p.n}</b><span>${p.pct} %</span></div>
      <small class="em-p">${p.delPrevio == null ? 'del total' : `${p.delPrevio} % del paso anterior`}</small>
    </div>`;
  }).join('')}</div>`;
}

// Un solo cuadro de detalle para todas las gráficas.
let tip = null;
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) { if (tip) tip.hidden = true; return; }
  if (!tip) { tip = document.createElement('div'); tip.className = 'gf-tip'; document.body.appendChild(tip); }
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
  tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 12, e.clientX + 14)}px`;
  tip.style.top = `${Math.max(8, e.clientY - tip.offsetHeight - 10)}px`;
});
