// Ventana con las personas detrás de un número: tocás el número, ves quiénes son y abrís su conversación o su ficha.
// Uso: <b data-lista="${reg('Título', personas)}">14</b>, o reg('Título', [{ t: 'Pestaña', personas }]).
// persona: { nombre, detalle, conv, tel }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const REG = new Map();
let n = 0;
export function reg(titulo, personasOPestanas) {
  if (REG.size > 800) REG.clear();
  const id = `l${++n}`;
  const pestanas = Array.isArray(personasOPestanas) && personasOPestanas[0]?.personas ? personasOPestanas : [{ t: '', personas: personasOPestanas || [] }];
  REG.set(id, { titulo, pestanas });
  return id;
}

function caja() {
  let el = document.getElementById('lista-modal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lista-modal';
    el.hidden = true;
    el.innerHTML = '<div class="lm-fondo" data-lm-cerrar></div><div class="lm-panel" role="dialog"></div>';
    document.body.appendChild(el);
  }
  return el;
}
let actual = null, pest = 0, filtro = '';
function pintar() {
  const { titulo, pestanas } = actual;
  const p = pestanas[pest] || pestanas[0];
  const t = filtro.trim().toLowerCase();
  const l = t ? p.personas.filter((x) => `${x.nombre} ${x.detalle || ''}`.toLowerCase().includes(t)) : p.personas;
  caja().querySelector('.lm-panel').innerHTML = `<header class="lm-cab"><h2>${esc(titulo)}</h2><button class="btn sm ghost" data-lm-cerrar>Cerrar</button></header>
    ${pestanas.length > 1 ? `<div class="chips">${pestanas.map((x, i) => `<button class="chip ${i === pest ? 'on' : ''}" data-lm-pest="${i}">${esc(x.t)} <small>${x.personas.length}</small></button>`).join('')}</div>` : ''}
    ${p.personas.length > 8 ? `<input type="search" class="ng-in lm-buscar" placeholder="Buscar" value="${esc(filtro)}">` : ''}
    <div class="lm-lista">${l.map((x) => `<div class="lm-f"><div class="lm-n"><b>${esc(x.nombre || 'Sin nombre')}</b>${x.detalle ? `<small>${esc(x.detalle)}</small>` : ''}</div>
      <div class="lm-acc">${x.conv ? `<button class="btn sm" data-fi-chat="${esc(x.conv)}">Conversación</button>` : ''}${x.conv || x.tel ? `<button class="btn sm ghost" data-ficha="${x.conv ? `conv:${esc(x.conv)}` : `tel:${esc(x.tel)}`}">Ficha</button>` : ''}</div></div>`).join('') || '<div class="empty">Nadie en esta lista.</div>'}</div>`;
  const b = caja().querySelector('.lm-buscar');
  if (b && document.activeElement !== b && filtro) { b.focus(); b.setSelectionRange(filtro.length, filtro.length); }
}
export function abrirLista(id) {
  actual = REG.get(id);
  if (!actual) return;
  pest = 0; filtro = '';
  caja().hidden = false;
  pintar();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('[data-lista]');
  if (a && REG.has(a.dataset.lista)) { e.preventDefault(); e.stopPropagation(); abrirLista(a.dataset.lista); return; }
  const p = e.target.closest?.('[data-lm-pest]');
  if (p) { pest = Number(p.dataset.lmPest); filtro = ''; pintar(); return; }
  if (e.target.closest?.('[data-lm-cerrar]')) caja().hidden = true;
}, true);
document.addEventListener('input', (e) => { if (e.target.classList?.contains('lm-buscar')) { filtro = e.target.value; pintar(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('lista-modal')?.hidden === false && document.getElementById('v-drawer')?.hidden !== false && document.getElementById('ficha')?.hidden !== false) caja().hidden = true; });
