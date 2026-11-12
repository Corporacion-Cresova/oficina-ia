import { NEGOCIO, cargarNegocio } from './negocio.js';
import './ficha.js';
import './lista.js';
import { cargarProspeccion } from './prospeccion.js';
import { cargarPauta } from './pauta.js';
import { OfficeHQ } from './officehq.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TZ = 'America/Tegucigalpa';
const time = (ts) => new Date(ts).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const dayTime = (ts) => new Date(ts).toLocaleString('es-HN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
const ago = (ts) => {
  if (!ts) return 'Todavía no ha trabajado';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
};

const STATUS = {
  idle: ['Disponible', '#555b6b'],
  working: ['Trabajando', '#21c48d'],
  tool: ['Usando una herramienta', '#2f9bff'],
  waiting: ['Esperando tu aprobación', '#e30016'],
  error: ['Error', '#ff6b7a'],
};
const REVIEW = { pending: 'Sin revisar', approved: 'Aprobado', changes: 'Cambios pedidos', read: 'Leído', discarded: 'Descartado' };
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const SHORT = { cresova: 'Cresova', uploadpost: 'Upload-Post', metaads: 'Meta Ads' };
const HOW = {
  cresova: 'Sacala en cresova.com → Ajustes → Conexión de agentes (MCP).',
  uploadpost: 'Sacala en app.upload-post.com → API Keys.',
  metaads: 'En Meta Business creá un usuario del sistema con rol Empleado y generá un token con los permisos ads_mcp_management y ads_read.',
};
const CONNECTION_TEXT = {
  ok: ['ok', 'Conectado y funcionando'],
  invalid: ['bad', 'La llave fue rechazada: revisá que esté bien copiada'],
  unreachable: ['warn', 'No responde en este momento'],
  missing: ['bad', 'Falta cargar la llave'],
};
const VIEWS = ['oficina', 'tablero', 'equipo', 'bandeja', 'estudio', 'ventas', 'desarrollo', 'chat', 'actividad', 'sistema', 'ajustes', 'prospeccion', 'pauta', ...NEGOCIO];

const config = await fetch('/api/config').then((r) => r.json());
// Sin prototipo: un agente que se llame "constructor" (Luis, de Desarrollo) no debe resolver a Object.prototype.constructor.
const byId = Object.assign(Object.create(null), Object.fromEntries(config.agents.map((a) => [a.id, a])));
for (const [id, nombre, rol, color] of [['constructor', 'Luis', 'Constructor de páginas', '#7c5cff'], ['revisor', 'Ashley', 'Revisora de calidad', '#16a6b6']]) if (!byId[id]) byId[id] = { id, nombre, rol, color };
let model = { agents: {}, approvals: [], log: [], deliverables: [], costs: {}, chats: {} };
let status = null;
let view = 'oficina';
let chatId = `grupo-${(config.departments || [{ id: 'marketing' }])[0].id}`;
let mobilePane = 'list';
let openDocId = null;
let invFilter = 'pending';
let studioFilter = 'pending';
let actAgent = 'all';
let actKind = 'all';

// Cuartel pixel: tocar una sala abre el chat de su equipo; tocar un héroe, su chat.
const office = new OfficeHQ($('#office'), $('#overlay'), config.agents, {
  onApprovalClick: () => go('bandeja'),
  onOpenChat: (id) => (id === 'constructor' || id === 'revisor' ? go('desarrollo') : byId[id]?.engine ? go('ventas') : openSideChat({ type: 'agent', id })),
  onOpenGroup: (dept) => openSideChat({ type: 'group', id: dept }),
  // Estudio de render = aprobar videos. Sala de edición = ver a los editores y hablar con el equipo.
  onOpenRoom: (v) => (v === 'estudio' ? openSideStudio() : v === 'team:edicion' ? openSideChat({ type: 'group', id: 'marketing', members: ['video', 'video2', 'video3'], title: 'Sala de edición' }) : go(v)),
});

if (config.demo) {
  $('#mode').hidden = false;
  $('#demo-day').hidden = false;
  $('#demo-day').onclick = () => fetch('/api/demo-day', { method: 'POST' });
} else {
  $('#run-all').hidden = false;
  $('#run-all').onclick = async () => {
    if (!confirm('Los 5 agentes van a trabajar en cadena, uno tras otro. Consume bastante cupo de Claude (cada uno corre una vez). ¿Seguir?')) return;
    const res = await fetch('/api/run-all', { method: 'POST' });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'No se pudo iniciar.');
  };
}

setInterval(() => {
  $('#clock').textContent = `${new Date().toLocaleString('es-HN', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}, 1000);

// ---------- datos derivados ----------
const isBusy = (id) => !['idle', 'error', undefined].includes(model.agents[id]?.status);
const pendingDeliverables = () => model.deliverables.filter((d) => d.kind === 'decision' && d.status === 'pending' && !d.paraCeo);
const pendingVideos = () => model.deliverables.filter((d) => d.kind === 'video' && d.status === 'pending');
const totalCost = () => Object.values(model.costs).reduce((a, b) => a + b, 0);
const connState = (id) => status?.connections.find((c) => c.id === id)?.state;

const seenKey = (id) => `oficina:seen:${id}`;
const getSeen = (id) => { try { return Number(localStorage.getItem(seenKey(id))) || 0; } catch { return 0; } };
const markRead = (id) => { try { localStorage.setItem(seenKey(id), String(Date.now())); } catch { /* sin almacenamiento */ } };
const unread = (id) => (model.chats[id]?.messages || []).filter((m) => m.role === 'agent' && m.ts > getSeen(id)).length;

function nextRun({ days, hour, minute }) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const now = Number(parts.hour) * 60 + Number(parts.minute);
  for (let d = 0; d <= 7; d++) {
    const dd = (day + d) % 7;
    if (days.includes(dd) && (d > 0 || hour * 60 + minute > now)) {
      return `${d === 0 ? 'hoy' : d === 1 ? 'mañana' : DAYS[dd]} ${hour}:${String(minute).padStart(2, '0')}`;
    }
  }
  return '—';
}

const nextText = (a) => (a.enabled === false ? 'Apagado' : a.onDemand ? 'A pedido' : config.paused ? 'En pausa' : nextRun(a.schedule));

function scheduleText({ days, hour, minute }) {
  const s = [...days].sort();
  const range = s.length > 2 && s.every((d, i) => i === 0 || d === s[i - 1] + 1);
  return `${range ? `${DAYS[s[0]]}–${DAYS[s.at(-1)]}` : s.map((x) => DAYS[x]).join(', ')} · ${hour}:${String(minute).padStart(2, '0')}`;
}

// ---------- render por pantalla ----------
const RENDER = {
  stats() {
    const working = config.agents.filter((a) => isBusy(a.id)).length;
    const approvals = model.approvals.length;
    const pend = pendingDeliverables().length;
    const card = (label, value, cls, to) => `<button class="stat ${cls}" data-go="${to}"><small>${label}</small><b>${value}</b></button>`;
    $('#stats').innerHTML =
      card('Trabajando ahora', `${working}/${config.agents.length}`, working ? 'ok' : '', 'equipo') +
      card('Por decidir', approvals + pend, approvals + pend ? 'bad' : '', 'bandeja') +
      card('Videos por aprobar', pendingVideos().length, pendingVideos().length ? 'warn' : '', 'estudio') +
      cupoCard(card);
  },

  alert() {
    const n = model.approvals.length;
    const parts = [];
    if (n) parts.push(`<div class="alert"><span><b>${n} ${n === 1 ? 'acción espera' : 'acciones esperan'} tu aprobación.</b> Los agentes están detenidos hasta que decidas.</span><button class="btn ok sm" data-go="bandeja">Revisar ahora</button></div>`);
    if (config.paused) parts.push('<div class="alert warn"><span><b>Pausa general activa.</b> Los agentes no arrancan solos a su hora.</span><button class="btn sm" data-go="ajustes">Quitar pausa</button></div>');
    const box = $('#alert');
    box.hidden = !parts.length;
    box.innerHTML = parts.join('');
  },

  ticker() {
    const last = model.log.at(-1);
    $('#ticker').innerHTML = last
      ? `<b>${time(last.ts)}</b>${esc(byId[last.agentId] ? `${byId[last.agentId].nombre}: ` : '')}${esc(last.text)}`
      : 'Sin actividad todavía.';
  },

  team() {
    // Desarrollo (Luis construye, Ashley revisa) no es un agente del tablero: se muestra con su estado real por proyecto.
    const dp = devProyectos || [];
    const vivo = dp.find((x) => x.trabajando);
    const devCard = (nombre, rol, color, modelo, metrica, estado) => `<article class="agent-card" style="--c:${color}">
        <div class="head"><div class="avatar lg" style="--c:${color}">${esc(nombre[0])}</div><div><div class="name">${esc(nombre)}</div><div class="role">${esc(rol)}</div></div></div>
        <div class="state ${vivo ? 'live' : ''}" style="--dot:${vivo ? '#2ecc71' : '#7b8090'}"><i class="dot"></i><span>${esc(estado)}</span></div>
        <dl class="kv"><dt>Modelo</dt><dd>${esc(modelo)}</dd><dt>Métrica</dt><dd>${esc(metrica)}</dd>
        <dt>Proyectos</dt><dd>${dp.filter((x) => x.estado === 'demo').length} demos listas · ${dp.filter((x) => x.estado === 'armando').length} armándose · ${dp.filter((x) => x.estado === 'enviada').length} enviadas</dd></dl>
        <div class="actions"><button class="btn" data-go="desarrollo">🛠️ Abrir Desarrollo</button></div></article>`;
    const devHtml = devCard('Luis', 'Constructor de páginas (Desarrollo)', '#7c5cff', 'opus 5.5 (primera versión) · sonnet 5.5 (cambios)', 'Demos que quedan excelentes y se envían sin correcciones', vivo ? `Trabajando — ${vivo.nombre}` : 'Disponible')
      + devCard('Ashley', 'Revisora de calidad (Desarrollo)', '#16a6b6', 'sonnet 5.5', 'Que ninguna demo llegue a Diego con fallas visibles', vivo ? `Revisa después de Luis — ${vivo.nombre}` : 'Disponible');
    $('#team').innerHTML = devHtml + config.agents.map((a) => {
      const s = model.agents[a.id] || { status: 'idle', text: '' };
      const off = a.enabled === false;
      const [label, dot] = off ? ['Apagado', '#3a3d48'] : (STATUS[s.status] || STATUS.idle);
      const live = !off && s.status !== 'idle';
      const busy = isBusy(a.id);
      const last = [...model.deliverables].reverse().find((d) => d.agentId === a.id);
      const tools = a.mcp.length
        ? a.mcp.map((id) => `<span class="tchip ${{ ok: 'ok', invalid: 'bad', missing: 'bad', unreachable: 'warn' }[connState(id)] || ''}">${SHORT[id] || id}</span>`).join('')
        : '<span class="tchip">Solo archivos y búsqueda web</span>';
      return `<article class="agent-card ${off ? 'off' : ''}" style="--c:${a.color}">
        <div class="head">
          <div class="avatar lg" style="--c:${a.color}">${esc(a.nombre[0])}</div>
          <div><div class="name">${esc(a.nombre)}</div><div class="role">${esc(a.rol)}</div></div>
        </div>
        <div class="state ${live ? 'live' : ''}" style="--dot:${dot}"><i class="dot"></i><span title="${esc(s.text)}">${esc(label)}${s.text && live ? ` — ${esc(s.text)}` : ''}</span></div>
        <dl class="kv">
          <dt>Modelo</dt><dd>${esc(a.model.replace('claude-', ''))}</dd>
          <dt>Horario</dt><dd>${scheduleText(a.schedule)}</dd>
          <dt>Próxima vez</dt><dd>${nextText(a)}</dd>
          <dt>Métrica</dt><dd>${esc(a.metrica)}</dd>
          <dt>Último trabajo</dt><dd>${ago(s.lastRun)}</dd>
          <dt>Consumo</dt><dd>$${(model.costs[a.id] || 0).toFixed(2)}</dd>
          <dt>Herramientas</dt><dd class="tools">${tools}</dd>
        </dl>
        ${last ? `<div class="lastdel" data-doc="${last.id}"><span>${esc(last.title)}</span><span class="badge ${last.status}">${REVIEW[last.status]}</span></div>` : ''}
        <div class="actions">
          ${a.engine ? '<button class="btn" data-go="ventas">🧪 Probar en Ventas</button>' : `<button class="btn" data-chat="${a.id}" ${off ? 'disabled' : ''}>💬 Chat</button>
          <button class="btn" data-encargo="${a.id}" ${off || busy ? 'disabled' : ''}>📝 Encargar</button>
          ${busy ? `<button class="btn no" data-stop="${a.id}">Detener</button>` : `<button class="btn" data-run="${a.id}" ${off ? 'disabled' : ''}>▶ Trabajar</button>`}`}
        </div>
      </article>`;
    }).join('');
  },

  inbox() {
    const list = model.approvals;
    $('#approvals-box').hidden = !list.length;
    $('#approvals-count').textContent = list.length;
    $('#approvals').innerHTML = list.map((x) => {
      const a = byId[x.agentId];
      const iguales = list.filter((y) => y.agentId === x.agentId && y.tool === x.tool).length;
      return `<div class="approval" data-id="${x.id}">
        <div class="who"><span class="avatar sm" style="--c:${a?.color}">${esc(a?.nombre?.[0])}</span><span style="color:${a?.color}">${esc(a?.nombre)}</span> quiere ejecutar:</div>
        <div class="tool">${esc(x.tool.split('__').slice(1).join(' · '))}</div>
        <pre>${esc(JSON.stringify(x.input, null, 2))}</pre>
        <input placeholder="Nota para el agente (opcional)" maxlength="500">
        <div class="actions">
          <button class="btn ok" data-decide="approved">Aprobar</button>
          <button class="btn ok" data-decide="approved" data-todas="1" title="Aprueba todas las que esperan de este tipo y no vuelve a preguntar por 3 horas">✓ Aprobar ${iguales > 1 ? `las ${iguales}` : 'y no preguntar'} (3 h)</button>
          <button class="btn no" data-decide="rejected">Rechazar</button>
        </div>
      </div>`;
    }).join('');

    const all = [...model.deliverables].reverse();
    const decisions = all.filter((d) => d.kind === 'decision' && d.status === 'pending' && !d.paraCeo).sort((a, b) => b.ts - a.ts); // lo último primero
    $('#decisions-count').textContent = decisions.length || '';
    $('#decisions').innerHTML = decisions.length ? decisions.map(decisionCard).join('')
      : '<div class="empty">Nada por decidir. Cuando el equipo necesite tu respuesta, aparece acá.</div>';

    const vids = pendingVideos().length;
    $('#inbox-videos').innerHTML = vids
      ? `<button class="video-banner" data-go="estudio"><b>${vids} ${vids === 1 ? 'video espera' : 'videos esperan'} tu aprobación</b><span>Miralos en el Estudio →</span></button>` : '';

    const reports = all.filter((d) => d.kind === 'informe');
    const unreadN = reports.filter((d) => d.status === 'pending').length;
    $('#report-filters').innerHTML = [['pending', 'Sin leer', unreadN], ['all', 'Todos', reports.length]]
      .map(([k, l, n]) => `<button class="chip ${invFilter === k ? 'on' : ''}" data-inv="${k}">${l}<small>${n}</small></button>`).join('')
      + (unreadN ? '<button class="chip" data-readall="1" title="Marca todos los informes como leídos (no borra nada)">✓ Marcar todos como leídos</button>' : '');
    const shown = reports.filter((d) => invFilter === 'all' || d.status === 'pending').slice(0, 40);
    $('#reports').innerHTML = shown.length
      ? shown.map((d) => {
        const a = byId[d.agentId];
        return `<div class="row-item ${d.status === 'pending' ? 'is-unread' : ''}" data-doc="${d.id}" role="button" tabindex="0">
          <span class="avatar sm" style="--c:${a?.color}">${esc(a?.nombre?.[0])}</span>
          <span><span class="t">${esc(d.title)}</span><br><span class="s">${esc(d.summary || `${a?.nombre} · ${a?.rol}`)}</span></span>
          <span class="d">${dayTime(d.ts)}</span>
          ${d.status === 'pending' ? `<button class="btn sm ghost" data-readone="${d.id}" title="Marcarlo como leído sin abrirlo">✓ Leído</button>` : '<span></span>'}
        </div>`;
      }).join('')
      : `<div class="empty">${reports.length ? 'Leíste todos los informes.' : 'Todavía no hay informes.'}</div>`;
  },

  studio() {
    renderLinea();
    renderCalendario();
    $('#studio-slot').textContent = slotInfo?.label ? `Si aprobás ahora, sale en TikTok y YouTube el ${slotInfo.label.replace(/\.$/, '')}.` : slotInfo?.error ? `Publicación automática: ${slotInfo.error}` : 'Al aprobar un video, se programa solo en el próximo hueco libre de TikTok y YouTube.';
    const list = studioVideos;
    const count = (k) => list.filter((v) => k === 'all' || v.status === k).length;
    const l = linea || {};
    const producing = (l.trabajando || []).length + renders.filter((r) => r.status === 'running').length;
    const kpi = (label, value, cls = '', sub = '') => `<div class="kpi ${cls}"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    $('#studio-kpis').innerHTML = [
      kpi('Por aprobar', count('pending'), count('pending') ? 'warn' : ''),
      kpi('Produciendo', producing, producing ? 'ok' : '', `${(l.trabajando || []).length} editores`),
      kpi('Hechos hoy', `${l.producedToday ?? 0}<em>/${l.maxPorDia ?? '—'}</em>`),
      kpi('Reserva', `${l.stock?.total ?? 0}<em>/${l.reserva ?? '—'}</em>`, '', 'listos + en cola'),
      kpi('Programados', calendario?.total ?? '—', '', 'TikTok y YouTube'),
    ].join('');
    $('#studio-filters').innerHTML = [['pending', 'Por aprobar'], ['approved', 'Aprobados'], ['changes', 'Con cambios'], ['discarded', 'Descartados'], ['all', 'Todos']]
      .map(([k, t]) => `<button class="tab-btn ${studioFilter === k ? 'on' : ''}" data-sfilter="${k}">${t}<small>${count(k)}</small></button>`).join('');
    const shown = list.filter((v) => studioFilter === 'all' || v.status === studioFilter);
    gridIds = shown.map((v) => v.id);
    // Solo se redibuja si cambiaron los videos: así no se corta el que estás mirando ni lo que escribiste.
    const grid = $('#studio-grid');
    const sig = `${studioFilter}|${shown.map((v) => `${v.id}:${v.status}:${v.published?.at || ''}`).join('|')}`;
    if (grid.dataset.sig === sig) return;
    grid.dataset.sig = sig;
    grid.innerHTML = shown.length ? shown.map(videoCard).join('')
      : `<div class="empty">${studioFilter === 'pending' ? 'No hay videos esperando tu aprobación. Los nuevos aparecen acá apenas terminan de renderizarse.' : 'No hay videos en este filtro.'}</div>`;
  },

  chatList() {
    $('#chat-list').innerHTML = groupItem() + config.agents.filter((a) => !a.engine).map((a) => {
      const msgs = model.chats[a.id]?.messages || [];
      const last = msgs.at(-1);
      const [, dot] = STATUS[model.agents[a.id]?.status] || STATUS.idle;
      const n = a.id === chatId && view === 'chat' ? 0 : unread(a.id);
      return `<button class="chat-item ${a.id === chatId ? 'on' : ''}" data-chat="${a.id}">
        <span class="avatar" style="--c:${a.color};--dot:${dot}">${esc(a.nombre[0])}</span>
        <span><span class="n">${esc(a.nombre)}</span><br><span class="p">${last ? esc((last.role === 'user' ? 'Vos: ' : '') + last.text.replace(/\s+/g, ' ')) : esc(a.rol)}</span></span>
        <span class="meta">${last ? time(last.ts) : ''}${n ? `<span class="unread">${n}</span>` : ''}</span>
      </button>`;
    }).join('');
  },

  chat() {
    $('#chat-mentions').hidden = true;
    if (isGroupChat(chatId)) return renderGroup();
    $('#chat-input').placeholder = 'Escribile al agente… (Enter envía, Shift+Enter salto de línea)';
    const a = byId[chatId];
    const s = model.agents[chatId] || { status: 'idle' };
    const busy = isBusy(chatId);
    $('#chat-head').innerHTML = `<button class="btn sm back" data-back>←</button>
      <div class="avatar" style="--c:${a.color}">${esc(a.nombre[0])}</div>
      <div><div class="t">${esc(a.nombre)}</div><div class="s">${esc(a.rol)} · ${esc(a.model.replace('claude-', ''))}</div></div>`;
    const msgs = model.chats[chatId]?.messages || [];
    const box = $('#chat-msgs');
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    const html = msgs.length
      ? msgs.map((m) => `<div class="msg ${m.role === 'agent' ? 'bot' : m.role}">${m.role === 'agent' ? markdown(m.text) : esc(m.text)}<time>${time(m.ts)}</time></div>`).join('')
      : `<div class="msg sys">Escribile a ${esc(a.nombre)}. Recuerda la conversación y puede pedirte aprobación antes de ejecutar acciones.</div>`;
    if (box.dataset.sig !== `${chatId}|${msgs.length}|${msgs.at(-1)?.id}`) {
      box.innerHTML = html;
      if (near || box.dataset.chat !== chatId) box.scrollTop = box.scrollHeight;
      box.dataset.sig = `${chatId}|${msgs.length}|${msgs.at(-1)?.id}`;
      box.dataset.chat = chatId;
    }
    const typing = $('#chat-typing');
    typing.hidden = !busy;
    typing.textContent = busy ? `${a.nombre}: ${s.text || 'trabajando…'}` : '';
    $('#chat-send').disabled = busy;
    if (view === 'chat') markRead(chatId);
  },

  activity() {
    const kinds = [['all', 'Todo'], ['approval', 'Aprobaciones'], ['deliverable', 'Entregables'], ['error', 'Errores']];
    $('#activity-filters').innerHTML =
      [['all', 'Todos los agentes'], ...config.agents.map((a) => [a.id, a.nombre])].map(([k, l]) => `<button class="chip ${actAgent === k ? 'on' : ''}" data-act-agent="${k}">${esc(l)}</button>`).join('') +
      '<span style="width:12px"></span>' +
      kinds.map(([k, l]) => `<button class="chip ${actKind === k ? 'on' : ''}" data-act-kind="${k}">${l}</button>`).join('');
    const list = [...model.log].reverse().filter((e) =>
      (actAgent === 'all' || e.agentId === actAgent) &&
      (actKind === 'all' || e.kind === actKind || (actKind === 'error' && e.kind === 'warn')));
    $('#activity').innerHTML = list.length
      ? list.slice(0, 200).map((e) => {
        const a = byId[e.agentId];
        return `<div class="ev ${esc(e.kind)}"><time>${time(e.ts)}</time>
          <span class="avatar sm" style="--c:${a?.color || '#555b6b'}">${esc(a ? a.nombre[0] : '·')}</span>
          <span class="txt"><span class="who" style="color:${a?.color || 'inherit'}">${esc(a?.nombre || 'Oficina')}</span>${esc(e.text)}</span></div>`;
      }).join('')
      : '<div class="empty">No hay actividad con estos filtros.</div>';
  },

  system() {
    const claude = status?.claude
      ? `<div class="conn ok"><i class="dot"></i><div><b>Claude</b><span class="st">Conectado con tu ${esc(status.claude)}</span></div></div>`
      : `<div class="conn warn"><i class="dot"></i><div><b>Claude</b><span class="st">Modo demo: falta <code>CLAUDE_CODE_OAUTH_TOKEN</code> o <code>ANTHROPIC_API_KEY</code></span></div></div>`;
    // Primero lo que no funciona.
    const conns = status
      ? [...status.connections].sort((x, y) => (x.state === 'ok') - (y.state === 'ok')).map((c) => {
        const [cls, text] = CONNECTION_TEXT[c.state] || CONNECTION_TEXT.unreachable;
        const detail = c.state === 'missing' ? `Variable: <code>${esc(c.missing.join(', '))}</code>` : esc(c.detail || '');
        const how = c.state !== 'ok' && HOW[c.id] ? `<div class="how">${esc(HOW[c.id])}</div>` : '';
        return `<div class="conn ${cls}"><i class="dot"></i><div><b>${esc(c.label)}</b><span class="st">${text}${detail ? ` · ${detail}` : ''}</span>${how}</div></div>`;
      }).join('')
      : '<div class="empty">Comprobando…</div>';
    const e = status?.estudio;
    const row = (ok, title, text, how = '') => `<div class="conn ${ok ? 'ok' : 'bad'}"><i class="dot"></i><div><b>${title}</b><span class="st">${text}</span>${how ? `<div class="how">${how}</div>` : ''}</div></div>`;
    const studio = e ? [
      row(e.videos > 0, 'Estudio: motor de video', e.videos ? `${e.videos} videos y la plantilla cargados` : 'Falta subir el motor de cresova-motion'),
      row(e.skill, 'Estudio: skill motion-video-director', e.skill ? 'Instalada de forma privada' : 'Falta subir la skill'),
      row(e.elevenlabs, 'Estudio: voz con ElevenLabs', e.elevenlabs ? 'Llave cargada' : 'Falta cargar la llave · Variable: <code>ELEVENLABS_API_KEY</code>', e.elevenlabs ? '' : 'Cargala arriba, en Llaves de los servicios.'),
    ].join('') : '';
    $('#sys-conn').innerHTML = claude + conns + studio;
    if (status) {
      const mal = status.connections.filter((c) => c.state !== 'ok');
      const faltan = mal.filter((c) => c.state === 'missing').length;
      const total = status.connections.length + 1, bien = total - mal.length - (status.claude ? 0 : 1);
      $('#sys-resumen').innerHTML = `<div class="sys-res ${mal.length || !status.claude ? 'warn' : 'ok'}"><b>${bien} de ${total} conexiones funcionando</b>${mal.length ? `<span>Revisar: ${mal.map((c) => esc(c.label)).join(', ')}</span>` : '<span>Todo en orden.</span>'}</div>`;
      const det = $('#keys-det');
      if (det && !det.dataset.tocado) { det.open = faltan > 0; det.dataset.tocado = '1'; }
    }
    $('#sys-sched').innerHTML = `<table class="t"><thead><tr><th>Agente</th><th>Horario</th><th>Próxima</th></tr></thead><tbody>${
      config.agents.map((a) => `<tr><td>${esc(a.nombre)}</td><td>${scheduleText(a.schedule)}</td><td>${nextText(a)}</td></tr>`).join('')
    }</tbody></table><p class="note">Hora de Honduras. Los agentes arrancan solos a la hora indicada.</p>`;
    renderStudio();
  $('#sys-cost').innerHTML = `<table class="t"><thead><tr><th>Agente</th><th>Modelo</th><th class="n">Acumulado</th></tr></thead><tbody>${
      config.agents.map((a) => `<tr><td>${esc(a.nombre)}</td><td>${esc(a.model.replace('claude-', ''))}</td><td class="n">$${(model.costs[a.id] || 0).toFixed(2)}</td></tr>`).join('')
    }</tbody><tfoot><tr><td colspan="2">Total</td><td class="n">$${totalCost().toFixed(2)}</td></tr></tfoot></table>
    <p class="note">Es el costo equivalente en la API. Con tu suscripción no se cobra aparte, pero cuenta contra tu cupo.</p>`;
  },
};

function cupoCard(card) {
  const c = status?.cupo;
  if (!c) return card('Consumo (equiv. API)', `$${totalCost().toFixed(2)}`, '', 'sistema');
  if (c.blockedUntil > Date.now()) return `<button class="stat bad" data-cupo-retomar="1" title="Si subiste de plan o ya volvió el cupo, tocá para retomar"><small>Cupo de Claude · tocá para retomar</small><b>Vuelve ${new Intl.DateTimeFormat('es-HN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(c.blockedUntil)}</b></button>`;
  const w5 = c.windows?.five_hour, w7 = c.windows?.seven_day;
  const pct = (w) => (w?.real && w.utilization != null && !(w.resetsAt && w.resetsAt < Date.now()) ? `${Math.round(w.utilization * 100)} %` : null);
  const parts = [pct(w5) && `5 h ${pct(w5)}`, pct(w7) && `semana ${pct(w7)}`].filter(Boolean);
  const freno = c.ahorro?.motivo ? ' · oficina en pausa' : '';
  // Sin uso real todavía: solo sabemos que hay cupo (no estamos frenados).
  // El valor grande es el de las 5 h (el que frena primero); la semana va abajo, chica, para que no se parta en dos líneas.
  const valor = pct(w5) ? `${pct(w5)}<em>${pct(w7) ? `en 5 h · semana ${pct(w7)}` : 'en 5 h'}</em>` : pct(w7) ? `${pct(w7)}<em>en la semana</em>` : 'Disponible';
  return card(`Cupo de Claude${freno}`, valor, c.ahorro?.motivo ? 'warn' : 'ok', 'ajustes');
}

function renderBadges() {
  const working = config.agents.filter((a) => isBusy(a.id)).length;
  const inbox = model.approvals.length + pendingDeliverables().length;
  const chats = config.agents.reduce((n, a) => n + (a.id === chatId && view === 'chat' ? 0 : unread(a.id)), 0) + unreadGroups();
  const offline = status ? status.connections.filter((c) => c.state !== 'ok').length + (status.claude ? 0 : 1) : 0;
  const set = (id, n) => { $(`#badge-${id}`).textContent = n || ''; };
  set('tablero', (model.tasks || []).filter((t) => t.status === 'espera').length);
  set('equipo', working); set('bandeja', inbox); set('estudio', pendingVideos().length); set('chat', chats); set('conexiones', offline);
  set('sistema', offline + (model.tasks || []).filter((t) => t.status === 'espera').length);
  // Quién necesita algo de Diego: se marca en la oficina con un "!" que brilla.
  office.setNeeds?.(new Set(needsByAgent().keys()));
  $('#badge-oficina').textContent = '';
  const todo = inbox + pendingVideos().length;
  document.title = todo ? `(${todo}) Oficina Cresova` : 'Oficina Cresova';
  office.setPending(model.approvals.length);
  office.setTasks?.(model.tasks || []);
}

// Dibujo agrupado: muchos eventos seguidos se pintan una sola vez por cuadro.
const dirty = new Set();
let raf = 0;
function invalidate(...keys) {
  for (const k of keys) dirty.add(k);
  if (!raf) raf = requestAnimationFrame(() => {
    raf = 0;
    const keys2 = [...dirty];
    dirty.clear();
    for (const k of keys2) RENDER[k]?.();
    renderBadges();
  });
}
const invalidateAll = () => invalidate(...Object.keys(RENDER));

// ---------- tarjetas de decisión y de video ----------
// Sistema de diseño: sin emoji decorativos al principio de los títulos (el tipo lo dice la etiqueta).
const sinEmoji = (t) => String(t || '').replace(/^[^\p{L}\p{N}"'¿¡(]+/u, '').trim();
// Título corto de un video: "🎬 113 · Anuncio "Sí, tu página es cara" · B · Lo que pierdes (clínica) · cierre unificado del set v1"
// → "Sí, tu página es cara · B · Lo que pierdes". El título completo queda en el tooltip y en las notas.
function tituloCorto(t) {
  let x = sinEmoji(t).replace(/^\d+\s*·\s*/, '');
  x = x.replace(/\s*\([^)]*\)/g, '').replace(/\s*·\s*cierre unificado del set/gi, '').replace(/\s+v\d+\s*$/i, '');
  x = x.replace(/^Anuncio\s+([A-Z])\s+"([^"]+)"/, '"$2" · $1').replace(/^Anuncio\s+(?=")/i, '');
  x = x.replace(/"([^"]+)"/g, '$1').replace(/\s*·\s*·\s*/g, ' · ').trim();
  return x || sinEmoji(t);
}
// Tarjeta de decisión: tres caminos claros. Sí (con la opción que elijas), Ajustar (decís qué cambiar)
// o No (y si querés, se cierra el tema para que nadie lo vuelva a proponer).
// Palomitas de WhatsApp: una (no llegó), dos (llegó), dos azules (leído).
const entregaTxt = (m) => m.entrega === 'leido' ? ' · <span class="ent leido" title="Lo leyó">✓✓ leído</span>' : m.entrega === 'entregado' ? ' · <span class="ent" title="Le llegó">✓✓ entregado</span>' : m.entrega === 'pendiente' ? ' · <span class="ent pend" title="Sigue con una sola palomita: no le llegó">✓ sin entregar</span>' : '';
// Valor para un <input type="datetime-local"> en la hora de la compu de Diego (Honduras).
const fechaLocal = (t) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
function decisionCard(d) {
  const a = byId[d.agentId];
  // Opciones del agente que dicen que no ("No", "Dejar igual"…) van en el camino del No, no como aprobación.
  const esNo = (o) => /^(no\b|no,|dejar (todo )?igual|ninguno|cancelar|primero ajustar|ajustar)/i.test(o.trim());
  const si = (d.options || []).filter((o) => !esNo(o));
  const yes = si.length ? si.map((o, i) => `<button class="btn ${i === 0 ? 'ok' : ''}" data-answer="${esc(o)}">${esc(o)}</button>`).join('') : '<button class="btn ok" data-dreview="approved">Aprobar</button>';
  // El enlace de la vista previa sale del resumen y va como botón.
  const url = (d.summary || '').match(/https:\/\/\S+/)?.[0] || '';
  const resumen = url ? d.summary.replace(url, '').replace(/\s*·\s*$/, '').trim() : d.summary;
  const responderCliente = d.ventasConv && !d.ventasPregunta && /ya le escribiste/i.test(d.question || '');
  return `<div class="decision" data-id="${d.id}" data-devp="${esc(d.devProyecto || '')}" style="--c:${a?.color}">
    <div class="who"><span class="avatar sm" style="--c:${a?.color}">${esc(a?.nombre?.[0])}</span><b>${esc(a?.nombre)}</b><span class="d">${dayTime(d.ts)}</span>
      <a class="btn sm ghost" href="/api/doc/${d.id}.pdf" target="_blank" rel="noopener" title="El informe completo en PDF">PDF</a><button class="btn sm ghost" data-doc="${d.id}">Leer completo</button></div>
    <div class="t" title="${esc(d.title)}">${esc(sinEmoji(d.title))}</div>
    ${resumen ? `<p class="sum">${esc(resumen)}</p>` : ''}
    ${d.critica ? `<p class="critica v-${esc((d.critica.veredicto || '').replace(/\W+/g, ''))}" title="Revisión de otro modelo que intenta tirar abajo la propuesta. Detalle al final del informe.">🔎 <b>Crítica independiente: ${esc(d.critica.veredicto)}</b> — ${esc(d.critica.resumen)}</p>` : ''}
    ${d.question ? `<p class="q">${esc(d.question)}</p>` : ''}
    ${d.devProyecto ? `<label class="dec-fecha">Se envía el <input type="datetime-local" class="dev-cuando" value="${fechaLocal((devProyectos || []).find((p) => p.id === d.devProyecto)?.fechaSugerida || Date.now() + 24 * 3600e3)}"><small>Sugerida: 1 día después del pedido, en horario. Cambiala si querés.</small></label>` : ''}
    <div class="actions dec-main">${yes}${responderCliente ? '<button class="btn" data-dpanel="responder">Responder al cliente</button>' : ''}<button class="btn" data-dpanel="ajustar">Ajustar</button>${url ? `<a class="btn enlace" href="${esc(url)}" target="_blank" rel="noopener">Ver vista previa</a>` : ''}<button class="btn no" data-dpanel="no">No</button></div>
    ${responderCliente ? `<div class="dec-panel" data-panel="responder" hidden>
      <label>Tu respuesta le llega al cliente por WhatsApp, desde el número de ventas. El bot queda en pausa en ese chat.</label>
      <textarea class="note reply" rows="3" maxlength="3000" placeholder="Escribile al cliente…"></textarea>
      <div class="actions"><button class="btn ok" data-vreply="${esc(d.ventasConv)}">Enviar al cliente</button><button class="btn ghost" data-dpanel="">Cancelar</button></div>
    </div>` : ''}
    <div class="dec-panel" data-panel="ajustar" hidden>
      <label>¿Qué cambiarías? El agente lo corrige y te lo vuelve a presentar.</label>
      <div class="chips">${['Explicámelo más simple', 'Dame otra opción', 'Más barato', 'Con números concretos', 'Hacelo más corto'].map((c) => `<button class="chip" data-dchip="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <textarea class="note" rows="2" maxlength="2000" placeholder="Ej.: probalo primero con un solo anuncio y mostrame el resultado"></textarea>
      <div class="actions"><button class="btn ok" data-dreview="changes">Enviar ajuste</button><button class="btn ghost" data-dpanel="">Cancelar</button></div>
    </div>
    <div class="dec-panel" data-panel="no" hidden>
      <label>¿Por qué no? (opcional, ayuda a que el equipo aprenda)</label>
      <textarea class="note-no" rows="2" maxlength="2000" placeholder="Ej.: no vamos a invertir más en anuncios este mes"></textarea>
      <div class="actions"><button class="btn no" data-dno="veto" title="El tema se cierra: ningún agente lo vuelve a proponer">No, y cerrar el tema</button><button class="btn" data-dno="ahora">Ahora no</button><button class="btn ghost" data-dpanel="">Cancelar</button></div>
    </div>
  </div>`;
}

const HN = (t) => new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(t);

function videoCard(v) {
  const a = byId[v.agentId];
  const src = `/api/estudio/file/${encodeURIComponent(v.video.video)}/${encodeURIComponent(v.video.name)}`;
  const pub = v.published;
  const post = v.post || {};
  const anuncio = (v.tipo || (/anuncio/i.test(v.title) ? 'anuncio' : 'organico')) === 'anuncio';
  const estadoEtq = pub ? '<span class="etq bien">Programado</span>' : v.status === 'pending' ? '<span class="etq espera">Por aprobar</span>' : v.status === 'approved' ? '<span class="etq bien">Aprobado</span>' : v.status === 'changes' ? '<span class="etq error">Cambios pedidos</span>' : `<span class="etq">${REVIEW[v.status] || v.status}</span>`;
  const tipoTag = `<div class="vtags">${anuncio ? '<span class="etq anuncio" title="Va a Meta con Renata; no se publica en redes">Anuncio · Meta</span>' : '<span class="etq" title="Se publica en TikTok y YouTube con Andrés">Orgánico</span>'}${estadoEtq}${pub ? '' : `<button class="btn enlace" data-vtipo="${anuncio ? 'organico' : 'anuncio'}">Cambiar a ${anuncio ? 'orgánico' : 'anuncio'}</button>`}</div>`;
  const editable = !anuncio && !pub && (v.status === 'pending' || v.status === 'approved');
  const metaBox = anuncio && v.status === 'approved' ? `<div class="pubbox ${v.meta?.anuncioId || v.meta?.videoId ? 'ok' : ''}"><b>${v.meta?.anuncioId ? `✅ En Meta · anuncio ${esc(v.meta.anuncioId)}` : v.meta?.videoId ? `✅ Subido a Meta · video ${esc(v.meta.videoId)}` : '⏳ Renata lo sube a Meta (queda en pausa hasta que vos lo actives)'}</b></div>` : '';
  const postBox = anuncio ? metaBox : pub
    ? `<div class="pubbox ok"><b>📅 Programado: ${esc(HN(pub.at))}</b> · TikTok + YouTube<p>${esc(pub.caption)}</p></div>`
    : editable ? `<div class="pubbox">
        <label>Título para YouTube<input class="p-title" maxlength="100" value="${esc(post.title || '')}" placeholder="Máximo 100 caracteres"></label>
        <label>Texto de la publicación (TikTok y YouTube)<textarea class="p-caption" rows="4" maxlength="2200" placeholder="Gancho, valor, CTA igual al del video y hashtags del rubro">${esc(post.caption || '')}</textarea></label>
      </div>` : '';
  let actions;
  if (v.status === 'pending' && anuncio) actions = `<button class="btn ok" data-vreview="approved">Aprobar para Meta</button>
       <button class="btn" data-vreview="changes">Pedir cambios</button>
       <button class="btn no" data-vreview="discarded">Descartar</button>`;
  else if (anuncio) actions = `<span class="badge ${v.status}">${REVIEW[v.status]}</span>`;
  else if (v.status === 'pending') actions = `<button class="btn ok" data-vreview="approved">Aprobar y programar</button>
       <button class="btn" data-vreview="changes">Pedir cambios</button>
       <button class="btn no" data-vreview="discarded">Descartar</button>`;
  else if (v.status === 'approved' && !pub) actions = '<button class="btn ok" data-vpublish="1">Programar en el próximo hueco</button><span class="badge approved">Aprobado</span>';
  else if (pub) actions = '<button class="btn ghost" data-vunpublish="1">Cancelar la publicación</button>';
  else actions = `<span class="badge ${v.status}">${REVIEW[v.status]}</span>`;
  return `<article class="vcard" data-id="${v.id}">
    <video controls playsinline preload="none" poster="${src.replace('/api/estudio/file/', '/api/estudio/poster/')}" src="${src}"></video>
    <div class="vbody">
      <div class="t" title="${esc(sinEmoji(v.title))}">${esc(tituloCorto(v.title))}</div>
      <div class="s">${esc(a?.nombre || '')} · ${dayTime(v.ts)} · <code>${esc(v.folder)}</code></div>
      ${tipoTag}
      ${v.note ? `<p class="vnote">Tu nota: ${esc(v.note)}</p>` : ''}
      ${v.script ? `<details><summary>Locución</summary><p class="script">${esc(v.script)}</p></details>` : ''}
      <div class="links"><button class="link" data-vopen="${v.id}">⤢ Ver en grande</button>${v.notesId ? `<button class="link" data-doc="${v.notesId}">Notas de ${esc(a?.nombre || 'producción')}</button>` : ''}<button class="link" data-doc="${v.id}">Control de calidad</button><a class="link" href="${src}" download>Descargar</a></div>
      ${postBox}
      ${v.status === 'pending' ? '<textarea class="note" rows="2" maxlength="2000" placeholder="Si pedís cambios: qué cambiar"></textarea>' : ''}
      <p class="verr" hidden></p>
      <div class="actions">${actions}</div>
    </div>
  </article>`;
}

async function publishCard(card) {
  const err = card.querySelector('.verr');
  const title = card.querySelector('.p-title')?.value.trim() || '';
  const caption = card.querySelector('.p-caption')?.value.trim() || '';
  const res = await fetch(`/api/estudio/publish/${card.dataset.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, caption }) });
  if (res.ok) { loadStudio(); return true; }
  err.hidden = false;
  err.textContent = (await res.json().catch(() => ({}))).error || 'No se pudo programar.';
  return false;
}

async function review(id, body) {
  const res = await fetch(`/api/deliverables/${id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  if (!res?.ok) {
    // Antes fallaba en silencio: ahora se dice qué pasó.
    const msg = !res ? 'no hay conexión con la oficina' : (await res.json().catch(() => ({}))).error || `error ${res.status}`;
    alert(`No se pudo guardar tu respuesta: ${msg}. Recargá la página (Ctrl+F5) y probá de nuevo.`);
  }
  return Boolean(res?.ok);
}

let studioVideos = [];
let slotInfo = null;
let linea = null;
async function loadLinea() {
  try { linea = await fetch('/api/linea').then((r) => r.json()); } catch { return; }
  invalidate('studio');
}
async function setLinea(patch) {
  const res = await fetch('/api/linea', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  if (res.ok) { linea = await res.json(); invalidate('studio'); }
}
const QSTATE = { queued: 'En cola', producing: 'Produciendo', done: 'Listo', failed: 'No se hizo' };
function renderLinea() {
  const box = $('#linea');
  if (!linea) { box.innerHTML = ''; return; }
  const l = linea;
  const blocked = status?.cupo?.blockedUntil > Date.now();
  const stage = l.batch ? (l.batch.stage === 'guiones' ? 'Mateo escribe un lote de guiones' : 'Nico elige los mejores guiones') : '';
  const ahorro = status?.cupo?.ahorro?.activo;
  const estado = ahorro ? 'Modo ahorro de Claude: no produce videos nuevos; los cambios que pidas sí se hacen.'
    : !l.enabled ? 'Apagada: no produce sola.'
    : blocked ? 'Esperando que vuelva el cupo de Claude.'
    : l.stock.total >= l.reserva && !(l.trabajando || []).length ? 'Reserva llena: descansa.'
    : l.producedToday >= l.maxPorDia ? 'Llegó al máximo de hoy.' : 'Produciendo para llenar la reserva.';
  const working = (l.trabajando || []).map((w) => {
    const a = byId[w.editor];
    return `<div class="work-row"><span class="avatar sm" style="--c:${a?.color || '#555'}">${esc((a?.nombre || '?')[0])}</span><div><b>${esc(a?.nombre || w.editor)}</b><small>${esc(w.title)}</small></div></div>`;
  });
  // Renders: cuánto llevan, por dónde van y cuánto les falta (según su velocidad y lo que dura el video).
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const enCola = renders.filter((x) => x.status === 'queued').sort((a, b) => Boolean(b.prioridad) - Boolean(a.prioridad) || a.createdAt - b.createdAt);
  for (const r of renders.filter((x) => x.status === 'running' || x.status === 'queued').sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1))) {
    const secs = (r.log || []).join(' ').match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)?.at(-1)?.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const done = r.hecho ?? (secs ? Number(secs[1]) * 3600 + Number(secs[2]) * 60 + Number(secs[3]) : 0);
    const titulo = esc(r.review?.title ? sinEmoji(r.review.title).slice(0, 60) : r.video);
    if (r.status === 'running') {
      const lleva = Math.max(0, (Date.now() - r.startedAt) / 1000);
      const falta = done > 1 && r.duracion ? (lleva / done) * Math.max(0, r.duracion - done) : null;
      working.push(`<div class="work-row"><span class="spin"></span><div><b>Renderizando · lleva ${Math.round(lleva / 60)} min${r.partes ? ` · ${r.partes} partes a la vez (${r.partesListas} listas)` : ''}</b><small>${titulo}</small><small class="rprog">${done ? `Va en ${mmss(done)}${r.duracion ? ` de ${mmss(r.duracion)}` : ''}` : 'Arrancando…'}${falta != null ? ` · faltan ~${Math.max(1, Math.round(falta / 60))} min` : ''}</small>${r.duracion && done ? `<span class="rbar"><i style="width:${Math.min(100, Math.round((done / r.duracion) * 100))}%"></i></span>` : ''}<button class="link" data-render-cancelar="${r.id}">Cancelar</button></div></div>`);
    } else {
      const pos = enCola.indexOf(r) + 1;
      const espera = Math.round((Date.now() - r.createdAt) / 60000);
      working.push(`<div class="work-row"><span class="spin"></span><div><b>Render en cola${pos ? ` · ${pos}.º` : ''}${r.prioridad ? ' · prioridad' : ''}</b><small>${titulo}</small><small class="rprog">Esperando hace ${espera} min${r.duracion ? ` · dura ${mmss(r.duracion)}` : ''}</small>${!r.prioridad ? `<button class="link" data-render-priorizar="${r.id}">Priorizar</button>` : ''}<button class="link" data-render-cancelar="${r.id}">Cancelar</button></div></div>`);
    }
  }
  const queued = l.queue.filter((q) => q.status === 'queued');
  const failed = l.queue.filter((q) => q.status === 'failed').slice(-3);
  box.innerHTML = `<div class="side-head"><h2>Producción</h2><button class="btn sm ${l.enabled ? 'no' : 'ok'}" data-linea-toggle="1">${l.enabled ? 'Apagar' : 'Encender'}</button></div>
    <p class="lstate ${l.enabled && !ahorro ? 'on' : ''}">${esc(estado)}${stage ? `<br><small>${esc(stage)}</small>` : ''}</p>
    <button class="btn sm ${ahorro ? 'ok' : ''}" data-ahorro="${ahorro ? '0' : '1'}">${ahorro ? 'Salir del modo ahorro' : 'Modo ahorro de Claude'}</button>
    <h3>Trabajando ahora</h3>
    ${working.length ? working.join('') : '<p class="note">Nadie está editando en este momento.</p>'}
    <h3>En cola <small>${queued.length}</small></h3>
    ${queued.length ? `<div class="q-list">${queued.slice(0, 8).map((q) => `<div class="q-row ${q.kind === 'cambios' ? 'chg' : ''}"><span>${q.kind === 'cambios' ? '✏️ ' : ''}${esc(q.title)}</span><button class="link" data-linea-quitar="${q.id}" title="Quitar de la cola">✕</button></div>`).join('')}${queued.length > 8 ? `<p class="note">y ${queued.length - 8} más</p>` : ''}</div>` : '<p class="note">Vacía: Mateo escribe un lote nuevo cuando hace falta.</p>'}
    ${failed.length ? `<p class="note err">No se pudo: ${failed.map((q) => esc(q.title)).join(' · ')}</p>` : ''}
    <details class="line-settings"><summary>Ajustes de la línea</summary>
      <div class="set-grid">
        <label>Máximo por día<input type="number" min="1" max="80" value="${l.maxPorDia}" data-linea-field="maxPorDia"></label>
        <label>Reserva objetivo<input type="number" min="1" max="100" value="${l.reserva}" data-linea-field="reserva"></label>
        <label>Editores en paralelo<input type="number" min="1" max="3" value="${l.editores || 1}" data-linea-field="editores"></label>
        <label>Guiones por lote<input type="number" min="3" max="12" value="${l.lote}" data-linea-field="lote"></label>
      </div>
      <p class="note">El límite real es tu cupo de Claude: más editores y más videos por día lo gastan más rápido.</p>
    </details>`;
}
async function loadStudio() {
  try { studioVideos = await fetch('/api/estudio/videos').then((r) => r.json()); } catch { return; }
  invalidate('sideStudio');
  if (!config.demo) fetch('/api/estudio/next-slot').then((r) => r.json()).then((j) => { slotInfo = j; invalidate('studio'); }).catch(() => {});
  invalidate('studio');
}

// ---------- estudio de video ----------
document.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-render-cancelar]');
  if (!c || !confirm('¿Cancelar este render? Se detiene y no vuelve a empezar.')) return;
  c.disabled = true;
  const r = await fetch(`/api/estudio/render/${c.dataset.renderCancelar}/cancelar`, { method: 'POST' }).then((x) => x.json()).catch((er) => ({ error: er.message }));
  window.toast?.(r.error || 'Render cancelado', r.error ? 'error' : 'ok');
  loadRenders();
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-render-priorizar]');
  if (!b) return;
  b.disabled = true;
  const r = await fetch(`/api/estudio/render/${b.dataset.renderPriorizar}/priorizar`, { method: 'POST' }).then((x) => x.json()).catch((er) => ({ error: er.message }));
  window.toast?.(r.error || 'Priorizado: es el próximo en renderizarse', r.error ? 'error' : 'ok');
  loadRenders();
});
let renders = [];
const RSTATUS = { queued: 'En cola', running: 'Renderizando…', done: 'Listo', failed: 'Falló' };

async function loadRenders() {
  try { renders = (await fetch('/api/estudio').then((r) => r.json())).jobs || []; } catch { return; }
  invalidate('system', 'studio');
}

function renderStudio() {
  $('#sys-renders').innerHTML = renders.length
    ? `<div class="renders">${renders.slice(0, 12).map((r) => `<div class="render-row ${r.status}">
        <span><b>${esc(r.video)}</b> · ${esc(r.label)}</span>
        <span class="st">${RSTATUS[r.status] || r.status}${r.seconds ? ` · ${Math.round(r.seconds / 60)} min` : ''}</span>
      </div>`).join('')}</div><p class="note">Los renders corren en el VPS, en cola y con prioridad baja.</p>`
    : '<div class="empty">Todavía no hay renders.</div>';
}

// ---------- encargos ----------
let encargoId = null;
function openEncargo(id) {
  encargoId = id;
  $('#encargo-title').textContent = `Encargo para ${byId[id].nombre} · ${byId[id].rol}`;
  $('#encargo-text').value = '';
  $('#encargo-msg').textContent = '';
  $('#encargo').showModal();
  $('#encargo-text').focus();
}
$('#encargo-send').addEventListener('click', async () => {
  const instruction = $('#encargo-text').value.trim();
  if (!instruction || !encargoId) return;
  const res = await fetch(`/api/run/${encargoId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction }) });
  if (res.ok) $('#encargo').close();
  else { $('#encargo-msg').textContent = (await res.json().catch(() => ({}))).error || 'No se pudo encargar.'; $('#encargo-msg').classList.add('err'); }
});


// ---------- tablero ----------
const TCOLS = [['pendiente', 'Pendiente'], ['en_progreso', 'En progreso'], ['espera', 'Espera aprobación'], ['correcciones', 'Correcciones'], ['hecha', 'Hecha']];
const TSTATE = { pendiente: 'Pendiente', en_progreso: 'En progreso', espera: 'Espera aprobación', correcciones: 'Correcciones', hecha: 'Hecha', cancelada: 'Cancelada' };
const PRIO = { alta: 'Alta', media: 'Media', baja: 'Baja' };
let openTaskId = null;

function cardHTML(t) {
  const a = byId[t.assignee];
  return `<button class="tcard" data-task="${t.id}" style="--c:${a?.color || '#555'}">
    <span class="tt">${esc(t.title)}</span>
    <span class="tm"><span class="avatar sm" style="--c:${a?.color}">${esc(a?.nombre?.[0] || '?')}</span>${esc(a?.nombre || t.assignee)}
      <span class="prio ${t.priority}">${PRIO[t.priority]}</span>
      ${t.deliverables.length ? `<span>📎 ${t.deliverables.length}</span>` : ''}${t.awaitingVideo ? '<span>🎬 renderizando</span>' : ''}
      <span class="age">${ago(t.updatedAt)}</span></span>
  </button>`;
}

RENDER.board = function renderBoard() {
  const tasks = model.tasks || [];
  $('#board').innerHTML = TCOLS.map(([st, label]) => {
    const all = tasks.filter((t) => t.status === st).sort((a, b) => b.updatedAt - a.updatedAt);
    const shown = st === 'hecha' ? all.slice(0, 12) : all;
    return `<section class="col ${st}"><h3>${label} <span class="n">${all.length}</span></h3>${shown.map(cardHTML).join('') || '<div class="col-empty">—</div>'}</section>`;
  }).join('');
};

function openTask(id) {
  openTaskId = id;
  renderTaskDetail();
  if (!$('#task-detail').open) $('#task-detail').showModal();
}
$('#task-detail').addEventListener('close', () => { openTaskId = null; });

function renderTaskDetail() {
  const t = (model.tasks || []).find((x) => x.id === openTaskId);
  if (!t) return;
  const a = byId[t.assignee];
  const from = t.createdBy === 'diego' ? 'vos' : byId[t.createdBy]?.nombre || t.createdBy;
  const dels = t.deliverables.map((id) => model.deliverables.find((d) => d.id === id)).filter(Boolean);
  const who = (by) => (by === 'diego' ? 'Diego' : by === 'sistema' ? 'Oficina' : byId[by]?.nombre || by);
  const acts = [];
  if (['pendiente', 'correcciones', 'en_progreso', 'espera'].includes(t.status)) acts.push('<button class="btn no" data-task-act="cancelada">Cancelar tarea</button>');
  if (['espera', 'hecha', 'cancelada'].includes(t.status)) acts.push('<button class="btn" data-task-act="pendiente">Volver a hacer</button>');
  if (t.status === 'espera') acts.push('<button class="btn ok" data-task-act="hecha">Marcar como hecha</button>');
  $('#td-body').innerHTML = `<h2 class="dlg-title">${esc(t.title)}</h2>
    <div class="td-meta"><span class="pill2">${TSTATE[t.status]}</span><span class="pill2" style="color:${a?.color}">${esc(a?.nombre)} · ${esc(a?.rol)}</span>
      <span class="pill2">Prioridad ${PRIO[t.priority]}</span><span class="pill2">Creada por ${esc(from)} ${ago(t.createdAt)}</span>${t.runs ? `<span class="pill2">${t.runs} corrida(s)</span>` : ''}</div>
    <div class="doc">${markdown(t.description || '_Sin descripción._')}</div>
    <div class="td-sec"><h3>Entregables</h3>${dels.length ? `<div class="rows">${dels.map((d) => `<button class="row-item" data-doc="${d.id}"><span class="avatar sm" style="--c:${byId[d.agentId]?.color}">${esc(byId[d.agentId]?.nombre?.[0] || '?')}</span><span><span class="t">${esc(d.title)}</span></span><span class="d">${dayTime(d.ts)}</span><span class="badge ${d.status}">${REVIEW[d.status]}</span></button>`).join('')}</div>` : `<div class="empty">${t.awaitingVideo ? 'El video se está renderizando; aparece acá al terminar.' : 'Todavía no hay entregables.'}</div>`}</div>
    <div class="td-sec"><h3>Notas</h3><div class="td-notes">${t.notes.map((n) => `<div><b>${esc(who(n.by))}</b> · ${ago(n.ts)}<br>${esc(n.text)}</div>`).join('') || '<span class="note">Sin notas.</span>'}</div>
      <div class="td-note"><textarea id="td-note" rows="2" maxlength="2000" placeholder="Agregar una nota o una corrección para el agente…"></textarea><div><button class="btn sm" data-task-act="nota">Agregar nota</button></div></div></div>
    <div class="td-actions">${acts.join('')}</div>`;
}

async function taskAction(act) {
  if (!openTaskId) return;
  const body = act === 'nota' ? { note: $('#td-note').value.trim() } : { status: act };
  if (act === 'nota' && !body.note) return;
  if (act === 'cancelada' && !confirm('¿Cancelar esta tarea?')) return;
  const res = await fetch(`/api/tareas/${openTaskId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'No se pudo actualizar.');
}

$('#task-new').addEventListener('click', () => {
  $('#tn-assignee').innerHTML = config.agents.filter((a) => a.enabled !== false).map((a) => `<option value="${a.id}">${esc(a.nombre)} · ${esc(a.rol)}</option>`).join('');
  $('#tn-title').value = ''; $('#tn-desc').value = ''; $('#tn-msg').textContent = '';
  $('#task-new-dialog').showModal();
  $('#tn-title').focus();
});
$('#tn-save').addEventListener('click', async () => {
  const body = { assignee: $('#tn-assignee').value, priority: $('#tn-priority').value, title: $('#tn-title').value.trim(), description: $('#tn-desc').value.trim() };
  if (!body.title) { $('#tn-title').focus(); return; }
  const res = await fetch('/api/tareas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) $('#task-new-dialog').close();
  else { $('#tn-msg').textContent = (await res.json().catch(() => ({}))).error || 'No se pudo crear.'; $('#tn-msg').classList.add('err'); }
});

// ---------- chat grupal ----------
const GROUP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.2c2.4.1 4 1.7 4.5 4.6"/></svg>';
// Un chat por departamento: chatId = 'grupo-<departamento>'.
const DEPTS = config.departments || [{ id: 'marketing', nombre: 'Marketing', color: '#e30016' }];
const groupKey = (d) => `grupo-${d}`;
const deptOf = (id) => (String(id).startsWith('grupo-') ? id.slice(6) : null);
const isGroupChat = (id) => DEPTS.some((d) => groupKey(d.id) === id);
const deptMsgs = (d) => (model.group || []).filter((m) => (m.dept || DEPTS[0].id) === d);
const busyDepts = new Set();
const unreadGroup = (d) => deptMsgs(d).filter((m) => m.from !== 'diego' && m.ts > getSeen(groupKey(d))).length;
const unreadGroups = () => DEPTS.reduce((n, d) => n + (chatId === groupKey(d.id) && view === 'chat' ? 0 : unreadGroup(d.id)), 0);
const leadName = (d) => byId[d.lead]?.nombre || 'Jarvis';
const deptMembers = (d) => config.agents.filter((a) => a.dept === d.id).map((a) => a.nombre);

function groupItem() {
  return DEPTS.map((d) => {
    const key = groupKey(d.id);
    const last = deptMsgs(d.id).at(-1);
    const n = chatId === key && view === 'chat' ? 0 : unreadGroup(d.id);
    const who = last ? (last.from === 'diego' ? 'Vos: ' : last.from === 'sistema' ? '' : `${byId[last.from]?.nombre || ''}: `) : '';
    return `<button class="chat-item group ${chatId === key ? 'on' : ''}" data-chat="${key}" style="--c:${d.color}">
    <span class="avatar">${GROUP_ICON}</span>
    <span><span class="n">${esc(d.nombre)}</span><br><span class="p">${last ? esc(who + last.text.replace(/\s+/g, ' ')) : `Grupo · ${deptMembers(d).length + 1} integrantes`}</span></span>
    <span class="meta">${last ? time(last.ts) : ''}${n ? `<span class="unread">${n}</span>` : ''}</span>
  </button>`;
  }).join('');
}

function renderGroup() {
  const d = DEPTS.find((x) => groupKey(x.id) === chatId) || DEPTS[0];
  const key = groupKey(d.id);
  $('#chat-head').innerHTML = `<button class="btn sm back" data-back>←</button>
    <div class="avatar" style="background:linear-gradient(135deg,${d.color},#7c5cff)">${GROUP_ICON}</div>
    <div><div class="t">${esc(d.nombre)}</div><div class="s">${esc([leadName(d), ...deptMembers(d)].join(', '))} · Mencioná con @Nombre; sin mención responde ${esc(leadName(d))}.</div></div>`;
  const msgs = deptMsgs(d.id);
  const box = $('#chat-msgs');
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  const html = msgs.length ? msgs.map((m) => {
    if (m.from === 'diego') return `<div class="msg user">${esc(m.text)}<time>${time(m.ts)}</time></div>`;
    if (m.from === 'sistema') return `<div class="msg sys">${esc(m.text)}</div>`;
    const a = byId[m.from];
    return `<div class="msg bot"><b class="who" style="color:${a?.color}">${esc(a?.nombre || m.from)} · ${esc(a?.rol || '')}</b>${markdown(m.text)}<time>${time(m.ts)}</time></div>`;
  }).join('') : `<div class="msg sys">Este es el chat de ${esc(d.nombre)}. Escribí a todos con @equipo o mencioná a alguien con @Nombre. ${esc(leadName(d))} responde si no mencionás a nadie, y puede poner tareas en el tablero.</div>`;
  const sig = `${key}|${msgs.length}|${msgs.at(-1)?.id}`;
  if (box.dataset.sig !== sig) {
    box.innerHTML = html;
    if (near || box.dataset.chat !== key) box.scrollTop = box.scrollHeight;
    box.dataset.sig = sig;
    box.dataset.chat = key;
  }
  const busyNow = busyDepts.has(d.id);
  const replying = config.agents.filter((a) => model.agents[a.id]?.text === 'Leyendo el chat del equipo…').map((a) => a.nombre);
  const typing = $('#chat-typing');
  typing.hidden = !busyNow;
  typing.textContent = busyNow ? `${replying.length ? replying.join(', ') : 'El equipo'} está respondiendo…` : '';
  $('#chat-send').disabled = busyNow;
  $('#chat-input').placeholder = `Escribile a ${d.nombre}… tocá un nombre para mencionarlo (Enter envía)`;
  const people = config.agents.filter((a) => (a.dept === d.id || a.coordinator) && !a.engine);
  $('#chat-mentions').hidden = false;
  $('#chat-mentions').innerHTML = [['equipo', 'Todos'], ...people.map((a) => [a.nombre, a.nombre])].map(([m, l]) => `<button type="button" class="chip" data-mention="${esc(m)}">@${esc(l)}</button>`).join('');
  if (view === 'chat') markRead(key);
}

// ---------- llaves ----------
let keys = [];
const KEY_STATE = { ok: ['ok', 'Funciona'], invalid: ['bad', 'El servicio la rechazó'], unreachable: ['warn', 'No se pudo comprobar'], missing: ['bad', 'Falta cargarla'], saved: ['ok', 'Guardada'] };

async function loadKeys() {
  const res = await fetch('/api/keys');
  if (res.ok) { keys = await res.json(); renderKeys(true); }
}

function renderKeys(force) {
  const box = $('#sys-keys');
  // No borrar lo que Diego esté escribiendo.
  if (!force && [...box.querySelectorAll('input')].some((i) => i.value)) return;
  let group = '';
  box.innerHTML = keys.map((k) => {
    const head = k.group !== group ? `<h3 class="key-group">${esc((group = k.group))}</h3>` : '';
    const st = k.set ? `Cargada ···· ${esc(k.last4 || '')} · ${k.source === 'panel' ? 'desde acá' : 'desde EasyPanel'}` : 'Falta cargarla';
    return `${head}<div class="key-row ${k.set ? 'set' : ''}" data-key="${k.env}">
      <div class="key-info"><b>${esc(k.label)}</b><span class="st"><i class="dot"></i>${st}</span><span class="key-test"></span><div class="how">${markdown(k.help)}</div></div>
      <div class="key-form"><input type="password" autocomplete="off" spellcheck="false" placeholder="${k.set ? 'Pegá una nueva para reemplazarla' : 'Pegá la llave'}">
        <button class="btn sm ok" data-key-save="${k.env}">Guardar</button>
        ${k.set ? `<button class="btn sm" data-key-test="${k.env}">Probar</button>` : ''}
        ${k.source === 'panel' ? `<button class="btn sm no" data-key-del="${k.env}">Quitar</button>` : ''}</div>
    </div>`;
  }).join('');
}

async function keyAction(env, kind) {
  const row = $(`.key-row[data-key="${env}"]`);
  const out = row.querySelector('.key-test');
  if (kind === 'test') {
    out.textContent = 'Probando…'; out.className = 'key-test';
    const r = await fetch('/api/keys/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env }) }).then((x) => x.json());
    const [cls, text] = KEY_STATE[r.state] || KEY_STATE.unreachable;
    out.textContent = r.detail ? `${text} · ${r.detail}` : text; out.className = `key-test ${cls}`;
    return;
  }
  const value = kind === 'del' ? '' : row.querySelector('input').value.trim();
  if (kind === 'save' && !value) { row.querySelector('input').focus(); return; }
  if (kind === 'del' && !confirm('¿Quitar esta llave?')) return;
  const res = await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env, value }) });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) { out.textContent = r.error || 'No se pudo guardar.'; out.className = 'key-test bad'; return; }
  keys = r.keys; renderKeys(true);
  loadStatus(true);
  if (r.restart) {
    alert('Listo. La oficina se reinicia para conectarse con Claude; vuelve en unos segundos.');
    setTimeout(() => location.reload(), 8000);
    return;
  }
  if (value) keyAction(env, 'test');
}

// ---------- ajustes ----------
let settings = null;
let promptAgent = config.agents[0].id;
const dirtyForms = new Set();
const DAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

function applySettings(s) {
  settings = s;
  config.paused = s.paused;
  for (const sa of s.agents) {
    const ca = byId[sa.id];
    if (ca) Object.assign(ca, { enabled: sa.enabled, model: sa.model, effort: sa.effort, maxBudgetUsd: sa.maxBudgetUsd, schedule: sa.schedule });
  }
  invalidate('settings', 'team', 'stats', 'alert', 'system');
}

async function loadSettings() {
  try { applySettings(await fetch('/api/settings').then((r) => r.json())); } catch { /* se reintenta al reconectar */ }
}

const opts = (list, current) => list.map((o) => `<option value="${esc(o.id)}" ${o.id === current ? 'selected' : ''}>${esc(o.label)}</option>`).join('');

function globalHTML() {
  return `<div class="set-row">
    <div><b>Pausa general</b><small>Mientras esté activa, ningún agente arranca solo a su hora. Los trabajos manuales siguen disponibles.</small></div>
    <label class="switch warn"><input type="checkbox" data-pause ${settings.paused ? 'checked' : ''}><span></span><em>${settings.paused ? 'En pausa' : 'Activo'}</em></label>
  </div>`;
}

function agentFormHTML(a) {
  const t = `${String(a.schedule.hour).padStart(2, '0')}:${String(a.schedule.minute).padStart(2, '0')}`;
  const days = DAY_LETTERS.map((l, i) => `<label class="daychip" title="${DAY_NAMES[i]}"><input type="checkbox" name="day" value="${i}" ${a.schedule.days.includes(i) ? 'checked' : ''}><span>${l}</span></label>`).join('');
  const hint = settings.models.find((m) => m.id === a.model)?.hint || '';
  return `<div class="sa-head">
      <span class="avatar sm" style="--c:${a.color}">${esc(a.nombre[0])}</span>
      <div><b>${esc(a.nombre)}</b><small>${esc(a.rol)}</small></div>
      <label class="switch sw"><input type="checkbox" data-agent-toggle="${a.id}" ${a.enabled ? 'checked' : ''}><span></span><em>${a.enabled ? 'Encendido' : 'Apagado'}</em></label>
    </div>
    <div class="sa-grid">
      <label>Modelo<select name="model">${opts(settings.models, a.model)}</select></label>
      <label>Esfuerzo<select name="effort">${opts(settings.efforts, a.effort)}</select></label>
      <label>Tope por corrida (US$)<input name="maxBudgetUsd" type="number" min="0.1" max="50" step="0.1" value="${a.maxBudgetUsd}"></label>
      <label>Hora de arranque<input name="time" type="time" value="${t}"></label>
    </div>
    <div class="note" style="margin:0">${esc(hint)}</div>
    <div class="sa-days"><span>Días</span><div class="daychips">${days}</div></div>
    <div class="sa-foot"><button class="btn ok sm" data-agent-save="${a.id}" disabled>Guardar cambios</button><span class="msg-line"></span></div>`;
}

function editorHTML(kind, id, data) {
  const n = data.versions.length;
  const versions = data.versions.map((v) => `<option value="${v.ts}">${dayTime(v.ts)} · ${v.chars} car. · ${esc(v.preview.slice(0, 48))}…</option>`).join('');
  return `<div class="editor" data-kind="${kind}" data-id="${id}">
    <div class="ed-top"><span class="badge ${data.isDefault ? 'pending' : 'approved'}">${data.isDefault ? 'Original' : 'Personalizado'}</span><span class="note" style="margin:0">${data.text.length} caracteres</span></div>
    <textarea maxlength="20000" spellcheck="true" aria-label="Texto">${esc(data.text)}</textarea>
    <div class="ed-actions">
      <button class="btn ok sm" data-ed="save" disabled>Guardar</button>
      <button class="btn sm" data-ed="reset" ${data.isDefault ? 'disabled' : ''}>Volver al original</button>
      <select data-ed-versions ${n ? '' : 'disabled'} aria-label="Versiones anteriores"><option value="">Versiones anteriores (${n})</option>${versions}</select>
      <button class="btn sm" data-ed="restore" disabled>Restaurar</button>
      <span class="msg-line"></span>
    </div>
  </div>`;
}

RENDER.settings = function renderSettings() {
  if (!settings) return;
  const fill = (key, el, html) => { if (!dirtyForms.has(key)) el.innerHTML = html; };
  fill('global', $('#set-global'), globalHTML());
  const box = $('#set-agents');
  for (const a of settings.agents) {
    let el = document.getElementById(`set-agent-${a.id}`);
    if (!el) {
      el = document.createElement('div');
      el.id = `set-agent-${a.id}`;
      el.className = 'set-agent';
      el.dataset.form = `agent:${a.id}`;
      box.appendChild(el);
    }
    el.style.setProperty('--c', a.color);
    fill(`agent:${a.id}`, el, agentFormHTML(a));
  }
  fill('knowledge', $('#set-knowledge'), editorHTML('knowledge', '', settings.knowledge));
  fill('manual', $('#set-manual'), editorHTML('manual', '', settings.manual));
  $('#set-prompt-chips').innerHTML = settings.agents.map((a) => `<button class="chip ${a.id === promptAgent ? 'on' : ''}" data-prompt-agent="${a.id}">${esc(a.nombre)}</button>`).join('');
  fill('prompt', $('#set-prompt'), editorHTML('prompt', promptAgent, settings.prompts[promptAgent]));
};

function flash(el, text, isError = false) {
  const line = el?.querySelector('.msg-line');
  if (!line) return;
  line.textContent = text;
  line.classList.toggle('err', isError);
  if (!isError) setTimeout(() => { if (line.textContent === text) line.textContent = ''; }, 2500);
}

const settingsView = $('[data-view="ajustes"]');

settingsView.addEventListener('input', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form || e.target.matches('[data-agent-toggle], [data-pause], [data-ed-versions]')) return;
  dirtyForms.add(form.dataset.form);
  form.querySelector('[data-agent-save], [data-ed="save"]')?.removeAttribute('disabled');
});

settingsView.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('[data-pause]')) {
    const { ok, data } = await post('/api/settings/global', { paused: t.checked });
    if (ok) applySettings(data); else { t.checked = !t.checked; alert(data.error || 'No se pudo cambiar.'); }
  } else if (t.matches('[data-agent-toggle]')) {
    const { ok, data } = await post(`/api/settings/agent/${t.dataset.agentToggle}`, { enabled: t.checked });
    if (ok) await loadSettings(); else { t.checked = !t.checked; alert(data.error || 'No se pudo cambiar.'); }
  } else if (t.matches('[data-ed-versions]')) {
    t.closest('.editor').querySelector('[data-ed="restore"]').disabled = !t.value;
  }
});

settingsView.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.promptAgent) {
    if (dirtyForms.has('prompt') && !confirm('Tenés cambios sin guardar en estas instrucciones. ¿Descartarlos?')) return;
    dirtyForms.delete('prompt');
    promptAgent = t.dataset.promptAgent;
    invalidate('settings');
    return;
  }
  if (t.dataset.agentSave) {
    const id = t.dataset.agentSave;
    const form = t.closest('[data-form]');
    const [hour, minute] = form.querySelector('[name="time"]').value.split(':').map(Number);
    const patch = {
      model: form.querySelector('[name="model"]').value,
      effort: form.querySelector('[name="effort"]').value,
      maxBudgetUsd: Number(form.querySelector('[name="maxBudgetUsd"]').value),
      schedule: { days: [...form.querySelectorAll('[name="day"]:checked')].map((x) => Number(x.value)), hour, minute },
    };
    t.disabled = true;
    const { ok, data } = await post(`/api/settings/agent/${id}`, patch);
    if (!ok) { t.disabled = false; flash(form, data.error || 'No se pudo guardar.', true); return; }
    dirtyForms.delete(form.dataset.form);
    await loadSettings();
    flash(document.getElementById(`set-agent-${id}`), 'Guardado ✓');
    return;
  }
  if (t.dataset.ed) {
    const ed = t.closest('.editor');
    const form = t.closest('[data-form]');
    const path = ed.dataset.kind === 'prompt' ? `/api/settings/prompt/${ed.dataset.id}` : `/api/settings/${ed.dataset.kind}`;
    let body;
    if (t.dataset.ed === 'save') body = { text: ed.querySelector('textarea').value };
    else if (t.dataset.ed === 'reset') {
      if (!confirm('Se vuelve al texto original. La versión actual queda en el historial. ¿Seguir?')) return;
      body = { reset: true };
    } else {
      const ts = ed.querySelector('[data-ed-versions]').value;
      if (!ts) return;
      body = { restore: Number(ts) };
    }
    t.disabled = true;
    const { ok, data } = await post(path, body);
    if (!ok) { t.disabled = false; flash(ed, data.error || 'No se pudo guardar.', true); return; }
    dirtyForms.delete(form.dataset.form);
    applySettings(data);
    flash($(`[data-form="${form.dataset.form}"] .editor`), t.dataset.ed === 'save' ? 'Guardado ✓' : 'Listo ✓');
  }
});

// ---------- navegación ----------
function go(v, arg) { location.hash = `#/${v}${arg ? `/${arg}` : ''}`; }

// Menú: 6 secciones con pestañas. Las direcciones de cada pantalla no cambian.
const SECCIONES = { hoy: ['bandeja', 'pendientes'], ventas: ['ventas', 'llamadas', 'cotizaciones', 'clientes', 'prospeccion'], proyectos: ['proyectos', 'desarrollo'], marketing: ['estudio', 'pauta', 'publicacion'], numeros: ['analiticas', 'ceo', 'tesoreria'], equipo: ['oficina', 'chat', 'equipo', 'tablero', 'actividad', 'sistema', 'ajustes'] };
const TAB_VENTAS = ['seguimientos', 'lab', 'playbook'];
const seccionDe = (v) => Object.keys(SECCIONES).find((k) => SECCIONES[k].includes(v)) || 'equipo';
function marcarSubnav(arg) {
  const clave = view === 'ventas' ? (arg === 'seguimientos' ? 'ventas/seguimientos' : arg === 'lab' || arg === 'playbook' ? 'ventas/lab' : 'ventas') : view;
  document.querySelectorAll('#subnavs a').forEach((el) => (el.dataset.sub === clave ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current')));
}
// Cada sección del menú suma los pendientes de sus pestañas (los chats del equipo no cuentan como trabajo pendiente).
function sumarSecciones() {
  document.querySelectorAll('#subnavs .subnav').forEach((n) => {
    const bs = [...n.querySelectorAll('.tbadge:not(.info):not(.ok)')].filter((b) => /^\d+$/.test(b.textContent.trim()));
    const out = document.getElementById(`badge-sec-${n.dataset.sec}`);
    const total = bs.reduce((s, b) => s + Number(b.textContent), 0);
    if (out.textContent !== (total ? String(total) : '')) out.textContent = total ? String(total) : '';
    out.className = `tbadge ${bs.some((b) => b.classList.contains('bad')) ? 'bad' : 'warn'}`;
  });
}
new MutationObserver(sumarSecciones).observe(document.getElementById('subnavs'), { subtree: true, childList: true, characterData: true });

function applyRoute() {
  const [v, arg] = location.hash.replace(/^#\/?/, '').split('/');
  view = VIEWS.includes(v) ? v : 'oficina';
  if (view === 'chat') {
    if (arg && (byId[arg] || isGroupChat(arg))) chatId = arg;
    mobilePane = arg ? 'chat' : 'list';
    $('#chat-view').dataset.pane = mobilePane;
    markRead(chatId);
  }
  $$('.view').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  const sec = seccionDe(view);
  $$('.tab').forEach((el) => (el.dataset.tab === sec ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current')));
  $$('#subnavs .subnav').forEach((n) => { n.hidden = n.dataset.sec !== sec; });
  marcarSubnav(arg);
  // El menú vuelve a la última pestaña que usaste en cada sección.
  const destino = location.hash.replace(/^#\/?/, '').split('/').slice(0, 2).join('/');
  if (view !== 'chat' && !(view === 'cotizaciones' && arg) && !(view === 'clientes' && arg) && !(view === 'desarrollo' && arg)) $(`.tab[data-tab="${sec}"]`)?.setAttribute('href', `#/${destino}`);
  if (view === 'ventas') { try { setVTab(TAB_VENTAS.includes(arg) ? arg : 'clientes'); } catch {} }
  // Al cargar la página la ruta se aplica antes de que existan los paneles: por eso el try.
  if (view !== 'oficina') { try { closeSideChat(); closeSideStudio(); } catch {} }
  if (view !== 'ventas') { try { closeVConv(); } catch {} }
  if (view === 'oficina') requestAnimationFrame(() => office.fit());
  if (view === 'estudio') { loadStudio(); loadLinea(); loadCalendario(); }
  if (view === 'ventas') loadVentas();
  if (view === 'proyectos') loadCresova();
  if (view === 'prospeccion') cargarProspeccion();
  if (view === 'pauta') cargarPauta();
  if (view === 'ajustes') { try { cargarGastoVoz(); cargarWaConexion(); cargarAutonomia(); } catch {} }
  if (NEGOCIO.includes(view) && view !== 'proyectos') cargarNegocio(view, arg);
  if (view === 'desarrollo') {
    try {
      if (arg) { devId = arg; loadDev(); }
      else { devId = null; $('#dev-proyecto').hidden = true; $('#dev-lista').hidden = false; $('#dev-frame').src = 'about:blank'; loadDev(); }
    } catch {} // al cargar la página todavía no existe: se reintenta al final del archivo
  }
  invalidateAll();
}
window.addEventListener('hashchange', applyRoute);

// ---------- chat ----------
async function sendChat() {
  const input = $('#chat-input');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  const url = isGroupChat(chatId) ? `/api/grupo/${deptOf(chatId)}` : `/api/chat/${chatId}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    (isGroupChat(chatId) ? { messages: (model.group ||= []) } : (model.chats[chatId] ||= { messages: [] })).messages.push({ id: crypto.randomUUID(), ts: Date.now(), role: 'sys', text: err.error || 'No se pudo enviar.' });
    input.value = message;
    invalidate('chat', 'chatList');
  }
}
$('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
});

// ---------- entregables ----------
async function openDoc(id) {
  const md = await fetch(`/api/deliverables/${id}`).then((r) => r.text());
  openDocId = id;
  const meta = model.deliverables.find((x) => x.id === id);
  const player = meta?.video ? `<video class="player" controls playsinline preload="metadata" src="/api/estudio/file/${encodeURIComponent(meta.video.video)}/${encodeURIComponent(meta.video.name)}"></video>` : '';
  $('#doc-body').innerHTML = player + markdown(md);
  $('#doc-pdf').href = `/api/doc/${id}.pdf`;
  $('#doc-ver').href = `/api/doc/${id}`;
  $('.doc-actions').hidden = Boolean(meta?.video);
  $('#review-note').value = model.deliverables.find((x) => x.id === id)?.note || '';
  $('#doc-review').hidden = meta?.kind !== 'decision' || meta.status !== 'pending' && meta.status !== 'changes';
  $('#review-options').innerHTML = meta?.kind === 'decision' && meta.status === 'pending' && meta.options?.length
    ? `${meta.question ? `<p class="q">${esc(meta.question)}</p>` : ''}${meta.options.map((o, i) => `<button class="btn ${i === 0 ? 'ok' : ''}" data-doc-answer="${esc(o)}">${esc(o)}</button>`).join('')}` : '';
  renderReviewStatus();
  $('#doc').showModal();
  if (meta?.kind === 'informe' && meta.status === 'pending') review(id, { status: 'read' });
}

function renderReviewStatus() {
  const d = model.deliverables.find((x) => x.id === openDocId);
  if (d) $('#review-status').innerHTML = `Estado: <span class="badge ${d.status}">${REVIEW[d.status]}</span> · de ${esc(byId[d.agentId]?.nombre)}`;
}

// ---------- eventos del servidor ----------
async function loadStatus(refresh = false) {
  try { status = await fetch(`/api/status${refresh ? '?refresh=1' : ''}`).then((r) => r.json()); } catch { return; }
  invalidate('system', 'team', 'stats');
  renderPresupuesto();
}

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    switch (ev.type) {
      case 'snapshot': model = { chats: {}, ...ev.state }; for (const [id, a] of Object.entries(model.agents)) office.setAgent(id, a); invalidateAll(); fetch('/api/reunion').then((r) => r.json()).then((j) => office.setReunion?.(j.reunion)).catch(() => {}); break;
      case 'reunion': office.setReunion?.(ev.reunion); break;
      case 'agent': model.agents[ev.id] = ev.agent; office.setAgent(ev.id, ev.agent); invalidate('stats', 'team', 'chat', 'chatList', 'side'); break;
      case 'log': model.log.push(ev.entry); invalidate('ticker', 'activity'); break;
      case 'cupo': if (status) { status.cupo = ev.cupo; invalidate('stats', 'studio'); renderPresupuesto(); } break;
      case 'linea': linea = ev.linea; invalidate('studio'); break;
      case 'calendario': calendario = ev.calendario; invalidate('studio'); break;
      case 'memoria': memoria = ev.memoria; renderMemoria(); break;
      case 'ventas': onVentasEvent(ev); break;
      case 'proyecto': case 'proyecto-msg': case 'proyecto-trabajo': try { onDevEvent(ev); } catch {} break;
      case 'costs': model.costs = ev.costs; invalidate('stats', 'team', 'system'); break;
      case 'approval': model.approvals.push(ev.approval); invalidate('stats', 'alert', 'inbox', 'side'); break;
      case 'approval-resolved': model.approvals = model.approvals.filter((x) => x.id !== ev.id); invalidate('stats', 'alert', 'inbox', 'side'); break;
      case 'deliverable': model.deliverables.push(ev.deliverable); invalidate('stats', 'inbox', 'team', 'side'); if (ev.deliverable.kind === 'video' || ev.deliverable.kind === 'informe') loadStudio(); break;
      case 'deliverable-updated': {
        const i = model.deliverables.findIndex((x) => x.id === ev.deliverable.id);
        if (i >= 0) model.deliverables[i] = ev.deliverable;
        const v = studioVideos.find((x) => x.id === ev.deliverable.id);
        if (v) Object.assign(v, ev.deliverable);
        invalidate('stats', 'inbox', 'team', 'studio', 'sideStudio', 'side');
        renderReviewStatus();
        break;
      }
      case 'chat': (model.chats[ev.agentId] ||= { messages: [] }).messages.push(ev.message); invalidate('chat', 'chatList', 'side'); break;
      case 'handoff': office.handoff(ev.from, ev.to); break;
      case 'settings': applySettings(ev.settings); break;
      case 'task': {
        const list = (model.tasks ||= []);
        const i = list.findIndex((t) => t.id === ev.task.id);
        if (i >= 0) list[i] = ev.task; else list.push(ev.task);
        invalidate('board');
        if (openTaskId === ev.task.id) renderTaskDetail();
        break;
      }
      case 'group': (model.group ||= []).push(ev.message); invalidate('chat', 'chatList', 'side'); break;
      case 'group-busy': if (ev.busy) busyDepts.add(ev.dept); else busyDepts.delete(ev.dept); invalidate('chat', 'side'); break;
      case 'render': {
        const i = renders.findIndex((r) => r.id === ev.job.id);
        if (i >= 0) renders[i] = ev.job; else renders.unshift(ev.job);
        invalidate('system', 'studio');
        break;
      }
    }
  };
  es.onerror = () => { es.close(); setTimeout(connect, 3000); };
}

// ---------- acciones ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-doc], [data-go]');
  if (!t) return;
  const d = t.dataset;
  if (d.go) go(d.go);
  if (d.chat) go('chat', d.chat);
  if (d.encargo) openEncargo(d.encargo);
  if (d.task) openTask(d.task);
  if (d.keySave) keyAction(d.keySave, 'save');
  if (d.keyTest) keyAction(d.keyTest, 'test');
  if (d.keyDel) keyAction(d.keyDel, 'del');
  if (d.taskAct) taskAction(d.taskAct);
  if (d.back !== undefined) go('chat');
  if (d.run) { t.disabled = true; await fetch(`/api/run/${d.run}`, { method: 'POST' }); }
  if (d.stop) { t.disabled = true; await fetch(`/api/stop/${d.stop}`, { method: 'POST' }); }
  if (d.inv) { invFilter = d.inv; invalidate('inbox'); }
  if (d.readone) {
    await fetch(`/api/deliverables/${d.readone}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'read' }) }).catch(() => {});
    return;
  }
  if (d.readall) {
    const ids = model.deliverables.filter((x) => x.kind === 'informe' && x.status === 'pending').map((x) => x.id);
    for (const id of ids) await fetch(`/api/deliverables/${id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'read' }) }).catch(() => {});
    return;
  }
  if (d.vwaLive) {
    const on = d.vwaLive === '1';
    if (on && !confirm('El vendedor va a responder de verdad a los clientes en WhatsApp. ¿Encender?')) return;
    await vpost('/whatsapp/vivo', { on }); loadWa();
  }
  if (d.vwaHook) { const r = await vpost('/whatsapp/conectar', {}); if (r) alert('Listo: Evolution manda los mensajes a la oficina.'); loadWa(); }
  if (d.vwaPause) { await vpost(`/conv/${d.vwaPause}/pausar`, {}); loadVConv(); }
  if (d.vwaResume) { await vpost(`/conv/${d.vwaResume}/reactivar`, {}); loadVConv(); }
  if (d.vnew) {
    const titulo = $('#v-ad').value.trim();
    const conv = await vpost('/nueva', titulo ? { anuncio: { titulo }, title: `Prueba · ${titulo.slice(0, 30)}` } : {});
    if (conv?.id) { vConvId = conv.id; vConv = conv; $('#v-drawer').hidden = false; renderVentas(); $('#v-input').focus(); }
  }
  if (d.vconv) { openVConv(d.vconv); }
  if (d.vcloseConv) closeVConv();
  if (d.vtab) setVTab(d.vtab);
  if (d.vfiltro) { vFiltro = d.vfiltro; renderBoard(); }
  if (d.vsegYa) { t.disabled = true; const r = await vpost(`/conv/${d.vsegYa}/seguimiento/ya`, {}); t.disabled = false; if (r && !r.ok) alert(r.motivo || 'No se envió.'); }
  if (d.vsegCancel) { if (confirm('¿Cancelar los seguimientos de este cliente?')) await vpost(`/conv/${d.vsegCancel}/seguimiento/cancelar`, {}); }
  if (d.vpasoAdd) { readPasos(); vSeg.pasos.push({ horas: (vSeg.pasos.at(-1)?.horas || 24) * 2, activo: true, pista: '' }); renderPasos(); }
  if (d.vpasoDel != null && d.vpasoDel !== '') { readPasos(); vSeg.pasos.splice(Number(d.vpasoDel), 1); renderPasos(); }
  if (d.vpasosSave) { readPasos(); const r = await vpost('/seguimientos', { pasos: vSeg.pasos }); if (r) { vSeg = r; renderPasos(); $('#v-pasos-msg').textContent = 'Guardado. El vendedor ya usa estos pasos.'; } }
  if (d.vcase) {
    t.disabled = true;
    const conv = await vpost(`/caso/${d.vcase}`, { turns: 6 });
    t.disabled = false;
    if (conv?.id) { vConvId = conv.id; vConv = conv; $('#v-drawer').hidden = false; renderVentas(); }
  }
  if (d.vdel) { if (confirm('¿Borrar esta conversación de prueba?')) { await vpost(`/conv/${d.vdel}/borrar`, {}); if (vConvId === d.vdel) closeVConv(); loadVentas(); } }
  if (d.vfix != null && d.vfix !== '') {
    const box = t.closest('.vmsg');
    box.querySelector('.vfix').hidden = !box.querySelector('.vfix').hidden;
  }
  if (d.vfixSave != null && d.vfixSave !== '') {
    const box = t.closest('.vmsg');
    const corregida = box.querySelector('.vfix-text').value.trim();
    if (!corregida) return box.querySelector('.vfix-text').focus();
    const ok = await vpost(`/conv/${vConvId}/corregir`, { index: Number(d.vfixSave), corregida, nota: box.querySelector('.vfix-note').value.trim() });
    if (ok) loadVConv();
  }
  if (d.vcuentaSubir) $('#v-cuenta-file').click();
  if (d.vcuentaQuitar) { await fetch('/api/ventas/cuenta-imagen', { method: 'DELETE' }); cargarImgCuenta(); }
  if (d.vcuenta) {
    const ok = await vpost('/config', { cuentaAnticipo: $('#v-cuenta').value });
    $('#v-cuenta-msg').textContent = ok ? 'Guardada: el vendedor ya la usa.' : 'No se pudo guardar.';
  }
  if (d.vpb) {
    const ok = await vpost('/playbook', { texto: $('#v-playbook').value, resumen: 'Editado por Diego' });
    $('#v-pb-msg').textContent = ok ? 'Guardado. El vendedor ya usa esta versión.' : 'No se pudo guardar.';
  }
  if (d.vrule) { await vpost(`/regla/${d.vrule}`, { activa: d.vruleOn === '1' }); loadVentas(); }
  if (d.cupoRetomar) { if (confirm('¿Retomar ya? Usalo si subiste de plan o ya volvió el cupo.')) { await fetch('/api/cupo/retomar', { method: 'POST' }); loadStatus(); } return; }
  if (d.memDel) { await fetch(`/api/memoria/${d.memDel}/borrar`, { method: 'POST' }); loadMemoria(); }
  if (d.mention) {
    const box = $('#chat-input');
    box.value = `${box.value.replace(/\s*$/, '')}${box.value.trim() ? ' ' : ''}@${d.mention} `;
    box.focus();
  }
  if (d.calRevisar) {
    t.disabled = true;
    const res = await fetch('/api/estudio/calendario/revisar', { method: 'POST' });
    if (res.ok) calendario = await res.json(); else alert((await res.json().catch(() => ({}))).error || 'No se pudo revisar.');
    t.disabled = false;
    invalidate('studio');
  }
  if (d.openStudio) openSideStudio();
  if (d.docAnswer && openDocId) {
    t.closest('.actions').querySelectorAll('button').forEach((b) => (b.disabled = true));
    const ok = await review(openDocId, { status: 'approved', answer: d.docAnswer, note: $('#review-note').value.trim() });
    if (ok) $('#doc').close(); else t.closest('.actions').querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
  if (d.sideClose === 'chat') closeSideChat();
  if (d.sideClose === 'studio') closeSideStudio();
  if (d.sideMention) {
    const box = $('#side-chat-input');
    box.value = `${box.value.replace(/\s*$/, '')}${box.value.trim() ? ' ' : ''}@${d.sideMention} `;
    box.focus();
  }
  if (d.ahorro) {
    await fetch('/api/cupo/ahorro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: d.ahorro === '1' }) });
    await loadStatus?.();
    invalidate('studio');
  }
  if (d.lineaToggle) {
    if (!linea.enabled && !confirm('La línea va a usar tu cupo de Claude cuando haya: Mateo escribe lotes, Nico elige y Lucía produce videos hasta llenar la reserva. ¿Encender?')) return;
    setLinea({ enabled: !linea.enabled });
  }
  if (d.lineaQuitar) { await fetch(`/api/linea/quitar/${d.lineaQuitar}`, { method: 'POST' }); loadLinea(); }
  if (d.sfilter) { studioFilter = d.sfilter; invalidate('studio'); }
  if (d.dpanel != null && t.closest('.decision')) {
    const box = t.closest('.decision');
    box.querySelectorAll('.dec-panel').forEach((p) => (p.hidden = p.dataset.panel !== d.dpanel));
    box.querySelector('.dec-main').hidden = Boolean(d.dpanel);
    box.querySelector(`.dec-panel[data-panel="${d.dpanel}"] textarea`)?.focus();
    return;
  }
  if (d.dchip) {
    const ta = t.closest('.dec-panel').querySelector('textarea');
    ta.value = `${ta.value.trim()}${ta.value.trim() ? '. ' : ''}${d.dchip}`;
    ta.focus();
    return;
  }
  if (d.dno) {
    const box = t.closest('.decision');
    const note = box.querySelector('.note-no').value.trim();
    box.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const ok = await review(box.dataset.id, { status: 'discarded', note, veto: d.dno === 'veto' });
    if (!ok) box.querySelectorAll('button').forEach((b) => (b.disabled = false));
    return;
  }
  if (d.vreply) {
    const box = t.closest('.decision');
    const area = box.querySelector('.reply');
    const texto = area.value.trim();
    if (!texto) { area.focus(); area.classList.add('need'); return; }
    t.disabled = true;
    const res = await fetch(`/api/ventas/conv/${d.vreply}/enviar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { t.disabled = false; alert(j.error || 'No se pudo enviar.'); return; }
    await review(box.dataset.id, { status: 'approved', answer: 'Ya le escribí', note: 'Respondido desde la Bandeja' });
    return;
  }
  if ((d.answer || d.dreview) && t.closest('.decision')) {
    const box = t.closest('.decision');
    const noteBox = box.querySelector('.note');
    const note = noteBox.value.trim();
    if (d.dreview === 'changes' && !note) { noteBox.focus(); noteBox.placeholder = 'Contale qué querés que cambie…'; noteBox.classList.add('need'); return; }
    box.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const cuandoIn = box.querySelector('.dev-cuando');
    const cuando = cuandoIn?.value ? new Date(cuandoIn.value).getTime() : null;
    const ok = await review(box.dataset.id, d.answer ? { status: 'approved', answer: d.answer, note, ...(cuando ? { cuando } : {}) } : { status: d.dreview, note, rerun: true });
    // Confirma qué pasó con la demo: si sale programada, dice cuándo (antes la tarjeta desaparecía sin decir nada).
    if (ok && d.answer && /^s[ií]/i.test(d.answer) && box.dataset.devp) {
      setTimeout(async () => {
        const p = await fetch(`/api/proyectos/${box.dataset.devp}`).then((r) => r.json()).catch(() => null);
        if (p) alert(p.envioProgramado ? `✅ Listo: la demo de ${p.nombre} sale por WhatsApp el ${dayTime(p.envioProgramado)}.\nPodés cambiarlo o enviarla ya desde Desarrollo.` : p.enviada ? `✅ La demo de ${p.nombre} ya salió por WhatsApp.` : `✅ Recibido: se está enviando la demo de ${p.nombre}.`);
      }, 600);
    }
    if (!ok) box.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
  if (d.vreview) {
    const card = t.closest('.vcard');
    const noteBox = card.querySelector('.note');
    const note = noteBox?.value.trim() || '';
    if (d.vreview === 'changes' && !note) { noteBox.focus(); noteBox.placeholder = 'Contale a Lucía qué cambiar: ella lo corrige y te manda la versión nueva.'; noteBox.classList.add('need'); return; }
    if (d.vreview === 'discarded' && !confirm('¿Descartar este video? No se publica.')) return;
    if (d.vreview === 'approved' && card.querySelector('.p-title') && (!card.querySelector('.p-title')?.value.trim() || !card.querySelector('.p-caption')?.value.trim())) {
      const e2 = card.querySelector('.verr'); e2.hidden = false; e2.textContent = 'Completá el título y el texto de la publicación antes de aprobar.'; return;
    }
    card.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const ok = await review(card.dataset.id, { status: d.vreview, note, rerun: true });
    if (ok && d.vreview === 'approved' && card.querySelector('.p-title')) await publishCard(card);
    else if (ok) loadStudio();
    card.querySelectorAll('button').forEach((b) => (b.disabled = false));
    if (ok && card.closest('#vbox')) nextAfterReview(card.dataset.id);
  }
  if (d.vtipo) {
    const card = t.closest('.vcard');
    t.disabled = true;
    const res = await fetch(`/api/estudio/tipo/${card.dataset.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: d.vtipo }) });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'No se pudo cambiar el tipo.');
    loadStudio();
  }
  if (d.vopen) openVideo(d.vopen, t.closest('#side-studio') ? sideIds : t.closest('#vbox') ? vboxIds : gridIds);
  if (d.vnav) stepVideo(Number(d.vnav));
  if (d.vclose) closeVideo();
  if (d.vpublish) {
    const card = t.closest('.vcard');
    t.disabled = true;
    await publishCard(card);
    t.disabled = false;
  }
  if (d.vunpublish) {
    const card = t.closest('.vcard');
    if (!confirm('¿Cancelar esta publicación programada?')) return;
    t.disabled = true;
    const res = await fetch(`/api/estudio/unpublish/${card.dataset.id}`, { method: 'POST' });
    if (res.ok) loadStudio(); else t.disabled = false;
  }
  if (d.actAgent) { actAgent = d.actAgent; invalidate('activity'); }
  if (d.actKind) { actKind = d.actKind; invalidate('activity'); }
  if (d.decide) {
    const box = t.closest('.approval');
    box.querySelectorAll('button').forEach((b) => (b.disabled = true));
    await fetch(`/api/approvals/${box.dataset.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: d.decide, note: box.querySelector('input').value, todas: Boolean(d.todas) }),
    });
  }
  if (d.doc) openDoc(d.doc);
  if (d.review && openDocId) {
    const st = d.review;
    const note = $('#review-note').value.trim();
    if (st === 'changes' && !note) { $('#review-note').focus(); $('#review-note').placeholder = 'Contale qué querés que cambie…'; return; }
    const btns = t.closest('.actions').querySelectorAll('button');
    btns.forEach((b) => (b.disabled = true));
    await fetch(`/api/deliverables/${openDocId}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: st, note, rerun: $('#review-rerun').checked }),
    });
    btns.forEach((b) => (b.disabled = false));
    $('#doc').close();
  }
});

$('#status-refresh').addEventListener('click', () => loadStatus(true));

// Markdown mínimo para leer entregables y respuestas (títulos, tablas, listas, negritas).
function markdown(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/_(.+?)_/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
      out.push(`<table>${body.map((r, k) => `<tr>${cells(r).map((c) => (k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`).join('')}</table>`);
    } else if (/^#{1,3} /.test(l)) {
      const n = l.match(/^#+/)[0].length;
      out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`);
    } else if (/^\s*([-*]|\d+\.) /.test(l)) {
      // Las viñetas seguidas se agrupan en una lista (con su espacio arriba y abajo).
      const ordered = /^\s*\d+\. /.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*([-*]|\d+\.) /, ''))}</li>`);
      i--;
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
    } else if (l.trim()) {
      out.push(`<p>${inline(l)}</p>`);
    }
  }
  return out.join('\n');
}

applyRoute();
connect();
loadSettings();
loadStatus();
loadKeys();
loadRenders();
loadStudio();
loadLinea();
setInterval(loadStatus, 60_000);
setInterval(() => invalidate('team', 'system'), 30_000);

// Ajustes de la línea: se guardan al cambiar el número.
document.addEventListener('change', (e) => {
  const f = e.target.closest('[data-linea-field]');
  if (f) setLinea({ [f.dataset.lineaField]: Number(f.value) });
});

// ---------- Ventas: probador del vendedor ----------
let vSummary = null;
let vConvId = null;
let vConv = null;
let vModels = null;
let vWa = null;
async function loadWa() {
  try { vWa = await fetch('/api/ventas/whatsapp').then((r) => r.json()); } catch { vWa = null; }
  renderVentas();
}

function cargarImgCuenta() {
  const img = $('#v-cuenta-img');
  img.onload = () => { img.hidden = false; $('#v-cuenta-img-vacia').hidden = true; };
  img.onerror = () => { img.hidden = true; $('#v-cuenta-img-vacia').hidden = false; };
  img.src = `/api/ventas/cuenta-imagen?t=${Date.now()}`;
}
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'v-cuenta-file' || !e.target.files?.[0]) return;
  const f = e.target.files[0];
  $('#v-cuenta-img-msg').textContent = 'Subiendo…';
  const base64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
  const res = await fetch('/api/ventas/cuenta-imagen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64 }) });
  $('#v-cuenta-img-msg').textContent = res.ok ? 'Lista: sale con el mensaje del monto.' : (await res.json().catch(() => ({}))).error || 'No se pudo subir.';
  e.target.value = '';
  cargarImgCuenta();
});

async function vpost(path, body) {
  const res = await fetch(`/api/ventas${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { alert(j.error || 'No se pudo.'); return null; }
  return j;
}

async function loadVentas() {
  try { vSummary = await fetch('/api/ventas').then((r) => r.json()); } catch { return; }
  if (!vModels) {
    vModels = [];
    fetch('/api/ventas/modelos').then((r) => r.json()).then((list) => { vModels = Array.isArray(list) ? list : []; renderVentas(); }).catch(() => {});
    fetch('/api/ventas/playbook').then((r) => r.json()).then((p) => { $('#v-playbook').value = p.texto || ''; });
    $('#v-cuenta').value = vSummary?.config?.cuentaAnticipo || '';
    cargarImgCuenta();
  }
  loadWa();
  await loadVConv();
}

async function loadVConv() {
  vConv = vConvId ? await fetch(`/api/ventas/conv/${vConvId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  renderVentas();
}

function onVentasEvent(ev) {
  if (ev.summary) vSummary = { ...vSummary, ...ev.summary };
  if (ev.conv && ev.conv.id === vConvId) vConv = ev.conv;
  if (view === 'ventas') renderVentas();
}

const money = (n) => `$${Number(n || 0).toFixed(n < 0.01 ? 4 : 3)}`;

function renderVentas() {
  if (!vSummary) return;
  const cfg = vSummary.config;
  const sel = $('#v-model');
  const opts = (vModels || []).length ? vModels : [{ id: cfg.model, name: cfg.model }];
  if (sel.dataset.n !== String(opts.length) || sel.value !== cfg.model) {
    sel.innerHTML = opts.map((m) => `<option value="${esc(m.id)}">${esc(m.id)}${m.in != null && vModels.length ? ` · $${m.in.toFixed(2)}/$${m.out.toFixed(2)} por M` : ''}</option>`).join('');
    if (!opts.some((m) => m.id === cfg.model)) sel.insertAdjacentHTML('afterbegin', `<option value="${esc(cfg.model)}">${esc(cfg.model)}</option>`);
    sel.value = cfg.model;
    sel.dataset.n = String(opts.length);
  }
  if (document.activeElement !== $('#v-temp')) $('#v-temp').value = cfg.temperature;
  $('#v-motor').value = cfg.motor === 'openrouter' ? 'openrouter' : 'plan';
  $('#v-cost').textContent = `Gastado en pruebas: ${money(vSummary.cost)}`;

  const item = (c) => `<div class="v-item ${c.id === vConvId ? 'on' : ''}"><button class="v-open" data-vconv="${c.id}">${esc(c.title)}<small>${c.n} mensajes${c.busy ? ' · respondiendo…' : ''}${c.estado?.demo ? ' · ✅ demo' : c.estado?.humano ? ' · 🙋 persona' : c.estado?.noCalificado ? ' · ✖ no califica' : ''}</small></button><button class="link" data-vdel="${c.id}">✕</button></div>`;
  renderBoard();
  renderAgenda();
  $('#v-convs').innerHTML = vSummary.convs.filter((x) => x.kind !== 'whatsapp').map(item).join('') || '<p class="note">Todavía no hay pruebas.</p>';
  const live = vWa?.live;
  $('#v-live').innerHTML = `<div class="v-live-row">
      <span class="v-dot ${live ? 'on' : ''}"></span>
      <div><b>${live ? 'El vendedor está respondiendo en WhatsApp' : vWa?.autoStart ? 'El vendedor se enciende solo apenas funcione la llave de OpenRouter' : 'El vendedor está apagado: no responde ni hace seguimientos'}</b>
      <small>WhatsApp: ${esc(vWa?.state === 'open' ? 'conectado' : vWa?.state || '…')} · solo atiende contactos nuevos (${vWa?.existentes ?? 0} existentes quedan fuera) · espera 13 s para juntar mensajes · se pausa si una persona escribe desde el teléfono</small>
      ${vWa?.modelo && vWa.modelo.state !== 'ok' ? `<small class="v-keyerr">⚠ OpenRouter: ${esc(vWa.modelo.detail || vWa.modelo.state)}</small>` : ''}${vWa && vWa.state !== 'open' ? '<small class="v-keyerr">🔴 WhatsApp desconectado: no entran mensajes. <a href="#/ajustes">Reconectalo en Ajustes</a></small>' : ''}</div>
      <button class="btn" data-vwa-hook="1">Reconectar webhook</button>
      <button class="btn ${live ? 'no' : 'ok'}" data-vwa-live="${live ? '0' : '1'}">${live ? 'Apagar' : 'Encender'}</button>
    </div>`;
  const cases = vSummary.cases || [];
  $('#v-cases-n').textContent = cases.length ? `(${cases.length})` : '';
  $('#v-cases').innerHTML = cases.length ? cases.map((c) => `<button class="v-case" data-vcase="${c.id}" title="Reproduce los primeros 6 turnos del cliente">${c.demo ? '✅' : '·'} ${esc(c.empresa || 'Sin nombre')}<small>${c.fecha} · ${c.n} mensajes${c.anuncio ? ` · ${esc(c.anuncio.slice(0, 30))}` : ''}</small></button>`).join('') : '<p class="note">Sin casos cargados.</p>';

  const c = vConv;
  $('#v-head').innerHTML = c ? `<div><b>${esc(c.title)}</b>${c.anuncio ? `<small>Anuncio: ${esc(c.anuncio.titulo || '')}</small>` : ''}${c.pausa ? `<small class="v-paused">⏸ Pausado: ${esc(c.pausa.motivo)}</small>` : ''}</div>
    ${c.kind === 'whatsapp' ? `<button class="btn sm ${c.pausa ? 'ok' : 'no'}" data-vwa-${c.pausa ? 'resume' : 'pause'}="${c.id}">${c.pausa ? 'Reactivar bot' : 'Pausar bot'}</button>${c.pausa && !c.pausa.total && !c.pausa.existente ? `<button class="btn sm no" data-vwa-pause="${c.id}" title="Pausa total: nada automático le escribe hasta reactivar">No escribirle</button>` : ''}` : ''}` : '<b>Elegí o creá una conversación</b>';
  $('#v-msgs').innerHTML = c ? c.msgs.map((m, i) => {
    if (m.role === 'cliente') return msgCliente(c, m);
    if (m.role === 'sistema') return `<div class="vmsg sys">${esc(m.text)}</div>`;
    if (m.role === 'equipo') return `<div class="vmsg bot team"><div class="vb">${esc(m.text)}</div><div class="vmeta">${m.desdeOficina ? 'Escrito desde la oficina' : 'Escrito por una persona desde el teléfono'}${entregaTxt(m)}</div></div>`;
    const tools = (m.meta?.tools || []).map((t) => `<span class="vtool" title="${esc(JSON.stringify(t.args))}">${esc(t.name)}${t.result?.error ? ' ⚠' : ''}</span>`).join('');
    return `<div class="vmsg bot"><div class="vb">${esc(m.text).replace(/\*(.+?)\*/g, '<b>$1</b>')}</div>
      <div class="vmeta">${esc(m.meta?.model || '')} · ${money(m.meta?.cost)}${entregaTxt(m)} ${tools}<button class="link" data-vfix="${i}">Corregir</button></div>
      ${m.original ? `<details class="vorig"><summary>Natally había respondido</summary><p>${esc(m.original)}</p></details>` : ''}
      ${m.corregida ? `<p class="vcorr">Tu corrección: ${esc(m.corregida)}</p>` : ''}
      <div class="vfix" hidden><textarea class="vfix-text" rows="3" placeholder="Cómo debió responder"></textarea><input class="vfix-note" placeholder="Por qué (opcional)"><button class="btn ok sm" data-vfix-save="${i}">Guardar corrección</button></div>
    </div>`;
  }).join('') + (c.busy ? '<div class="vmsg bot"><div class="vb typing">escribiendo…</div></div>' : '') : '';
  const box = $('#v-msgs'); box.scrollTop = box.scrollHeight;
  $('#v-input').disabled = !c || c.busy;
  $('#v-input').placeholder = c?.kind === 'whatsapp' ? 'Escribile al cliente como Diego (el bot se pausa en este chat)…' : 'Escribí como cliente…';
  // API oficial: con la ventana de 24 h cerrada, en vez del texto libre aparece el selector de plantillas.
  const ultCli = c ? [...c.msgs].reverse().find((m) => m.role === 'cliente' && !m.previo) : null;
  const cerrada = Boolean(vWa?.ycloud && c?.kind === 'whatsapp' && !c.inst && (!ultCli || Date.now() - ultCli.ts > 23.75 * 3600e3));
  $('#v-plantilla').hidden = !cerrada;
  $('#v-form').hidden = cerrada;
  if (cerrada) cargarPlantillasSel();

  const st = c?.estado || {};
  const datos = Object.entries(c?.contacto || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('#v-state').innerHTML = c ? `<h3>Estado</h3>
    <dl class="vdl"><dt>Precio dado</dt><dd>${st.precioDado ? 'Sí' : 'No'}</dd><dt>Demo ofrecida</dt><dd>${st.ofertasDemo || 0} veces</dd>
    <dt>Pasó a demo</dt><dd>${st.demo ? `✅ ${esc(st.demo)}` : '—'}</dd><dt>Pasó a persona</dt><dd>${st.humano ? esc(st.humano) : '—'}</dd>
    <dt>No califica</dt><dd>${st.noCalificado ? esc(st.noCalificado) : '—'}</dd></dl>
    ${c.kind === 'whatsapp' ? segBox(c) : ''}
    <h3>Datos guardados</h3><dl class="vdl">${datos || '<dd>Nada todavía</dd>'}</dl>
    ${st.resumenDemo ? `<h3>Resumen para la cotización</h3><p class="note">${esc(st.resumenDemo)}</p>` : ''}
    ${c.kind === 'whatsapp' ? ventaBox(c) : ''}` : '';

  $('#v-pb-info').textContent = vSummary.playbookVersions ? `· ${vSummary.playbookVersions} versiones` : '· versión de Velforce';
  $('#v-rules').innerHTML = vSummary.rules.length ? vSummary.rules.slice().reverse().map((r) => `<div class="row-item vrule ${r.activa ? '' : 'off'}"><span class="t">[${esc(r.categoria)}] ${esc(r.regla)}</span><small>${esc(r.fuente)}</small><button class="link" data-vrule="${r.id}" data-vrule-on="${r.activa ? '0' : '1'}">${r.activa ? 'Desactivar' : 'Activar'}</button></div>`).join('')
    : `<div class="empty">Todavía no hay reglas. Cuando corregís una respuesta, Martín (Gerente de Ventas) la convierte en regla en su próxima revisión. Correcciones guardadas: ${vSummary.feedback}.</div>`;
}

// Historial de la venta y resultado (ganado / perdido), en el panel del cliente.
const EVENTO = { demo_aceptada: '✅ Aceptó la demo', demo_lista: '🌐 Demo lista para aprobar', cambios_pedidos: '✏️ Pidió cambios', cambios_listos: '🔁 Cambios listos', demo_programada: '📅 Envío programado', envio_cancelado: '✖ Envío cancelado', demo_enviada: '📲 Demo enviada', seguimiento_demo: '⏰ Seguimiento', respondio_demo: '💬 Respondió', recontacto: '📞 Recontacto', ganado: '🏆 Ganado', perdido: '✖ Perdido', resultado: '↺ Resultado' };
function ventaBox(c) {
  const st = c.estado || {};
  const ev = [...(c.eventos || [])];
  // Clientes anteriores al historial: se arma con lo que ya se sabe.
  if (!ev.some((e) => e.tipo === 'demo_enviada') && st.demoEnviada) ev.push({ ts: st.demoEnviada, tipo: 'demo_enviada', texto: st.demoUrl || '' });
  if (!ev.some((e) => e.tipo === 'respondio_demo') && st.demoEnviada) { const r = (c.msgs || []).find((m) => m.role === 'cliente' && !m.auto && m.ts > st.demoEnviada); if (r) ev.push({ ts: r.ts, tipo: 'respondio_demo', texto: String(r.text).slice(0, 120) }); }
  ev.sort((a, b) => a.ts - b.ts);
  const res = st.resultado;
  return `<h3>Venta</h3>
    ${res ? `<p class="note">${res.tipo === 'ganado' ? '🏆 <b>Ganada</b>' : '✖ <b>Perdida</b>'} · ${esc(dayTime(res.ts))}${res.nota ? ` · ${esc(res.nota)}` : ''}</p>` : ''}
    <div class="actions">${res ? '<button class="btn sm" data-vresultado="">↺ Quitar resultado</button>' : '<button class="btn sm ok" data-vresultado="ganado">🏆 Ganada</button><button class="btn sm no" data-vresultado="perdido">✖ Perdida</button>'}</div>
    <h3>Historial</h3>
    ${ev.length ? `<ol class="v-hist">${ev.slice(-20).reverse().map((e) => `<li><b>${esc(EVENTO[e.tipo] || e.tipo)}</b> <small>${esc(dayTime(e.ts))}</small>${e.texto ? `<br><small>${esc(e.texto)}</small>` : ''}</li>`).join('')}</ol>` : '<p class="note">Todavía no hay movimientos registrados.</p>'}`;
}
$('#v-state').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-vresultado]');
  if (!b || !vConvId) return;
  const tipo = b.dataset.vresultado;
  const nota = tipo ? prompt(tipo === 'ganado' ? '¿Qué compró o cuánto? (opcional)' : '¿Por qué se perdió? (opcional)') : '';
  if (nota === null) return;
  await vpost(`/conv/${vConvId}/resultado`, { tipo, nota });
  loadVConv();
});

let plantillasVen = null;
async function cargarPlantillasSel() {
  if (!plantillasVen) plantillasVen = await fetch('/api/ventas/ycloud/plantillas').then((r) => r.json()).catch(() => []);
  const ok = (plantillasVen || []).filter((p) => p.estado === 'APPROVED');
  $('#v-plantilla-sel').innerHTML = ok.length ? ok.map((p) => `<option value="${esc(p.name)}" title="${esc(p.body)}">${esc(p.name.replace('cresova_', '').replace(/_/g, ' '))}</option>`).join('') : '<option value="">Todavía no hay plantillas aprobadas</option>';
}
$('#v-plantilla-btn').addEventListener('click', async () => {
  const name = $('#v-plantilla-sel').value;
  if (!name || !vConvId) return;
  const p = (plantillasVen || []).find((x) => x.name === name);
  if (!confirm(`Se le manda esta plantilla por WhatsApp:\n\n${p?.body || name}\n\n¿Enviar?`)) return;
  const r = await vpost(`/conv/${vConvId}/plantilla`, { name });
  if (r) window.toast?.('Plantilla enviada', 'ok');
  loadVConv();
});
$('#v-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('#v-input').value.trim();
  if (!texto || !vConvId) return;
  $('#v-input').value = '';
  if (vConv?.kind === 'whatsapp') {
    if (!confirm('Esto le llega al cliente por WhatsApp y pausa al bot en este chat. ¿Enviar?')) { $('#v-input').value = texto; return; }
    await vpost(`/conv/${vConvId}/enviar`, { texto });
    return loadVConv();
  }
  if (vConv) { vConv.msgs.push({ role: 'cliente', text: texto }); vConv.busy = true; renderVentas(); }
  await vpost(`/conv/${vConvId}/msg`, { texto });
});
$('#v-model').addEventListener('change', (e) => vpost('/config', { model: e.target.value }).then(loadVentas));
$('#v-motor').addEventListener('change', (e) => vpost('/config', { motor: e.target.value }).then(loadVentas));
$('#v-temp').addEventListener('change', (e) => vpost('/config', { temperature: Number(e.target.value) }).then(loadVentas));

// ---------- memoria del equipo ----------
let memoria = [];
const PARA = { todos: 'Todos', marketing: 'Marketing', ventas: 'Ventas', vendedor: 'Vendedor (WhatsApp)' };
async function loadMemoria() {
  try { memoria = await fetch('/api/memoria').then((r) => r.json()); } catch { return; }
  renderMemoria();
}
function renderMemoria() {
  const box = $('#mem-list');
  if (!box) return;
  box.innerHTML = memoria.length ? memoria.slice().reverse().map((m) => `<div class="row-item mem"><span class="t">${esc(m.indicacion)}</span><small>${esc(PARA[m.para] || byId[m.para]?.nombre || m.para)} · ${m.por ? `guardó ${esc(byId[m.por]?.nombre || m.por)}` : 'a mano'} · ${dayTime(m.ts)}</small><button class="link" data-mem-del="${m.id}">Borrar</button></div>`).join('')
    : '<div class="empty">Todavía no hay indicaciones. Escribilas en cualquier chat ("de ahora en adelante…") y el agente las guarda.</div>';
}
$('#mem-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const indicacion = $('#mem-text').value.trim();
  if (!indicacion) return;
  const res = await fetch('/api/memoria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ indicacion, para: $('#mem-para').value }) });
  if (res.ok) { $('#mem-text').value = ''; loadMemoria(); }
});
loadMemoria();

// ---------- calendario de publicación ----------
let calendario = null;
async function loadCalendario() {
  try { calendario = await fetch('/api/estudio/calendario').then((r) => r.json()); } catch { return; }
  invalidate('studio');
}
function renderCalendario() {
  const box = $('#calendario');
  if (!box) return;
  const c = calendario;
  const head = `<div class="side-head"><h2>Calendario</h2><button class="btn sm" data-cal-revisar="1">Revisar</button></div>`;
  if (!c?.ultima) { box.innerHTML = `${head}<p class="note">Todavía no se revisó.</p>`; return; }
  const fmt = (t) => new Intl.DateTimeFormat('es-HN', { timeZone: TZ, weekday: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t);
  const days = Object.entries(c.dias || {}).sort().slice(0, 7);
  box.innerHTML = `${head}
    <p class="note">${c.total} programados en TikTok y YouTube (${c.oficina} de la oficina). Se revisa solo cada 6 h y no deja que dos videos salgan a la misma hora.</p>
    <div class="cal-week">${days.map(([d, v]) => `<div class="cal-d"><small>${new Date(`${d}T12:00:00Z`).toLocaleDateString('es-HN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</small><b>${v.total}</b></div>`).join('')}</div>
    ${c.movidos?.length ? `<details class="cal-moves"><summary>Reacomodados (${c.movidos.length})</summary>${c.movidos.slice(0, 15).map((m) => `<div>${esc(m.video)}: ${fmt(m.de)} → <b>${fmt(m.a)}</b></div>`).join('')}</details>` : ''}`;
}

// ---------- paneles laterales de la oficina ----------
let sideChat = null;      // { type: 'agent' | 'group', id }
let sideStudio = false;

function openSideChat(target) {
  sideChat = target;
  closeSideStudio();
  $('#side-chat').hidden = false;
  $('#side-team').hidden = false;
  invalidate('side');
  setTimeout(() => $('#side-chat-input').focus(), 50);
}
function closeSideChat() { sideChat = null; $('#side-chat').hidden = true; $('#side-team').hidden = true; }
function openSideStudio() { sideStudio = true; $('#side-team').hidden = true; $('#side-studio').hidden = false; loadStudio(); invalidate('sideStudio'); }
function closeSideStudio() { sideStudio = false; $('#side-studio').hidden = true; }

RENDER.side = function renderSide() {
  if (!sideChat) return;
  const box = $('#side-chat-msgs');
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  let html = '', sig = '', head = '', busy = false, typing = '';
  if (sideChat.type === 'agent') {
    const a = byId[sideChat.id];
    const msgs = model.chats[sideChat.id]?.messages || [];
    head = `<span class="avatar sm" style="--c:${a.color}">${esc(a.nombre[0])}</span><div><b>${esc(a.nombre)}</b><small>${esc(a.rol)}</small></div>`;
    html = msgs.length ? msgs.slice(-60).map((m) => `<div class="msg ${m.role === 'agent' ? 'bot' : m.role}">${m.role === 'agent' ? markdown(m.text) : esc(m.text)}<time>${time(m.ts)}</time></div>`).join('')
      : `<div class="msg sys">Escribile a ${esc(a.nombre)}.</div>`;
    sig = `a|${sideChat.id}|${msgs.length}|${msgs.at(-1)?.id}`;
    busy = isBusy(sideChat.id);
    typing = busy ? `${a.nombre}: ${model.agents[sideChat.id]?.text || 'trabajando…'}` : '';
    $('#side-chat-mentions').hidden = true;
    markRead(sideChat.id);
  } else {
    const d = DEPTS.find((x) => x.id === sideChat.id) || DEPTS[0];
    const msgs = deptMsgs(d.id);
    head = `<span class="avatar sm" style="background:${d.color}">#</span><div><b>${esc(d.nombre)}</b><small>Chat del equipo · mencioná con @Nombre</small></div>`;
    html = msgs.length ? msgs.slice(-60).map((m) => {
      if (m.from === 'diego') return `<div class="msg user">${esc(m.text)}<time>${time(m.ts)}</time></div>`;
      if (m.from === 'sistema') return `<div class="msg sys">${esc(m.text)}</div>`;
      const a = byId[m.from];
      return `<div class="msg bot"><b class="who" style="color:${a?.color}">${esc(a?.nombre || m.from)}</b>${markdown(m.text)}<time>${time(m.ts)}</time></div>`;
    }).join('') : `<div class="msg sys">Chat de ${esc(d.nombre)}.</div>`;
    sig = `g|${d.id}|${msgs.length}|${msgs.at(-1)?.id}`;
    busy = busyDepts.has(d.id);
    typing = busy ? 'El equipo está respondiendo…' : '';
    const people = config.agents.filter((a) => (a.dept === d.id || a.coordinator) && !a.engine);
    $('#side-chat-mentions').hidden = false;
    $('#side-chat-mentions').innerHTML = [['equipo', 'Todos'], ...people.map((a) => [a.nombre, a.nombre])].map(([m, l]) => `<button type="button" class="chip" data-side-mention="${esc(m)}">@${esc(l)}</button>`).join('');
    markRead(groupKey(d.id));
  }
  const ids = sideChat.members || (sideChat.type === 'agent' ? [sideChat.id] : config.agents.filter((a) => (a.dept === sideChat.id || a.coordinator) && !a.engine).map((a) => a.id));
  $('#side-status').innerHTML = sideStatusHTML(ids);
  $('#side-team-title').textContent = sideChat.title || (sideChat.type === 'agent' ? byId[sideChat.id]?.nombre || 'El equipo' : (DEPTS.find((x) => x.id === sideChat.id)?.nombre || 'El equipo'));
  $('#side-chat-head').innerHTML = head;
  if (box.dataset.sig !== sig) { box.innerHTML = html; box.dataset.sig = sig; box.scrollTop = box.scrollHeight; } else if (near) box.scrollTop = box.scrollHeight;
  $('#side-chat-typing').hidden = !busy;
  $('#side-chat-typing').textContent = typing;
  $('#side-chat-send').disabled = busy;
};

RENDER.sideStudio = function renderSideStudio() {
  if (!sideStudio) return;
  const list = studioVideos.filter((v) => v.status === 'pending');
  $('#side-studio-sub').textContent = list.length ? `${list.length} esperando` : 'Nada pendiente';
  const body = $('#side-studio-body');
  const sig = list.map((v) => `${v.id}:${v.status}:${v.published ? 1 : 0}`).join('|');
  if (body.dataset.sig === sig) return; // no se re-dibuja mientras mirás un video
  body.dataset.sig = sig;
  sideIds = list.map((v) => v.id);
  body.innerHTML = list.length ? list.map(thumbCard).join('') : '<div class="empty">No hay videos esperando tu aprobación. Los que van llegando aparecen acá.</div>';
};

async function sendSide() {
  const text = $('#side-chat-input').value.trim();
  if (!text || !sideChat) return;
  $('#side-chat-input').value = '';
  const url = sideChat.type === 'agent' ? `/api/chat/${sideChat.id}` : `/api/grupo/${sideChat.id}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
  if (!res.ok) { $('#side-chat-input').value = text; alert((await res.json().catch(() => ({}))).error || 'No se pudo enviar.'); }
}
$('#side-chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendSide(); });
$('#side-chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendSide(); } });
$('#side-chat-full').addEventListener('click', () => {
  if (!sideChat) return;
  const id = sideChat.type === 'agent' ? sideChat.id : `grupo-${sideChat.id}`;
  closeSideChat();
  go('chat', id);
});

// ---------- lo que el equipo necesita de Diego ----------
function needsByAgent() {
  const map = new Map();
  const add = (id, item) => { if (!id) return; if (!map.has(id)) map.set(id, []); map.get(id).push(item); };
  for (const x of model.approvals) add(x.agentId, { kind: 'approval', title: `Quiere ejecutar: ${x.tool.split('__').slice(1).join(' · ')}`, go: 'bandeja' });
  for (const d of [...model.deliverables].reverse()) { // lo último primero
    if (d.status !== 'pending') continue;
    if (d.kind === 'decision' && !d.paraCeo) add(d.agentId, { kind: 'decision', title: d.question || d.title, doc: d.id });
    if (d.kind === 'video') add(d.agentId, { kind: 'video', title: d.title.replace(/^(🎬\s*)+/, ''), studio: true });
  }
  for (const [id, a] of Object.entries(model.agents)) if (a.status === 'waiting') add(id, { kind: 'approval', title: a.text || 'Espera tu aprobación', go: 'bandeja' });
  return map;
}

function sideStatusHTML(ids) {
  const needs = needsByAgent();
  const asks = ids.flatMap((id) => (needs.get(id) || []).map((n) => ({ ...n, id })));
  const icon = { approval: '⚠️', decision: '❓', video: '🎬' };
  const askHTML = asks.length ? `<div class="ss-block ss-asks"><h4>Necesitan de vos <small>${asks.length}</small></h4>${asks.slice(0, 6).map((n) => {
    const a = byId[n.id];
    const btn = n.doc ? `<button class="btn sm ok" data-doc="${n.doc}">Responder</button>` : n.studio ? '<button class="btn sm ok" data-open-studio="1">Ver video</button>' : `<button class="btn sm ok" data-go="${n.go}">Revisar</button>`;
    return `<div class="ss-ask"><span>${icon[n.kind] || '•'}</span><div><b>${esc(a?.nombre || n.id)}</b><small>${esc(n.title)}</small></div>${btn}</div>`;
  }).join('')}</div>` : '';
  const STATE = { idle: 'Disponible', working: 'Trabajando', tool: 'Trabajando', waiting: 'Espera tu aprobación', error: 'Con un error' };
  const rows = ids.map((id) => {
    const a = byId[id];
    const s = model.agents[id] || { status: 'idle' };
    const busy = isBusy(id);
    return `<div class="ss-row ${busy ? 'busy' : ''}"><span class="avatar sm" style="--c:${a.color}">${esc(a.nombre[0])}</span><div><b>${esc(a.nombre)} <em>${esc(STATE[s.status] || s.status)}</em></b><small>${esc(busy ? (s.text || '') : a.rol)}</small></div></div>`;
  }).join('');
  return `${askHTML}<details class="ss-block" ${asks.length ? '' : 'open'}><summary>En qué están ahora</summary>${rows}</details>`;
}

// ---------- ver un video en grande, con sus botones de aprobación ----------
function thumbCard(v) {
  const src = `/api/estudio/file/${encodeURIComponent(v.video.video)}/${encodeURIComponent(v.video.name)}`;
  const st = v.status === 'pending' ? '<span class="badge pending">Por aprobar</span>' : '<span class="badge approved">Aprobado · sin programar</span>';
  return `<button class="vthumb" data-vopen="${v.id}" title="Abrir en grande">
    <span class="vthumb-img"><img loading="lazy" alt="" src="${src.replace('/api/estudio/file/', '/api/estudio/poster/')}"><i>▶</i></span>
    <span class="vthumb-txt"><b>${esc(tituloCorto(v.title))}</b><small>${esc(byId[v.agentId]?.nombre || '')} · ${dayTime(v.ts)}</small>${st}</span>
  </button>`;
}

let gridIds = [], sideIds = [], vboxIds = [], vboxId = null;

// Abre un video en grande. `ids` es la lista desde donde se abrió, para pasar con las flechas.
function openVideo(id, ids = vboxIds) {
  const v = studioVideos.find((x) => x.id === id);
  if (!v) return;
  vboxIds = ids.length ? ids : [id];
  vboxId = id;
  let box = $('#vbox');
  if (!box) { box = document.createElement('div'); box.id = 'vbox'; box.className = 'vbox'; document.body.appendChild(box); }
  box.querySelectorAll('video').forEach((x) => x.pause());
  const i = vboxIds.indexOf(id);
  const n = vboxIds.length;
  box.innerHTML = `<button class="vnav prev" data-vnav="-1" aria-label="Video anterior" ${i <= 0 ? 'disabled' : ''}>‹</button>
    <div class="vbox-inner"><div class="vbox-top"><span>${i + 1} de ${n}</span><button class="btn sm" data-vclose="1" aria-label="Cerrar">✕</button></div>${videoCard(v)}</div>
    <button class="vnav next" data-vnav="1" aria-label="Video siguiente" ${i >= n - 1 ? 'disabled' : ''}>›</button>`;
  box.hidden = false;
  box.querySelector('[data-vopen]')?.remove();
  box.querySelector('video')?.play().catch(() => {});
}
function stepVideo(dir) {
  const i = vboxIds.indexOf(vboxId) + dir;
  if (i >= 0 && i < vboxIds.length) openVideo(vboxIds[i]);
}
// Después de aprobar, pedir cambios o descartar: pasa al siguiente que sigue por aprobar.
function nextAfterReview(id) {
  const i = vboxIds.indexOf(id);
  vboxIds = vboxIds.filter((x) => x !== id);
  const rest = vboxIds.filter((x) => studioVideos.find((v) => v.id === x)?.status === 'pending');
  const next = rest.find((x) => vboxIds.indexOf(x) >= i) || rest[0];
  if (next) openVideo(next); else closeVideo();
}
function closeVideo() {
  const box = $('#vbox');
  if (!box || box.hidden) return;
  box.querySelectorAll('video').forEach((x) => x.pause());
  box.hidden = true; box.innerHTML = '';
}
document.addEventListener('keydown', (e) => {
  if ($('#vbox')?.hidden !== false) return;
  if (e.key === 'Escape') closeVideo();
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return; // escribiendo: las flechas mueven el cursor
  if (e.key === 'ArrowRight') stepVideo(1);
  if (e.key === 'ArrowLeft') stepVideo(-1);
});
// En el celular: deslizar a los lados cambia de video.
let swipeX = null;
document.addEventListener('touchstart', (e) => { swipeX = e.target.closest('#vbox') && !e.target.closest('input, textarea') ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (swipeX == null) return;
  const dx = e.changedTouches[0].clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 70) stepVideo(dx < 0 ? 1 : -1);
}, { passive: true });
document.addEventListener('click', (e) => { if (e.target.id === 'vbox') closeVideo(); });

// ---------- Ventas: tablero de clientes, seguimientos y pestañas ----------
let vFiltro = 'todos';
let vTab = (() => { const [v, a] = location.hash.replace(/^#\/?/, '').split('/'); return v === 'ventas' && TAB_VENTAS.includes(a) ? a : 'clientes'; })();
let vSeg = null; // { pasos, stats, horario, topeHora }

function setVTab(tab) {
  vTab = tab;
  try { localStorage.setItem('vTab', tab); } catch {}
  $$('.v-tab').forEach((b) => b.classList.toggle('on', b.dataset.vtab === tab));
  document.querySelector('.ventas-view').dataset.vtActual = tab;
  $$('.vt').forEach((x) => (x.hidden = x.dataset.vt !== tab));
  if (tab === 'seguimientos') loadSeg();
}
setVTab(vTab);

// Mensaje del cliente: si mandó una imagen, se ve la foto (clic para abrirla grande), su texto y lo que leyó la IA.
const IMG_RE = /^\[El cliente envió (?:una|otra) imagen(?: con el texto:? "([\s\S]*?)")?(?: \(puede ser[^)]*\))?(?:\. Lo que se ve: ([\s\S]*?))?(\. No se analizó[^\]]*)?\]$/;
function msgCliente(c, m) {
  const x = String(m.text || '').match(IMG_RE);
  if (!x) return `<div class="vmsg cli"><div class="vb">${esc(m.text)}</div></div>`;
  // Las imágenes viejas no traen el archivo en el mensaje: se busca la guardada justo antes.
  const archivo = m.img || (c.imagenes || []).filter((i) => i.ts <= m.ts + 5e3 && m.ts - i.ts < 5 * 60e3).at(-1)?.archivo;
  const url = archivo ? `/api/ventas/media/${encodeURIComponent(c.id)}/${encodeURIComponent(archivo)}` : '';
  return `<div class="vmsg cli"><div class="vb vimg-b">
    ${url ? `<a href="${url}" target="_blank" rel="noopener" title="Abrir la imagen"><img class="vimg" src="${url}" alt="Imagen del cliente" loading="lazy"></a>` : '<span class="tenue">📷 Imagen (no se guardó)</span>'}
    ${x[1] ? `<p>${esc(x[1])}</p>` : ''}
    ${x[2] ? `<details class="vlect"><summary>Lo que leyó la IA</summary><p>${esc(x[2])}</p></details>` : ''}
    ${x[3] ? '<small class="vlect">Sin leer con IA (ya iban más de 5 seguidas)</small>' : ''}
  </div></div>`;
}
window.openVConv = (id) => openVConv(id);
async function openVConv(id) {
  vConvId = id;
  $('#v-drawer').hidden = false;
  await asegurarVentas(); // desde otras secciones (Analíticas, Proyectos) todavía no se cargó Ventas
  await loadVConv();
  $('#v-msgs').scrollTop = $('#v-msgs').scrollHeight;
}
function closeVConv() { vConvId = null; vConv = null; $('#v-drawer').hidden = true; }

const hnDayStart = () => { const d = new Date(Date.now() - 6 * 3600e3); d.setUTCHours(0, 0, 0, 0); return d.getTime() + 6 * 3600e3; };
function vAgo(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  const mo = Math.round(d / 30);
  return `hace ${mo} ${mo === 1 ? 'mes' : 'meses'}`;
}
function until(ts) {
  const m = Math.round((ts - Date.now()) / 60000);
  if (m <= 0) return 'ya, en el próximo horario';
  if (m < 60) return `en ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `en ${h} h`;
  return new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', weekday: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(ts);
}
const realConvs = () => (vSummary?.convs || []).filter((c) => c.kind === 'whatsapp');
const puedeSeguir = (c) => !c.pausa && !c.estado?.noCalificado && !c.estado?.demo && !c.estado?.humano;
const vName = (c) => c.empresa || c.title.replace(/\s*·\s*\+?[\d:]+$/, '') || c.title;
const vPhone = (c) => (c.title.match(/\+\d+$/) || [''])[0];

// En qué columna va cada cliente.
function vStage(c) {
  if (c.estado?.resultado?.tipo === 'ganado') return 'ganado';
  if (c.estado?.resultado?.tipo === 'perdido') return 'perdido';
  if (c.pausa?.existente) return 'existente';
  if (c.estado?.noCalificado) return 'nocalifica';
  if (['cuenta', 'comprobante', 'pago'].includes(c.etapaVenta)) return c.etapaVenta === 'pago' ? 'ganado' : c.etapaVenta;
  // Lo que espera una respuesta tuya va primero; una pausa simple (escribiste desde el teléfono) no saca a la demo de su columna.
  if (c.estado?.humano || (c.estado?.consulta && !c.estado.consulta.respondida) || (c.pausa && !c.estado?.demoEnviada && !c.proyecto?.envioProgramado)) return 'convos';
  if (c.estado?.demoEnviada) return c.etapaVenta || (c.respondioDemo ? 'respondio' : 'enviada');
  if (c.proyecto?.envioProgramado) return 'programada';
  if (c.estado?.demo) return 'armando';
  if (c.last && c.last.role !== 'cliente' && Date.now() - c.last.ts > 2 * 3600e3) return 'sinresp';
  return 'activo';
}
const STAGES = [
  ['activo', 'Conversando', 'El vendedor está atendiendo'],
  ['sinresp', 'Sin respuesta', 'Dejaron de contestar: les toca seguimiento'],
  ['armando', 'Armando demo', 'Luis la arma; después la aprobás en la Bandeja'],
  ['programada', 'Demo programada', 'Ya la aprobaste: sale sola en la fecha indicada'],
  ['enviada', 'Demo enviada', 'Ya la tienen: seguimiento a los 1, 3 y 7 días'],
  ['respondio', 'Respondió', 'Contestó, pero todavía no dijo qué le pareció'],
  ['gusto', 'Le gustó', 'Dijo que le gustó o quiere avanzar: pedirle el anticipo'],
  ['cambios', 'Pidió cambios', 'Quiere ajustes en su demo'],
  ['dudas', 'Tiene dudas', 'Precio, tiempo u otro freno: conviene una llamada'],
  ['cuenta', 'Cuenta enviada', 'Ya tiene los datos para pagar'],
  ['comprobante', 'Comprobante', 'Mandó comprobante: esperando que lo valides'],
  ['convos', 'Con vos', 'El bot está pausado o espera tu respuesta'],
  ['ganado', 'Ganados', 'Cerraron la venta'],
];
const hnCorto = (ts) => new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', weekday: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(ts);

function vCard(c, stage) {
  const who = c.last ? (c.last.role === 'cliente' ? '' : c.last.role === 'equipo' ? 'Vos: ' : 'Bot: ') : '';
  const fu = c.followups?.next && puedeSeguir(c) ? `<span class="v-chip seg">Seguimiento ${(c.followups.step || 0) + 1} ${until(c.followups.next)}</span>` : '';
  const chip = stage === 'convos' ? `<span class="v-chip warn">${esc(c.estado?.consulta && !c.estado.consulta.respondida ? `${c.estado.consulta.pregunta.slice(0, 50)}` : c.estado?.humano || c.pausa?.motivo || 'Pausado')}</span>`
    : stage === 'armando' ? `<span class="v-chip ${c.proyecto?.estado === 'demo' ? 'warn' : 'seg'}">${c.proyecto?.estado === 'demo' ? 'Lista: aprobala en la Bandeja' : c.proyecto ? 'Luis la está armando' : `✅ ${esc(String(c.estado.demo).slice(0, 40))}`}</span>`
    : stage === 'programada' ? `<span class="v-chip ok">Sale ${esc(hnCorto(c.proyecto.envioProgramado))}</span>`
    : stage === 'enviada' ? `<span class="v-chip ok">Enviada ${vAgo(c.estado.demoEnviada)}${c.postDemo?.next ? ` · seg. ${(c.postDemo.step || 0) + 1} ${until(c.postDemo.next)}` : ''}</span>`
    : stage === 'respondio' ? `<span class="v-chip warn">Respondió ${vAgo(c.respondioDemo)}</span>`
    : stage === 'ganado' ? `<span class="v-chip ok">${esc(c.estado.resultado.nota || 'Venta cerrada').slice(0, 50)}</span>`
    : c.pausa && (stage === 'enviada' || stage === 'respondio' || stage === 'programada') ? '<span class="v-chip warn">Lo tenés vos</span>' : fu;
  const nuevo = Date.now() - c.ts < 24 * 3600e3 && stage === 'activo';
  return `<button class="v-card ${stage} ${c.id === vConvId ? 'on' : ''}" data-vconv="${c.id}">
    <span class="v-card-top"><b>${esc(vName(c))}</b><span class="fi-abrir" data-ficha="conv:${c.id}" title="Ver todo de este cliente">Ficha</span>${nuevo ? '<span class="v-new">Nuevo</span>' : ''}${c.busy ? '<span class="v-typing">escribiendo…</span>' : ''}</span>
    ${c.rubro || c.anuncio ? `<small class="v-meta">${esc([c.rubro, c.anuncio && `Anuncio: ${c.anuncio}`].filter(Boolean).join(' · ').slice(0, 70))}</small>` : ''}
    ${c.last ? `<span class="v-last">${esc(who + c.last.text)}</span>` : ''}
    <span class="v-card-foot"><small>${c.last ? vAgo(c.last.ts) : ''}${vPhone(c) ? ` · ${esc(vPhone(c))}` : ''}</small>${chip}</span>
  </button>`;
}

function renderBoard() {
  if (!$('#v-board')) return;
  const todos = realConvs();
  const quieto = (c) => c.estado?.demoEnviada && c.last && Date.now() - c.last.ts > 3 * 86400e3;
  const FILTROS = { todos: ['Todos', () => true], gusto: ['Le gustó', (c) => c.etapaVenta === 'gusto'], cuenta: ['Cuenta enviada', (c) => c.etapaVenta === 'cuenta'], quietos: ['Sin moverse hace 3 días', (c) => quieto(c) && !['pago', 'nointeresa'].includes(c.etapaVenta)], anuncio: ['Vinieron de anuncio', (c) => Boolean(c.anuncio)] };
  const convs = todos.filter(FILTROS[vFiltro]?.[1] || (() => true));
  $('#v-filtros').innerHTML = Object.entries(FILTROS).map(([k, [t, f]]) => `<button class="chip ${vFiltro === k ? 'on' : ''}" data-vfiltro="${k}">${t} <small>${todos.filter(f).length}</small></button>`).join('');
  const by = {};
  for (const c of convs) (by[vStage(c)] ||= []).push(c);
  const day0 = hnDayStart();
  const dayEnd = day0 + 86400e3;
  const agendaHoy = convs.filter((c) => c.followups?.next && puedeSeguir(c) && c.followups.next < dayEnd).length;
  const kpi = (label, value, cls = '', sub = '') => `<div class="kpi ${cls}"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const nuevasHoy = convs.filter((c) => c.ts >= day0 && !c.pausa?.existente).length;
  $('#v-kpis').innerHTML = [
    kpi('Conversaciones hoy', convs.filter((c) => !c.pausa?.existente && c.last?.ts >= day0).length, '', `${nuevasHoy} ${nuevasHoy === 1 ? 'nueva' : 'nuevas'}`),
    kpi('Demos en curso', (by.armando || []).length + (by.programada || []).length, '', `${(by.programada || []).length} programadas para salir`),
    kpi('Demos enviadas', ['enviada', 'respondio', 'gusto', 'cambios', 'dudas', 'cuenta', 'comprobante'].reduce((s, k) => s + (by[k] || []).length, 0), (by.gusto || []).length ? 'ok' : '', `${(by.gusto || []).length} les gustó · ${(by.cuenta || []).length} con la cuenta · ${(by.ganado || []).length} ganados`),
    kpi('Te necesitan', (by.convos || []).length, (by.convos || []).length ? 'warn' : '', 'chats con el bot pausado'),
  ].join('');
  $('#v-badge-seg').textContent = agendaHoy || '';
  $('#v-board').innerHTML = STAGES.map(([id, name, hint]) => {
    const list = by[id] || [];
    return `<section class="v-col ${id}"><header><b>${name}</b><span>${list.length}</span></header><small class="v-hint">${hint}</small>
      <div class="v-col-list">${list.slice(0, 40).map((c) => vCard(c, id)).join('') || '<p class="v-empty">Nadie por ahora.</p>'}${list.length > 40 ? `<p class="v-empty">y ${list.length - 40} más</p>` : ''}</div></section>`;
  }).join('');
  const pd = by.perdido || [];
  const nc = by.nocalifica || [];
  const ex = by.existente || [];
  const ni = by.nointeresa || [];
  $('#v-otros').innerHTML = `${ni.length ? `<details><summary>No les interesó (${ni.length})</summary><div class="v-otros-list">${ni.map((c) => `<button class="link" data-vconv="${c.id}">${esc(vName(c))}</button>`).join('')}</div></details>` : ''}${pd.length ? `<details><summary>Perdidos (${pd.length})</summary><div class="v-otros-list">${pd.map((c) => `<button class="link" data-vconv="${c.id}">${esc(vName(c))} <small>· ${esc(String(c.estado?.resultado?.nota || '').slice(0, 60))}</small></button>`).join('')}</div></details>` : ''}${nc.length ? `<details><summary>No califican (${nc.length})</summary><div class="v-otros-list">${nc.map((c) => `<button class="link" data-vconv="${c.id}">${esc(vName(c))} <small>· ${esc(String(c.estado.noCalificado).slice(0, 60))}</small></button>`).join('')}</div></details>` : ''}
    ${ex.length ? `<details><summary>Contactos que ya existían (${ex.length}): el bot no los atiende</summary><div class="v-otros-list">${ex.slice(0, 80).map((c) => `<button class="link" data-vconv="${c.id}">${esc(vName(c))}</button>`).join('')}</div></details>` : ''}`;
}

function segBox(c) {
  const f = c.followups || {};
  const total = vSeg?.pasos?.filter((p) => p.activo !== false).length;
  const head = '<h3>Seguimiento</h3>';
  if (!puedeSeguir(c)) return `${head}<p class="note">Sin seguimientos: ${c.pausa ? 'el bot está pausado' : c.estado?.demo ? 'ya aceptó la demo' : c.estado?.humano ? 'está con vos' : 'no califica'}.</p>`;
  if (!f.next) return `${head}<p class="note">${f.step && total && f.step >= total ? 'Ya se enviaron todos los pasos.' : 'Nada programado: el cliente fue el último en escribir.'}</p>`;
  return `${head}<p class="note">Paso ${(f.step || 0) + 1}${total ? ` de ${total}` : ''} · ${until(f.next)}</p>
    <div class="actions"><button class="btn sm ok" data-vseg-ya="${c.id}">Enviar ya</button><button class="btn sm" data-vseg-cancel="${c.id}">Cancelar</button></div>`;
}

function renderAgenda() {
  if (!$('#v-agenda') || vTab !== 'seguimientos') return;
  const list = realConvs().filter((c) => c.followups?.next && puedeSeguir(c)).sort((a, b) => a.followups.next - b.followups.next);
  $('#v-agenda').innerHTML = list.length ? list.slice(0, 60).map((c) => `<div class="v-ag-row">
      <span class="v-ag-when">${esc(until(c.followups.next))}</span>
      <button class="link v-ag-name" data-vconv="${c.id}">${esc(vName(c))}<small>Paso ${(c.followups.step || 0) + 1} · calló ${c.last ? vAgo(c.last.ts) : ''}</small></button>
      <span class="v-ag-act"><button class="btn sm ok" data-vseg-ya="${c.id}">Enviar ya</button><button class="btn sm" data-vseg-cancel="${c.id}">Cancelar</button></span>
    </div>`).join('') : '<div class="empty">No hay seguimientos programados. Cuando un cliente deja de responder, aparece acá con la hora de su próximo mensaje.</div>';
}

async function loadSeg() {
  try { vSeg = await fetch('/api/ventas/seguimientos').then((r) => r.json()); } catch { return; }
  renderPasos();
  renderAgenda();
}
const DIAS = (h) => (h % 24 === 0 ? { n: h / 24, u: 'dias' } : { n: h, u: 'horas' });
function renderPasos() {
  if (!vSeg?.pasos) return;
  const hz = vSeg.horario;
  const dn = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  $('#v-seg-horario').textContent = `Salen ${hz.days.map((d) => dn[d]).join(', ')} de ${hz.start}:00 a ${hz.end}:00 (hora de Honduras), máximo ${vSeg.topeHora} por hora.${vSeg.enVivo ? '' : ' El vendedor está apagado: no sale ninguno.'}`;
  $('#v-pasos').innerHTML = vSeg.pasos.map((p, i) => {
    const st = vSeg.stats?.[i] || { enviados: 0, respondidos: 0 };
    const pct = st.enviados ? Math.round((st.respondidos / st.enviados) * 100) : null;
    const t = DIAS(p.horas);
    return `<div class="v-paso" data-i="${i}">
      <div class="v-paso-head"><b>Paso ${i + 1}</b>
        <label>a los <input type="number" min="1" max="2160" class="p-n" value="${t.n}"></label>
        <select class="p-u"><option value="horas" ${t.u === 'horas' ? 'selected' : ''}>horas</option><option value="dias" ${t.u === 'dias' ? 'selected' : ''}>días</option></select>
        <label class="p-on"><input type="checkbox" class="p-a" ${p.activo !== false ? 'checked' : ''}> activo</label>
        <span class="v-paso-stat">${st.enviados ? `${st.enviados} enviados · ${pct}% respondió` : 'Sin envíos todavía'}</span>
        <button class="link" data-vpaso-del="${i}" title="Quitar paso">✕</button></div>
      <textarea class="p-t" rows="2" maxlength="800" placeholder="Qué le dice el vendedor en este paso">${esc(p.pista)}</textarea>
    </div>`;
  }).join('');
}
function readPasos() {
  if (!vSeg) return;
  vSeg.pasos = $$('#v-pasos .v-paso').map((row) => {
    const n = Number(row.querySelector('.p-n').value) || 1;
    return { horas: row.querySelector('.p-u').value === 'dias' ? n * 24 : n, activo: row.querySelector('.p-a').checked, pista: row.querySelector('.p-t').value.trim() };
  });
}
setInterval(() => { if (view === 'ventas') { renderBoard(); renderAgenda(); } }, 60_000); // los "hace X" y "en X" se mantienen al día

// ---------- autonomía (Ajustes) ----------
async function cargarAutonomia() {
  const box = $('#autonomia');
  if (!box) return;
  const a = await fetch('/api/autonomia').then((r) => r.json()).catch(() => null);
  if (!a) return;
  const p = await fetch('/api/autonomia/presupuesto').then((r) => r.json()).catch(() => ({}));
  const pct = p.proyectado && a.adsMes ? Math.min(100, Math.round((p.proyectado / a.adsMes) * 100)) : null;
  box.innerHTML = `
    <div class="pp-row"><div class="pp-name"><b>Anuncios de Meta</b><small>Renata activa, pausa y mueve presupuesto sola hasta este tope mensual</small></div>
      <div class="pp-bar"><span style="width:${pct ?? 0}%" class="${pct >= 95 ? 'over' : ''}"></span></div>
      <div class="pp-num"><b>${p.error ? '—' : `L ${(p.proyectado ?? 0).toLocaleString('es-HN')}`}</b><small>${p.error ? esc(p.error).slice(0, 60) : `proyectado del mes · gastado L ${(p.gastoMes ?? 0).toLocaleString('es-HN')} · L ${p.diario ?? 0}/día`}</small></div>
      <label class="pp-cap">Tope L<input type="number" min="0" step="500" value="${a.adsMes}" data-au="adsMes"></label></div>
    <label class="au-chk"><input type="checkbox" data-au="organicoAuto" ${a.organicoAuto ? 'checked' : ''}> Videos orgánicos se publican solos si pasan el revisor automático (nota ${a.videoNotaMin}+). Los anuncios siguen pasando por vos.</label>
    <label class="au-chk"><input type="checkbox" data-au="demoAuto" ${a.demoAuto ? 'checked' : ''}> Demos con nota ${a.demoNotaMin}+ de Ashley salen solas, con <input type="number" min="0" max="48" value="${a.demoVetoH}" data-au="demoVetoH" class="au-num"> h para cancelarlas.</label>
    <div class="actions"><button class="btn sm ok" data-au-guardar="1">Guardar límites</button></div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-au-guardar]');
  if (!b) return;
  const body = {};
  document.querySelectorAll('#autonomia [data-au]').forEach((i) => { body[i.dataset.au] = i.type === 'checkbox' ? i.checked : Number(i.value); });
  await fetch('/api/autonomia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  window.toast?.('Límites guardados', 'ok');
  cargarAutonomia();
});

// ---------- plantillas de WhatsApp (Ajustes) ----------
const EST_PL = { APPROVED: ['Aprobada', 'bien'], PENDING: ['En revisión de Meta', 'espera'], REJECTED: ['Rechazada', 'error'], NO_CREADA: ['Sin mandar', ''], PAUSED: ['Pausada', 'error'], DISABLED: ['Desactivada', 'error'] };
async function htmlPlantillas() {
  const ps = await fetch('/api/ventas/ycloud/plantillas?forzar=1').then((r) => r.json()).catch(() => []);
  if (!Array.isArray(ps)) return '';
  const faltan = ps.some((p) => p.estado === 'NO_CREADA');
  return `<div class="pl-lista"><p class="note">Pasadas 24 h desde el último mensaje del cliente, la oficina usa estas plantillas (con su nombre y el enlace). Si no hay una aprobada para ese envío, te avisa por Discord para que lo llames.</p>
    ${ps.map((p) => { const [t, c] = EST_PL[p.estado] || [p.estado, '']; return `<div class="pl-item"><div><b>${esc(p.name.replace('cresova_', '').replace(/_/g, ' '))}</b> <span class="etq ${c}">${esc(t)}</span><small>${esc(p.body)}</small>${p.motivo ? `<small class="v-keyerr">${esc(p.motivo)}</small>` : ''}</div></div>`; }).join('')}
    ${faltan ? '<div class="actions"><button class="btn sm principal" data-yc-plantillas="1">Mandar a aprobar a Meta</button></div>' : ''}</div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-yc-plantillas]');
  if (!b) return;
  b.disabled = true;
  const r = await fetch('/api/ventas/ycloud/plantillas', { method: 'POST' }).then((x) => x.json()).catch((er) => ({ error: er.message }));
  const mal = (r.resultado || []).filter((x) => !x.ok);
  window.toast?.(r.error || (mal.length ? `${mal.length} no se pudieron mandar: ${mal[0].error}` : 'Mandadas a aprobar: Meta suele responder en minutos'), r.error || mal.length ? 'error' : 'ok');
  cargarWaConexion();
});

// ---------- conexión del WhatsApp de ventas (Ajustes) ----------
let waQr = null, waPoll = null;
async function cargarWaConexion() {
  const box = $('#wa-conexion');
  if (!box) return;
  const w = await fetch('/api/ventas/whatsapp').then((r) => r.json()).catch(() => null);
  const ok = w?.state === 'open';
  if (ok) { waQr = null; clearInterval(waPoll); waPoll = null; }
  const hace = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`; };
  const y = await fetch('/api/ventas/ycloud').then((r) => r.json()).catch(() => null);
  const ycHtml = !y?.llave ? '<p class="note">API oficial (YCloud): falta la llave en Sistema → Llaves.</p>'
    : y.activo ? `<div class="pp-row"><div class="pp-name"><b>✅ API oficial (YCloud)</b><small>Número ${esc(y.from || '')} · coexistencia con la app del teléfono</small></div><div class="actions"><button class="btn sm" data-yc="apagar">Volver a Evolution</button></div></div>${await htmlPlantillas()}`
    : `<div class="pp-row"><div class="pp-name"><b>API oficial (YCloud)</b><small>${y.error ? esc(y.error) : y.numeros?.length ? `Número listo en YCloud: ${esc(y.numeros[0].numero || '')} (${esc(y.numeros[0].estado || '')})` : 'Todavía no hay número conectado en YCloud'}</small></div><div class="actions">${y.numeros?.length ? '<button class="btn sm principal" data-yc="conectar">Usar la API oficial</button>' : ''}</div></div>`;
  if (y?.activo) { box.innerHTML = ycHtml; return; }
  box.innerHTML = ycHtml + `<div class="pp-row"><div class="pp-name"><b>${ok ? '🟢 Conectado' : '🔴 Desconectado'}</b><small>${ok ? `último mensaje recibido hace ${w?.avisos?.last ? hace(w.avisos.last) : '—'}` : w?.caidoDesde ? `caído desde hace ${hace(w.caidoDesde)}` : esc(w?.state || 'sin respuesta')}</small></div>
    <div class="actions">${ok ? '<button class="btn sm" data-wa-recuperar="1" title="Vuelve a revisar los mensajes de las últimas 6 horas por si alguno no se procesó">Recuperar mensajes</button>' : '<button class="btn sm principal" data-wa-qr="1">Reconectar</button>'}</div></div>
    ${waQr && !ok ? `<div class="wa-qr"><img src="${waQr}" alt="Código QR de WhatsApp"><p class="note">Escanealo con el teléfono de Cresova: WhatsApp → Dispositivos vinculados → Vincular un dispositivo. Esta pantalla se actualiza sola al conectar.</p></div>` : ''}`;
}
document.addEventListener('click', async (e) => {
  const yb = e.target.closest('[data-yc]');
  if (yb) {
    yb.disabled = true;
    const r = await fetch(`/api/ventas/ycloud/${yb.dataset.yc}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((x) => x.json()).catch((er) => ({ error: er.message }));
    window.toast?.(r.error || (yb.dataset.yc === 'conectar' ? 'Listo: el WhatsApp de ventas va por la API oficial' : 'Volvió a Evolution'), r.error ? 'error' : 'ok');
    return cargarWaConexion();
  }
  const b = e.target.closest('[data-wa-qr], [data-wa-recuperar]');
  if (!b) return;
  b.disabled = true;
  if (b.dataset.waQr) {
    window.toast?.('Reconectando…');
    const r = await fetch('/api/ventas/whatsapp/qr', { method: 'POST' }).then((x) => x.json()).catch((er) => ({ error: er.message }));
    if (r.error) window.toast?.(r.error, 'error');
    else if (r.conectado) window.toast?.('WhatsApp reconectado: proceso los mensajes que llegaron mientras tanto', 'ok');
    else { waQr = r.qr; if (r.motivo) window.toast?.(r.motivo); if (!waQr) window.toast?.('Evolution no devolvió el QR; probá de nuevo', 'error'); clearInterval(waPoll); waPoll = setInterval(cargarWaConexion, 4000); }
  } else {
    const r = await fetch('/api/ventas/whatsapp/recuperar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"horas":6}' }).then((x) => x.json()).catch((er) => ({ error: er.message }));
    window.toast?.(r.error || `${r.recuperados} mensajes recuperados`, r.error ? 'error' : 'ok');
  }
  cargarWaConexion();
});

// ---------- gasto de la voz de Jarvis (Ajustes) ----------
async function cargarGastoVoz(forzar = false) {
  const box = $('#voz-gasto');
  if (!box) return;
  const g = await fetch(`/api/voz/gasto${forzar ? '?forzar=1' : ''}`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  if (g.error) { box.innerHTML = `<p class="note">No se pudo leer el gasto: ${esc(g.error)}</p>`; return; }
  const usd = (n) => `US$ ${Number(n || 0).toFixed(2)}`;
  const cr = (n) => Math.round(n || 0).toLocaleString('es-HN');
  const p = g.plan;
  const pct = p?.limite ? Math.min(100, Math.round((p.usados / p.limite) * 100)) : null;
  box.innerHTML = `
    ${p ? `<div class="pp-row"><div class="pp-name"><b>Plan ${esc(p.nivel || '')}</b><small>${p.renueva ? `se renueva ${new Date(p.renueva).toLocaleDateString('es-HN', { day: 'numeric', month: 'short' })}` : ''}</small></div>
      <div class="pp-bar"><span style="width:${pct ?? 0}%" class="${pct >= 85 ? 'over' : ''}"></span></div>
      <div class="pp-num"><b>${pct != null ? `${pct} %` : '—'}</b><small>${cr(p.usados)} de ${cr(p.limite)} créditos</small></div></div>` : ''}
    <p class="note"><b>Últimos 30 días, solo la voz de Jarvis:</b> ${g.total.llamadas} llamadas · ${Math.round(g.total.minutos)} min · ${cr(g.total.creditos)} créditos · <b>${usd(g.total.usd)}</b>${g.total.minutos ? ` (≈ ${usd(g.total.usd / g.total.minutos)} por minuto)` : ''}. ${g.cortes ? `${g.cortes} llamadas se cortaron por la conexión (casi siempre un reinicio de la oficina).` : ''} ${g.porLimite ? `${g.porLimite} llegaron al límite de duración.` : ''}</p>
    ${g.desglose?.cobrado ? (() => { const d = g.desglose; const pct = (x) => Math.round((x / d.cobrado) * 100); const sil = Math.max(0, d.cobrado - d.jarvis - d.diego); return `<p class="note"><b>De lo cobrado en las últimas ${d.llamadas} llamadas</b> (${Math.round(d.cobrado / 60)} min): Jarvis hablando ${Math.round(d.jarvis / 60)} min (${pct(d.jarvis)} %), vos hablando ~${Math.round(d.diego / 60)} min (${pct(d.diego)} %) y <b>silencio ${Math.round(sil / 60)} min (${pct(sil)} %)</b>: pausas, esperas mientras la oficina trabajaba y el rato antes de cerrar la sesión.</p>`; })() : ''}
    <div class="vg-dias">${g.dias.slice(0, 10).map((d) => `<div><b>${new Date(`${d.fecha}T12:00:00`).toLocaleDateString('es-HN', { weekday: 'short', day: 'numeric', month: 'short' })}</b><span>${d.llamadas} llamadas · ${Math.round(d.minutos)} min</span><span>${cr(d.creditos)} créd. · ${usd(d.usd)}</span></div>`).join('') || '<p class="note">Sin llamadas en 30 días.</p>'}</div>
    <div class="actions"><button class="btn sm" data-vg-actualizar="1">Actualizar</button></div>`;
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-vg-actualizar]')) cargarGastoVoz(true); });

// ---------- presupuesto de Claude (Ajustes) ----------
function renderPresupuesto() {
  const box = $('#presupuesto');
  const c = status?.cupo;
  if (!box || !c) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // no pisar lo que estás escribiendo
  const fmt = (t) => new Intl.DateTimeFormat('es-HN', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(t);
  const fila = (nombre, w, tope, gasto) => {
    const vig = w && w.utilization != null && !(w.resetsAt && w.resetsAt < Date.now());
    const u = vig ? Math.round(w.utilization * 100) : null;
    const t = Math.round(tope * 100);
    return `<div class="pp-row">
      <div class="pp-name"><b>${nombre}</b><small>${vig && w.resetsAt ? `se renueva ${fmt(w.resetsAt)}` : 'sin dato todavía'}</small></div>
      <div class="pp-bar"><span style="width:${u ?? 0}%" class="${u != null && u >= t ? 'over' : ''}"></span><i style="left:${t}%" title="Tope de la oficina"></i></div>
      <div class="pp-num"><b>${u != null ? `${u} %` : '—'}</b><small>oficina: $${(gasto || 0).toFixed(2)}</small></div>
      <label class="pp-cap">Tope<input type="number" min="10" max="100" step="5" value="${t}" data-pp="${nombre === 'Ventana de 5 h' ? 'cincoHoras' : 'semana'}"> %</label>
    </div>`;
  };
  box.innerHTML = `${fila('Ventana de 5 h', c.windows?.five_hour, c.limites?.cincoHoras ?? 0.6, c.gasto?.cincoHoras)}
    ${fila('Semana', c.windows?.seven_day, c.limites?.semana ?? 0.7, c.gasto?.semana)}
    <p class="note">${c.ahorro?.motivo ? `<b>La oficina está en pausa</b>: pasó el tope de ${c.ahorro.motivo === 'semana' ? 'la semana' : 'la ventana de 5 h'}. Solo trabaja en lo que le pidas (chat, cambios); el resto queda para vos. ` : ''}Medido ${c.medido ? `hace ${Math.max(1, Math.round((Date.now() - c.medido) / 60000))} min` : 'todavía no'} · el porcentaje es de todo tu plan (oficina + lo que uses vos); "oficina" es su gasto equivalente en la API.</p>
    <div class="actions"><button class="btn sm" data-pp-medir="1">Medir ahora</button><button class="btn sm ok" data-pp-guardar="1">Guardar topes</button></div>`;
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-pp-medir], [data-pp-guardar]');
  if (!t) return;
  t.disabled = true;
  if (t.dataset.ppMedir) { const r = await fetch('/api/cupo/medir', { method: 'POST' }).then((x) => x.json()).catch(() => null); if (r && status) status.cupo = r; }
  if (t.dataset.ppGuardar) {
    const v = (k) => Number($(`[data-pp="${k}"]`).value) / 100;
    const r = await fetch('/api/cupo/limites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cincoHoras: v('cincoHoras'), semana: v('semana') }) }).then((x) => x.json()).catch(() => null);
    if (r && status) status.cupo = r;
  }
  t.disabled = false;
  document.activeElement?.blur();
  renderPresupuesto();
  invalidate('stats');
});

// ---------- Desarrollo: proyectos, chat con el constructor y vista previa ----------
let devProyectos = [];
let devId = null;       // proyecto abierto
let devChat = [];
let devDevice = 'computadora';
const DEV_ESTADO = { nuevo: 'Nuevo', armando: 'Armando la demo', demo: 'Demo lista', enviada: 'Enviada al cliente', aprobada: 'Aprobada', publicada: 'Publicada', archivada: 'Archivada' };

// ---- Proyectos de Cresova (la base de cresova.com) ----
let czData = null, czCuentas = null, czDrag = null;
async function loadCresova() {
  try {
    const r = await fetch(`/api/cresova/proyectos${$('#cz-entregados')?.checked ? '?entregados=1' : ''}`);
    const j = await r.json();
    czData = r.ok ? j : { error: j.error || 'No se pudo leer la base de Cresova', configurado: j.configurado };
  } catch { return; }
  renderCresova();
}
async function asegurarVentas() {
  if (vSummary) return;
  try { vSummary = await fetch('/api/ventas').then((r) => r.json()); } catch {}
}
function renderCresova() {
  const el = $('#cz-board');
  if (!el || !czData) return;
  if (czData.error) { el.innerHTML = `<div class="empty">${esc(czData.error)}${czData.configurado === false ? ' <a href="#/sistema">Ir a Sistema → Llaves</a>' : ''}</div>`; return; }
  const aviso = $('#cz-corte');
  if (aviso) aviso.innerHTML = czData.corte ? '' : '<b>Copia de prueba:</b> todavía se trabaja en cresova.com; lo que muevas acá se pisa en la próxima sincronización.';
  if (!vSummary) asegurarVentas().then(() => { if (vSummary) renderCresova(); });
  const pix = new Map((czData.pixel || []).map((p) => [p.cotizacion, p]));
  el.innerHTML = czData.etapas.map((e) => {
    const items = czData.proyectos.filter((p) => p.etapa === e.id);
    return `<div class="v-col cz-col" data-cz-col="${e.id}"><header>${esc(e.label)}<span>${items.length}</span></header><div class="v-col-list">${items.map((p) => czCard(p, pix.get(p.numero))).join('') || '<div class="empty sm">—</div>'}</div></div>`;
  }).join('');
}
function czCard(p, px) {
  const pct = p.total ? Math.min(100, Math.round((p.pagado / p.total) * 100)) : 0;
  const L = (n) => `L ${Number(n).toLocaleString('en-US')}`;
  const web = p.demo || px?.preview || '';
  // Su conversación de WhatsApp en Ventas (por los últimos 8 dígitos del teléfono), para leerla y escribirle sin salir de aquí.
  const t8 = String(p.telefono || '').replace(/\D/g, '').slice(-8);
  const conv = t8.length === 8 ? (vSummary?.convs || []).find((c) => c.kind === 'whatsapp' && c.tel8 === t8) : null;
  // Chica por defecto: número, paquete, nombre, pago y dos íconos (copiar teléfono, abrir la web).
  // Con un clic se abre el resto: contacto, Luis, mover de etapa y registrar un pago.
  return `<div class="v-card cz-card${czAbiertas.has(p.id) ? ' abierta' : ''}" draggable="true" data-cz-id="${p.id}" data-cz-abrir="${p.id}">
    <div class="cz-fila"><div class="cz-top"><b title="${esc(p.numero)}">#${esc(String(p.numero).replace(/^COT-\d{4}-0*/, ''))}</b>${p.paquete ? `<span class="v-chip">${esc(p.paquete.slice(0, 18))}</span>` : ''}</div>
      <div class="cz-ico">${conv ? `<button class="btn" data-cz-chat="${conv.id}" title="Ver la conversación de WhatsApp"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.9-.9L3 20.5l1.5-4.6A8.4 8.4 0 1 1 21 11.5z"/></svg></button>` : ''}${p.telefono ? `<button class="btn" data-cz-tel="${esc(p.telefono)}" title="Copiar teléfono (${esc(p.telefono)})"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg></button>` : ''}${web ? `<a href="${esc(web)}" target="_blank" rel="noopener" title="Abrir la página"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></a>` : ''}</div></div>
    ${px?.tieneBuild ? `<img class="cz-img" loading="lazy" alt="" src="/p/${esc(px.id)}/__captura/computadora.jpg?v=${px.compilado}">` : ''}
    <div class="cz-name"${t8.length === 8 ? ` data-ficha="tel:${esc(t8)}" title="Ver todo de este cliente"` : ''}>${esc(p.empresa || p.cliente || '')}</div>
    <div class="cz-pay"><i style="width:${pct}%"></i></div><span class="cz-mini">${L(p.pagado)} de ${L(p.total)} · ${p.dias} d</span>
    <div class="cz-mas">
      ${p.cliente && p.cliente !== p.empresa ? `<small>Contacto: ${esc(p.cliente)}</small>` : ''}
      ${px ? `<small>Luis: ${esc(DEV_ESTADO[px.estado] || px.estado)}${px.trabajando ? ' (trabajando)' : ''}${px.envioProgramado ? ` · sale ${dayTime(px.envioProgramado)}` : ''}</small>` : ''}
      ${px ? `<div class="cz-actions"><a class="btn sm" href="#/desarrollo/${esc(px.id)}">Abrir demo</a>${px.tieneBuild && px.preview ? `<a class="btn sm" href="${esc(px.preview)}" target="_blank" rel="noopener">Ver sitio</a>` : ''}</div>` : ''}
      <div class="cz-actions"><select class="cz-move" data-cz-move="${p.id}" title="Mover a…"><option value="">Mover a…</option>${czData.etapas.filter((e) => e.id !== p.etapa).map((e) => `<option value="${e.id}">${esc(e.label)}</option>`).join('')}</select><button class="btn sm" data-cz-pago="${p.id}" data-cz-resto="${Math.max(0, p.total - p.pagado)}">Registrar pago</button></div>
    </div>
  </div>`;
}
// Aviso corto abajo de la pantalla ("Teléfono copiado: 97644186").
document.addEventListener('click', (e) => {
  const c = e.target.closest?.('[data-fi-chat]');
  if (c) { const fi = document.getElementById('ficha'); if (fi) fi.hidden = true; openVConv(c.dataset.fiChat); return; }
  const f = e.target.closest?.('[data-dev-filtro]');
  if (f) { devFiltro = f.dataset.devFiltro; renderDevLista(); }
});
window.toast = (texto, tipo = 'ok') => {
  let c = document.getElementById('toasts');
  if (!c) { c = Object.assign(document.createElement('div'), { id: 'toasts' }); document.body.append(c); }
  const el = Object.assign(document.createElement('div'), { className: `toast ${tipo}`, textContent: texto });
  c.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 300); }, 2600);
};
// Tarjeta de Proyectos: un clic (fuera de los íconos y controles) la abre o la cierra.
document.addEventListener('click', (e) => {
  const card = e.target.closest?.('[data-cz-abrir]');
  if (!card || e.target.closest('button, a, select, input')) return;
  card.classList.toggle('abierta');
  if (card.classList.contains('abierta')) czAbiertas.add(card.dataset.czAbrir); else czAbiertas.delete(card.dataset.czAbrir);
});
const czAbiertas = new Set();
async function czMover(id, etapa) {
  let demo_url = '';
  if (etapa === 'demo_sent') {
    const p = czData?.proyectos.find((x) => x.id === id);
    demo_url = prompt('Enlace de la demo que se le mandó al cliente:', p?.demo || (czData?.pixel || []).find((x) => x.cotizacion === p?.numero)?.preview || '') || '';
    if (!demo_url) return;
  }
  const r = await fetch(`/api/cresova/proyectos/${id}/mover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ etapa, demo_url }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) alert(j.error || 'No se pudo mover');
  loadCresova();
}
async function czPago(id, resto) {
  const monto = prompt(`Monto del pago (L). Falta por pagar: L ${Number(resto).toLocaleString('en-US')}`, resto ? String(Math.round(resto)) : '');
  if (!monto) return;
  if (!czCuentas) czCuentas = await fetch('/api/cresova/cuentas').then((r) => r.json()).catch(() => []);
  const lista = Array.isArray(czCuentas) ? czCuentas : [];
  const idx = lista.length ? prompt(`¿A qué cuenta entró?\n${lista.map((c, i) => `${i + 1}) ${c.name}`).join('\n')}\n(número, o vacío si no sabés)`, '1') : '';
  const cuenta = idx && lista[Number(idx) - 1] ? lista[Number(idx) - 1].id : null;
  const r = await fetch(`/api/cresova/proyectos/${id}/pago`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monto: Number(monto), cuenta, metodo: 'transferencia' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) alert(j.error || 'No se pudo registrar el pago');
  loadCresova();
}
document.addEventListener('change', (e) => {
  const s = e.target.closest?.('[data-cz-move]');
  if (s && s.value) czMover(s.dataset.czMove, s.value);
  if (e.target.id === 'cz-entregados') loadCresova();
});
document.addEventListener('dragstart', (e) => { const c = e.target.closest?.('[data-cz-id]'); if (c) { czDrag = c.dataset.czId; e.dataTransfer.effectAllowed = 'move'; } });
document.addEventListener('dragover', (e) => { if (czDrag && e.target.closest?.('[data-cz-col]')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  const col = e.target.closest?.('[data-cz-col]');
  if (!czDrag || !col) return;
  e.preventDefault();
  const id = czDrag; czDrag = null;
  const p = czData?.proyectos.find((x) => x.id === id);
  if (p && p.etapa !== col.dataset.czCol) czMover(id, col.dataset.czCol);
});

async function loadDev() {
  try { devProyectos = await fetch('/api/proyectos').then((r) => r.json()); } catch { return; }
  renderDevLista();
  if (devId) await abrirProyecto(devId, { quieto: true });
}

let devFiltro = 'todas';
function renderDevLista() {
  const grid = $('#dev-grid');
  if (!grid) return;
  const sinCot = devProyectos.filter((p) => !p.origen?.cotizacion).length;
  const f = $('#dev-filtros');
  if (f) f.innerHTML = `<button class="chip ${devFiltro === 'todas' ? 'on' : ''}" data-dev-filtro="todas">Todas <small>${devProyectos.length}</small></button><button class="chip ${devFiltro === 'sincot' ? 'on' : ''}" data-dev-filtro="sincot">Sin cotización <small>${sinCot}</small></button>`;
  const vis = devFiltro === 'sincot' ? devProyectos.filter((p) => !p.origen?.cotizacion) : devProyectos;
  grid.innerHTML = vis.length ? vis.map((p) => `<button class="dev-card" data-dev-abrir="${p.id}">
      <span class="dev-thumb">${p.tieneBuild ? `<img loading="lazy" src="/p/${p.id}/__captura/computadora.jpg?v=${p.compilado || p.actualizado}" alt="">` : '<i>Todavía sin vista previa</i>'}${p.trabajando ? '<em class="dev-live"><span class="spin"></span> Trabajando</em>' : ''}</span>
      <span class="dev-card-body"><span class="v-card-top"><b>${esc(p.nombre)}</b>${p.whatsapp ? `<span class="fi-abrir" data-ficha="tel:${esc(p.whatsapp)}">Ficha</span>` : ''}</span>${p.origen?.cotizacion ? `<small>${esc(p.origen.cotizacion)}</small>` : ''}<small>${esc(p.rubro || '')}${p.rubro ? ' · ' : ''}actualizado ${ago(p.actualizado)}</small><span class="dev-badge ${p.estado}">${DEV_ESTADO[p.estado] || p.estado}</span>${p.envioProgramado ? `<small>📅 sale ${dayTime(p.envioProgramado)}</small>` : ''}</span>
    </button>`).join('')
    : '<div class="empty">Todavía no hay proyectos. Creá el primero con "Nuevo proyecto": el constructor arma la demo solo y te avisa cuando esté.</div>';
}

async function abrirProyecto(id, { quieto = false } = {}) {
  const j = await fetch(`/api/proyectos/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!j) { go('desarrollo'); return; }
  devId = id;
  devChat = j.chat || [];
  const i = devProyectos.findIndex((x) => x.id === id);
  if (i >= 0) devProyectos[i] = { ...devProyectos[i], ...j }; else devProyectos.push(j);
  $('#dev-lista').hidden = true;
  $('#dev-proyecto').hidden = false;
  renderDevProyecto(j);
  renderDevChat();
  if (!quieto || !$('#dev-frame').src) recargarPreview(j);
}

function recargarPreview(p = devProyectos.find((x) => x.id === devId)) {
  if (!p) return;
  $('#dev-frame').src = p.tieneBuild ? `/p/${p.id}/?v=${Date.now()}` : 'about:blank';
}

function renderDevProyecto(p = devProyectos.find((x) => x.id === devId)) {
  if (!p) return;
  $('#dev-nombre').textContent = p.nombre;
  $('#dev-sub').textContent = `${p.rubro || ''}${p.rubro ? ' · ' : ''}versión ${p.version || 1}${p.costo ? ` · $${p.costo.toFixed(2)} equiv.` : ''}`;
  if (document.activeElement !== $('#dev-estado')) $('#dev-estado').value = p.estado;
  $('#dev-url').textContent = p.preview.replace(/^https:\/\//, '');
  $('#dev-url').href = p.preview;
  const w = $('#dev-trabajo');
  w.hidden = !p.trabajando;
  if (p.trabajando) w.querySelector('span:not(.spin)').textContent = p.trabajo || 'Trabajando…';
  $('#dev-input').disabled = Boolean(p.trabajando);
  $('#dev-calidad').textContent = p.calidad ? `Calidad: ${p.calidad}/10` : '';
  $('[data-dev-enviar]').hidden = !(p.origen?.conv && p.tieneBuild && !p.trabajando);
  $('[data-dev-enviar]').textContent = p.envioProgramado ? `📲 Enviar ahora (programada: ${dayTime(p.envioProgramado)})` : p.enviada ? '📲 Reenviar al cliente' : '📲 Enviar al cliente';
  $('[data-dev-cancelenvio]').hidden = !p.envioProgramado;
  $('#dev-frame-wrap').dataset.device = devDevice;
  $$('[data-dev-device]').forEach((b) => b.classList.toggle('on', b.dataset.devDevice === devDevice));
}

function renderDevChat() {
  const box = $('#dev-msgs');
  box.innerHTML = devChat.length ? devChat.map((m) => m.role === 'user' ? `<div class="msg user">${esc(m.text)}<time>${time(m.ts)}</time></div>`
    : m.role === 'sistema' ? `<div class="msg sys">${esc(m.text)}</div>`
    : `<div class="msg bot">${markdown(m.text)}<time>${time(m.ts)}</time></div>`).join('')
    : '<div class="msg sys">Escribile al constructor lo que quieras cambiar: textos, colores, secciones, fotos, precios…</div>';
  box.scrollTop = box.scrollHeight;
}

async function cargarVersiones() {
  const list = await fetch(`/api/proyectos/${devId}/versiones`).then((r) => r.json()).catch(() => []);
  $('#dev-versiones-list').innerHTML = list.map((v, i) => `<div class="dev-ver"><span><b>${i === 0 ? 'Actual' : `v${list.length - i}`}</b> ${esc(v.mensaje)}<small>${ago(v.ts)}</small></span>${i ? `<button class="link" data-dev-version="${v.hash}">Volver a esta</button>` : ''}</div>`).join('') || '<p class="note">Sin versiones.</p>';
}

async function devEnviar() {
  const t = $('#dev-input').value.trim();
  if (!t || !devId) return;
  $('#dev-input').value = '';
  const res = await fetch(`/api/proyectos/${devId}/pedir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: t }) });
  if (!res.ok) { $('#dev-input').value = t; alert((await res.json().catch(() => ({}))).error || 'No se pudo enviar.'); }
}
$('#dev-chat-form').addEventListener('submit', (e) => { e.preventDefault(); devEnviar(); });
$('#dev-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); devEnviar(); } });
$('#dev-estado').addEventListener('change', async (e) => {
  const r = await fetch(`/api/proyectos/${devId}/estado`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: e.target.value }) });
  if (!r.ok) alert('No se pudo cambiar el estado.');
});
$('#dev-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = Object.fromEntries(f.entries());
  $('#dev-form-msg').textContent = 'Creando…';
  const res = await fetch('/api/proyectos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { $('#dev-form-msg').textContent = j.error || 'No se pudo crear.'; return; }
  e.target.reset();
  e.target.hidden = true;
  $('#dev-form-msg').textContent = '';
  go('desarrollo', j.id);
});
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-dev-nuevo], [data-dev-cancelar], [data-dev-abrir], [data-dev-volver], [data-dev-device], [data-dev-recargar], [data-dev-detener], [data-dev-version], [data-dev-revisar], [data-dev-enviar], [data-dev-cancelenvio], [data-cz-pago], [data-cz-tel], [data-cz-chat]');
  if (!t) return;
  const d = t.dataset;
  if (d.devNuevo) { $('#dev-form').hidden = false; $('#dev-form [name=nombre]').focus(); }
  if (d.devCancelar) $('#dev-form').hidden = true;
  if (d.devAbrir) go('desarrollo', d.devAbrir);
  if (d.czPago) { czPago(d.czPago, Number(d.czResto)); return; }
  if (d.czChat) { openVConv(d.czChat); return; }
  if (d.czTel) { window.copiarTel ? window.copiarTel(t) : navigator.clipboard?.writeText(d.czTel); return; }
  if (d.devVolver) go('desarrollo');
  if (d.devDevice) { devDevice = d.devDevice; renderDevProyecto(); }
  if (d.devRecargar) recargarPreview();
  if (d.devCancelenvio) {
    const r = await fetch(`/api/proyectos/${devId}/cancelar-envio`, { method: 'POST' });
    if (!r.ok) alert('No se pudo cancelar el envío.');
    return;
  }
  if (d.devEnviar) {
    const p = devProyectos.find((x) => x.id === devId);
    const dlg = document.createElement('dialog');
    dlg.className = 'pr-dialog';
    dlg.innerHTML = `<form method="dialog" class="ng"><h2>${p?.enviada ? 'Reenviar' : 'Enviar'} la demo de ${esc(p?.nombre || '')}</h2>
      <label>Fecha y hora de envío<input class="ng-in" type="datetime-local" name="cuando" value="${fechaLocal(p?.envioProgramado || p?.fechaSugerida || Date.now() + 24 * 3600e3)}"></label>
      <p class="muted">Sugerida: 1 día después del pedido y en horario (lunes a sábado, 9 a 5). El vendedor le escribe con el enlace y le da seguimiento a los 1, 3 y 7 días.</p>
      <div class="ng-row"><button class="btn principal" value="programar">Programar</button><button class="btn" value="ahora">Enviar ahora</button><button class="btn ghost" value="cancel">Cancelar</button></div></form>`;
    document.body.append(dlg);
    dlg.showModal();
    await new Promise((r) => dlg.addEventListener('close', r, { once: true }));
    const val = dlg.querySelector('[name=cuando]').value;
    dlg.remove();
    if (dlg.returnValue !== 'programar' && dlg.returnValue !== 'ahora') return;
    t.disabled = true;
    const body = dlg.returnValue === 'ahora' ? { ahora: true } : { cuando: new Date(val).getTime() };
    const r = await fetch(`/api/proyectos/${devId}/enviar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    t.disabled = false;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return alert(j.error || 'No se pudo enviar.');
    window.toast?.(j.envioProgramado ? `Programada para ${dayTime(j.envioProgramado)}` : 'Listo: la demo salió por WhatsApp', 'ok');
  }
  if (d.devRevisar) { const r = await fetch(`/api/proyectos/${devId}/revisar`, { method: 'POST' }); if (!r.ok) alert((await r.json().catch(() => ({}))).error || 'No se pudo.'); }
  if (d.devDetener) await fetch(`/api/proyectos/${devId}/detener`, { method: 'POST' });
  if (d.devVersion) {
    if (!confirm('¿Volver a esta versión? Lo de después queda guardado en el historial.')) return;
    const r = await fetch(`/api/proyectos/${devId}/volver`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: d.devVersion }) });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error || 'No se pudo.');
    t.closest('details')?.removeAttribute('open');
    recargarPreview();
  }
});
$('.dev-versiones').addEventListener('toggle', (e) => { if (e.target.open) cargarVersiones(); });

function onDevEvent(ev) {
  if (ev.type === 'proyecto') {
    const p = ev.proyecto;
    const i = devProyectos.findIndex((x) => x.id === p.id);
    const antes = i >= 0 ? devProyectos[i] : null;
    if (i >= 0) devProyectos[i] = { ...antes, ...p }; else devProyectos.unshift(p);
    if (view === 'desarrollo' && !devId) renderDevLista();
    if (p.id === devId) {
      renderDevProyecto();
      if (p.compilado && p.compilado !== antes?.compilado) recargarPreview();
    }
  }
  // La sala de Desarrollo de la oficina refleja si el constructor (o el revisor) está trabajando.
  const vivo = devProyectos.find((x) => x.trabajando);
  if (ev.type === 'proyecto-trabajo') office.setDev?.(ev.texto);
  else if (ev.type === 'proyecto') office.setDev?.(vivo ? vivo.trabajo || 'Trabajando en un proyecto…' : null);
  if (ev.type === 'proyecto-trabajo' && ev.id === devId) {
    const p = devProyectos.find((x) => x.id === devId);
    if (p) { p.trabajo = ev.texto; p.trabajando = true; renderDevProyecto(); }
  }
  if (ev.type === 'proyecto-msg' && ev.id === devId) { devChat.push(ev.mensaje); renderDevChat(); }
}
if (view === 'desarrollo') applyRoute();
$('#dev-fotos').addEventListener('change', async (e) => {
  for (const f of [...e.target.files]) {
    const base64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
    const res = await fetch(`/api/proyectos/${devId}/fotos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: f.name, base64 }) });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || `No se pudo subir ${f.name}`);
  }
  e.target.value = '';
  $('#dev-input').value ||= 'Usá las fotos del cliente que acabo de subir donde mejor queden (reemplazá las generadas que correspondan).';
  $('#dev-input').focus();
});
// Al abrir la oficina: si hay un proyecto en marcha, el constructor ya aparece trabajando.
fetch('/api/proyectos').then((r) => r.json()).then((list) => { devProyectos = list; const v = list.find((x) => x.trabajando); office.setDev?.(v ? v.trabajo || 'Trabajando en un proyecto…' : null); }).catch(() => {});
// La Bandeja necesita los proyectos de Desarrollo para prellenar la fecha de envío de las demos.
fetch('/api/proyectos').then((r) => r.json()).then((j) => { if (Array.isArray(j) && !devProyectos.length) { devProyectos = j; invalidateAll(); } }).catch(() => {});
