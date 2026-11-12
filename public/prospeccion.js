// Prospección: campañas de Google Maps, fichas investigadas por la IA, aprobación y envíos de a poco.
import { pagina, controles } from './paginas.js';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fecha = (d) => (d ? new Date(d).toLocaleString('es-HN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const toast = (t, tipo) => window.toast?.(t, tipo);

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`/api/prospeccion${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

const ESTADOS = {
  nuevo: ['Por investigar', ''], investigando: ['Investigando', 'espera'], calificado: ['Calificado', 'bien'], aprobado: ['Aprobado · en cola', 'anuncio'],
  contactado: ['Contactado', 'espera'], respondio: ['Respondió', 'bien'], descartado: ['Descartado', ''], optout: ['No quiere', 'error'], error: ['Error', 'error'],
};
const FILTROS = ['calificado', 'aprobado', 'contactado', 'respondio', 'descartado', 'todos'];
let R = null, campana = null, filtro = 'calificado', lista = [], abiertos = new Set(), qr = null, pag = 0, buscar = '';
const TAM = 20;

const caja = () => document.getElementById('pr-root');
export async function cargarProspeccion() {
  const el = caja();
  if (!el) return;
  try {
    R = await api('');
    if (campana == null && R.campanas[0]) campana = R.campanas[0].id;
    lista = campana ? await api(`/prospectos?campana=${campana}${filtro === 'todos' ? '' : `&estado=${filtro}`}`) : [];
    pintar();
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

const kpi = (label, valor, pista = '', tono = '') => `<div class="ng-kpi ${tono}"><small>${esc(label)}</small><b>${valor}</b>${pista ? `<span>${pista}</span>` : ''}</div>`;

function pintar() {
  const c = R.campanas.find((x) => x.id === campana);
  const n = R.numero || {};
  const cfg = R.config;
  const cnt = c?.conteo || {};
  const sum = (...ks) => ks.reduce((a, k) => a + (cnt[k] || 0), 0);
  caja().innerHTML = `
    <header class="ng-head"><div><h1>Prospección</h1><p>Negocios que todavía no nos conocen: se buscan en Google Maps, la IA los investiga y califica, vos aprobás y salen de a poco.</p></div>
      <div class="ng-acciones"><button class="btn ${cfg.activo ? 'no' : 'principal'}" data-pr="activo">${cfg.activo ? 'Apagar envíos' : 'Encender envíos'}</button><button class="btn" data-pr="nueva">+ Nueva campaña</button></div></header>

    <div class="pr-estado">
      <div class="ng-card pr-canal">
        <h2>WhatsApp de prospección ${n.conectado ? '<span class="etq bien">Conectado</span>' : n.existe ? `<span class="etq espera">${esc(n.estado || 'Sin conectar')}</span>` : '<span class="etq">Sin número</span>'}</h2>
        <p class="muted">${n.conectado ? `Número +${esc(n.numero || '…')} · ${R.hoy.whatsapp} de ${cfg.waPorDia} mensajes hoy` : 'Un número aparte para no arriesgar el de ventas. Conectalo escaneando el código con el WhatsApp de ese teléfono (Dispositivos vinculados).'}</p>
        ${n.conectado ? '' : `<button class="btn principal sm" data-pr="conectar">${n.existe ? 'Mostrar código QR' : 'Conectar número'}</button>`}
        ${qr && !n.conectado ? `<img class="pr-qr" src="${qr}" alt="Código QR para vincular WhatsApp"><p class="muted">Escanealo con el teléfono del número nuevo y tocá "Ya lo escaneé".</p><button class="btn sm" data-pr="refrescar">Ya lo escaneé</button>` : ''}
      </div>
      <div class="ng-card pr-canal">
        <h2>Correo ${cfg.resend && cfg.correoDe ? '<span class="etq bien">Listo</span>' : '<span class="etq espera">Falta configurar</span>'}</h2>
        <p class="muted">${cfg.resend ? '' : 'Falta la llave de Resend (Sistema → Llaves). '}${cfg.correoDe ? `Sale como ${esc(cfg.correoDe)} · ${R.hoy.correo} de ${cfg.correoPorDia} hoy` : 'Falta el remitente (abajo, en Ajustes).'}</p>
      </div>
      <div class="ng-card pr-canal">
        <h2>Buscador de Maps ${R.maps.ok ? '<span class="etq bien">En línea</span>' : '<span class="etq error">No responde</span>'}</h2>
        <p class="muted">${R.maps.ok ? 'Servicio interno en EasyPanel (tools/maps).' : esc(R.maps.error || '')}</p>
        <p class="muted">IA para investigar: ${cfg.ia ? 'lista (Gemini)' : 'falta la llave de Gemini u OpenRouter'}</p>
      </div>
    </div>

    ${R.campanas.length ? `<div class="ng-tabs">${R.campanas.map((x) => `<button class="tab-btn ${x.id === campana ? 'on' : ''}" data-pr-camp="${x.id}">${esc(x.nombre)} <small>${x.encontrados || 0}</small></button>`).join('')}</div>` : ''}

    ${c ? `
    <div class="ng-kpis c5">
      ${kpi('Encontrados', c.encontrados || 0, c.estado === 'buscando' ? 'buscando en Maps…' : c.estado === 'investigando' ? `investigando… ${sum('nuevo')} por revisar` : `IA: US$ ${Number(c.costo || 0).toFixed(3)}`)}
      ${kpi('Calificados', sum('calificado', 'aprobado', 'contactado', 'respondio', 'optout'), `${sum('descartado')} descartados`, 'info')}
      ${kpi('Contactados', sum('contactado', 'respondio', 'optout'), `${sum('aprobado')} en cola`)}
      ${kpi('Respondieron', sum('respondio'), sum('optout') ? `${sum('optout')} pidieron no escribir` : '', 'ok')}
      ${kpi('Demos / ventas', `${R.embudo.demo} / ${R.embudo.ganado}`, 'de todas las campañas', 'warn')}
    </div>
    <p class="muted pr-busq">Búsquedas: ${c.busquedas.map((b) => `<code>${esc(b)}</code>`).join(' ')} · profundidad ${c.profundidad} ${c.estado === 'lista' ? `<button class="btn ghost sm" data-pr="buscar" data-id="${c.id}">Buscar más</button><button class="btn ghost sm" data-pr="reinvestigar" data-id="${c.id}">Investigar todo de nuevo</button>` : ''}</p>
    <div class="ng-filtros">${FILTROS.map((f) => `<button class="chip ${filtro === f ? 'on' : ''}" data-pr-filtro="${f}">${f === 'todos' ? 'Todos' : ESTADOS[f][0]}${f !== 'todos' && cnt[f] ? ` · ${cnt[f]}` : ''}</button>`).join('')}
      ${filtro === 'calificado' && lista.length ? `<button class="btn principal sm" data-pr="aprobar-todos">Aprobar los ${lista.length}</button>` : ''}</div>
    <input type="search" class="ng-in pr-buscar" id="pr-q" placeholder="Buscar por nombre o rubro" value="${esc(buscar)}">
    <div id="pr-listado">${listado(c)}</div>`
    : '<div class="ng-card"><h2>Todavía no hay campañas</h2><p class="muted">Creá la primera: un rubro y una ciudad. Ejemplo: constructoras y remodelación en San Pedro Sula.</p></div>'}

    <details class="ng-card pr-ajustes"><summary><h2>Ajustes de envío</h2></summary>
      <div class="pr-form">
        <label>WhatsApp por día<input class="ng-in" type="number" min="0" max="20" data-cfg="waPorDia" value="${cfg.waPorDia}"></label>
        <label>Correos por día<input class="ng-in" type="number" min="0" max="60" data-cfg="correoPorDia" value="${cfg.correoPorDia}"></label>
        <label>Puntaje mínimo<input class="ng-in" type="number" min="0" max="100" data-cfg="umbral" value="${cfg.umbral}"></label>
        <label>Firma<input class="ng-in" data-cfg="firma" value="${esc(cfg.firma)}"></label>
        <label>Remitente del correo<input class="ng-in" data-cfg="correoDe" placeholder="Diego de Cresova <diego@tudominio.com>" value="${esc(cfg.correoDe)}"></label>
        <label>Respuestas a (tu correo)<input class="ng-in" data-cfg="responderA" placeholder="tu@correo.com" value="${esc(cfg.responderA)}"></label>
      </div>
      <p class="muted">Horario de envío: lunes a sábado de ${cfg.horario.desde}:00 a ${cfg.horario.hasta}:00. Los WhatsApp salen separados entre 30 y 90 minutos.</p>
      <button class="btn principal sm" data-pr="guardar-cfg">Guardar ajustes</button>
    </details>`;
}

const filtrados = () => { const t = buscar.trim().toLowerCase(); return t ? lista.filter((x) => `${x.nombre} ${x.categoria || ''}`.toLowerCase().includes(t)) : lista; };
function listado(c) {
  const l = filtrados();
  pag = Math.min(pag, Math.max(0, Math.ceil(l.length / TAM) - 1));
  const vacio = buscar.trim() ? 'Ningún negocio con esa búsqueda.' : c.estado === 'buscando' ? 'Buscando en Google Maps… (tarda unos minutos)' : c.estado === 'investigando' && filtro === 'calificado' ? 'La IA está investigando los negocios: los calificados aparecen aquí.' : 'Nada en esta lista.';
  return `<div class="pr-lista">${l.length ? pagina(l, pag, TAM).map(tarjeta).join('') : `<div class="empty">${vacio}</div>`}</div>${controles(l.length, pag, TAM, 'data-pr-pg')}`;
}
function pintarListado() { const el = document.getElementById('pr-listado'); const c = R?.campanas.find((x) => x.id === campana); if (el && c) el.innerHTML = listado(c); }

function tarjeta(p) {
  const [est, tono] = ESTADOS[p.estado] || [p.estado, ''];
  const inv = p.investigacion || {};
  const m = p.mensaje || {};
  const abierto = abiertos.has(p.id);
  const pts = p.puntos || {};
  const contacto = p.canal === 'whatsapp' ? `WhatsApp +${esc(p.telefono)}` : p.canal === 'correo' ? `Correo ${esc((p.emails || [])[0] || '')}` : p.telefono ? `📞 Llamar al +${esc(p.telefono)}` : 'Sin contacto';
  return `<article class="ng-card pr-card ${abierto ? 'abierta' : ''}" data-pr-card="${p.id}">
    <div class="pr-top">
      <div class="pr-score ${p.score >= 75 ? 'alto' : p.score >= 60 ? 'medio' : ''}">${p.score ?? '—'}</div>
      <div class="pr-nom"><b>${esc(p.nombre)}</b><small>${esc(p.categoria || '')}${p.rating ? ` · ★ ${p.rating} (${p.resenas})` : ''} · ${contacto}</small></div>
      <span class="etq ${tono}">${esc(est)}</span>
    </div>
    ${inv.oportunidad ? `<p class="pr-op">${esc(inv.oportunidad)}</p>` : p.motivo ? `<p class="pr-op muted">${esc(p.motivo)}</p>` : ''}
    ${abierto ? `
      <div class="pr-det">
        <div>
          <div class="ng-label">Hallazgos <span>confianza ${esc(p.confianza || '—')}</span></div>
          <ul>${(inv.hallazgos || []).map((h) => `<li>${esc(h)}</li>`).join('') || '<li class="muted">Sin investigar</li>'}</ul>
          <p class="muted">Ofrecer: <b>${esc(inv.oferta || '—')}</b> · Necesidad ${pts.necesidad ?? '–'}/30 · Potencial ${pts.potencial ?? '–'}/25 · Encaje ${pts.encaje ?? '–'}/20 · Actividad ${pts.actividad ?? '–'}/15 · Contacto ${pts.contacto ?? '–'}/10</p>
          <p class="pr-links">${p.web ? `<a href="${esc(/^https?:/.test(p.web) ? p.web : `http://${p.web}`)}" target="_blank" rel="noopener">Su página</a>` : ''}${p.maps_url ? `<a href="${esc(p.maps_url)}" target="_blank" rel="noopener">Google Maps</a>` : ''}${p.conv_id ? `<a href="#" data-pr-conv="${esc(p.conv_id)}">Ver la conversación</a>` : ''}</p>
          ${p.motivo && p.estado !== 'calificado' ? `<p class="muted">${esc(p.motivo)}</p>` : ''}
        </div>
        <div class="pr-msg">
          <div class="ng-label">Primer mensaje <span><select class="ng-in pr-canal-sel" data-pr-canal="${p.id}">${p.movil ? `<option value="whatsapp" ${p.canal === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>` : ''}${(p.emails || []).length ? `<option value="correo" ${p.canal === 'correo' ? 'selected' : ''}>Correo</option>` : ''}${p.telefono ? `<option value="llamada" ${p.canal === 'llamada' ? 'selected' : ''}>Llamada</option>` : ''}</select></span></div>
          ${p.canal === 'correo' ? `<input class="ng-in" data-pr-asunto="${p.id}" value="${esc(m.asunto || '')}" placeholder="Asunto"><textarea class="ng-in" rows="9" data-pr-texto="${p.id}" data-campo="correo">${esc(m.correo || '')}</textarea>`
            : p.canal === 'llamada' ? `<p class="muted">Guion para la llamada (<a href="tel:+${esc(p.telefono)}">+${esc(p.telefono)}</a>):</p><textarea class="ng-in" rows="6" data-pr-texto="${p.id}" data-campo="llamada">${esc(m.llamada || '')}</textarea>`
            : `<textarea class="ng-in" rows="7" data-pr-texto="${p.id}" data-campo="whatsapp">${esc(m.whatsapp || '')}</textarea>`}
          ${['contactado', 'respondio', 'optout'].includes(p.estado) ? `<p class="muted">Enviado ${fecha(p.contactado_en)}${p.respondio_en ? ` · respondió ${fecha(p.respondio_en)}` : ''}</p>` : `<div class="ng-row"><button class="btn sm" data-pr-guardar="${p.id}">Guardar mensaje</button>${p.canal === 'llamada' ? '' : `<button class="btn ghost sm" data-pr-prueba="${p.id}">Mandarme una prueba</button>`}</div>`}
        </div>
      </div>` : ''}
    <div class="ng-row pr-acc">
      <button class="btn ghost sm" data-pr-abrir="${p.id}">${abierto ? 'Cerrar' : 'Ver ficha y mensaje'}</button>
      ${['calificado', 'descartado', 'error'].includes(p.estado) && p.canal ? `<button class="btn principal sm" data-pr-acc="aprobar" data-id="${p.id}">Aprobar</button>` : ''}
      ${p.estado === 'aprobado' ? `<button class="btn sm" data-pr-acc="calificar" data-id="${p.id}">Sacar de la cola</button>` : ''}
      ${['calificado', 'aprobado', 'nuevo', 'error'].includes(p.estado) ? `<button class="btn no sm" data-pr-acc="descartar" data-id="${p.id}">Descartar</button>` : ''}
      ${['descartado', 'error', 'calificado'].includes(p.estado) ? `<button class="btn ghost sm" data-pr-acc="reinvestigar" data-id="${p.id}">Investigar de nuevo</button>` : ''}
      ${p.estado === 'aprobado' && p.canal === 'llamada' ? `<button class="btn principal sm" data-pr-acc="llamado" data-id="${p.id}">Ya lo llamé</button>` : ''}
      ${p.estado === 'contactado' && p.canal !== 'whatsapp' ? `<button class="btn sm" data-pr-acc="respondio" data-id="${p.id}">${p.canal === 'llamada' ? 'Le interesó' : 'Respondió por correo'}</button>` : ''}
    </div>
  </article>`;
}

function dialogoCampana() {
  const d = document.createElement('dialog');
  d.className = 'pr-dialog';
  d.innerHTML = `<form method="dialog" class="ng">
    <h2>Nueva campaña</h2>
    <label>Rubro<input class="ng-in" name="rubro" value="Constructoras y remodelación" required></label>
    <label>Ciudad<input class="ng-in" name="ciudad" value="San Pedro Sula" required></label>
    <label>Búsquedas en Google Maps (una por línea)<textarea class="ng-in" name="busquedas" rows="5">constructora San Pedro Sula
empresa de construcción San Pedro Sula
remodelaciones San Pedro Sula
contratista de construcción San Pedro Sula
acabados y remodelación de casas San Pedro Sula</textarea></label>
    <label>Profundidad (más = más resultados y más tiempo)<input class="ng-in" name="profundidad" type="number" min="1" max="20" value="5"></label>
    <div class="ng-row"><button class="btn principal" value="ok">Buscar</button><button class="btn ghost" value="cancel">Cancelar</button></div>
  </form>`;
  document.body.append(d);
  d.showModal();
  d.addEventListener('close', async () => {
    const f = new FormData(d.querySelector('form'));
    d.remove();
    if (d.returnValue !== 'ok') return;
    try {
      const c = await api('/campanas', { method: 'POST', body: { rubro: f.get('rubro'), ciudad: f.get('ciudad'), nombre: `${f.get('rubro')} · ${f.get('ciudad')}`, busquedas: String(f.get('busquedas')).split('\n'), profundidad: Number(f.get('profundidad')) } });
      campana = c.id; filtro = 'calificado';
      toast('Campaña creada: buscando en Google Maps', 'ok');
      cargarProspeccion();
    } catch (e) { toast(e.message, 'error'); }
  });
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-pr], [data-pr-camp], [data-pr-filtro], [data-pr-abrir], [data-pr-acc], [data-pr-guardar], [data-pr-prueba], [data-pr-conv]');
  if (!t || !caja()?.contains(t)) return;
  const d = t.dataset;
  try {
    if (d.prCamp) { campana = Number(d.prCamp); abiertos.clear(); return cargarProspeccion(); }
    if (d.prFiltro) { filtro = d.prFiltro; return cargarProspeccion(); }
    if (d.prAbrir) { const id = Number(d.prAbrir); abiertos.has(id) ? abiertos.delete(id) : abiertos.add(id); return pintar(); }
    if (d.prConv) { ev.preventDefault(); location.hash = '#/ventas'; setTimeout(() => window.openVConv?.(d.prConv), 600); return; }
    if (d.prAcc) {
      t.disabled = true;
      if (d.prAcc === 'reinvestigar') toast('Investigando de nuevo…');
      await api(`/prospectos/${d.id}`, { method: 'POST', body: { accion: d.prAcc } });
      toast({ aprobar: 'Aprobado: queda en la cola de envío', descartar: 'Descartado', calificar: 'Salió de la cola', reinvestigar: 'Ficha actualizada', respondio: 'Marcado como respondido', llamado: 'Marcado como llamado' }[d.prAcc] || 'Listo', 'ok');
      return cargarProspeccion();
    }
    if (d.prGuardar) {
      const id = d.prGuardar;
      const txt = $(`[data-pr-texto="${id}"]`);
      const body = { accion: 'mensaje', canal: $(`[data-pr-canal="${id}"]`)?.value, mensaje: { [txt.dataset.campo]: txt.value, ...($(`[data-pr-asunto="${id}"]`) ? { asunto: $(`[data-pr-asunto="${id}"]`).value } : {}) } };
      await api(`/prospectos/${id}`, { method: 'POST', body });
      toast('Mensaje guardado', 'ok');
      return cargarProspeccion();
    }
    if (d.prPrueba) {
      const canal = $(`[data-pr-canal="${d.prPrueba}"]`)?.value;
      const r = await api(`/prospectos/${d.prPrueba}/prueba`, { method: 'POST', body: { canal } });
      return toast(`Prueba enviada a ${r.a}`, 'ok');
    }
    if (d.pr === 'nueva') return dialogoCampana();
    if (d.pr === 'activo') { await api('/config', { method: 'POST', body: { activo: !R.config.activo } }); toast(R.config.activo ? 'Envíos apagados' : 'Envíos encendidos: salen de a poco en horario', 'ok'); return cargarProspeccion(); }
    if (d.pr === 'conectar') { t.disabled = true; toast('Preparando el código…'); const r = await api('/numero/conectar', { method: 'POST' }); qr = r.qr; if (r.conectado) toast('El número ya está conectado', 'ok'); return cargarProspeccion(); }
    if (d.pr === 'refrescar') { const r = await api('/numero'); if (r.conectado) { qr = null; toast(`Conectado: +${r.numero || ''}`, 'ok'); } else toast(`Todavía no se conecta (${r.estado || 'sin estado'})`, 'error'); return cargarProspeccion(); }
    if (d.pr === 'reinvestigar') { if (!confirm('¿Volver a investigar todos los negocios de esta campaña con la IA? (cuesta centavos)')) return; const r = await api(`/campanas/${d.id}/reinvestigar`, { method: 'POST' }); toast(`${r.reinvestigar} negocios vuelven a investigarse`, 'ok'); return cargarProspeccion(); }
    if (d.pr === 'buscar') { await api(`/campanas/${d.id}/buscar`, { method: 'POST' }); toast('Buscando más negocios…', 'ok'); return cargarProspeccion(); }
    if (d.pr === 'aprobar-todos') {
      if (!confirm(`¿Aprobar los ${lista.length} calificados? Salen de a poco (WhatsApp máx. ${R.config.waPorDia} por día).`)) return;
      for (const p of lista) await api(`/prospectos/${p.id}`, { method: 'POST', body: { accion: 'aprobar' } }).catch(() => {});
      toast(`${lista.length} aprobados`, 'ok');
      return cargarProspeccion();
    }
    if (d.pr === 'guardar-cfg') {
      const body = {};
      document.querySelectorAll('#pr-root [data-cfg]').forEach((i) => { body[i.dataset.cfg] = i.type === 'number' ? Number(i.value) : i.value; });
      await api('/config', { method: 'POST', body });
      toast('Ajustes guardados', 'ok');
      return cargarProspeccion();
    }
  } catch (e) { toast(e.message, 'error'); t.disabled = false; }
});

// Mientras se busca o investiga, la pantalla se actualiza sola.
setInterval(() => {
  if (!caja()?.closest('.view.active')) return;
  if (document.activeElement?.closest?.('#pr-root textarea, #pr-root input')) return;
  if (R?.campanas?.some((c) => ['buscando', 'investigando'].includes(c.estado))) cargarProspeccion();
}, 30_000);

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-pr-pg]');
  if (b && !b.disabled) { pag = Number(b.dataset.prPg); pintarListado(); caja()?.querySelector('#pr-q')?.scrollIntoView({ block: 'start' }); return; }
  if (e.target.closest?.('[data-pr-filtro], [data-pr-camp]')) { pag = 0; buscar = ''; }
}, true);
document.addEventListener('input', (e) => { if (e.target.id === 'pr-q') { buscar = e.target.value; pag = 0; pintarListado(); } });
