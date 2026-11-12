// Ficha única del cliente: se abre desde cualquier sección con data-ficha="conv:ID", "tel:NUMERO" o "cliente:ID".
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const L = (n) => `L ${Math.round(n || 0).toLocaleString('en-US')}`;
const fecha = (t) => (t ? new Date(t).toLocaleDateString('es-HN', { day: 'numeric', month: 'short' }) : '');
const EST = { draft: 'Borrador', sent: 'Enviada', accepted: 'Aceptada', rejected: 'Rechazada', expired: 'Vencida' };
const ETAPA = { pending_demo: 'Pendiente demo', demo_sent: 'Demo enviada', approved: 'Aprobado', in_progress: 'En progreso', waiting_approval: 'Esperando aprobación', finished: 'Terminado', delivered: 'Entregado' };
const DEMO = { nuevo: 'En cola', armando: 'En construcción', demo: 'Lista para revisar', enviada: 'Enviada al cliente', aprobada: 'Aprobada' };

function panel() {
  let el = document.getElementById('ficha');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ficha';
    el.hidden = true;
    el.innerHTML = '<div class="fi-fondo" data-fi-cerrar></div><aside class="fi-panel" role="dialog" aria-label="Ficha del cliente"></aside>';
    document.body.appendChild(el);
  }
  return el;
}
const cerrar = () => { panel().hidden = true; };

function pintar(f) {
  const seccion = (t, c) => (c ? `<section class="fi-s"><h3>${esc(t)}</h3>${c}</section>` : '');
  const tel = f.telefono.replace(/\D/g, '');
  return `<header class="fi-cab"><div><h2>${esc(f.nombre)}</h2><p>${[f.contacto && f.contacto !== f.nombre ? f.contacto : '', f.rubro].filter(Boolean).map(esc).join(' · ')}</p>
      <div class="fi-etq">${f.conv?.etapa ? `<span class="etq anuncio">${esc(f.conv.etapa)}</span>` : ''}${f.conv?.anuncio ? `<span class="etq">Anuncio</span>` : ''}${f.llamadas.length ? '<span class="etq espera">Por llamar</span>' : ''}</div></div>
      <button class="btn sm ghost" data-fi-cerrar aria-label="Cerrar">Cerrar</button></header>
    <div class="fi-acc">${f.conv ? `<button class="btn" data-fi-chat="${esc(f.conv.id)}">Ver conversación</button>` : ''}${tel ? `<a class="btn" href="tel:+${esc(tel)}">Llamar</a><button class="btn" data-fi-copiar="${esc(f.telefono)}">Copiar teléfono</button>` : ''}${f.clienteId ? `<a class="btn" href="#/clientes/${esc(f.clienteId)}" data-fi-cerrar>Editar datos</a>` : ''}</div>
    <div class="fi-num"><div><small>Vendido</small><b>${L(f.resumen.aceptado)}</b></div><div><small>Pagado</small><b>${L(f.resumen.pagado)}</b></div><div><small>Saldo</small><b class="${f.resumen.saldo ? 'saldo' : ''}">${L(f.resumen.saldo)}</b></div></div>
    ${f.conv?.compromiso ? seccion('Lo que dijo que haría', (() => { const k = f.conv.compromiso; const d = (x) => `${x.slice(8, 10)}/${x.slice(5, 7)}`; return `<div class="fi-l"><b>${esc(k.que)}</b><small>"${esc(k.cita)}" · ${d(k.dicho_el)}</small><small><span class="etq ${k.estado === 'toca' ? 'espera' : ''}">${esc(k.estadoNombre || '')}</span> Revisar el ${d(k.revisar_el)}${k.confianza === 'baja' ? ' · la IA no está segura' : ''}${k.delicado ? ' · delicado, preguntá con cuidado' : ''}</small><small>Pregunta sugerida: ${esc(k.pregunta)}</small></div>`; })()) : ''}
    ${f.llamadas.length ? seccion('Por llamar', f.llamadas.map((x) => `<div class="fi-l"><b>${esc(x.motivo)}</b><small>${esc(x.sugerencia || '')}</small></div>`).join('')) : ''}
    ${f.proyectos.length ? seccion('Demo y proyecto', f.proyectos.map((p) => `<div class="fi-pr">${p.tieneBuild ? `<img loading="lazy" alt="" src="/p/${esc(p.id)}/__captura/computadora.jpg?v=${p.compilado || p.actualizado}">` : '<span class="fi-sin">Sin vista previa</span>'}<div><b>${esc(p.nombre)}</b><small>${esc(DEMO[p.estado] || p.estado)}${p.trabajando ? ' · Luis trabajando' : ''}</small><div class="fi-acc"><a class="btn sm" href="#/desarrollo/${esc(p.id)}" data-fi-cerrar>Abrir proyecto</a>${p.preview && p.tieneBuild ? `<a class="btn sm" href="${esc(p.preview)}" target="_blank" rel="noopener">Ver sitio</a>` : ''}</div></div></div>`).join('')) : ''}
    ${seccion('Cotizaciones', f.cotizaciones.map((c) => `<a class="fi-l fi-enl" href="#/cotizaciones/${esc(c.id)}" data-fi-cerrar><span><b>${esc(c.quote_number)}</b><small>${esc(EST[c.status] || c.status || '')}${c.project_status ? ` · ${esc(ETAPA[c.project_status] || c.project_status)}` : ''} · ${fecha(c.created_at)}</small></span><span class="fi-m"><b>${L(c.total)}</b><small>${L(c.pagado)} pagado${c.mensual ? ` · ${L(c.mensual)}/mes` : ''}</small></span></a>`).join('') || '<p class="muted">Sin cotizaciones.</p>')}
    ${f.pendientes.length ? seccion('Pendientes', f.pendientes.map((t) => `<div class="fi-l"><b>${esc(t.title)}</b>${t.due_date ? `<small>${fecha(t.due_date)}</small>` : ''}</div>`).join('')) : ''}
    ${f.conv?.ultimos?.length ? seccion('Últimos mensajes', f.conv.ultimos.map((m) => `<div class="fi-m2 ${m.de === 'Cliente' ? 'cl' : ''}"><small>${esc(m.de)} · ${fecha(m.ts)}</small>${esc(m.texto)}</div>`).join('')) : ''}`;
}

async function abrir(valor) {
  const [tipo, ...r] = String(valor).split(':');
  const id = r.join(':');
  const el = panel();
  const p = el.querySelector('.fi-panel');
  p.innerHTML = '<div class="empty">Cargando…</div>';
  el.hidden = false;
  try {
    const res = await fetch(`/api/ficha?${tipo}=${encodeURIComponent(id)}`);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'No se pudo cargar la ficha.');
    p.innerHTML = pintar(j);
  } catch (e) { p.innerHTML = `<header class="fi-cab"><h2>Ficha</h2><button class="btn sm ghost" data-fi-cerrar>Cerrar</button></header><div class="empty">${esc(e.message)}</div>`; }
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-ficha]');
  if (a) { e.preventDefault(); e.stopPropagation(); abrir(a.dataset.ficha); return; }
  const co = e.target.closest('[data-fi-copiar]');
  if (co) { navigator.clipboard?.writeText(co.dataset.fiCopiar); window.toast?.('Teléfono copiado'); return; }
  if (e.target.closest('[data-fi-cerrar]')) cerrar();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('ficha')?.hidden === false) cerrar(); });
