// Oficina pixel-art: dibuja el espacio, mueve a los agentes según su estado
// y coloca sus nombres y globos de diálogo como HTML encima del canvas.
const T = 16;              // px por baldosa
const COLS = 18, ROWS = 12;
const W = COLS * T, H = ROWS * T;
const CORRIDOR = 7.4;
const SPEED = 2.4;         // baldosas por segundo
const SKIN = ['#f1c7a3', '#d9a27c', '#b97a55', '#e8b892', '#c98d66'];

// Etiqueta que aparece sobre el monitor según la herramienta que usa el agente.
const CHIPS = {
  metaads: ['META', '#1877f2'], uploadpost: ['POST', '#ff5a1f'], cresova: ['CRE', '#e30016'],
  WebSearch: ['WEB', '#21c48d'], WebFetch: ['WEB', '#21c48d'],
  Read: ['FILE', '#8d93a3'], Write: ['FILE', '#8d93a3'], Edit: ['FILE', '#8d93a3'], Glob: ['FILE', '#8d93a3'], Grep: ['FILE', '#8d93a3'],
};

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Lugares de descanso. door = punto en el pasillo, via = camino hasta el lugar.
const LOUNGE = [
  { name: 'café', pos: { x: 16.3, y: 6.9 }, door: { x: 16.3, y: CORRIDOR }, via: [] },
  { name: 'sofá', pos: { x: 15.2, y: 10.9 }, door: { x: 13.6, y: CORRIDOR }, via: [{ x: 13.6, y: 10.9 }] },
  { name: 'sofá2', pos: { x: 16.6, y: 10.9 }, door: { x: 13.6, y: CORRIDOR }, via: [{ x: 13.6, y: 10.9 }] },
  { name: 'ventana', pos: { x: 2.25, y: 3.7 }, door: { x: 2.25, y: CORRIDOR }, via: [] },
  { name: 'agua', pos: { x: 1.3, y: 9.3 }, door: { x: 1.3, y: CORRIDOR }, via: [] },
  { name: 'pizarra', pos: { x: 8.9, y: 3.5 }, door: { x: 7.1, y: CORRIDOR }, via: [{ x: 7.1, y: 3.5 }] },
];

function deskSpot(desk) {
  const row = desk.y + 2;
  const seat = { x: desk.x + 1, y: row + 1.6 };
  if (row < CORRIDOR) return { pos: seat, door: { x: seat.x, y: CORRIDOR }, via: [], row };
  const side = { x: desk.x - 0.45, y: seat.y };
  return { pos: seat, door: { x: side.x, y: CORRIDOR }, via: [side], row };
}

function route(from, to) {
  if (from === to) return [];
  return [...[...from.via].reverse(), from.door, to.door, ...to.via, to.pos];
}

export class Office {
  constructor(canvas, overlay, agents, { onApprovalClick } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.overlay = overlay;
    this.onApprovalClick = onApprovalClick;
    canvas.width = W;
    canvas.height = H;
    this.t = 0;
    this.planes = [];
    this.sparks = [];
    this.pending = 0;
    this.stars = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), p: Math.random() * 6 }));
    this.people = agents.map((a, i) => {
      const desk = deskSpot(a.desk);
      const start = i % 2 ? LOUNGE[i % LOUNGE.length] : desk;
      const p = {
        ...a, deskSpot: desk, spot: start, x: start.pos.x + rnd(-0.3, 0.3), y: start.pos.y, path: [],
        status: 'idle', text: '', skin: SKIN[i % SKIN.length], nextWander: rnd(1, 5), face: 1, step: 0,
      };
      p.tag = this.el('div', 'tag', a.nombre);
      p.tag.style.setProperty('--c', a.color);
      p.bubble = this.el('div', 'bubble', '');
      p.bubble.style.opacity = 0;
      p.bubble.addEventListener('click', () => p.status === 'waiting' && this.onApprovalClick?.());
      return p;
    });
    new ResizeObserver(() => this.fit()).observe(canvas.parentElement);
    this.fit();
    let last = performance.now();
    const loop = (now) => {
      // Pasos fijos: si la pestaña estuvo en segundo plano, se pone al día.
      let dt = Math.min(5, (now - last) / 1000);
      last = now;
      while (dt > 0) { this.update(Math.min(0.05, dt)); dt -= 0.05; }
      this.draw();
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

  fit() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const scale = Math.max(1, Math.min((box.width - 16) / W, (box.height - 16) / H));
    this.scale = scale;
    this.canvas.style.width = `${W * scale}px`;
    this.canvas.style.height = `${H * scale}px`;
  }

  setAgent(id, agent) {
    const p = this.people.find((x) => x.id === id);
    if (!p) return;
    p.status = agent.status;
    p.text = agent.text || '';
    p.tool = agent.tool || null;
    const atWork = ['working', 'tool', 'waiting', 'error'].includes(p.status);
    if (atWork && p.spot !== p.deskSpot && !p.errand) this.goTo(p, p.deskSpot);
    if (!atWork) p.nextWander = Math.min(p.nextWander, rnd(2, 5));
  }

  setPending(n) { this.pending = n; }

  handoff(fromId, toId) {
    const a = this.people.find((x) => x.id === fromId);
    const b = this.people.find((x) => x.id === toId);
    if (!a || !b) return;
    if (a === b) return;
    if (a.errand) {
      const s = { x: a.desk.x + 1, y: a.deskSpot.row - 0.2 };
      const e = { x: b.desk.x + 1, y: b.deskSpot.row - 0.2 };
      this.planes.push({ s, e, t: 0, color: a.color });
      return;
    }
    // Se levanta y lleva el documento hasta el escritorio del compañero.
    const visit = { pos: { x: b.desk.x - 0.45, y: b.deskSpot.pos.y }, door: { x: b.desk.x - 0.45, y: CORRIDOR }, via: [] };
    a.errand = { stage: 'go', wait: 0, to: b };
    a.carrying = true;
    this.goTo(a, visit);
  }

  goTo(p, spot) {
    p.path = route(p.spot, spot).map((q) => ({ ...q }));
    p.spot = spot;
  }

  update(dt) {
    this.t += dt;
    for (const p of this.people) {
      const atWork = ['working', 'tool', 'waiting', 'error'].includes(p.status);
      if (!atWork && !p.path.length && !p.errand) {
        p.nextWander -= dt;
        if (p.nextWander <= 0) {
          const options = [...LOUNGE.filter((l) => !this.people.some((o) => o !== p && o.spot === l)), p.deskSpot];
          this.goTo(p, pick(options));
          p.nextWander = rnd(8, 18);
        }
      }
      if (p.path.length) {
        const target = p.path[0];
        const dx = target.x - p.x, dy = target.y - p.y;
        const d = Math.hypot(dx, dy);
        const step = SPEED * (atWork ? 1.4 : 1) * dt;
        if (d <= step) {
          p.x = target.x; p.y = target.y; p.path.shift();
        } else {
          p.x += (dx / d) * step; p.y += (dy / d) * step;
          if (Math.abs(dx) > 0.01) p.face = dx > 0 ? 1 : -1;
          p.step += dt * 9;
        }
      }
      p.seated = !p.path.length && p.spot === p.deskSpot;
      if (p.errand && !p.path.length) {
        const e = p.errand;
        if (e.stage === 'go') {
          e.stage = 'drop'; e.wait = 1.4; p.carrying = false; p.face = 1;
          for (let i = 0; i < 16; i++) this.sparks.push({ x: (e.to.desk.x + 0.9) * T, y: (e.to.deskSpot.row + 0.4) * T, vx: rnd(-45, 45), vy: rnd(-70, -15), life: 1, color: p.color });
        } else if (e.stage === 'drop') {
          e.wait -= dt;
          if (e.wait <= 0) { e.stage = 'back'; this.goTo(p, p.deskSpot); }
        } else {
          p.errand = null;
        }
      }
    }
    for (const pl of this.planes) pl.t += dt / 1.6;
    for (const pl of this.planes.filter((q) => q.t >= 1)) {
      for (let i = 0; i < 14; i++) this.sparks.push({ x: pl.e.x * T, y: pl.e.y * T, vx: rnd(-40, 40), vy: rnd(-60, -10), life: 1, color: pl.color });
    }
    this.planes = this.planes.filter((q) => q.t < 1);
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 120 * dt; s.life -= dt * 1.4; }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  // ---------- dibujo ----------
  draw() {
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    this.drawRoom(c);
    const items = [];
    for (const p of this.people) items.push({ y: p.deskSpot.row + 1, draw: () => this.drawDesk(c, p) });
    items.push({ y: 6.2, draw: () => this.drawCoffee(c) });
    items.push({ y: 11.6, draw: () => this.drawSofa(c) });
    items.push({ y: 9.6, draw: () => this.drawCooler(c) });
    items.push({ y: 11.9, draw: () => this.drawRack(c) });
    for (const [x, y] of [[12.6, 4.9], [0.6, 6.4], [6.6, 11.8], [17.4, 4.6]]) items.push({ y, draw: () => this.drawPlant(c, x, y) });
    for (const p of this.people) items.push({ y: p.y, draw: () => this.drawPerson(c, p) });
    items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());
    this.drawPlanes(c);
    for (const s of this.sparks) { c.globalAlpha = Math.max(0, s.life); c.fillStyle = s.color; c.fillRect(s.x | 0, s.y | 0, 2, 2); }
    c.globalAlpha = 1;
    this.drawLight(c);
    this.placeLabels();
  }

  hondurasHour() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Tegucigalpa', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    const g = (t) => Number(parts.find((x) => x.type === t).value);
    return g('hour') + g('minute') / 60;
  }

  drawRoom(c) {
    // piso de madera
    for (let y = 3; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        c.fillStyle = (x + (y % 2) * 2) % 4 < 2 ? '#3b2c22' : '#36281f';
        c.fillRect(x * T, y * T, T, T);
        c.fillStyle = '#2d2119';
        c.fillRect(x * T, y * T + T - 1, T, 1);
        if ((x + y * 3) % 5 === 0) c.fillRect(x * T + 7, y * T, 1, T - 1);
      }
    }
    // alfombra del lounge
    c.fillStyle = '#3b1418'; c.fillRect(13.3 * T, 9.2 * T, 4.5 * T, 2.6 * T);
    c.fillStyle = '#5a1c22'; c.fillRect(13.6 * T, 9.5 * T, 3.9 * T, 2 * T);
    // pasillo
    c.fillStyle = '#ffffff08'; c.fillRect(0, 6.6 * T, W, 1.6 * T);

    // pared
    c.fillStyle = '#20232f'; c.fillRect(0, 0, W, 3 * T);
    c.fillStyle = '#272b39';
    for (let x = 0; x < COLS; x++) c.fillRect(x * T, 0, 1, 3 * T);
    c.fillStyle = '#14161e'; c.fillRect(0, 3 * T - 3, W, 3);

    // ventanas con cielo de Tegucigalpa según la hora real
    const h = this.hondurasHour();
    for (const wx of [1, 13.5]) this.drawWindow(c, wx * T, 6, 3.4 * T, 2.2 * T, h);

    // letrero neón CRESOVA
    const flick = Math.sin(this.t * 31) > 0.97 ? 0.4 : 1;
    c.save();
    c.font = '8px "Press Start 2P", monospace';
    c.textBaseline = 'top';
    c.shadowColor = '#ff1a2e';
    c.shadowBlur = 10 * flick;
    c.fillStyle = `rgba(255,40,60,${flick})`;
    c.fillText('C', 5.9 * T, 0.75 * T);
    c.fillStyle = `rgba(255,240,240,${0.9 * flick})`;
    c.shadowColor = '#ffffff';
    c.fillText('RESOVA', 5.9 * T + 8, 0.75 * T);
    c.shadowBlur = 0;
    c.font = '5px "Press Start 2P", monospace';
    c.fillStyle = '#8d93a3';
    c.fillText('CRECES. INNOVAS.', 6.35 * T, 1.55 * T);
    c.restore();

    // pizarra con el brief
    c.fillStyle = '#d9dde6'; c.fillRect(7.2 * T, 2.05 * T, 3.4 * T, 0.85 * T);
    c.fillStyle = '#9aa1b2'; c.fillRect(7.2 * T, 2.9 * T - 1, 3.4 * T, 1);
    c.fillStyle = '#e30016'; c.fillRect(7.4 * T, 2.25 * T, 10, 2);
    c.fillStyle = '#2f9bff'; c.fillRect(7.4 * T, 2.45 * T, 22, 1); c.fillRect(7.4 * T, 2.6 * T, 16, 1);
    c.fillStyle = '#21c48d'; c.fillRect(9.2 * T, 2.25 * T, 1, 8); c.fillRect(9.2 * T, 2.25 * T + 7, 12, 1);

    // reloj de pared
    const cx = 11.8 * T, cy = 1.5 * T;
    c.fillStyle = '#e8eaf0'; c.beginPath(); c.arc(cx, cy, 6, 0, 7); c.fill();
    c.strokeStyle = '#111'; c.lineWidth = 1;
    const hr = (h % 12) / 12 * Math.PI * 2, mn = (h % 1) * Math.PI * 2;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(hr) * 3, cy - Math.cos(hr) * 3); c.stroke();
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(mn) * 5, cy - Math.cos(mn) * 5); c.stroke();

    // sirena de aprobaciones
    const on = this.pending > 0 && Math.sin(this.t * 8) > 0;
    c.fillStyle = '#444'; c.fillRect(4.6 * T, 0.6 * T, 8, 3);
    c.fillStyle = this.pending ? (on ? '#ff2a3d' : '#7a0f19') : '#3a3d48';
    c.fillRect(4.6 * T + 1, 0.6 * T - 6, 6, 6);
    if (on) { c.fillStyle = '#ff2a3d33'; c.beginPath(); c.arc(4.6 * T + 4, 0.6 * T - 3, 14, 0, 7); c.fill(); }

    // estantería
    c.fillStyle = '#4a3326'; c.fillRect(0.2 * T, 3.1 * T, 1.3 * T, 2.4 * T);
    const books = ['#e30016', '#2f9bff', '#21c48d', '#ffb020', '#7c5cff', '#eee'];
    for (let r = 0; r < 3; r++) {
      c.fillStyle = '#2e1f17'; c.fillRect(0.2 * T, (3.1 + r * 0.8) * T + 11, 1.3 * T, 2);
      for (let b = 0; b < 5; b++) { c.fillStyle = books[(b + r * 2) % books.length]; c.fillRect(0.3 * T + b * 3.6, (3.1 + r * 0.8) * T + 3, 3, 8); }
    }
  }

  drawWindow(c, x, y, w, h, hour) {
    const sky =
      hour < 5 || hour >= 19.5 ? ['#060a1a', '#141b3a'] :
      hour < 6.5 ? ['#3b2d5e', '#f08a5d'] :
      hour < 17.5 ? ['#3c8de0', '#a9d6ff'] :
      ['#4a2a6a', '#ff8a4c'];
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, sky[0]); g.addColorStop(1, sky[1]);
    c.fillStyle = '#11131a'; c.fillRect(x - 2, y - 2, w + 4, h + 4);
    c.fillStyle = g; c.fillRect(x, y, w, h);
    const night = hour < 5.5 || hour >= 19;
    if (night) for (const s of this.stars) { c.fillStyle = Math.sin(this.t * 2 + s.p) > 0.3 ? '#fff' : '#fff6'; c.fillRect(x + s.x * w, y + s.y * h * 0.5, 1, 1); }
    else { c.fillStyle = hour < 12 ? '#fff6a0' : '#ffd27a'; c.beginPath(); c.arc(x + w * (hour - 6) / 13, y + 6 + Math.abs(12.5 - hour) * 1.3, 3, 0, 7); c.fill(); }
    // cerros y ciudad
    c.fillStyle = night ? '#0d1424' : '#3d5a46';
    c.beginPath(); c.moveTo(x, y + h);
    for (let i = 0; i <= w; i += 4) c.lineTo(x + i, y + h - 7 - Math.sin(i / 9 + x) * 4 - Math.sin(i / 4) * 1.5);
    c.lineTo(x + w, y + h); c.fill();
    for (let i = 2; i < w - 2; i += 5) {
      const bh = 3 + ((i * 7 + x) % 6);
      c.fillStyle = night ? '#171b29' : '#59606e';
      c.fillRect(x + i, y + h - bh, 4, bh);
      if (night && (i + Math.floor(this.t / 3)) % 3) { c.fillStyle = '#ffd36b'; c.fillRect(x + i + 1, y + h - bh + 1, 1, 1); }
    }
    c.fillStyle = '#11131a'; c.fillRect(x + w / 2 - 1, y, 2, h); c.fillRect(x, y + h / 2 - 1, w, 1);
  }

  drawDesk(c, p) {
    const x = p.desk.x * T, y = p.deskSpot.row * T;
    // escritorio
    c.fillStyle = '#7a5a43'; c.fillRect(x, y + 4, 2 * T, 8);
    c.fillStyle = '#5e4433'; c.fillRect(x, y + 12, 2 * T, 4);
    c.fillStyle = '#3c2b21'; c.fillRect(x + 1, y + 16, 2, 2); c.fillRect(x + 2 * T - 3, y + 16, 2, 2);
    // monitor
    const mx = x + 9, my = y - 7;
    c.fillStyle = '#1a1c22'; c.fillRect(mx - 1, my - 1, 16, 12);
    c.fillStyle = '#26282f'; c.fillRect(mx + 6, my + 11, 2, 2); c.fillRect(mx + 3, my + 12, 8, 1);
    const st = p.status;
    if (st === 'waiting') c.fillStyle = Math.sin(this.t * 8) > 0 ? '#e30016' : '#5a0a12';
    else if (st === 'error') c.fillStyle = '#5a1018';
    else if (p.seated && st !== 'idle') c.fillStyle = '#0f1726';
    else c.fillStyle = '#0b0c10';
    c.fillRect(mx, my, 14, 10);
    if (p.seated && (st === 'working' || st === 'tool')) {
      for (let i = 0; i < 4; i++) {
        const len = 3 + ((i * 5 + Math.floor(this.t * 6)) % 9);
        c.fillStyle = i % 2 ? p.color : '#9fb3d1';
        c.fillRect(mx + 1, my + 1 + i * 2.3, len, 1);
      }
      if (st === 'tool') { c.fillStyle = '#ffb020'; c.fillRect(mx + 11, my + 1, 2, 2); }
    } else if (st === 'idle') {
      c.fillStyle = '#e3001655'; c.fillRect(mx + 5, my + 3, 4, 4);
    }
    if (p.seated && st === 'tool' && p.tool) this.drawChip(c, mx + 7, my - 3, p.tool);
    // taza y papeles
    c.fillStyle = '#eee'; c.fillRect(x + 3, y + 5, 3, 3);
    c.fillStyle = p.color; c.fillRect(x + 3, y + 5, 3, 1);
    c.fillStyle = '#e8e2d5'; c.fillRect(x + 25, y + 6, 5, 4);
    // silla
    const sx = x + T - 5, sy = (p.deskSpot.row + 1.6) * T;
    if (!p.seated) { c.fillStyle = '#262a36'; c.fillRect(sx, sy - 8, 10, 7); c.fillStyle = '#1b1e27'; c.fillRect(sx + 4, sy - 1, 2, 2); }
  }

  drawPerson(c, p) {
    const fx = Math.round(p.x * T), fy = Math.round(p.y * T);
    const walking = p.path.length > 0;
    const leg = walking ? Math.sin(p.step) > 0 : false;
    // sombra
    c.fillStyle = '#0006'; c.fillRect(fx - 5, fy - 1, 10, 2);
    if (p.seated) {
      // de espaldas, sentado frente al monitor
      const top = fy - 15;
      const typing = (p.status === 'working' || p.status === 'tool') && Math.sin(this.t * 22 + p.x) > 0;
      c.fillStyle = p.color; c.fillRect(fx - 4, top + 7, 8, 6);
      c.fillStyle = p.skin; c.fillRect(fx - 6, top + (typing ? 6 : 7), 2, 3); c.fillRect(fx + 4, top + (typing ? 7 : 6), 2, 3);
      c.fillStyle = p.pelo; c.fillRect(fx - 3, top, 7, 7); c.fillRect(fx - 4, top + 1, 9, 5);
      c.fillStyle = '#262a36'; c.fillRect(fx - 5, top + 10, 11, 6);
      c.fillStyle = '#1b1e27'; c.fillRect(fx - 1, fy - 1, 2, 2);
      if (p.status === 'waiting') this.drawExclaim(c, fx, top - 4);
      return;
    }
    const top = fy - 18;
    // piernas
    c.fillStyle = '#2b2f3a';
    c.fillRect(fx - 3, top + 12 + (leg ? 1 : 0), 3, 5 - (leg ? 1 : 0));
    c.fillRect(fx + 1, top + 12 + (leg ? 0 : 1), 3, 5 - (leg ? 0 : 1));
    c.fillStyle = '#15171d'; c.fillRect(fx - 3, top + 17, 3, 1); c.fillRect(fx + 1, top + 17, 3, 1);
    // torso y brazos
    c.fillStyle = p.color; c.fillRect(fx - 4, top + 6, 9, 7);
    c.fillStyle = p.skin;
    const swing = walking ? Math.round(Math.sin(p.step)) : 0;
    c.fillRect(fx - 6, top + 7 + swing, 2, 5); c.fillRect(fx + 5, top + 7 - swing, 2, 5);
    if (p.carrying) {
      const px = fx + (p.face > 0 ? 5 : -9);
      c.fillStyle = '#fff'; c.fillRect(px, top + 4, 5, 8);
      c.fillStyle = p.color; c.fillRect(px, top + 4, 5, 1);
      c.fillStyle = '#9aa1b2'; c.fillRect(px + 1, top + 7, 3, 1); c.fillRect(px + 1, top + 9, 3, 1);
    }
    // cabeza
    c.fillStyle = p.skin; c.fillRect(fx - 3, top, 7, 7);
    c.fillStyle = p.pelo; c.fillRect(fx - 4, top - 1, 9, 3); c.fillRect(p.face > 0 ? fx - 4 : fx + 3, top + 1, 2, 3);
    c.fillStyle = '#1a1a1a';
    const ex = p.face > 0 ? 1 : -1;
    c.fillRect(fx - 1 + ex, top + 3, 1, 2); c.fillRect(fx + 2 + ex, top + 3, 1, 2);
    if (p.spot?.name === 'café' && !walking) {
      c.fillStyle = '#fff'; c.fillRect(fx + 6, top + 8, 3, 3);
      c.fillStyle = '#ffffff66'; c.fillRect(fx + 7, top + 5 - (Math.floor(this.t * 3) % 3), 1, 2);
    }
  }

  drawChip(c, cx, cy, tool) {
    const key = tool.startsWith('mcp__') ? tool.split('__')[1] : tool;
    const [label, color] = CHIPS[key] || ['···', '#8d93a3'];
    const bob = Math.round(Math.sin(this.t * 5) * 1.2);
    c.font = '5px "Press Start 2P", monospace';
    c.textBaseline = 'top';
    const w = Math.ceil(c.measureText(label).width) + 6;
    const x = Math.round(cx - w / 2), y = cy + bob - 12;
    c.fillStyle = '#000b'; c.fillRect(x - 1, y - 1, w + 2, 10);
    c.fillStyle = color; c.fillRect(x, y, w, 8);
    c.fillStyle = '#fff'; c.fillText(label, x + 3, y + 1.5);
    c.fillStyle = color; c.fillRect(Math.round(cx), y + 8, 1, 3);
  }

  drawExclaim(c, x, y) {
    const b = Math.sin(this.t * 10) * 1.5;
    c.fillStyle = '#e30016'; c.fillRect(x - 3, y - 11 + b, 7, 9);
    c.fillStyle = '#fff'; c.fillRect(x, y - 9 + b, 1, 4); c.fillRect(x, y - 4 + b, 1, 1);
  }

  drawCoffee(c) {
    const x = 15.4 * T, y = 4.6 * T;
    c.fillStyle = '#4a3326'; c.fillRect(x, y + 8, 2.4 * T, 14);
    c.fillStyle = '#2e1f17'; c.fillRect(x, y + 20, 2.4 * T, 2);
    c.fillStyle = '#c8ccd6'; c.fillRect(x + 6, y - 6, 12, 14);
    c.fillStyle = '#e30016'; c.fillRect(x + 8, y - 3, 3, 2);
    c.fillStyle = '#111'; c.fillRect(x + 9, y + 2, 6, 4);
    for (let i = 0; i < 3; i++) {
      c.fillStyle = '#ffffff40';
      c.fillRect(x + 11 + Math.sin(this.t * 2 + i) * 1.5, y - 9 - ((this.t * 6 + i * 4) % 10), 1, 2);
    }
    c.fillStyle = '#eee'; c.fillRect(x + 24, y + 5, 3, 3); c.fillRect(x + 29, y + 5, 3, 3);
  }

  drawSofa(c) {
    const x = 14 * T, y = 10.3 * T;
    c.fillStyle = '#26324d'; c.fillRect(x, y - 6, 3.6 * T, 8);
    c.fillStyle = '#2f3d5e'; c.fillRect(x, y + 2, 3.6 * T, 8);
    c.fillStyle = '#1f2940'; c.fillRect(x - 3, y - 4, 4, 14); c.fillRect(x + 3.6 * T - 1, y - 4, 4, 14);
    c.fillStyle = '#e30016'; c.fillRect(x + 6, y - 3, 6, 5);
  }

  drawCooler(c) {
    const x = 0.5 * T, y = 7.8 * T;
    c.fillStyle = '#9fd3ff99'; c.fillRect(x + 2, y, 8, 7);
    c.fillStyle = '#d6dae3'; c.fillRect(x, y + 7, 12, 14);
    c.fillStyle = '#2f9bff'; c.fillRect(x + 3, y + 10, 2, 2);
  }

  drawRack(c) {
    const x = 0.2 * T, y = 10.2 * T;
    c.fillStyle = '#121419'; c.fillRect(x, y, 1.4 * T, 1.7 * T);
    for (let i = 0; i < 5; i++) {
      c.fillStyle = '#1d2029'; c.fillRect(x + 2, y + 2 + i * 5, 1.4 * T - 4, 4);
      const on = Math.sin(this.t * (3 + i) + i * 2) > 0;
      c.fillStyle = on ? (i % 2 ? '#21c48d' : '#2f9bff') : '#123';
      c.fillRect(x + 1.4 * T - 6, y + 3 + i * 5, 2, 2);
    }
  }

  drawPlant(c, tx, ty) {
    const x = tx * T, y = ty * T;
    c.fillStyle = '#8a4b2c'; c.fillRect(x - 4, y - 6, 9, 7);
    c.fillStyle = '#2f7d4a';
    const sway = Math.round(Math.sin(this.t * 1.5 + tx) * 0.8);
    c.fillRect(x - 6 + sway, y - 14, 5, 8); c.fillRect(x + 1 + sway, y - 16, 5, 10); c.fillRect(x - 2 + sway, y - 19, 4, 8);
    c.fillStyle = '#3fa063'; c.fillRect(x - 1 + sway, y - 17, 2, 6);
  }

  drawPlanes(c) {
    for (const pl of this.planes) {
      const k = pl.t;
      const x = (pl.s.x + (pl.e.x - pl.s.x) * k) * T;
      const y = (pl.s.y + (pl.e.y - pl.s.y) * k) * T - Math.sin(k * Math.PI) * 40;
      for (let i = 1; i < 6; i++) {
        const kk = Math.max(0, k - i * 0.03);
        c.fillStyle = `${pl.color}${(80 - i * 12).toString(16).padStart(2, '0')}`;
        c.fillRect((pl.s.x + (pl.e.x - pl.s.x) * kk) * T, (pl.s.y + (pl.e.y - pl.s.y) * kk) * T - Math.sin(kk * Math.PI) * 40, 2, 2);
      }
      c.fillStyle = '#fff'; c.fillRect(x - 3, y - 2, 7, 4);
      c.fillStyle = pl.color; c.fillRect(x - 2, y - 1, 5, 1);
    }
  }

  drawLight(c) {
    // luz cálida de noche, brillo de monitores
    const h = this.hondurasHour();
    if (h < 6 || h >= 18.5) { c.fillStyle = '#0a0f2a33'; c.fillRect(0, 0, W, H); }
    for (const p of this.people) {
      if (!p.seated || p.status === 'idle') continue;
      const g = c.createRadialGradient(p.desk.x * T + 16, p.deskSpot.row * T, 1, p.desk.x * T + 16, p.deskSpot.row * T, 30);
      g.addColorStop(0, p.status === 'waiting' ? '#e3001633' : `${p.color}22`);
      g.addColorStop(1, '#0000');
      c.fillStyle = g; c.fillRect(p.desk.x * T - 16, p.deskSpot.row * T - 30, 64, 60);
    }
  }

  placeLabels() {
    const rect = this.canvas.getBoundingClientRect();
    const host = this.overlay.getBoundingClientRect();
    const ox = rect.left - host.left, oy = rect.top - host.top, s = this.scale;
    for (const p of this.people) {
      const headY = p.y * T - (p.seated ? 17 : 21);
      const x = ox + p.x * T * s, y = oy + headY * s;
      p.tag.style.left = `${x}px`;
      p.tag.style.top = `${oy + (p.y * T + 2) * s}px`;
      const show = p.status !== 'idle' && p.text;
      p.bubble.className = `bubble ${p.status}`;
      p.bubble.textContent = p.status === 'tool' ? `🔧 ${p.text}` : p.status === 'waiting' ? `✋ ${p.text}` : p.text;
      p.bubble.style.opacity = show ? 1 : 0;
      const half = p.bubble.offsetWidth / 2 + 6;
      p.bubble.style.left = `${Math.min(host.width - half, Math.max(half, x))}px`;
      p.bubble.style.top = `${y - (p.status === 'waiting' ? 14 * s : 2 * s)}px`;
      p.bubble.style.zIndex = Math.round(p.y * 10);
    }
  }
}
