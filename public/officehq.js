// Cuartel de Cresova en pixel art: salas por departamento, un pasillo que las une
// y un escuadrón de héroes originales (uno por agente). Todo se puede tocar: una
// sala abre el chat de su equipo, un héroe abre su chat personal y el botón 3D de
// cada sala la muestra en vista isométrica. Nombres y globos van en HTML.
import { makeSprites, SPRITE_W, SPRITE_H } from './sprites.js';

const W = 880, H = 500;            // 3 filas de salas + terraza al aire libre
const SPEED = 38;                  // px por segundo
const AT_WORK = ['working', 'tool', 'waiting', 'error'];
const OUT = '#141218';             // contorno de todo, como en los RPG de bolsillo

const CHIPS = {
  metaads: ['META', '#1877f2'], uploadpost: ['POST', '#ff5a1f'], cresova: ['CRE', '#e30016'], oficina: ['OFI', '#7c5cff'],
  WebSearch: ['WEB', '#21c48d'], WebFetch: ['WEB', '#21c48d'], Bash: ['CMD', '#f5b400'], Skill: ['SKILL', '#f5b400'],
  Read: ['FILE', '#8d93a3'], Write: ['FILE', '#8d93a3'], Edit: ['FILE', '#8d93a3'], Glob: ['FILE', '#8d93a3'], Grep: ['FILE', '#8d93a3'],
};

// Salas. dept → abre el chat del departamento; agent → el chat de esa persona; link → otra pestaña.
const ROOMS = [
  // Fila 1 (puerta abajo, al pasillo 1)
  { id: 'marketing', name: 'Contenido orgánico', sub: 'Hablar con el equipo', x: 8, y: 8, w: 200, h: 140, dept: 'marketing', icon: 'bulb' },
  { id: 'pauta', name: 'Ads (Pauta)', sub: 'Hablar con el equipo', x: 212, y: 8, w: 200, h: 140, dept: 'pauta', icon: 'chart' },
  { id: 'prospeccion', name: 'Prospección', sub: 'Hablar con Brújula', x: 416, y: 8, w: 200, h: 140, dept: 'prospeccion', icon: 'star' },
  // Fila 2 (puerta abajo, al pasillo 2). Jarvis al centro, con otra puerta al pasillo 1.
  { id: 'edicion', name: 'Sala de edición', sub: 'Ver al equipo', x: 8, y: 180, w: 200, h: 140, team: 'edicion', icon: 'film' },
  { id: 'mando', name: 'Dirección · Jarvis', sub: 'Hablar con Jarvis', x: 212, y: 180, w: 200, h: 140, agent: 'coordinador', icon: 'star' },
  { id: 'ventas', name: 'Ventas', sub: 'Hablar con el equipo', x: 416, y: 180, w: 200, h: 140, dept: 'ventas', icon: 'chart' },
  // Fila 3 (puerta en la pared del fondo, desde el pasillo 2)
  { id: 'estudio', name: 'Estudio de render', sub: 'Ver videos', x: 8, y: 352, w: 200, h: 140, link: 'estudio', icon: 'film' },
  { id: 'desarrollo', name: 'Desarrollo', sub: 'Ver proyectos', x: 212, y: 352, w: 200, h: 140, link: 'desarrollo', icon: 'code' },
  { id: 'juntas', name: 'Sala de juntas', sub: 'Reuniones del equipo', x: 416, y: 352, w: 200, h: 140, link: 'bandeja', icon: 'cup' },
  // Afuera: la terraza (descanso), a la que dan los dos pasillos.
  { id: 'terraza', name: 'Terraza', sub: 'Café, jardín y ping-pong', x: 624, y: 8, w: 248, h: 484, icon: 'cup', outdoor: true },
];
const roomById = (id) => ROOMS.find((r) => r.id === id);

// Escuadrón: personajes propios de Cresova en estilo RPG de bolsillo.
const HEROES = {
  coordinador: { alias: 'Jarvis', hair: '#2a2a33', hairStyle: 'short', clothes: '#b3001b', accent: '#f5b400', gearKind: 'visor', gear: '#5ff2ff', pants: '#3a2a10', boots: '#f5b400' },
  estratega: { alias: 'Radar', hair: '#8a6cff', hairStyle: 'ponytail', clothes: '#4b36b8', accent: '#5ff2ff', gearKind: 'goggles', gear: '#5ff2ff', pants: '#26254a' },
  guionista: { alias: 'Chispa', hair: '#ffb020', hairStyle: 'spiky', clothes: '#ff7a1a', accent: '#fff3b0', gearKind: 'mask', gear: '#9a2c00', pants: '#3a2a20' },
  video: { alias: 'Reel', hair: '#2b1d16', hairStyle: 'long', clothes: '#ff3d8b', accent: '#ffffff', gearKind: 'beanie', gear: '#1f1f2a', pants: '#2b2f45' },
  community: { alias: 'Cometa', hair: '#5a3a22', hairStyle: 'short', clothes: '#21c48d', accent: '#ffffff', gearKind: 'cap', gear: '#0f7a55', pants: '#2b2f45', boots: '#f2f3f7' },
  media: { alias: 'Mira', hair: '#1b2a4a', hairStyle: 'ponytail', clothes: '#2f7bff', accent: '#ffffff', gearKind: 'visor', gear: '#5ff2ff', pants: '#1f2233' },
  gerente_ventas: { alias: 'Cierre', hair: '#3b2a1e', hairStyle: 'short', clothes: '#1f6f4a', accent: '#f5b400', gearKind: 'headset', gear: '#2b2f3a', pants: '#1f2233' },
  vendedor: { alias: 'WhatsApp', hair: '#2a1a12', hairStyle: 'spiky', clothes: '#25d366', accent: '#ffffff', gearKind: 'cap', gear: '#128c4a', pants: '#2b2f45' },
  video2: { alias: 'Corte', hair: '#3a2418', hairStyle: 'spiky', clothes: '#ff9f43', accent: '#ffffff', gearKind: 'headset', gear: '#2b2f3a', pants: '#2b2f45' },
  video3: { alias: 'Fotograma', hair: '#1b1b2a', hairStyle: 'long', clothes: '#a66bff', accent: '#ffffff', gearKind: 'beanie', gear: '#2b2f3a', pants: '#1f2233' },
  constructor: { alias: 'Luis', hair: '#1d1d2a', hairStyle: 'spiky', clothes: '#00a99d', accent: '#ffffff', gearKind: 'headset', gear: '#2b2f3a', pants: '#1f2233', boots: '#f2f3f7' },
  revisor: { alias: 'Ashley', hair: '#c9a46a', hairStyle: 'long', clothes: '#f5b400', accent: '#141218', gearKind: 'goggles', gear: '#5ff2ff', pants: '#2b2f45' },
  analista_pauta: { alias: 'Tomás', hair: '#2b1d16', hairStyle: 'short', clothes: '#0a66c2', accent: '#ffffff', gearKind: 'visor', gear: '#5ff2ff', pants: '#1f2233' },
  calidad_leads: { alias: 'Sofía', hair: '#5a3a22', hairStyle: 'long', clothes: '#42b72a', accent: '#ffffff', gearKind: 'headset', gear: '#2b2f3a', pants: '#2b2f45' },
  prospector: { alias: 'Brújula', hair: '#1b2433', hairStyle: 'short', clothes: '#2f7bd9', accent: '#ffffff', gearKind: 'goggles', gear: '#5ff2ff', pants: '#1f2233', boots: '#f2f3f7' },
  viralidad: { alias: 'Veredicto', hair: '#ffe08a', hairStyle: 'spiky', clothes: '#e0a100', accent: '#5b2a3a', gearKind: 'visor', gear: '#d8102a', pants: '#3a2a20' },
};
const DEFAULT_HERO = { alias: 'Agente', hair: '#3a2418', hairStyle: 'short', clothes: '#555b6b', accent: '#f2f3f7' };

// Escritorios.
const DESK_X = [46, 108, 170];
const DESK_Y = [52, 96];
const MARKETING_ORDER = ['estratega', 'guionista', 'viralidad', 'community'];
const PAUTA_ORDER = ['media', 'analista_pauta', 'calidad_leads'];
const PROS_ORDER = ['prospector'];
const EDIT_ORDER = ['video', 'video2', 'video3'];
const SALES_ORDER = ['gerente_ventas', 'vendedor'];
const DEV_ORDER = ['constructor', 'revisor'];
// Los dos de Desarrollo no son agentes de la oficina: se mueven según el trabajo de los proyectos.
const DEV_PEOPLE = [
  { id: 'constructor', nombre: 'Luis', rol: 'Arma y cambia los sitios', color: '#00a99d' },
  { id: 'revisor', nombre: 'Ashley', rol: 'Revisa la calidad', color: '#f5b400' },
];

const spot = (x, y, side = { x, y }, extra = {}) => ({ pos: { x, y }, side, ...extra });
const deskAt = (cx, dy) => ({ ...spot(cx, dy + 4, { x: cx - 31, y: dy + 4 }), desk: { kind: 'desk', x: cx, y: dy } });
function deskSpotFor(id, i) {
  if (id === 'coordinador') return { ...spot(312, 222), desk: { kind: 'holo', x: 312, y: 228 } };
  if (id === 'auditor') return deskAt(378, 238);
  const e = EDIT_ORDER.indexOf(id);
  if (e >= 0) { const cx = [46, 100, 154][e], dy = 224; return { ...spot(cx, dy + 4, { x: cx, y: dy + 22 }), desk: { kind: 'desk', x: cx, y: dy } }; }
  const v = SALES_ORDER.indexOf(id);
  if (v >= 0) return deskAt([470, 550][v], 224);
  const g = DEV_ORDER.indexOf(id);
  if (g >= 0) return deskAt([262, 342][g], 400);
  const pa = PAUTA_ORDER.indexOf(id);
  if (pa >= 0) return deskAt([262, 324, 386][pa], 52);
  if (PROS_ORDER.includes(id)) return deskAt(470, 52);
  const k = MARKETING_ORDER.indexOf(id);
  const n = k >= 0 ? k : 6 + i;
  return deskAt(DESK_X[n % 3], DESK_Y[Math.floor(n / 3) % 2]);
}
const LOUNGE = {
  marketing: [spot(196, 122), spot(24, 122), spot(150, 124), spot(124, 104)],
  pauta: [spot(232, 122), spot(330, 124), spot(400, 120)],
  prospeccion: [spot(560, 64), spot(596, 118), spot(540, 124), spot(604, 124)],
  edicion: [spot(24, 292), spot(196, 292), spot(150, 300)],
  mando: [spot(232, 292), spot(392, 300), spot(290, 296)],
  ventas: [spot(600, 292), spot(440, 296), spot(560, 296)],
  desarrollo: [spot(230, 462), spot(400, 462), spot(372, 476)],
  juntas: [spot(428, 470, { x: 428, y: 470 }), spot(604, 470, { x: 604, y: 470 }), spot(604, 420, { x: 604, y: 420 })],
};
// Terraza: café, mesas de picnic, ping-pong, fuente, hamaca, parrilla y camastros (cada lugar con su actividad).
const BREAK = [
  spot(700, 66, undefined, { act: 'cafe', dir: 'up' }), spot(722, 66, undefined, { act: 'cafe', dir: 'up' }), spot(744, 66, undefined, { act: 'cafe', dir: 'up' }),
  spot(812, 82, { x: 790, y: 82 }, { act: 'sofa', dir: 'down' }), spot(840, 82, { x: 790, y: 82 }, { act: 'sofa', dir: 'down' }),
  spot(812, 124, undefined, { act: 'sofa', dir: 'up' }), spot(840, 124, undefined, { act: 'sofa', dir: 'up' }),
  spot(732, 208, undefined, { act: 'ping', dir: 'right' }), spot(820, 208, undefined, { act: 'ping', dir: 'left' }),
  spot(790, 270, undefined, { dir: 'right' }), spot(856, 270, undefined, { dir: 'left' }), spot(824, 300, undefined, { dir: 'up' }),
  spot(650, 300, undefined, { act: 'cafe', dir: 'up' }), spot(670, 300, undefined, { act: 'cafe', dir: 'up' }),
  spot(812, 386, undefined, { act: 'sofa', dir: 'down' }),
  spot(668, 452, undefined, { act: 'sofa', dir: 'up' }), spot(708, 452, undefined, { act: 'sofa', dir: 'up' }), spot(748, 452, undefined, { act: 'sofa', dir: 'up' }), spot(788, 452, undefined, { act: 'sofa', dir: 'up' }),
];

// ---------- caminos: puertas, dos pasillos y nada de atravesar paredes ----------
const HALL1 = 164, HALL2 = 336;
const NODES = {
  // Pasillo 1 (entre la fila 1 y la 2) y sus puertas
  H1L: { x: 18, y: HALL1 }, H1m: { x: 108, y: HALL1 }, H1d: { x: 248, y: HALL1 }, H1p: { x: 312, y: HALL1 }, H1r: { x: 516, y: HALL1 }, H1T: { x: 640, y: HALL1 },
  m: { x: 108, y: 132 }, pt: { x: 312, y: 132 }, pr: { x: 516, y: 132 },
  // Pasillo 2 (entre la fila 2 y la 3)
  H2L: { x: 18, y: HALL2 }, H2a: { x: 108, y: HALL2 }, H2b: { x: 312, y: HALL2 }, H2c: { x: 516, y: HALL2 }, H2T: { x: 640, y: HALL2 },
  eA: { x: 108, y: 304 }, dA: { x: 312, y: 304 }, vA: { x: 516, y: 304 },
  dT: { x: 248, y: 206 }, dTA: { x: 248, y: 304 },                                   // la puerta de atrás de Jarvis
  s: { x: 108, y: 384 }, sA: { x: 108, y: 470 }, dv: { x: 312, y: 384 }, dvA: { x: 312, y: 470 }, j: { x: 516, y: 384 }, jA: { x: 516, y: 392 },
  T1: { x: 700, y: HALL1 }, T2: { x: 700, y: HALL2 },                                 // senderos de la terraza
};
const EDGES = [['H1L', 'H1m'], ['H1m', 'H1d'], ['H1d', 'H1p'], ['H1p', 'H1r'], ['H1r', 'H1T'], ['H1T', 'T1'],
  ['H2L', 'H2a'], ['H2a', 'H2b'], ['H2b', 'H2c'], ['H2c', 'H2T'], ['H2T', 'T2'], ['T1', 'T2'],
  ['m', 'H1m'], ['pt', 'H1p'], ['pr', 'H1r'],
  ['eA', 'H2a'], ['dA', 'H2b'], ['vA', 'H2c'], ['H1d', 'dT'], ['dT', 'dTA'], ['dTA', 'dA'],
  ['H2a', 's'], ['s', 'sA'], ['H2b', 'dv'], ['dv', 'dvA'], ['H2c', 'j'], ['j', 'jA']];
const ENTRY = { marketing: 'm', pauta: 'pt', prospeccion: 'pr', edicion: 'eA', mando: 'dA', ventas: 'vA', estudio: 'sA', desarrollo: 'dvA', juntas: 'jA' };
const AISLE_Y = { marketing: 132, pauta: 132, prospeccion: 132, edicion: 304, mando: 304, ventas: 304, estudio: 470, desarrollo: 470, juntas: 392 };
const HALL_SPOTS = ['H1L', 'H1d', 'H2L', 'H1T', 'H2T'];
// Puertas: fila 1 y 2 dan al pasillo por abajo; la fila 3, por la pared del fondo. Jarvis tiene puerta a los dos pasillos.
const DOORS = [
  { room: 'marketing', side: 'bottom', x: 100 }, { room: 'pauta', side: 'bottom', x: 304 }, { room: 'prospeccion', side: 'bottom', x: 508 },
  { room: 'edicion', side: 'bottom', x: 100 }, { room: 'mando', side: 'bottom', x: 304 }, { room: 'ventas', side: 'bottom', x: 508 }, { room: 'mando', side: 'top', x: 240 },
  { room: 'estudio', side: 'top', x: 100 }, { room: 'desarrollo', side: 'top', x: 304 }, { room: 'juntas', side: 'top', x: 508 },
];
const hallSpot = (n) => ({ pos: { ...NODES[n] }, side: { ...NODES[n] }, node: n });

function placeOf(s) {
  if (s.node) return { node: s.node, aisle: NODES[s.node].y };
  const r = ROOMS.find((q) => s.side.x >= q.x && s.side.x <= q.x + q.w && s.side.y >= q.y && s.side.y <= q.y + q.h);
  // Terraza: espacio abierto; se llega por el sendero de arriba o el de abajo según dónde esté el lugar.
  if (r?.id === 'terraza') return s.side.y < 250 ? { room: 'terraza', node: 'T1', aisle: HALL1 } : { room: 'terraza', node: 'T2', aisle: HALL2 };
  return r && ENTRY[r.id] ? { room: r.id, node: ENTRY[r.id], aisle: AISLE_Y[r.id] } : null;
}
// Camino más corto entre dos puntos de la red (son pocos: alcanza con Dijkstra simple).
function shortest(a, b) {
  const dist = { [a]: 0 }, prev = {}, todo = new Set(Object.keys(NODES));
  while (todo.size) {
    let u = null;
    for (const n of todo) if (dist[n] != null && (u == null || dist[n] < dist[u])) u = n;
    if (u == null || u === b) break;
    todo.delete(u);
    for (const [x, y] of EDGES) {
      const w = x === u ? y : y === u ? x : null;
      if (!w || !todo.has(w)) continue;
      const nd = dist[u] + Math.abs(NODES[u].x - NODES[w].x) + Math.abs(NODES[u].y - NODES[w].y);
      if (dist[w] == null || nd < dist[w]) { dist[w] = nd; prev[w] = u; }
    }
  }
  const path = [b];
  while (path[0] !== a && prev[path[0]]) path.unshift(prev[path[0]]);
  return path[0] === a ? path : [a, b];
}
function route(from, to) {
  const a = placeOf(from), b = placeOf(to);
  let pts;
  if (!a || !b || (a.room && a.room === b.room)) {
    const y = (a || b)?.aisle ?? from.side.y;
    pts = [from.side, { x: from.side.x, y }, { x: to.side.x, y }, to.side, to.pos];
  } else {
    pts = [from.side, { x: from.side.x, y: a.aisle }, ...shortest(a.node, b.node).map((n) => NODES[n]), { x: to.side.x, y: b.aisle }, to.side, to.pos];
  }
  return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y).map((p) => ({ x: p.x, y: p.y }));
}

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const ICONS = {
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  star: '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
  cup: '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M7 2v3M11 2v3"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

export class OfficeHQ {
  constructor(canvas, overlay, agents, { onApprovalClick, onOpenChat, onOpenGroup, onOpenRoom } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.overlay = overlay;
    this.cb = { onApprovalClick, onOpenChat, onOpenGroup, onOpenRoom };
    canvas.width = W;
    canvas.height = H;
    canvas.classList.add('hq');
    this.t = 0;
    this.pending = 0;
    this.sparks = [];
    this.steam = [];
    this.tasks = [];
    this.hover = null;
    this.ball = 0;
    this.stars = Array.from({ length: 22 }, () => ({ x: rnd(314, 466), y: rnd(14, 30), p: rnd(0, 6) }));
    this.people = [...agents, ...DEV_PEOPLE].map((a, i) => {
      const desk = deskSpotFor(a.id, i);
      const room = a.coordinator || a.auditor ? 'mando' : a.dept === 'pauta' ? 'pauta' : a.dept === 'prospeccion' ? 'prospeccion' : a.dept === 'ventas' ? 'ventas' : EDIT_ORDER.includes(a.id) ? 'edicion' : DEV_ORDER.includes(a.id) ? 'desarrollo' : 'marketing';
      const p = {
        ...a, hero: HEROES[a.id] || DEFAULT_HERO, deskSpot: desk, room, spot: desk, x: desk.pos.x, y: desk.pos.y, path: [],
        status: 'idle', text: '', tool: null, nextWander: rnd(2, 8), step: 0, dir: 'down', blinkIn: rnd(1, 5), blink: 0,
      };
      p.sprites = makeSprites(p.hero);
      p.tag = this.el('div', 'tag hq-tag', `${a.nombre} · ${p.hero.alias}`);
      p.tag.style.setProperty('--c', a.color);
      p.bubble = this.el('div', 'bubble', '');
      p.bubble.style.opacity = 0;
      p.bubble.addEventListener('click', () => p.status === 'waiting' && this.cb.onApprovalClick?.());
      return p;
    });
    this.labels = ROOMS.map((r) => {
      const b = this.el('div', 'room-label-wrap', '');
      b.innerHTML = `<button class="room-label">${svg(r.icon)}<span class="rn">${r.name}</span><span class="rs">${r.sub}</span></button><button class="room-iso" title="Ver en 3D">${svg('cube')}</button>`;
      b.querySelector('.room-label').addEventListener('click', () => this.openRoom(r));
      b.querySelector('.room-iso').addEventListener('click', (e) => { e.stopPropagation(); this.openIso(r.id); });
      return { r, b };
    });

    canvas.addEventListener('mousemove', (e) => { this.hover = this.hit(e); canvas.style.cursor = this.hover ? 'pointer' : 'default'; });
    canvas.addEventListener('mouseleave', () => { this.hover = null; });
    canvas.addEventListener('click', (e) => {
      const h = this.hit(e);
      if (h?.p) this.cb.onOpenChat?.(h.p.id);
      else if (h?.r) this.openRoom(h.r);
    });

    new ResizeObserver(() => this.fit()).observe(canvas.parentElement);
    this.fit();
    let last = performance.now();
    const loop = (now) => {
      let dt = Math.min(5, (now - last) / 1000);
      last = now;
      while (dt > 0) { this.update(Math.min(0.05, dt)); dt -= 0.05; }
      if (canvas.offsetParent) this.draw();
      if (this.iso) this.drawIso();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  el(tag, cls, text) {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    this.overlay.appendChild(e);
    return e;
  }

  openRoom(r) {
    if (r.dept) this.cb.onOpenGroup?.(r.dept);
    else if (r.agent) this.cb.onOpenChat?.(r.agent);
    else if (r.team) this.cb.onOpenRoom?.(`team:${r.team}`);
    else if (r.link) this.cb.onOpenRoom?.(r.link);
    else this.openIso(r.id); // la sala de descanso no tiene chat: se ve en 3D
  }

  hit(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const p = [...this.people].sort((a, b) => b.y - a.y).find((q) => Math.abs(x - q.x) <= 8 && y >= q.y - 24 && y <= q.y + 2);
    if (p) return { p };
    const r = ROOMS.find((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
    return r ? { r } : null;
  }

  fit() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const scale = Math.max(0.5, Math.min((box.width - 12) / W, (box.height - 12) / H));
    this.scale = scale;
    this.canvas.style.width = `${Math.round(W * scale)}px`;
    this.canvas.style.height = `${Math.round(H * scale)}px`;
  }

  setAgent(id, agent) {
    const p = this.people.find((x) => x.id === id);
    if (!p) return;
    p.status = agent.status;
    p.text = agent.text || '';
    p.tool = agent.tool || null;
    const atWork = AT_WORK.includes(p.status);
    if (atWork && p.spot !== p.deskSpot && !p.errand && !p.meeting) this.goTo(p, p.deskSpot);
    if (!atWork) p.nextWander = Math.min(p.nextWander, rnd(2, 5));
  }

  // Reunión en curso: los participantes caminan a la mesa de la Sala de juntas y se quedan ahí hasta que termina.
  setReunion(r) {
    const SILLAS = [[458, 404], [494, 404], [530, 404], [566, 404], [458, 452], [494, 452], [530, 452], [566, 452]];
    for (const p of this.people) {
      const va = r && r.participantes?.includes(p.id);
      if (va && !p.meeting) {
        const n = r.participantes.indexOf(p.id) % SILLAS.length, [x, y] = SILLAS[n];
        p.meeting = spot(x, y, y < 430 ? { x, y } : { x: 428, y }, { dir: y < 430 ? 'down' : 'up' });
        p.errand = null; p.carrying = false;
        this.goTo(p, p.meeting);
      } else if (!va && p.meeting) {
        p.meeting = null;
        this.goTo(p, p.deskSpot);
      }
    }
    this.reunion = r;
  }

  setPending(n) { this.pending = n; }
  setNeeds(ids) { this.needs = ids; }
  setTasks(tasks) { this.tasks = tasks; }
  // texto = en qué anda el constructor (null si no hay ningún proyecto en marcha).
  setDev(texto) {
    const rev = texto && /revisor/i.test(texto);
    this.setAgent('constructor', { status: texto && !rev ? 'working' : 'idle', text: texto && !rev ? texto : '' });
    this.setAgent('revisor', { status: rev ? 'working' : 'idle', text: rev ? texto : '' });
  }

  handoff(fromId, toId) {
    const a = this.people.find((x) => x.id === fromId);
    const b = this.people.find((x) => x.id === toId);
    if (!a || !b || a === b || a.errand) return;
    const s = b.deskSpot.side;
    const holo = b.deskSpot.desk.kind === 'holo';
    const visit = spot(s.x + (holo ? -16 : 6), b.deskSpot.pos.y + 10, { x: s.x + (holo ? -16 : 0), y: b.deskSpot.pos.y + 10 });
    a.errand = { stage: 'go', wait: 0, to: b };
    a.carrying = true;
    this.goTo(a, visit);
  }

  goTo(p, s) {
    p.path = route(p.spot, s);
    p.spot = s;
  }

  // A dónde va alguien que está libre: su sala, el pasillo o un rato a la sala de descanso.
  wanderTarget(p) {
    const taken = (s) => this.people.some((o) => o !== p && o.spot === s);
    const roll = Math.random();
    const brk = BREAK.filter((s) => !taken(s));
    // El ping-pong necesita dos: si alguien espera en una punta, a veces otro va a la otra.
    const waiting = BREAK.find((s) => s.act === 'ping' && taken(s));
    if (waiting && roll < 0.5) { const other = BREAK.find((s) => s.act === 'ping' && s !== waiting && !taken(s)); if (other) return other; }
    if (brk.length && roll < 0.35) return pick(brk);
    const hall = HALL_SPOTS.filter((n) => !this.people.some((o) => o !== p && o.spot?.node === n));
    if (hall.length && roll < 0.47) return hallSpot(pick(hall));
    return pick([...(LOUNGE[p.room] || []).filter((s) => !taken(s)), p.deskSpot]);
  }

  update(dt) {
    this.t += dt;
    for (const p of this.people) {
      const atWork = AT_WORK.includes(p.status);
      if (!atWork && !p.path.length && !p.errand && !p.meeting) {
        p.nextWander -= dt;
        if (p.nextWander <= 0) {
          this.goTo(p, this.wanderTarget(p));
          p.nextWander = p.spot.act ? rnd(14, 28) : rnd(9, 20);
        }
      }
      p.moving = false;
      if (p.path.length) {
        const tg = p.path[0];
        const dx = tg.x - p.x, dy = tg.y - p.y;
        const d = Math.hypot(dx, dy);
        const step = SPEED * (atWork || p.errand ? 1.5 : 1) * dt;
        if (d <= step) { p.x = tg.x; p.y = tg.y; p.path.shift(); } else {
          p.x += (dx / d) * step; p.y += (dy / d) * step;
          p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
          p.moving = true;
          p.step += dt * 7;
        }
      }
      // Ya llegó: mira hacia donde corresponde (escritorio, cafetera, mesa de ping-pong).
      p.act = !p.path.length && p.spot.act ? p.spot.act : null;
      if (!p.moving && !p.path.length) {
        if (p.spot === p.deskSpot || p.errand?.stage === 'drop') p.dir = 'down';
        else if (p.spot.dir) p.dir = p.spot.dir;
      }
      if ((p.act === 'cafe' || p.act === 'sofa') && Math.random() < dt * 1.2) this.steam.push({ x: p.x + (p.dir === 'left' ? -5 : 8), y: p.y - 13, life: 1 });
      p.blinkIn -= dt;
      if (p.blinkIn <= 0) { p.blink = 0.14; p.blinkIn = rnd(2.5, 6); }
      if (p.blink > 0) p.blink -= dt;
      p.seated = !p.path.length && p.spot === p.deskSpot && p.deskSpot.desk.kind === 'desk';
      if (p.errand && !p.path.length) {
        const e = p.errand;
        if (e.stage === 'go') {
          e.stage = 'drop'; e.wait = 1.2; p.carrying = false;
          for (let i = 0; i < 14; i++) this.sparks.push({ x: e.to.x, y: e.to.y - 14, vx: rnd(-40, 40), vy: rnd(-60, -15), life: 1, color: p.color });
        } else if (e.stage === 'drop') {
          e.wait -= dt;
          if (e.wait <= 0) { e.stage = 'back'; this.goTo(p, p.deskSpot); }
        } else p.errand = null;
      }
    }
    this.pingers = this.people.filter((p) => p.act === 'ping').length === 2;
    if (this.pingers) this.ball += dt * 1.6;
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 110 * dt; s.life -= dt * 1.5; }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    for (const s of this.steam) { s.y -= dt * 9; s.x += Math.sin(this.t * 4 + s.y) * dt * 3; s.life -= dt * 0.8; }
    this.steam = this.steam.filter((s) => s.life > 0);
  }

  // ---------- dibujo (estilo RPG de bolsillo: contornos negros, colores claros) ----------
  draw() {
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#211c2e';
    c.fillRect(0, 0, W, H);
    this.drawTerraza(c);
    this.drawHall(c);
    for (const r of ROOMS) if (!r.outdoor) this.drawRoom(c, r);
    this.drawDoors(c);
    const items = [];
    for (const p of this.people) {
      const d = p.deskSpot.desk;
      if (d.kind === 'desk') items.push({ y: d.y + 3, draw: () => this.drawChair(c, d) });
      items.push({ y: d.y + 12, draw: () => (d.kind === 'holo' ? this.drawHolo(c, d) : this.drawDesk(c, p)) });
      items.push({ y: p.y, draw: () => this.drawHero(c, p) });
    }
    this.drawProps(c, items);
    items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());
    for (const s of this.sparks) { c.globalAlpha = Math.max(0, s.life); c.fillStyle = s.color; c.fillRect(s.x | 0, s.y | 0, 2, 2); }
    for (const s of this.steam) { c.globalAlpha = Math.max(0, s.life) * 0.7; c.fillStyle = '#ffffff'; c.fillRect(s.x | 0, s.y | 0, 1, 2); }
    c.globalAlpha = 1;
    this.drawOutlines(c);
    this.placeLabels();
  }

  // Mueble con contorno, brillo arriba y sombra abajo.
  box(c, x, y, w, h, fill, light = 0.3, dark = -0.25) {
    c.fillStyle = OUT; c.fillRect(x, y, w, h);
    c.fillStyle = fill; c.fillRect(x + 1, y + 1, w - 2, h - 2);
    c.fillStyle = shade(fill, light); c.fillRect(x + 1, y + 1, w - 2, 1);
    c.fillStyle = shade(fill, dark); c.fillRect(x + 1, y + h - 2, w - 2, 1);
  }

  floorPlanks(c, x0, y0, w, h, base) {
    const seam = shade(base, -0.22), hi = shade(base, 0.18);
    c.fillStyle = base; c.fillRect(x0, y0, w, h);
    for (let y = y0, row = 0; y < y0 + h; y += 6, row++) {
      c.fillStyle = seam; c.fillRect(x0, y + 5, w, 1);
      c.fillStyle = hi; c.fillRect(x0, y, w, 1);
      c.fillStyle = seam;
      for (let x = x0 + (row % 2 ? 6 : 18); x < x0 + w; x += 24) c.fillRect(x, y, 1, 5);
    }
  }

  floorTiles(c, x0, y0, w, h, a, b, line) {
    for (let y = y0; y < y0 + h; y += 8) for (let x = x0; x < x0 + w; x += 8) {
      c.fillStyle = ((x - x0) / 8 + (y - y0) / 8) % 2 < 1 ? a : b;
      c.fillRect(x, y, Math.min(8, x0 + w - x), Math.min(8, y0 + h - y));
      if (line) { c.fillStyle = line; c.fillRect(x, y, Math.min(8, x0 + w - x), 1); }
    }
  }

  rug(c, x, y, w, h, base, border) {
    c.fillStyle = OUT; c.fillRect(x, y, w, h);
    c.fillStyle = border; c.fillRect(x + 1, y + 1, w - 2, h - 2);
    c.fillStyle = base; c.fillRect(x + 3, y + 3, w - 6, h - 6);
    c.fillStyle = border;
    for (let i = x + 6; i < x + w - 6; i += 6) { c.fillRect(i, y + 5, 2, 2); c.fillRect(i, y + h - 7, 2, 2); }
  }

  // Pasillos: madera clara de punta a punta, con la sombra de las paredes y salida de vidrio a la terraza.
  drawHall(c) {
    for (const y of [148, 320]) {
      this.floorPlanks(c, 0, y, 624, 32, '#d8b98f');
      c.fillStyle = '#00000033'; c.fillRect(0, y, 624, 3);
      c.fillStyle = OUT; c.fillRect(0, y - 2, 4, 36);
      // Puerta de vidrio hacia la terraza.
      c.fillStyle = OUT; c.fillRect(616, y - 2, 8, 2); c.fillRect(616, y + 32, 8, 2);
      c.fillStyle = '#9fd8ff'; c.fillRect(618, y, 4, 32);
      c.fillStyle = '#ffffff'; c.fillRect(619, y + 4, 1, 10);
    }
    // Cuadros con la marca y una banca en cada pasillo.
    for (const [x, y] of [[150, 151], [420, 323]]) {
      this.box(c, x, y, 44, 9, '#f2e6d6', 0.15, -0.15);
      c.fillStyle = '#e30016'; c.fillRect(x + 4, y + 2, 6, 5);
      c.fillStyle = '#3a3350'; for (let k = 0; k < 5; k++) c.fillRect(x + 14 + k * 5, y + 4, 3, 1);
    }
  }

  // Terraza: césped, caminos de piedra, cerca de madera y un poco de cielo según la hora.
  drawTerraza(c) {
    const t = roomById('terraza');
    const h = this.hondurasHour();
    const day = Math.max(0, Math.min(1, Math.min(h - 5.5, 18.5 - h) / 1.5));
    c.fillStyle = '#5fae4e'; c.fillRect(t.x - 4, 0, W - t.x + 4, H);
    // Textura de pasto
    for (let y = 2; y < H; y += 6) for (let x = t.x + ((y / 6) % 2 ? 2 : 5); x < W; x += 9) {
      c.fillStyle = (x * 7 + y * 3) % 5 ? '#6cbd59' : '#4f9a42'; c.fillRect(x, y, 2, 1);
    }
    // Caminos de piedra: los dos que salen de los pasillos y uno que los une.
    const piedra = (x, y, w, hh) => {
      c.fillStyle = '#cfc4ad'; c.fillRect(x, y, w, hh);
      c.fillStyle = '#b5a98f';
      for (let yy = y; yy < y + hh; yy += 8) for (let xx = x + ((yy - y) / 8 % 2 ? 4 : 0); xx < x + w; xx += 12) c.fillRect(xx, yy, 1, 7), c.fillRect(xx, yy + 7, 11, 1);
    };
    piedra(624, 152, 92, 24); piedra(624, 324, 92, 24); piedra(688, 152, 24, 196);
    // Cerca de madera en el borde
    c.fillStyle = '#8a5a32'; c.fillRect(W - 6, 0, 6, H); c.fillRect(t.x - 4, H - 6, W - t.x + 4, 6); c.fillRect(t.x - 4, 0, W - t.x + 4, 4);
    c.fillStyle = '#b07a48'; for (let y = 6; y < H; y += 10) c.fillRect(W - 6, y, 6, 2);
    for (let x = t.x; x < W; x += 10) c.fillRect(x, H - 6, 2, 6);
    // Fuente (centro)
    c.fillStyle = OUT; c.beginPath(); c.ellipse(824, 272, 26, 14, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#9aa0ad'; c.beginPath(); c.ellipse(824, 272, 25, 13, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#4fb6ff'; c.beginPath(); c.ellipse(824, 272, 21, 10, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#9aa0ad'; c.fillRect(821, 256, 6, 16);
    c.fillStyle = '#bfe7ff'; for (let k = 0; k < 6; k++) { const a = this.t * 3 + k; c.fillRect(824 + Math.sin(a) * 8, 262 - Math.abs(Math.cos(a)) * 6, 2, 2); }
    // Tinte de noche
    if (day < 1) { c.fillStyle = `rgba(20,24,60,${(1 - day) * 0.35})`; c.fillRect(t.x - 4, 0, W - t.x + 4, H); }
  }

  // Marcos de puerta: hueco en la pared, umbral, jambas y una alfombrita en la entrada.
  drawDoors(c) {
    for (const d of DOORS) {
      const r = roomById(d.room);
      if (d.side === 'bottom') {
        const y = r.y + r.h - 2;
        c.fillStyle = '#d8b98f'; c.fillRect(d.x, y, 16, 2);
        this.box(c, d.x - 2, y - 3, 3, 6, '#8a5a32', 0.2, -0.2); this.box(c, d.x + 15, y - 3, 3, 6, '#8a5a32', 0.2, -0.2);
        this.box(c, d.x + 1, y + 3, 14, 4, '#7a2b2b', 0.15, -0.2);
      } else {
        // Puerta en la pared del fondo: vano con marco de madera y la alfombrita hacia el pasillo.
        c.fillStyle = OUT; c.fillRect(d.x - 2, r.y, 20, 25);
        c.fillStyle = '#8a5a32'; c.fillRect(d.x - 1, r.y, 18, 25);
        c.fillStyle = '#c9a776'; c.fillRect(d.x + 1, r.y, 14, 25);
        c.fillStyle = shade('#c9a776', -0.18); for (let y = r.y + 5; y < r.y + 25; y += 6) c.fillRect(d.x + 1, y, 14, 1);
        this.box(c, d.x + 1, r.y - 6, 14, 4, '#7a2b2b', 0.15, -0.2);
      }
    }
  }

  drawRoom(c, r) {
    const ix = r.x + 2, iy = r.y + 2, iw = r.w - 4;
    const floorY = r.y + 24;
    const fh = r.y + r.h - 2 - floorY;
    if (r.id === 'marketing') this.floorPlanks(c, ix, floorY, iw, fh, '#e0a86a');
    else if (r.id === 'mando') this.floorTiles(c, ix, floorY, iw, fh, '#a9c1e6', '#9db6de');
    else if (r.id === 'descanso') this.floorTiles(c, ix, floorY, iw, fh, '#f1dcc0', '#e6ceb0', '#dcc3a3');
    else if (r.id === 'estudio') this.floorTiles(c, ix, floorY, iw, fh, '#6c7a96', '#64718c', '#56627a');
    else if (r.id === 'ventas') this.floorPlanks(c, ix, floorY, iw, fh, '#c9b28e');
    else if (r.id === 'edicion') this.floorPlanks(c, ix, floorY, iw, fh, '#8c6a52');
    else if (r.id === 'pauta') this.floorTiles(c, ix, floorY, iw, fh, '#b8c9e8', '#aebfdf');
    else if (r.id === 'prospeccion') this.floorPlanks(c, ix, floorY, iw, fh, '#b9d0c9');
    else if (r.id === 'juntas') this.floorPlanks(c, ix, floorY, iw, fh, '#c9b28e');
    else this.floorTiles(c, ix, floorY, iw, fh, '#4c556b', '#465064', '#3e475a');
    const wall = WALLS[r.id];
    c.fillStyle = wall; c.fillRect(ix, iy, iw, floorY - iy);
    c.fillStyle = shade(wall, 0.25);
    for (let x = ix + 3; x < ix + iw; x += 8) c.fillRect(x, iy, 2, floorY - iy - 6);
    const trim = r.id === 'estudio' || r.id === 'desarrollo' ? '#1b2234' : r.id === 'mando' ? '#7d8fb3' : '#c48a5a';
    c.fillStyle = trim; c.fillRect(ix, floorY - 6, iw, 5);
    c.fillStyle = shade(trim, 0.25); c.fillRect(ix, floorY - 6, iw, 1);
    c.fillStyle = OUT; c.fillRect(ix, floorY - 1, iw, 1);
    c.fillStyle = OUT;
    c.fillRect(r.x, r.y, r.w, 2); c.fillRect(r.x, r.y + r.h - 2, r.w, 2);
    c.fillRect(r.x, r.y, 2, r.h); c.fillRect(r.x + r.w - 2, r.y, 2, r.h);
    c.fillStyle = '#e30016'; c.fillRect(r.x + 2, r.y + 2, r.w - 4, 1);
    const art = { marketing: 'drawMarketingWall', mando: 'drawCommandWall', estudio: 'drawStudio', edicion: 'drawEditWall', ventas: 'drawSalesWall', desarrollo: 'drawDevWall', pauta: 'drawAdsWall', prospeccion: 'drawProspWall', juntas: 'drawMeetingWall' }[r.id];
    this[art](c, r);
  }

  // Ads (Pauta): pantalla con el gráfico de resultados, el logo de Meta y el tablero de pruebas.
  drawAdsWall(c, r) {
    this.box(c, r.x + 8, r.y + 4, 70, 16, '#1b2234', 0.2, -0.2);
    c.fillStyle = '#0d1424'; c.fillRect(r.x + 10, r.y + 6, 66, 12);
    c.fillStyle = '#1877f2';
    [4, 6, 5, 8, 7, 9, 8, 10, 9, 11, 10, 12].forEach((v, i) => c.fillRect(r.x + 12 + i * 5, r.y + 17 - v, 3, v));
    this.box(c, r.x + 86, r.y + 4, 16, 16, '#1877f2', 0.2, -0.2);
    c.fillStyle = '#ffffff'; c.fillRect(r.x + 93, r.y + 8, 2, 10); c.fillRect(r.x + 91, r.y + 11, 6, 2);
    this.box(c, r.x + 112, r.y + 5, 52, 15, '#fbfbfd', 0, -0.1);
    c.fillStyle = '#3ad49c'; c.fillRect(r.x + 116, r.y + 9, 20, 3);
    c.fillStyle = '#ffc31f'; c.fillRect(r.x + 116, r.y + 14, 12, 3);
    c.fillStyle = '#ff6b7a'; c.fillRect(r.x + 140, r.y + 9, 8, 3);
    c.fillStyle = '#4f8dff'; c.fillRect(r.x + 140, r.y + 14, 18, 3);
    this.box(c, r.x + 172, r.y + 6, 12, 12, '#ffffff', 0, -0.15);
    c.fillStyle = OUT; c.fillRect(r.x + 177, r.y + 9, 1, 4); c.fillRect(r.x + 178, r.y + 12, 3, 1);
    this.rug(c, r.x + 40, r.y + 106, 120, 20, '#1877f2', '#0a4fb0');
  }
  // Prospección: mapa de Honduras con pines, archivero y una mesa de mapas.
  drawProspWall(c, r) {
    this.box(c, r.x + 14, r.y + 4, 80, 17, '#e8f1ec', 0, -0.1);
    c.fillStyle = '#9cc7b4'; c.fillRect(r.x + 18, r.y + 8, 34, 9); c.fillRect(r.x + 54, r.y + 6, 36, 12);
    c.fillStyle = '#e30016'; for (const [px, py] of [[24, 10], [38, 13], [60, 9], [74, 14], [84, 8]]) c.fillRect(r.x + px, r.y + py, 3, 3);
    this.box(c, r.x + 104, r.y + 5, 14, 15, '#2f7bd9', 0.2, -0.2);
    c.fillStyle = '#ffffff'; c.fillRect(r.x + 110, r.y + 8, 2, 9); c.fillRect(r.x + 107, r.y + 11, 8, 2);
    this.box(c, r.x + 128, r.y + 4, 40, 17, '#fbfbfd', 0, -0.1);
    c.fillStyle = '#2f7bd9'; c.fillRect(r.x + 132, r.y + 8, 30, 2); c.fillStyle = '#3ad49c'; c.fillRect(r.x + 132, r.y + 12, 22, 2); c.fillStyle = '#ffc31f'; c.fillRect(r.x + 132, r.y + 16, 12, 2);
    this.rug(c, r.x + 30, r.y + 106, 120, 20, '#2f7bd9', '#1d4f8f');
  }
  // Sala de juntas: pizarra con el orden del día, pantalla y una mesa larga para 8.
  drawMeetingWall(c, r) {
    this.box(c, r.x + 14, r.y + 4, 94, 17, '#fbfbfd', 0, -0.1);
    c.fillStyle = '#4f8dff'; c.fillRect(r.x + 20, r.y + 8, 40, 2); c.fillRect(r.x + 20, r.y + 12, 30, 2);
    c.fillStyle = '#e30016'; c.fillRect(r.x + 20, r.y + 16, 50, 2);
    c.fillStyle = '#3ad49c'; c.fillRect(r.x + 74, r.y + 8, 26, 10);
    const on = !!this.reunion;
    this.box(c, r.x + 118, r.y + 3, 66, 19, '#141218', 0.2, -0.2);
    c.fillStyle = on ? '#1877f2' : '#2a3044'; c.fillRect(r.x + 120, r.y + 5, 62, 15);
    if (on) { c.fillStyle = '#ffffff'; c.fillRect(r.x + 124, r.y + 8, 30, 2); c.fillRect(r.x + 124, r.y + 12, 44, 1); c.fillStyle = '#ffd23f'; c.fillRect(r.x + 124, r.y + 15, 20, 2); }
    this.rug(c, r.x + 18, r.y + 52, 164, 42, '#7a2b2b', '#c9a776');
    this.box(c, r.x + 26, r.y + 60, 148, 26, '#c98b4f', 0.15, -0.25);
    c.fillStyle = shade('#c98b4f', 0.2); c.fillRect(r.x + 28, r.y + 62, 144, 3);
    c.fillStyle = '#ffffff'; for (const dx of [40, 76, 112, 148]) c.fillRect(r.x + dx, r.y + 68, 6, 4);
    c.fillStyle = '#e30016'; c.fillRect(r.x + 96, r.y + 66, 8, 8);
  }

  drawMarketingWall(c, r) {
    this.box(c, r.x + 4, r.y + 5, 14, 14, '#e30016', 0.25, -0.25);
    c.fillStyle = '#ffffff'; c.fillRect(r.x + 8, r.y + 9, 6, 2); c.fillRect(r.x + 8, r.y + 9, 2, 6); c.fillRect(r.x + 8, r.y + 13, 6, 2);
    this.box(c, r.x + 22, r.y + 5, 56, 15, '#2b2f3a', 0.2, -0.2);
    c.fillStyle = '#10182a'; c.fillRect(r.x + 24, r.y + 7, 52, 11);
    c.fillStyle = '#e30016';
    [3, 5, 4, 7, 6, 8, 7, 9, 8, 10].forEach((v, i) => c.fillRect(r.x + 26 + i * 5, r.y + 17 - v, 3, v));
    this.box(c, r.x + 84, r.y + 4, 46, 16, '#fbfbfd', 0, -0.1);
    const cols = ['pendiente', 'en_progreso', 'espera', 'correcciones', 'hecha'];
    const colColor = ['#b4b8c4', '#4f8dff', '#ffc31f', '#ff6b7a', '#3ad49c'];
    cols.forEach((st, k) => {
      const n = this.tasks.filter((t) => t.status === st).length;
      c.fillStyle = '#d9dce4'; c.fillRect(r.x + 87 + k * 8, r.y + 6, 1, 12);
      c.fillStyle = colColor[k];
      for (let j = 0; j < Math.min(4, n); j++) c.fillRect(r.x + 89 + k * 8, r.y + 7 + j * 3, 4, 2);
    });
    [['#141218', '#25f4ee'], ['#ff0033', '#ffffff'], ['#c13584', '#ffd23f']].forEach(([bg, fg], k) => {
      const x = r.x + 134 + k * 11;
      this.box(c, x, r.y + 6, 10, 10, bg, 0.2, -0.2);
      c.fillStyle = fg; c.fillRect(x + 4, r.y + 9, 2, 4);
    });
    this.rug(c, r.x + 100, r.y + 84, 92, 36, '#d8102a', '#f6e7c8');
  }

  // Dirección (Jarvis, al centro): ventanales con el cielo real de Honduras, el escudo, alfombra roja hasta el holograma.
  drawCommandWall(c, r) {
    const h = this.hondurasHour();
    const day = Math.max(0, Math.min(1, Math.min(h - 5.5, 18.5 - h) / 1.5));
    const dusk = (h > 16.5 && h < 19) || (h > 5 && h < 7);
    const mix = (a, b, k) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
    const sky = mix([24, 30, 70], dusk ? [255, 160, 100] : [120, 190, 255], day);
    for (const [x0, w] of [[r.x + 50, 56], [r.x + 130, 56]]) {
      this.box(c, x0, r.y + 4, w, 17, '#8a6a4c', 0.2, -0.2);
      c.fillStyle = sky; c.fillRect(x0 + 2, r.y + 6, w - 4, 13);
      if (day < 0.5) for (const st of this.stars) { const sx = x0 + 2 + ((st.x * 7) % (w - 4)); c.fillStyle = Math.sin(this.t * 2 + st.p) > 0 ? '#ffffff' : '#8890b0'; c.fillRect(sx | 0, (r.y + 7 + (st.y % 6)) | 0, 1, 1); }
      let x = x0 + 2;
      for (const [bw, bh] of [[6, 6], [8, 9], [5, 5], [9, 8], [6, 7], [7, 10], [5, 6], [8, 7]]) {
        if (x >= x0 + w - 2) break;
        const ww = Math.min(bw, x0 + w - 2 - x);
        c.fillStyle = day < 0.5 ? '#151a33' : '#6a7fa8'; c.fillRect(x, r.y + 19 - bh, ww, bh);
        c.fillStyle = day < 0.5 ? '#ffd76e' : '#c9d6ee';
        if (ww > 3) c.fillRect(x + 2, r.y + 21 - bh, 1, 1);
        x += bw + 1;
      }
      c.fillStyle = '#8a6a4c'; c.fillRect(x0 + w / 2, r.y + 5, 1, 15);
    }
    this.box(c, r.x + 109, r.y + 3, 18, 18, '#e30016', 0.25, -0.25);
    c.fillStyle = '#ffd23f'; c.fillRect(r.x + 116, r.y + 6, 4, 2); c.fillRect(r.x + 114, r.y + 8, 8, 2); c.fillRect(r.x + 116, r.y + 10, 4, 6);
    this.box(c, r.x + 188, r.y + 6, 10, 12, '#ffffff', 0, -0.15);
    // Alfombra roja desde la puerta hasta el holograma y una alfombra grande alrededor.
    this.rug(c, r.x + 56, r.y + 30, 88, 46, '#d8102a', '#ffd23f');
    c.fillStyle = OUT; c.fillRect(r.x + 91, r.y + 76, 18, r.h - 78);
    c.fillStyle = '#b3001b'; c.fillRect(r.x + 92, r.y + 76, 16, r.h - 78);
    c.fillStyle = '#ffd23f'; c.fillRect(r.x + 92, r.y + 76, 1, r.h - 78); c.fillRect(r.x + 107, r.y + 76, 1, r.h - 78);
  }

  drawHolo(c, d) {
    const pulse = 0.55 + Math.sin(this.t * 2) * 0.2;
    this.box(c, d.x - 24, d.y, 48, 12, '#3a4256', 0.25, -0.25);
    c.fillStyle = '#5ff2ff'; c.fillRect(d.x - 20, d.y + 4, 40, 1);
    c.globalAlpha = pulse;
    c.fillStyle = '#5ff2ff';
    c.beginPath(); c.ellipse(d.x, d.y - 7, 13, 6, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = Math.min(1, pulse + 0.2);
    c.fillStyle = '#e30016';
    for (let i = 0; i < 4; i++) c.fillRect(d.x - 8 + ((i * 5 + Math.floor(this.t * 3)) % 16), d.y - 9 + (i % 3) * 2, 2, 2);
    c.globalAlpha = 1;
  }

  // Sala de descanso: menú del café, una ventana al jardín y un reloj. Los muebles van en drawProps.
  drawBreakWall(c, r) {
    this.box(c, r.x + 8, r.y + 4, 46, 17, '#3a2a1e', 0.15, -0.2);
    c.fillStyle = '#ffd23f'; c.fillRect(r.x + 12, r.y + 7, 18, 2);
    c.fillStyle = '#fbe9cf'; for (let k = 0; k < 3; k++) { c.fillRect(r.x + 12, r.y + 11 + k * 3, 24, 1); c.fillRect(r.x + 42, r.y + 11 + k * 3, 6, 1); }
    this.box(c, r.x + 66, r.y + 4, 56, 17, '#8a6a4c', 0.2, -0.2);
    c.fillStyle = '#9fd8ff'; c.fillRect(r.x + 68, r.y + 6, 52, 13);
    c.fillStyle = '#3aa36a'; c.fillRect(r.x + 68, r.y + 15, 52, 4);
    c.fillStyle = '#ffffff'; c.fillRect(r.x + 74, r.y + 8, 8, 2); c.fillRect(r.x + 98, r.y + 9, 10, 2);
    c.fillStyle = '#8a6a4c'; c.fillRect(r.x + 94, r.y + 5, 1, 15);
    this.box(c, r.x + 132, r.y + 6, 13, 13, '#ffffff', 0, -0.15);
    c.fillStyle = OUT; c.fillRect(r.x + 138, r.y + 9, 1, 4); c.fillRect(r.x + 139, r.y + 12, 3, 1);
  }

  drawStudio(c, r) {
    const busy = this.people.some((p) => p.studio && AT_WORK.includes(p.status));
    this.box(c, r.x + 10, r.y + 5, 30, 15, '#141218', 0.2, -0.2);
    c.fillStyle = '#ffffff';
    for (let k = 0; k < 4; k++) c.fillRect(r.x + 13 + k * 7, r.y + 7, 3, 3);
    c.fillStyle = busy ? '#ffd23f' : '#5ff2ff'; c.fillRect(r.x + 13, r.y + 13, busy ? 4 + Math.floor((this.t * 6) % 22) : 22, 4);
    for (let k = 0; k < 6; k++) {
      const x = r.x + 14 + k * 29, y = r.y + 40;
      this.box(c, x, y, 22, 60, '#4a5266', 0.25, -0.3);
      for (let j = 0; j < 7; j++) {
        c.fillStyle = '#2a3044'; c.fillRect(x + 3, y + 5 + j * 7, 16, 5);
        const on = Math.sin(this.t * (busy ? 9 : 1.4) + k * 3 + j * 1.7) > (busy ? -0.2 : 0.65);
        c.fillStyle = on ? (busy ? '#ffd23f' : '#3ad49c') : '#1d4d3a';
        c.fillRect(x + 5, y + 7 + j * 7, 2, 1);
        c.fillStyle = '#5ff2ff'; c.fillRect(x + 9, y + 7 + j * 7, 7, 1);
      }
    }
    this.rug(c, r.x + 20, r.y + 114, 150, 14, '#3a4256', '#2a3044');
  }

  drawEditWall(c, r) {
    const busy = this.people.some((p) => EDIT_ORDER.includes(p.id) && AT_WORK.includes(p.status));
    this.box(c, r.x + 6, r.y + 3, 70, 18, '#141218', 0.2, -0.2);
    c.fillStyle = '#1b2236'; c.fillRect(r.x + 8, r.y + 5, 66, 14);
    const clips = ['#ff4f8b', '#5ff2ff', '#ffd23f', '#3ad49c', '#8a6cff'];
    for (let row = 0; row < 3; row++) for (let k = 0; k < 4; k++) {
      c.fillStyle = clips[(k + row * 2) % clips.length];
      c.fillRect(r.x + 10 + k * 15 + row * 3, r.y + 7 + row * 4, 11, 2);
    }
    const head = busy ? (this.t * 14) % 62 : 30;
    c.fillStyle = '#e30016'; c.fillRect(r.x + 10 + head, r.y + 6, 1, 12);
    this.box(c, r.x + 114, r.y + 5, 14, 15, '#fbfbfd', 0, -0.1);
    c.fillStyle = OUT; for (let k = 0; k < 3; k++) c.fillRect(r.x + 116 + k * 4, r.y + 7, 2, 3);
    c.fillStyle = '#e30016'; c.fillRect(r.x + 116, r.y + 12, 10, 5);
    c.fillStyle = busy && Math.sin(this.t * 6) > 0 ? '#ff2238' : '#5a1520'; c.fillRect(r.x + 136, r.y + 8, 5, 5);
    this.rug(c, r.x + 20, r.y + 112, 110, 14, '#4b3a6a', '#2f2545');
  }

  drawSalesWall(c, r) {
    this.box(c, r.x + 8, r.y + 4, 50, 17, '#fbfbfd', 0, -0.1);
    [[40, '#25b86a'], [30, '#25b86a'], [20, '#f5b400'], [11, '#e30016']].forEach(([w, col], i) => {
      c.fillStyle = col; c.fillRect(r.x + 33 - w / 2, r.y + 6 + i * 3.5, w, 2);
    });
    this.box(c, r.x + 90, r.y + 5, 16, 15, '#25d366', 0.2, -0.2);
    c.fillStyle = '#ffffff'; c.fillRect(r.x + 94, r.y + 9, 8, 6); c.fillRect(r.x + 95, r.y + 15, 2, 2);
    c.fillStyle = '#25d366'; c.fillRect(r.x + 96, r.y + 11, 4, 1);
    this.box(c, r.x + 112, r.y + 6, 12, 12, '#ffffff', 0, -0.15);
    c.fillStyle = OUT; c.fillRect(r.x + 117, r.y + 9, 1, 4); c.fillRect(r.x + 118, r.y + 12, 3, 1);
    this.box(c, r.x + 128, r.y + 4, 18, 17, '#1f6f4a', 0.2, -0.2);
    c.fillStyle = '#f5b400'; c.fillRect(r.x + 131, r.y + 8, 12, 2);
    c.fillStyle = '#ffffff'; c.fillRect(r.x + 131, r.y + 12, 9, 1); c.fillRect(r.x + 131, r.y + 15, 11, 1);
    this.rug(c, r.x + 50, r.y + 108, 50, 20, '#2f9e63', '#1f6f4a');
  }

  drawDevWall(c, r) {
    const busy = this.people.some((p) => DEV_ORDER.includes(p.id) && AT_WORK.includes(p.status));
    this.box(c, r.x + 6, r.y + 4, 56, 17, '#141218', 0.2, -0.2);
    c.fillStyle = '#0d1424'; c.fillRect(r.x + 8, r.y + 6, 52, 13);
    const cols = ['#5ff2ff', '#ffd23f', '#ff4f8b', '#3ad49c', '#c9b8ff'];
    for (let j = 0; j < 5; j++) {
      const off = busy ? Math.floor(this.t * 4 + j) % 5 : j;
      c.fillStyle = cols[off % cols.length];
      c.fillRect(r.x + 10 + (j % 2) * 4, r.y + 7 + j * 2.4, 10 + ((off * 7) % 30), 1);
    }
    const bx = r.x + 88;
    this.box(c, bx, r.y + 3, 56, 19, '#e8eaf0', 0.1, -0.15);
    c.fillStyle = '#ff5f57'; c.fillRect(bx + 3, r.y + 5, 2, 2); c.fillStyle = '#febc2e'; c.fillRect(bx + 6, r.y + 5, 2, 2); c.fillStyle = '#28c840'; c.fillRect(bx + 9, r.y + 5, 2, 2);
    c.fillStyle = '#00a99d'; c.fillRect(bx + 3, r.y + 9, 24, 10);
    c.fillStyle = '#ffffff'; c.fillRect(bx + 5, r.y + 11, 14, 2); c.fillRect(bx + 5, r.y + 15, 8, 2);
    c.fillStyle = '#c9cdd8'; for (let k = 0; k < 3; k++) c.fillRect(bx + 30, r.y + 9 + k * 4, 23, 2);
    this.rug(c, r.x + 30, r.y + 108, 90, 20, '#00a99d', '#0d6e66');
  }

  drawProps(c, items) {
    const R = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
    const M = R.marketing, P = R.pauta, PR = R.prospeccion, E = R.edicion, D = R.mando, V = R.ventas, DV = R.desarrollo, J = R.juntas;
    const add = (y, fn) => items.push({ y, draw: fn });
    const plant = (x, y, big) => add(y, () => {
      this.box(c, x - 4, y - 7, 9, 7, '#c8693a', 0.25, -0.25);
      c.fillStyle = OUT; c.fillRect(x - 6, y - (big ? 24 : 17), 13, big ? 18 : 11);
      c.fillStyle = '#3aa36a'; c.fillRect(x - 5, y - (big ? 23 : 16), 11, big ? 16 : 9);
      c.fillStyle = '#56c788'; c.fillRect(x - 4, y - (big ? 23 : 16), 5, 3); c.fillRect(x + 2, y - (big ? 17 : 13), 3, 2);
      c.fillStyle = '#257a4c'; c.fillRect(x - 5, y - 9, 11, 2);
    });
    const shelf = (x, y) => add(y + 30, () => {
      this.box(c, x, y, 24, 30, '#8a5a32', 0.25, -0.25);
      const books = ['#e30016', '#4f8dff', '#ffd23f', '#3ad49c', '#8a6cff', '#ff7a1a'];
      for (let row = 0; row < 3; row++) {
        c.fillStyle = '#5e3c20'; c.fillRect(x + 2, y + 10 + row * 9, 20, 1);
        for (let b = 0; b < 5; b++) { c.fillStyle = books[(b + row * 2 + x) % books.length]; c.fillRect(x + 3 + b * 4, y + 3 + row * 9, 3, 7); }
      }
    });
    const sofa = (x, y, w, col) => add(y + 12, () => { this.box(c, x, y, w, 8, shade(col, -0.15)); this.box(c, x, y + 5, w, 8, col); this.box(c, x - 3, y, 5, 13, shade(col, -0.3)); this.box(c, x + w - 2, y, 5, 13, shade(col, -0.3)); });
    // Contenido orgánico: estantería, pufs en la zona de ideas, bidón de agua, cámara en trípode y aro de luz.
    shelf(M.x + 168, M.y + 3);
    for (const [x, y, col] of [[M.x + 118, M.y + 96, '#ffd23f'], [M.x + 146, M.y + 90, '#4f8dff'], [M.x + 170, M.y + 100, '#3ad49c']]) add(y + 6, () => this.box(c, x - 5, y, 11, 7, col, 0.3, -0.3));
    add(M.y + 126, () => { this.box(c, M.x + 3, M.y + 110, 12, 16, '#e8eaf0'); this.box(c, M.x + 4, M.y + 100, 10, 11, '#7ec8ff', 0.4, -0.2); });
    add(M.y + 80, () => { c.fillStyle = OUT; c.fillRect(M.x + 196, M.y + 62, 1, 18); c.fillRect(M.x + 192, M.y + 80, 9, 1); c.strokeStyle = '#fff3b0'; c.lineWidth = 2; c.beginPath(); c.arc(M.x + 196, M.y + 58, 6, 0, Math.PI * 2); c.stroke(); });
    // Prospección: mesa de mapas, archivero y globo terráqueo.
    add(PR.y + 92, () => { this.box(c, PR.x + 112, PR.y + 72, 60, 20, '#c98b4f', 0.2, -0.25); c.fillStyle = '#e8f1ec'; c.fillRect(PR.x + 116, PR.y + 75, 52, 12); c.fillStyle = '#9cc7b4'; c.fillRect(PR.x + 120, PR.y + 77, 20, 7); c.fillRect(PR.x + 144, PR.y + 76, 18, 9); c.fillStyle = '#e30016'; c.fillRect(PR.x + 128, PR.y + 79, 2, 2); c.fillRect(PR.x + 152, PR.y + 80, 2, 2); });
    add(PR.y + 56, () => { this.box(c, PR.x + 176, PR.y + 26, 18, 30, '#8d93a3', 0.25, -0.3); c.fillStyle = OUT; for (let k = 0; k < 3; k++) c.fillRect(PR.x + 182, PR.y + 32 + k * 9, 6, 1); });
    add(PR.y + 46, () => { this.box(c, PR.x + 132, PR.y + 40, 10, 6, '#8a5a32'); c.fillStyle = OUT; c.beginPath(); c.arc(PR.x + 137, PR.y + 33, 8, 0, Math.PI * 2); c.fill(); c.fillStyle = '#4fb6ff'; c.beginPath(); c.arc(PR.x + 137, PR.y + 33, 7, 0, Math.PI * 2); c.fill(); c.fillStyle = '#3aa36a'; c.fillRect(PR.x + 133, PR.y + 30, 5, 4); c.fillRect(PR.x + 138, PR.y + 35, 4, 3); });
    // Edición: sofá para ver los cortes y una pantalla grande.
    sofa(E.x + 60, E.y + 92, 52, '#4b3a6a');
    add(E.y + 60, () => { this.box(c, E.x + 172, E.y + 30, 20, 30, '#141218', 0.2, -0.2); c.fillStyle = '#ff4f8b'; c.fillRect(E.x + 175, E.y + 34, 14, 3); c.fillStyle = '#5ff2ff'; c.fillRect(E.x + 175, E.y + 40, 10, 3); });
    // Dirección: sofá de visitas, mesa de café, trofeos y una planta grande.
    sofa(D.x + 140, D.y + 98, 44, '#2f3a56');
    add(D.y + 96, () => { this.box(c, D.x + 150, D.y + 86, 26, 8, '#c98b4f'); c.fillStyle = '#ffffff'; c.fillRect(D.x + 156, D.y + 88, 5, 3); });
    add(D.y + 60, () => { this.box(c, D.x + 4, D.y + 30, 26, 30, '#5e3c20', 0.2, -0.25); c.fillStyle = '#ffd23f'; for (const [dx, dy] of [[8, 34], [15, 36], [22, 34]]) c.fillRect(D.x + dx, D.y + dy, 4, 6); c.fillStyle = '#c0c4cf'; c.fillRect(D.x + 8, D.y + 48, 6, 6); c.fillStyle = '#e30016'; c.fillRect(D.x + 17, D.y + 48, 8, 6); });
    // Ventas: pizarra de metas y dispensador de café.
    add(V.y + 60, () => { this.box(c, V.x + 176, V.y + 30, 18, 30, '#3a4256', 0.25, -0.25); c.fillStyle = '#e30016'; c.fillRect(V.x + 180, V.y + 35, 10, 3); c.fillStyle = '#ffd23f'; c.fillRect(V.x + 182, V.y + 42, 4, 3); });
    sofa(V.x + 64, V.y + 92, 52, '#2f9e63');
    // Desarrollo: servidor chico, pizarra con diagrama y puf.
    add(DV.y + 70, () => { this.box(c, DV.x + 176, DV.y + 32, 18, 38, '#2b2f3a', 0.25, -0.3); for (let j = 0; j < 5; j++) { c.fillStyle = Math.sin(this.t * 3 + j) > 0 ? '#3ad49c' : '#1d4d3a'; c.fillRect(DV.x + 180, DV.y + 37 + j * 6, 2, 1); } });
    add(DV.y + 92, () => this.box(c, DV.x + 150, DV.y + 84, 14, 8, '#00a99d', 0.3, -0.3));
    // Juntas: sillas alrededor de la mesa (se ven debajo de quien se sienta).
    for (const dx of [42, 78, 114, 150]) { add(J.y + 51, () => this.box(c, J.x + dx - 5, J.y + 44, 10, 8, '#d8102a')); add(J.y + 99, () => this.box(c, J.x + dx - 5, J.y + 92, 10, 8, '#d8102a')); }
    // Plantas en las esquinas de las salas y en los pasillos.
    for (const [x, y, big] of [[16, 30], [404, 30, 1], [606, 30, 1], [16, 202], [200, 202], [222, 314, 1], [404, 202, 1], [606, 202], [196, 476], [404, 376], [222, 488], [606, 488], [8, 180], [8, 352]]) plant(x, y, big);

    // ---------- Terraza ----------
    const T = R.terraza;
    // Kiosko de café con toldo a rayas
    add(60, () => {
      this.box(c, 684, 30, 76, 24, '#c98b4f', 0.25, -0.25);
      for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? '#ffffff' : '#e30016'; c.fillRect(682 + k * 10, 14, 10, 12); }
      c.fillStyle = OUT; c.fillRect(682, 26, 80, 2); c.fillRect(684, 14, 1, 16); c.fillRect(759, 14, 1, 16);
      this.box(c, 692, 34, 14, 14, '#3a4256', 0.25, -0.25); c.fillStyle = '#e30016'; c.fillRect(695, 37, 8, 2);
      for (let k = 0; k < 3; k++) this.box(c, 716 + k * 8, 36, 6, 6, ['#ffffff', '#e30016', '#ffd23f'][k], 0.2, -0.2);
      c.fillStyle = '#ffd23f'; c.fillRect(740, 38, 14, 2); c.fillStyle = '#fbe9cf'; c.fillRect(740, 42, 10, 1); c.fillRect(740, 45, 12, 1);
    });
    // Mesa de picnic con sombrilla
    add(104, () => {
      this.box(c, 802, 92, 48, 6, '#9a6236'); this.box(c, 800, 98, 52, 14, '#c98b4f', 0.2, -0.25); this.box(c, 802, 114, 48, 6, '#9a6236');
    });
    add(96, () => { c.fillStyle = OUT; c.fillRect(825, 58, 2, 40); c.fillStyle = OUT; c.beginPath(); c.ellipse(826, 58, 30, 9, 0, Math.PI, 0); c.fill(); for (let k = 0; k < 6; k++) { c.fillStyle = k % 2 ? '#ffd23f' : '#1877f2'; c.fillRect(798 + k * 10, 52, 10, 5); } });
    // Ping-pong
    add(220, () => {
      this.box(c, 744, 196, 64, 24, '#1f8a5a', 0.2, -0.3);
      c.fillStyle = '#ffffff'; c.fillRect(746, 207, 60, 1); c.fillRect(775, 194, 2, 28);
      c.fillStyle = OUT; c.fillRect(748, 220, 2, 4); c.fillRect(802, 220, 2, 4);
      if (this.pingers) {
        const k = (Math.sin(this.ball * Math.PI) + 1) / 2;
        const bx = 748 + k * 54, by = 200 - Math.abs(Math.cos(this.ball * Math.PI * 2)) * 8;
        c.fillStyle = OUT; c.fillRect(bx - 1, by - 1, 4, 4); c.fillStyle = '#ffffff'; c.fillRect(bx, by, 2, 2);
      }
    });
    // Parrilla con humo
    add(292, () => { this.box(c, 645, 278, 30, 14, '#2b2f3a', 0.25, -0.3); c.fillStyle = '#ff7a1a'; c.fillRect(649, 280, 22, 2); c.fillStyle = OUT; c.fillRect(649, 292, 2, 6); c.fillRect(669, 292, 2, 6); if (Math.sin(this.t * 4) > 0) { c.fillStyle = '#ffffff88'; c.fillRect(655 + Math.sin(this.t) * 3, 268, 3, 3); c.fillRect(663 - Math.sin(this.t) * 3, 262, 2, 2); } });
    // Hamaca entre dos palmeras
    const palm = (x, y) => add(y, () => {
      c.fillStyle = OUT; c.fillRect(x - 2, y - 44, 5, 44); c.fillStyle = '#9a6236'; c.fillRect(x - 1, y - 44, 3, 44);
      c.fillStyle = '#7a4a26'; for (let k = 0; k < 6; k++) c.fillRect(x - 1, y - 40 + k * 7, 3, 1);
      c.fillStyle = OUT; c.beginPath(); c.ellipse(x, y - 48, 20, 9, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#3aa36a'; c.beginPath(); c.ellipse(x, y - 48, 19, 8, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#56c788'; c.fillRect(x - 14, y - 52, 10, 3); c.fillRect(x + 4, y - 50, 10, 3);
    });
    palm(780, 392); palm(846, 392);
    add(394, () => { c.strokeStyle = OUT; c.lineWidth = 4; c.beginPath(); c.moveTo(782, 372); c.quadraticCurveTo(813, 396, 844, 372); c.stroke(); c.strokeStyle = '#ff7a1a'; c.lineWidth = 2; c.beginPath(); c.moveTo(782, 372); c.quadraticCurveTo(813, 396, 844, 372); c.stroke(); });
    // Camastros
    for (const x of [658, 698, 738, 778]) add(470, () => { this.box(c, x, 456, 22, 14, '#ffffff', 0.1, -0.2); for (let k = 0; k < 3; k++) { c.fillStyle = '#1877f2'; c.fillRect(x + 2, 459 + k * 4, 18, 1); } });
    add(446, () => { c.fillStyle = OUT; c.fillRect(818, 410, 2, 36); c.beginPath(); c.ellipse(819, 410, 22, 7, 0, Math.PI, 0); c.fill(); for (let k = 0; k < 4; k++) { c.fillStyle = k % 2 ? '#ffffff' : '#e30016'; c.fillRect(799 + k * 10, 404, 10, 5); } });
    // Árboles y arbustos en el borde
    const tree = (x, y) => add(y, () => {
      c.fillStyle = OUT; c.fillRect(x - 3, y - 14, 6, 14); c.fillStyle = '#7a4a26'; c.fillRect(x - 2, y - 14, 4, 14);
      c.fillStyle = OUT; c.beginPath(); c.arc(x, y - 22, 14, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2f8a4a'; c.beginPath(); c.arc(x, y - 22, 13, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#45a862'; c.beginPath(); c.arc(x - 4, y - 26, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ff5a6e'; c.fillRect(x + 4, y - 20, 2, 2); c.fillRect(x - 6, y - 16, 2, 2);
    });
    tree(860, 40); tree(652, 130); tree(862, 190); tree(652, 400); tree(862, 486); tree(760, 150);
    for (const [x, y] of [[660, 250], [770, 240], [860, 340], [740, 380], [640, 486]]) add(y, () => { c.fillStyle = OUT; c.fillRect(x - 7, y - 8, 14, 8); c.fillStyle = '#3f9a4a'; c.fillRect(x - 6, y - 7, 12, 6); c.fillStyle = '#ffd23f'; c.fillRect(x - 3, y - 6, 2, 2); c.fillStyle = '#ff7ab0'; c.fillRect(x + 2, y - 5, 2, 2); });
    // Faroles del sendero (se encienden de noche)
    const noche = this.hondurasHour() > 18 || this.hondurasHour() < 6;
    for (const [x, y] of [[680, 150], [680, 322], [716, 250]]) add(y, () => { c.fillStyle = OUT; c.fillRect(x - 1, y - 20, 3, 20); this.box(c, x - 3, y - 26, 7, 7, noche ? '#ffd76e' : '#e8eaf0', 0.3, -0.2); if (noche) { c.fillStyle = '#ffd76e33'; c.beginPath(); c.arc(x, y - 22, 14, 0, Math.PI * 2); c.fill(); } });
  }

  drawChair(c, d) {
    this.box(c, d.x - 6, d.y - 12, 12, 11, '#d8102a');
    c.fillStyle = '#ff5a6e'; c.fillRect(d.x - 4, d.y - 10, 8, 2);
  }

  drawDesk(c, p) {
    const { x, y } = p.deskSpot.desk;
    const st = p.status;
    this.box(c, x - 19, y, 38, 6, '#d99a5c', 0.3, -0.15);
    this.box(c, x - 19, y + 5, 38, 8, '#9a6236', 0.15, -0.25);
    c.fillStyle = '#7a4a26'; c.fillRect(x - 3, y + 7, 6, 1);
    const screen = st === 'waiting' ? (Math.sin(this.t * 8) > 0 ? '#ffc31f' : '#b88a00') : st === 'error' ? '#ff4d5e' : st === 'idle' ? '#3a4256' : p.color;
    this.box(c, x - 18, y - 11, 13, 10, '#2b2f3a', 0.2, -0.2);
    c.fillStyle = screen; c.fillRect(x - 16, y - 9, 9, 6);
    if (st !== 'idle' && st !== 'waiting' && st !== 'error') {
      c.fillStyle = '#ffffff';
      for (let k = 0; k < 3; k++) c.fillRect(x - 15, y - 8 + k * 2, 1 + ((k + Math.floor(this.t * 6)) % 5), 1);
    }
    c.fillStyle = OUT; c.fillRect(x - 13, y - 1, 3, 1);
    c.fillStyle = OUT; c.fillRect(x - 5, y + 1, 10, 3);
    c.fillStyle = '#e8eaf0'; c.fillRect(x - 4, y + 2, 8, 1);
    this.box(c, x + 9, y - 3, 5, 5, p.color, 0.3, -0.3);
    c.fillStyle = '#ffffff'; c.fillRect(x + 15, y + 1, 3, 3);
    const chip = st === 'tool' && p.tool ? CHIPS[p.tool.startsWith('mcp__') ? p.tool.split('__')[1] : p.tool] : null;
    if (chip) {
      const w = chip[0].length * 4 + 4;
      c.fillStyle = OUT; c.fillRect(x - 12 - w / 2 - 1, y - 18, w + 2, 8);
      c.fillStyle = chip[1]; c.fillRect(x - 12 - w / 2, y - 17, w, 6);
      c.fillStyle = '#fff';
      for (let k = 0; k < chip[0].length; k++) c.fillRect(x - 12 - w / 2 + 2 + k * 4, y - 15, 3, 2);
    }
  }

  // Personaje de 16×22 px. (x, y) = los pies. Caminata de 4 cuadros con rebote.
  drawHero(c, p) {
    const frame = p.moving ? [1, 0, 2, 0][Math.floor(p.step) % 4] : 0;
    const bob = p.moving && frame === 0 ? 0 : p.moving ? -1 : 0;
    const typing = p.seated && AT_WORK.includes(p.status) && p.status !== 'waiting';
    const nod = typing ? (Math.sin(this.t * 7) > 0.6 ? 1 : 0) : 0;
    const sitting = p.act === 'sofa' ? 3 : 0;
    const img = p.sprites.get(p.dir, frame, p.blink > 0);
    const ox = Math.round(p.x) - SPRITE_W / 2;
    const oy = Math.round(p.y) - SPRITE_H - 2 + bob + nod + sitting;
    c.fillStyle = '#00000055';
    c.fillRect(ox + 3, Math.round(p.y) - 1, 10, 2);
    c.fillRect(ox + 4, Math.round(p.y), 8, 1);
    if (this.hover?.p === p) { c.fillStyle = p.color; c.globalAlpha = 0.4; c.fillRect(ox + 1, Math.round(p.y) - 2, 14, 4); c.globalAlpha = 1; }
    c.drawImage(img, ox, oy);
    if (p.carrying) {
      const hx = p.dir === 'left' ? ox + 2 : p.dir === 'right' ? ox + 9 : ox + 5;
      c.fillStyle = '#141218'; c.fillRect(hx - 1, oy + 15, 8, 6);
      c.fillStyle = '#ffffff'; c.fillRect(hx, oy + 16, 6, 4);
      c.fillStyle = p.color; c.fillRect(hx + 1, oy + 17, 4, 1);
    }
    // Taza de café en la mano (el vapor sale en update).
    if (p.act === 'cafe' || p.act === 'sofa') {
      const hx = p.dir === 'left' ? ox + 1 : ox + 11;
      c.fillStyle = OUT; c.fillRect(hx - 1, oy + 14, 6, 6);
      c.fillStyle = '#ffffff'; c.fillRect(hx, oy + 15, 4, 4);
      c.fillStyle = '#7a4a26'; c.fillRect(hx, oy + 15, 4, 1);
    }
    // Paleta de ping-pong.
    if (p.act === 'ping') {
      const hx = p.dir === 'left' ? ox - 2 : ox + 14, swing = Math.sin(this.ball * Math.PI * 2) > 0 ? -2 : 0;
      c.fillStyle = OUT; c.fillRect(hx - 1, oy + 11 + swing, 5, 6);
      c.fillStyle = '#e30016'; c.fillRect(hx, oy + 12 + swing, 3, 4);
    }
    if (p.status === 'waiting') this.emote(c, ox + 8, oy - 1, '!');
    else if (this.needs?.has(p.id)) this.emote(c, ox + 8, oy - 1, 'need');
    else if (p.status === 'error') this.emote(c, ox + 8, oy - 1, 'x');
  }

  emote(c, x, y, kind) {
    const jump = Math.abs(Math.sin(this.t * 5)) > 0.7 ? -1 : 0;
    const bx = x - 4, by = y - 11 + jump;
    if (kind === 'need') {
      const glow = 0.35 + 0.35 * Math.sin(this.t * 6);
      c.globalAlpha = glow; c.fillStyle = '#ffd23f';
      c.fillRect(bx - 2, by - 2, 13, 13); c.globalAlpha = glow * 0.5; c.fillRect(bx - 4, by - 4, 17, 17); c.globalAlpha = 1;
      c.fillStyle = '#141218'; c.fillRect(bx, by, 9, 9); c.fillRect(bx + 3, by + 9, 3, 1);
      c.fillStyle = '#ffd23f'; c.fillRect(bx + 1, by + 1, 7, 7); c.fillRect(bx + 4, by + 8, 1, 1);
      c.fillStyle = '#141218'; c.fillRect(bx + 4, by + 2, 1, 3); c.fillRect(bx + 4, by + 6, 1, 1);
      return;
    }
    c.fillStyle = '#141218'; c.fillRect(bx, by, 9, 9); c.fillRect(bx + 3, by + 9, 3, 1);
    c.fillStyle = '#ffffff'; c.fillRect(bx + 1, by + 1, 7, 7); c.fillRect(bx + 4, by + 8, 1, 1);
    c.fillStyle = kind === '!' ? '#e30016' : '#141218';
    if (kind === '!') { c.fillRect(bx + 4, by + 2, 1, 3); c.fillRect(bx + 4, by + 6, 1, 1); }
    else { c.fillRect(bx + 2, by + 2, 1, 1); c.fillRect(bx + 3, by + 3, 3, 3); c.fillRect(bx + 6, by + 2, 1, 1); c.fillRect(bx + 2, by + 6, 1, 1); c.fillRect(bx + 6, by + 6, 1, 1); }
  }

  drawOutlines(c) {
    const r = this.hover?.r || (this.hover?.p && roomById(this.hover.p.room));
    if (!r) return;
    c.strokeStyle = '#ffd23f';
    c.globalAlpha = 0.6 + Math.sin(this.t * 6) * 0.3;
    c.lineWidth = 2;
    c.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    c.globalAlpha = 1;
  }

  hondurasHour() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Tegucigalpa', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    const g = (t) => Number(parts.find((x) => x.type === t).value);
    return g('hour') + g('minute') / 60;
  }

  placeLabels() {
    const rect = this.canvas.getBoundingClientRect();
    const host = this.overlay.getBoundingClientRect();
    const ox = rect.left - host.left, oy = rect.top - host.top, s = rect.width / W;
    for (const { r, b } of this.labels) {
      b.style.left = `${ox + (r.x + 8) * s}px`;
      b.style.top = `${oy + (r.y + r.h - 6) * s}px`;
      b.classList.toggle('hot', this.hover?.r === r || this.hover?.p?.room === r.id);
    }
    for (const p of this.people) {
      const x = ox + p.x * s;
      const headY = oy + (p.y - 24) * s;
      p.tag.style.left = `${x}px`;
      p.tag.style.top = `${headY - 13}px`;
      p.tag.style.opacity = this.hover?.p === p ? 1 : 0;
      const show = p.status !== 'idle' && p.status !== 'waiting' && p.text;
      p.bubble.className = `bubble ${p.status}`;
      const text = p.status === 'tool' ? `🔧 ${p.text}` : p.status === 'waiting' ? `✋ ${p.text}` : p.text;
      if (p.bubble.textContent !== text) p.bubble.textContent = text;
      p.bubble.style.opacity = show && this.hover?.p !== p ? 1 : 0;
      const half = p.bubble.offsetWidth / 2 + 6;
      p.bubble.style.left = `${Math.min(host.width - half, Math.max(half, x))}px`;
      p.bubble.style.top = `${headY - 4}px`;
      p.bubble.style.zIndex = Math.round(p.y);
    }
  }

  // ---------- vista isométrica de una sala ----------
  // La misma sala vista en diagonal: piso en rombos, dos paredes, muebles como bloques y
  // los mismos personajes moviéndose en vivo. Se abre con el botón 3D de cada sala.
  openIso(roomId) {
    this.closeIso();
    const r = roomById(roomId);
    const wrap = document.createElement('div');
    wrap.className = 'iso-wrap';
    wrap.innerHTML = `<div class="iso-card"><header><b>${r.name}</b><span>Vista 3D en vivo</span><button class="btn sm" aria-label="Cerrar">✕</button></header><canvas></canvas></div>`;
    document.body.appendChild(wrap);
    const canvas = wrap.querySelector('canvas');
    canvas.width = 760; canvas.height = 480;
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('button')) this.closeIso(); });
    this.isoKey = (e) => { if (e.key === 'Escape') this.closeIso(); };
    document.addEventListener('keydown', this.isoKey);
    this.iso = { r, wrap, canvas, ctx: canvas.getContext('2d') };
  }
  closeIso() {
    if (!this.iso) return;
    this.iso.wrap.remove();
    document.removeEventListener('keydown', this.isoKey);
    this.iso = null;
  }

  // Muebles de cada sala como bloques: x, y (esquina de atrás), w (ancho), d (profundidad), h (alto).
  isoBlocks(r) {
    const B = [];
    const add = (x, y, w, d, h, color, extra = {}) => B.push({ x, y, w, d, h, color, ...extra });
    for (const p of this.people) {
      if (p.room !== r.id) continue;
      const d = p.deskSpot.desk;
      if (d.kind === 'desk') {
        add(d.x - 19, d.y, 38, 12, 9, '#c98b4f');
        add(d.x - 18, d.y - 2, 12, 3, 20, '#2b2f3a', { screen: AT_WORK.includes(p.status) ? p.color : '#3a4256' });
        add(d.x - 6, d.y - 14, 12, 9, 6, '#d8102a');
      } else add(d.x - 24, d.y, 48, 12, 10, '#3a4256', { glow: '#5ff2ff' });
    }
    const props = {
      marketing: [[168, 26, 24, 8, 30, '#8a5a32'], [113, 96, 11, 8, 6, '#ffd23f'], [141, 90, 11, 8, 6, '#4f8dff'], [165, 100, 11, 8, 6, '#3ad49c'], [3, 100, 12, 12, 24, '#e8eaf0']],
      mando: [[140, 98, 44, 13, 10, '#2f3a56'], [150, 86, 26, 8, 7, '#c98b4f'], [4, 30, 26, 10, 30, '#5e3c20'], [91, 76, 18, 60, 1, '#b3001b']],
      terraza: [[60, 22, 76, 24, 20, '#c98b4f'], [176, 90, 52, 22, 9, '#c98b4f'], [120, 188, 64, 24, 9, '#1f8a5a', { net: true }], [21, 270, 30, 14, 14, '#2b2f3a'], [34, 448, 22, 14, 4, '#ffffff'], [74, 448, 22, 14, 4, '#ffffff'], [114, 448, 22, 14, 4, '#ffffff'], [154, 448, 22, 14, 4, '#ffffff'], [176, 256, 46, 30, 8, '#4fb6ff']],
      estudio: [0, 1, 2, 3, 4, 5].map((k) => [14 + k * 29, 40, 22, 14, 38, '#4a5266', { leds: true }]),
      edicion: [[60, 92, 52, 13, 10, '#4b3a6a'], [172, 30, 20, 10, 30, '#141218']],
      ventas: [[64, 92, 52, 13, 10, '#2f9e63'], [176, 30, 18, 10, 30, '#3a4256']],
      desarrollo: [[176, 32, 18, 12, 38, '#2b2f3a'], [150, 84, 14, 8, 6, '#00a99d']],
      pauta: [[40, 106, 120, 20, 1, '#1877f2']],
      prospeccion: [[112, 72, 60, 20, 10, '#c98b4f'], [176, 26, 18, 10, 30, '#8d93a3'], [30, 106, 120, 20, 1, '#2f7bd9']],
      juntas: [[26, 60, 148, 26, 9, '#c98b4f'], [18, 52, 164, 42, 1, '#7a2b2b']],
    }[r.id] || [];
    for (const [dx, dy, w, d, h, color, extra] of props) add(r.x + dx, r.y + dy, w, d, h, color, extra || {});
    return B;
  }

  drawIso() {
    const { r, ctx: c, canvas } = this.iso;
    if (!document.body.contains(canvas)) { this.iso = null; return; }
    const x0 = r.x + 2, y0 = r.y + 24, w = r.w - 4, d = r.h - 26;
    const WH = 52;
    // Zoom para que la sala llene el cuadro (ancho y alto del rombo más las paredes).
    const k = Math.min(2.6, (canvas.width - 60) / (w + d), (canvas.height - 70) / ((w + d) / 2 + WH));
    const ox = canvas.width / 2 + ((d - w) * k) / 2, oy = 34 + WH * k;
    const P = (x, y, z = 0) => [ox + ((x - x0) - (y - y0)) * k, oy + ((x - x0) + (y - y0)) * k * 0.5 - z * k];
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#17131f'; c.fillRect(0, 0, canvas.width, canvas.height);
    const poly = (pts, fill, line = OUT) => { c.beginPath(); pts.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); c.closePath(); c.fillStyle = fill; c.fill(); if (line) { c.strokeStyle = line; c.lineWidth = 1.5; c.stroke(); } };
    const floor = FLOORS[r.id], wall = WALLS[r.id];
    // Paredes del fondo con zócalo y cuadros.
    poly([P(x0, y0), P(x0, y0 + d), P(x0, y0 + d, WH), P(x0, y0, WH)], shade(wall, -0.14));
    poly([P(x0, y0), P(x0 + w, y0), P(x0 + w, y0, WH), P(x0, y0, WH)], wall);
    poly([P(x0, y0), P(x0 + w, y0), P(x0 + w, y0, 6), P(x0, y0, 6)], '#c48a5a', null);
    poly([P(x0, y0), P(x0, y0 + d), P(x0, y0 + d, 6), P(x0, y0, 6)], shade('#c48a5a', -0.15), null);
    const art = ['#2b2f3a', '#9fd8ff', '#e30016', '#fbfbfd'];
    for (let i = 0; i < 3; i++) {
      const a = x0 + 10 + i * (w / 3), b = a + Math.min(36, w / 4);
      poly([P(a, y0, 20), P(b, y0, 20), P(b, y0, 42), P(a, y0, 42)], art[(i + r.id.length) % art.length]);
    }
    for (let i = 0; i < 2; i++) {
      const a = y0 + 16 + i * (d / 2), b = a + Math.min(30, d / 3);
      poly([P(x0, a, 20), P(x0, b, 20), P(x0, b, 40), P(x0, a, 40)], art[(i + 1) % art.length]);
    }
    // Piso en rombos.
    const T = 12;
    for (let yy = 0; yy < d; yy += T) for (let xx = 0; xx < w; xx += T) {
      const f = ((xx + yy) / T) % 2 < 1 ? floor : shade(floor, -0.07);
      poly([P(x0 + xx, y0 + yy), P(x0 + Math.min(w, xx + T), y0 + yy), P(x0 + Math.min(w, xx + T), y0 + Math.min(d, yy + T)), P(x0 + xx, y0 + Math.min(d, yy + T))], f, null);
    }
    // Muebles y personas, de atrás hacia adelante.
    const items = this.isoBlocks(r).map((b) => ({ depth: b.x + b.w + b.y + b.d, draw: () => {
      const { x, y, w: bw, d: bd, h, color } = b;
      poly([P(x, y + bd), P(x + bw, y + bd), P(x + bw, y + bd, h), P(x, y + bd, h)], shade(color, -0.12));
      poly([P(x + bw, y), P(x + bw, y + bd), P(x + bw, y + bd, h), P(x + bw, y, h)], shade(color, -0.3));
      poly([P(x, y, h), P(x + bw, y, h), P(x + bw, y + bd, h), P(x, y + bd, h)], shade(color, 0.15));
      if (b.screen) poly([P(x + 1, y + bd, h * 0.35), P(x + bw - 1, y + bd, h * 0.35), P(x + bw - 1, y + bd, h - 2), P(x + 1, y + bd, h - 2)], b.screen, null);
      if (b.net) { c.strokeStyle = '#ffffff'; c.lineWidth = 2; const [a1, a2] = P(x + bw / 2, y, h + 4); const [b1, b2] = P(x + bw / 2, y + bd, h + 4); c.beginPath(); c.moveTo(a1, a2); c.lineTo(b1, b2); c.stroke(); }
      if (b.glow) { c.globalAlpha = 0.45 + Math.sin(this.t * 2) * 0.2; const [cx, cy] = P(x + bw / 2, y + bd / 2, h + 12); c.fillStyle = b.glow; c.beginPath(); c.ellipse(cx, cy, 26, 12, 0, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1; }
      if (b.leds) for (let j = 0; j < 7; j++) { const [lx, ly] = P(x + 4, y + bd, 6 + j * 4.5); c.fillStyle = Math.sin(this.t * 3 + j + x) > 0.3 ? '#3ad49c' : '#1d4d3a'; c.fillRect(lx, ly, 4, 2); }
    } }));
    for (const p of this.people) {
      if (p.x < x0 || p.x > x0 + w || p.y < y0 - 6 || p.y > y0 + d + 4) continue;
      items.push({ depth: p.x + p.y + 2, draw: () => {
        const [sx, sy] = P(p.x, p.y);
        const frame = p.moving ? [1, 0, 2, 0][Math.floor(p.step) % 4] : 0;
        const img = p.sprites.get(p.dir, frame, p.blink > 0);
        const s = k * 1.5;
        c.fillStyle = '#00000044'; c.beginPath(); c.ellipse(sx, sy, 6 * s / 1.5, 3 * s / 1.5, 0, 0, Math.PI * 2); c.fill();
        c.drawImage(img, Math.round(sx - (SPRITE_W * s) / 2), Math.round(sy - SPRITE_H * s + 2), Math.round(SPRITE_W * s), Math.round(SPRITE_H * s));
        if (p.act === 'cafe' || p.act === 'sofa') { c.fillStyle = '#ffffff'; c.fillRect(sx + 6 * s / 1.5, sy - 12 * s, 3 * s / 1.5, 3 * s / 1.5); }
        const label = AT_WORK.includes(p.status) && p.text ? p.text.slice(0, 36) : '';
        if (label) {
          c.font = '12px system-ui, sans-serif';
          const tw = c.measureText(label).width + 14, ty = sy - SPRITE_H * s - 22;
          c.fillStyle = OUT; c.fillRect(sx - tw / 2 - 1, ty - 1, tw + 2, 20);
          c.fillStyle = '#fbfbfd'; c.fillRect(sx - tw / 2, ty, tw, 18);
          c.fillStyle = OUT; c.fillText(label, sx - tw / 2 + 7, ty + 13);
        }
      } });
    }
    items.sort((a, b) => a.depth - b.depth).forEach((i) => i.draw());
    c.font = '12px system-ui, sans-serif';
    c.fillStyle = '#8d93a3';
    c.fillText(`${this.people.filter((p) => p.x >= x0 && p.x <= x0 + w && p.y >= y0 - 6 && p.y <= y0 + d + 4).length} en la sala · Esc para cerrar`, 16, canvas.height - 14);
  }
}

const FLOORS = { marketing: '#e0a86a', mando: '#a9c1e6', terraza: '#6cbd59', estudio: '#6c7a96', ventas: '#c9b28e', edicion: '#8c6a52', desarrollo: '#4c556b', pauta: '#b8c9e8', prospeccion: '#b9d0c9', juntas: '#c9b28e' };
const WALLS = { marketing: '#f6e7c8', mando: '#e3ebf7', terraza: '#bfe3ff', estudio: '#3e4760', ventas: '#e2f3e7', edicion: '#3a3350', desarrollo: '#26324a', pauta: '#e8efff', prospeccion: '#e4f2ee', juntas: '#f3ead8' };

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (k < 0 ? v * k : (255 - v) * k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
