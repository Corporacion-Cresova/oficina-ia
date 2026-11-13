// Sistema visual Cresova (receta A+B): paleta, combinaciones de fuentes, HUD, subtítulos, logo y piezas comunes.
// Todo depende solo de los argumentos (determinista).
export const C = { coal: '#121212', red: '#E20018', cream: '#ECE7DC', white: '#FFFFFF', ink: '#121212', mute: '#8C877D', green: '#1FAF5A' };

// Ronda 2 (Fontshare, ITF FFL): display (verbo/titular), serif (idea emocional), sans (subtítulos y UI), mono (HUD).
export const COMBOS = {
  D: { name: 'Showreel', display: (s) => `700 ${s}px ClashDisplay`, serif: (s) => `italic 500 ${s}px Gambetta`, sans: (s, w = 700) => `${w} ${s}px Satoshi`, mono: (s, w = 500) => `${w} ${s}px JetBrainsMono` },
  E: { name: 'Ancha', display: (s) => `800 ${s}px Panchang`, serif: (s) => `italic 400 ${s}px Zodiak`, sans: (s, w = 700) => `${w} ${s}px GeneralSans`, mono: (s, w = 500) => `${w} ${s}px JetBrainsMono` },
  F: { name: 'Grotesca', display: (s) => `900 ${s}px CabinetGrotesk`, serif: (s) => `italic 500 ${s}px Erode`, sans: (s, w = 700) => `${w} ${s}px GeneralSans`, mono: (s, w = 500) => `${w} ${s}px JetBrainsMono` },
};

// Logo desde el SVG oficial (bloque + C + RESOVA). Se recolorea según el fondo; sin recuadro.
const LOGO_VARIANTS = {
  dark: { letters: '#ffffff', c: '#e20018' },   // sobre carbón: letras blancas, C roja (colores originales)
  light: { letters: '#121212', c: '#e20018' },  // sobre crema: letras carbón, C roja
  red: { letters: '#ffffff', c: '#121212' },    // sobre rojo: letras blancas, C carbón
};
const logos = {};
let LOGO_AR = 1;
export async function loadAssets() {
  const fams = ['700 40px ClashDisplay', '800 40px Panchang', '900 40px CabinetGrotesk', 'italic 500 40px Gambetta', 'italic 600 40px Gambetta', 'italic 400 40px Zodiak',
    'italic 500 40px Erode', '500 40px Satoshi', '700 40px Satoshi', '900 40px Satoshi', '500 40px GeneralSans', '600 40px GeneralSans', '700 40px GeneralSans', '500 40px JetBrainsMono', '700 40px JetBrainsMono', '600 40px Montserrat'];
  await Promise.all(fams.map((f) => document.fonts.load(f, 'ÁÉÍÓÚÑ¿?aé0').catch(() => {})));
  const svg = await (await fetch('/assets/brand/Cresova_Logo.svg')).text();
  // Recorte al contenido (el SVG trae mucho margen).
  const cropped = svg.replace(/viewBox="[^"]*"/, 'viewBox="165 318 948 248"').replace(/width="1275" height="900"/, 'width="948" height="248"');
  LOGO_AR = 948 / 248;
  for (const [k, v] of Object.entries(LOGO_VARIANTS)) {
    const s = cropped.replace(/fill="#ffffff"/g, `fill="${v.letters}"`).replace(/fill="#e20018"/g, `fill="${v.c}"`);
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); await img.decode(); logos[k] = img;
  }
}
export function drawLogo(ctx, cx, cy, w, variant = 'dark') { const h = w / LOGO_AR; ctx.drawImage(logos[variant], cx - w / 2, cy - h / 2, w, h); }

export const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };

// Una línea que se achica si no cabe en maxW.
export function fitText(ctx, text, fontFn, x, y, maxW, size, align = 'left') {
  ctx.font = fontFn(size);
  const w = ctx.measureText(text).width;
  if (w > maxW) { size = Math.floor(size * maxW / w); ctx.font = fontFn(size); }
  ctx.textAlign = align; ctx.fillText(text, x, y);
  return size;
}

// Titular de varias líneas: todas al mismo tamaño (el que quepa la más larga). lines = [[texto, color], ...].
export function headline(ctx, fontFn, lines, { x = 70, y = 500, maxW = 880, size = 170, lead = 1.02, align = 'left' } = {}) {
  ctx.font = fontFn(size);
  const widest = Math.max(...lines.map(([s]) => ctx.measureText(s).width));
  if (widest > maxW) size = Math.floor(size * maxW / widest);
  ctx.font = fontFn(size); ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  lines.forEach(([s, col], i) => { ctx.fillStyle = col; ctx.fillText(s, x, y + i * size * lead); });
  return size;
}

const tc = (t) => { const f = Math.floor(t * 30) % 30, s = Math.floor(t) % 60; return `00:00:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`; };

// Marco HUD (referencia B): esquinas, marca, código de tiempo, capítulo y progreso. Dentro de zona segura.
export function hud(ctx, combo, { vt, chapter, total = 6, name, dark = true, dur = 23 }) {
  const fg = dark ? 'rgba(236,231,220,.72)' : 'rgba(18,18,18,.7)';
  ctx.save(); ctx.strokeStyle = fg; ctx.lineWidth = 2;
  [[40, 40, 1, 1], [1040, 40, -1, 1], [40, 1880, 1, -1], [1040, 1880, -1, -1]].forEach(([x, y, sx, sy]) => {
    ctx.beginPath(); ctx.moveTo(x, y + 36 * sy); ctx.lineTo(x, y); ctx.lineTo(x + 36 * sx, y); ctx.stroke();
  });
  ctx.fillStyle = fg; ctx.font = combo.mono(22); ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left'; ctx.fillText("CRESOVA · HN '26", 70, 300);
  ctx.textAlign = 'right'; ctx.fillText(tc(vt), 930, 300);
  const y = 1500;
  ctx.textAlign = 'left'; ctx.fillText(`${String(chapter).padStart(2, '0')}/${String(total).padStart(2, '0')} · ${name}`, 70, y);
  ctx.textAlign = 'right'; ctx.fillText('● 120 BPM', 930, y);
  ctx.fillRect(70, y + 22, 860, 2);
  ctx.fillStyle = C.red; ctx.fillRect(70, y + 20, 860 * Math.min(1, vt / dur), 6);
  for (let i = 0; i <= 24; i++) { ctx.fillStyle = fg; ctx.fillRect(70 + i * 860 / 24, y + 30, 2, i % 4 ? 8 : 16); }
  ctx.restore();
}

// Subtítulos en 3 estilos. words = palabras del grupo; said = cuántas ya se dijeron; key = índice de la palabra clave.
//  cine:      minúscula, sans limpia, sombra suave + contorno fino; lo no dicho al 35 % (ref. A).
//  editorial: sans + palabra clave en cursiva serif roja más grande (ref. B).
//  pildora:   sans blanca, palabra clave dentro de una píldora roja (estilo v2 que gustó).
export function caption(ctx, combo, words, { style = 'cine', said = words.length, key = -1, y = 1350, dark = true, keyColor = C.red } = {}) {
  ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  const base = style === 'cine' ? 62 : 60;
  // Palabra clave Editorial: Gambetta Semibold (600) más grande para que no se pierda sobre oscuro.
  const fontOf = (i) => (style === 'editorial' && i === key ? combo.serif(base * 1.42).replace('italic 500', 'italic 600') : combo.sans(base, style === 'cine' ? 700 : 800));
  const sp = base * 0.28;
  const ws = words.map((w, i) => { ctx.font = fontOf(i); return ctx.measureText(w).width; });
  const pad = 22, total = ws.reduce((a, b) => a + b, 0) + sp * (words.length - 1) + (style === 'pildora' && key >= 0 ? pad * 2 : 0);
  let x = 540 - total / 2;
  words.forEach((w, i) => {
    ctx.font = fontOf(i); ctx.textAlign = 'left';
    const isKey = i === key, on = i < said;
    if (style === 'pildora' && isKey) { ctx.fillStyle = C.red; rr(ctx, x, y - base * 0.86, ws[i] + pad * 2, base * 1.18, 16); ctx.fill(); x += pad; }
    ctx.globalAlpha = style === 'cine' && !on ? 0.35 : 1;
    // Fondo oscuro: blanco con sombra y contorno fino. Fondo claro: carbón sin contorno.
    if (dark) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 4; }
    if (dark && !(style === 'pildora' && isKey)) { ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(w, x, y); }
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = style === 'editorial' && isKey ? keyColor : (dark || (style === 'pildora' && isKey) ? C.white : C.ink);
    ctx.fillText(w, x, y);
    x += ws[i] + sp + (style === 'pildora' && isKey ? pad : 0);
  });
  ctx.restore();
}

// Honduras simplificado (lon, lat) → puntos dentro del contorno.
const HN = [[-89.35, 15.07], [-88.7, 15.7], [-88.2, 15.72], [-87.6, 15.88], [-86.9, 15.75], [-86.0, 15.95], [-85.4, 15.88], [-84.8, 15.85],
  [-84.3, 15.82], [-83.8, 15.42], [-83.15, 15.0], [-83.4, 14.95], [-83.6, 14.8], [-84.2, 14.75], [-84.5, 14.62], [-84.9, 14.8], [-85.15, 14.35],
  [-85.6, 13.95], [-86.0, 13.98], [-86.3, 13.75], [-86.75, 13.75], [-86.8, 13.3], [-87.3, 12.98], [-87.5, 13.3], [-87.8, 13.4], [-87.7, 13.8],
  [-88.0, 13.9], [-88.5, 13.85], [-88.85, 14.05], [-89.2, 14.4], [-89.35, 14.45], [-89.15, 14.9]];
const inside = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
export function mapPoints({ x = 90, y = 620, w = 900, step = 20 } = {}) {
  const lon0 = -89.4, lon1 = -83.1, lat0 = 12.9, lat1 = 16.0, sc = w / (lon1 - lon0), h = (lat1 - lat0) * sc, pts = [];
  for (let py = 0; py <= h; py += step) for (let px = 0; px <= w; px += step) {
    const lon = lon0 + px / sc, lat = lat1 - py / sc;
    if (inside(lon, lat, HN)) pts.push([x + px, y + py]);
  }
  return pts;
}

export function pin(ctx, x, y, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-8, -14, -26, -26, -26, -46); ctx.arc(0, -46, 26, Math.PI, 0); ctx.bezierCurveTo(26, -26, 8, -14, 0, 0); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -46, 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

export function bubble(ctx, combo, text, x, y, { w = 520, from = 'left' } = {}) {
  // Ancho automático: la burbuja crece para que el texto nunca se salga (feedback Diego, video 04).
  ctx.save(); ctx.font = combo.sans(40, 600); w = Math.max(w, ctx.measureText(text).width + 90); ctx.restore();
  if (from === 'right') x = Math.min(x, 1050 - w);
  ctx.save(); ctx.fillStyle = C.white; ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
  rr(ctx, x, y, w, 110, 34); ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.beginPath(); const tx = from === 'left' ? x + 30 : x + w - 30; ctx.moveTo(tx - 16, y + 100); ctx.lineTo(tx + (from === 'left' ? -30 : 30), y + 130); ctx.lineTo(tx + 16, y + 100); ctx.fill();
  ctx.fillStyle = C.ink; ctx.font = combo.sans(40, 600); ctx.textAlign = 'left'; ctx.fillText(text, x + 36, y + 72);
  ctx.fillStyle = C.mute; ctx.font = combo.mono(18); ctx.textAlign = 'right'; ctx.fillText('CLIENTE · 9:41 PM', x + w - 30, y + 30);
  ctx.restore();
}

// Fondo con rejilla de puntos tenue (referencia B).
export function bg(ctx, color, dot) {
  ctx.fillStyle = color; ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = dot; for (let y = 60; y < 1920; y += 60) for (let x = 60; x < 1080; x += 60) ctx.fillRect(x - 1, y - 1, 2, 2);
}

// ---------- animación (todo función del tiempo) ----------
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const prog = (t, a, d) => clamp01((t - a) / d);           // 0→1 entre a y a+d
export const lerp = (a, b, k) => a + (b - a) * k;
export const E = {
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inCubic: (x) => x * x * x,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outBack: (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
};
// Golpe de escala 1 → peak → 1 empezando en a (para "latidos" sobre algo ya visible).
export const bump = (t, a, d = 0.35, peak = 1.08) => { const k = prog(t, a, d); return k <= 0 || k >= 1 ? 1 : 1 + (peak - 1) * Math.sin(Math.PI * k); };
// Entrada con desenfoque (blur 14→0, y +24→0, alfa 0→1).
export function blurIn(ctx, t, a, d, draw) {
  const k = E.outCubic(prog(t, a, d)); if (k <= 0) return;
  ctx.save(); ctx.globalAlpha *= k; ctx.filter = `blur(${(1 - k) * 14}px)`; ctx.translate(0, (1 - k) * 24); draw(); ctx.restore();
}
// Entrada "golpe" (escala 2.2 → 1 con aplaste) alrededor de (cx, cy).
export function slamIn(ctx, t, a, cx, cy, draw, d = 0.32) {
  const k = prog(t, a, d); if (k <= 0) return;
  const s = k >= 1 ? 1 : lerp(2.2, 1, E.outExpo(k)) * (k > 0.6 ? 1 : 1);
  ctx.save(); ctx.globalAlpha *= clamp01(k * 3); ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy); draw(); ctx.restore();
}
// Aplica una "cámara": escala s alrededor de (cx, cy).
export function camera(ctx, s, cx = 540, cy = 960) { ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy); }

// ---------- piezas ----------
export function searchBar(ctx, k, x, y, w, text, { cursorOn = true, glow = 0.35 } = {}) {
  ctx.save(); ctx.fillStyle = C.cream; ctx.shadowColor = `rgba(226,0,24,${glow})`; ctx.shadowBlur = 50; rr(ctx, x, y, w, 130, 65); ctx.fill(); ctx.restore();
  ctx.save(); ctx.strokeStyle = C.coal; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(x + 80, y + 58, 22, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + 96, y + 74); ctx.lineTo(x + 116, y + 94); ctx.stroke();
  ctx.font = k.mono(38); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const [base, typed = ''] = Array.isArray(text) ? text : [text];
  ctx.fillStyle = C.mute; ctx.fillText(base, x + 150, y + 80);
  const bw = ctx.measureText(base).width; ctx.fillStyle = C.ink; ctx.fillText(typed, x + 150 + bw, y + 80);
  if (cursorOn) { ctx.fillStyle = C.red; ctx.fillRect(x + 158 + bw + ctx.measureText(typed).width, y + 40, 5, 54); }
  ctx.restore();
}

// Ficha de negocio (EJEMPLO). rows = cuántas filas visibles (0–3, puede ser fraccional para animar).
export function businessCard(ctx, k, x, y, { rows = 3, press = 1 } = {}) {
  ctx.save(); ctx.fillStyle = C.white; ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20; rr(ctx, x, y, 860, 520, 36); ctx.fill(); ctx.restore();
  ctx.fillStyle = C.ink; ctx.font = k.sans(46, 900); ctx.textAlign = 'left'; ctx.fillText('Clínica Dental Vértice', x + 140, y + 80);
  ctx.fillStyle = C.red; ctx.font = k.mono(20); ctx.fillText('EJEMPLO', x + 140, y + 116);
  ctx.fillStyle = '#F2B400'; ctx.font = k.sans(34); ctx.fillText('★★★★★', x + 290, y + 118);
  const R = [['UBICACIÓN', 'Barrio El Centro · a 600 m'], ['HORARIO', 'Abierto · citas hoy hasta 7:00 p. m.']];
  R.forEach(([a, b], i) => {
    const kk = E.outBack(clamp01(rows - i)); if (kk <= 0) return;
    const yy = y + 200 + i * 96;
    ctx.save(); ctx.globalAlpha = clamp01(rows - i); ctx.translate((1 - kk) * 40, 0);
    ctx.fillStyle = C.mute; ctx.font = k.mono(22); ctx.fillText(a, x + 50, yy); ctx.fillStyle = C.ink; ctx.font = k.sans(38, 500); ctx.fillText(b, x + 50, yy + 46);
    ctx.fillStyle = '#E6E1D6'; ctx.fillRect(x + 50, yy + 66, 760, 2); ctx.restore();
  });
  const kb = clamp01(rows - 2);
  if (kb > 0) {
    const s = lerp(0.6, 1, E.outBack(kb)) * press;
    ctx.save(); ctx.globalAlpha = kb; ctx.translate(x + 430, y + 445); ctx.scale(s, s);
    ctx.fillStyle = C.green; rr(ctx, -380, -45, 760, 90, 45); ctx.fill();
    ctx.fillStyle = C.white; ctx.font = k.sans(40, 900); ctx.textAlign = 'center'; ctx.fillText('Escribir por WhatsApp', 0, 14); ctx.restore();
  }
}

// Mini tarjetas del carrusel (380×560, origen arriba-izquierda).
export function miniCard(ctx, k, kind) {
  ctx.save(); ctx.fillStyle = C.white; rr(ctx, 0, 0, 380, 560, 30); ctx.fill();
  ctx.font = k.mono(18); ctx.fillStyle = C.red; ctx.textAlign = 'left';
  if (kind === 'web') {
    ctx.fillText('TU PÁGINA · EJEMPLO', 30, 50);
    ctx.fillStyle = C.coal; rr(ctx, 30, 75, 320, 40, 10); ctx.fill();
    ctx.fillStyle = C.red; rr(ctx, 30, 135, 320, 170, 16); ctx.fill();
    ctx.fillStyle = C.white; ctx.font = k.display(34); ctx.fillText('SONRÍE', 50, 230); ctx.font = k.serif(30); ctx.fillText('con cita hoy.', 52, 268);
    ctx.fillStyle = C.ink; [330, 365, 400].forEach((yy, i) => { ctx.fillStyle = i ? '#D9D4C8' : C.ink; rr(ctx, 30, yy, i ? 260 : 300, 16, 8); ctx.fill(); });
    ctx.fillStyle = C.green; rr(ctx, 30, 460, 320, 64, 32); ctx.fill(); ctx.fillStyle = C.white; ctx.font = k.sans(26, 900); ctx.textAlign = 'center'; ctx.fillText('WhatsApp', 190, 502);
  } else if (kind === 'google') {
    ctx.fillText('GOOGLE · EJEMPLO', 30, 50);
    ctx.fillStyle = C.ink; ctx.font = k.sans(34, 900); ctx.fillText('Clínica Dental', 30, 110); ctx.fillText('Vértice', 30, 150);
    ctx.fillStyle = '#F2B400'; ctx.font = k.sans(30); ctx.fillText('★★★★★', 30, 195);
    ctx.fillStyle = '#D9D4C8'; [240, 285, 330].forEach((yy) => { rr(ctx, 30, yy, 320, 18, 9); ctx.fill(); });
    ctx.fillStyle = C.green; ctx.font = k.sans(28, 700); ctx.fillText('Abierto ahora', 30, 400);
    ctx.fillStyle = C.coal; rr(ctx, 30, 440, 150, 70, 35); ctx.fill(); ctx.fillStyle = C.red; rr(ctx, 200, 440, 150, 70, 35); ctx.fill();
  } else {
    ctx.fillText('MAPA · EJEMPLO', 30, 50);
    ctx.fillStyle = '#E8E3D7'; rr(ctx, 20, 70, 340, 470, 20); ctx.fill();
    ctx.strokeStyle = '#D2CCBE'; ctx.lineWidth = 10; [[20, 200, 360, 260], [120, 70, 200, 540], [20, 420, 360, 380]].forEach(([a, b, c, d]) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); });
    pin(ctx, 190, 330, 1.5, C.red);
  }
  ctx.restore();
}

export function counterPanel(ctx, k, x, y, value, { light = true } = {}) {
  ctx.save(); ctx.fillStyle = light ? C.white : C.coal; rr(ctx, x, y, 420, 150, 24); ctx.fill();
  ctx.fillStyle = C.mute; ctx.font = k.mono(18); ctx.textAlign = 'left'; ctx.fillText('MENSAJES · EJEMPLO', x + 28, y + 42);
  ctx.fillStyle = light ? C.ink : C.white; ctx.font = k.display(76); ctx.fillText(String(Math.round(value)), x + 26, y + 125);
  const bars = [0.3, 0.45, 0.4, 0.7, 0.6, 1]; bars.forEach((h, i) => { ctx.fillStyle = i === 5 ? C.red : '#CFC9BC'; const bh = 70 * h * clamp01(value / 12); ctx.fillRect(x + 230 + i * 28, y + 125 - bh, 18, bh); });
  ctx.restore();
}

// ---------- movimiento ambiental (pase de movimiento, feedback Preview v1) ----------
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const DUST = (() => { const r = rng(7); return Array.from({ length: 34 }, () => ({ x: r() * 1080, y: r() * 1920, s: 1 + r() * 2.5, v: 6 + r() * 14, ph: r() * 6.28, red: r() < 0.18 })); })();
// Polvo/partículas que suben lento + un brillo radial que se desplaza. tone: 'dark' | 'light'.
export function ambient(ctx, t, tone = 'dark', glow = C.red) {
  ctx.save();
  const gx = 540 + Math.sin(t * 0.35) * 260, gy = 980 + Math.cos(t * 0.28) * 300;
  const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 900);
  g.addColorStop(0, tone === 'dark' ? 'rgba(226,0,24,.10)' : 'rgba(226,0,24,.05)'); g.addColorStop(1, 'rgba(226,0,24,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1920);
  DUST.forEach((d) => {
    const y = (d.y - t * d.v + 1920 * 10) % 1920, a = 0.14 + 0.12 * Math.sin(t * 1.3 + d.ph);
    ctx.fillStyle = d.red ? `rgba(226,0,24,${a + 0.2})` : tone === 'dark' ? `rgba(236,231,220,${a})` : `rgba(18,18,18,${a * 0.6})`;
    ctx.beginPath(); ctx.arc(d.x + Math.sin(t * 0.8 + d.ph) * 12, y, d.s, 0, Math.PI * 2); ctx.fill();
  });
  ctx.restore();
}
// Golpes de zoom (punch-in) en los beats: devuelve la escala de cámara para el tiempo t.
export function punch(t, times, amt = 0.06, d = 0.5) {
  amt *= 0.5; // feedback v2: menos movimiento de adorno
  let s = 1; times.forEach((a) => { const k = prog(t, a, d); if (k > 0 && k < 1) s += amt * (1 - E.outExpo(k)) * Math.min(1, k * 12); }); return s;
}
// Anillos que se expanden desde (x, y) cada `every` s a partir de a.
export function rings(ctx, t, x, y, a, { every = 0.9, max = 160, color = '226,0,24', n = 3 } = {}) {
  if (t < a) return;
  ctx.save(); ctx.lineWidth = 3;
  for (let i = 0; i < n; i++) { const k = (((t - a) / every + i / n) % 1); ctx.strokeStyle = `rgba(${color},${(1 - k) * 0.6})`; ctx.beginPath(); ctx.arc(x, y, 20 + max * E.outCubic(k), 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
// Brillo que pasa SOLO por dentro de las letras (feedback v2: el rectángulo encima se veía mal).
// draw(c) dibuja el texto en el contexto c; fuera de la ventana [a, a+d] se dibuja normal.
export function textShine(ctx, t, a, d, draw) {
  const k = prog(t, a, d);
  if (k <= 0 || k >= 1) { draw(ctx); return; }
  const cv = ctx.canvas, oc = new OffscreenCanvas(cv.width, cv.height), o = oc.getContext('2d');
  o.setTransform(ctx.getTransform()); o.globalAlpha = ctx.globalAlpha; o.filter = ctx.filter; draw(o);
  o.globalCompositeOperation = 'source-atop'; o.globalAlpha = 1; o.filter = 'none';
  const x = -300 + 1700 * E.inOutCubic(k), g = o.createLinearGradient(x - 180, 0, x + 180, 260);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  o.fillStyle = g; o.fillRect(-200, -200, 1480, 2320);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.drawImage(oc, 0, 0); ctx.restore();
}
// (Retirado del uso) Brillo que barre un rectángulo.
export function sweep(ctx, t, a, x, y, w, h, d = 0.7) {
  const k = prog(t, a, d); if (k <= 0 || k >= 1) return;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); const sx = x - 200 + (w + 400) * E.inOutCubic(k);
  const g = ctx.createLinearGradient(sx - 120, 0, sx + 120, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.globalCompositeOperation = 'lighter'; ctx.fillRect(x, y, w, h); ctx.restore();
}

// ---------- utilidades comunes de la tanda 1 (videos 05+) ----------
export async function loadImg(src) { const im = new Image(); im.src = src; await im.decode(); return im; }
// Grano de película: 4 tiles fijos (semilla) que se alternan por cuadro.
export function makeGrain() {
  return Array.from({ length: 4 }, (_, n) => {
    const c = document.createElement('canvas'); c.width = 270; c.height = 480; const g = c.getContext('2d'), im = g.createImageData(270, 480);
    let s = 1234 + n * 999; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < im.data.length; i += 4) { const v = r() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0); return c;
  });
}
// Acabado: viñeta + sombra inferior continua hasta el borde + grano.
export function finish(ctx, t, grain) {
  const v = ctx.createRadialGradient(540, 900, 300, 540, 960, 1250); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.65)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, 1080, 1920);
  const cb = ctx.createLinearGradient(0, 1150, 0, 1920); cb.addColorStop(0, 'rgba(0,0,0,0)'); cb.addColorStop(0.3, 'rgba(0,0,0,.55)'); cb.addColorStop(1, 'rgba(0,0,0,.8)');
  ctx.fillStyle = cb; ctx.fillRect(0, 1150, 1080, 770);
  ctx.save(); ctx.globalAlpha = 0.06; ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(grain[Math.floor(t * 30) % 4], 0, 0, 1080, 1920); ctx.restore();
}
// Captura web dentro de la pantalla del teléfono (540×1110): barra de estado + imagen con scroll + etiqueta EJEMPLO.
export function webShot(g, k, im, scroll = 0, { blur = 0, hue = 0, label = 'EJEMPLO', time = '9:00 a. m.' } = {}) {
  g.fillStyle = '#fff'; g.fillRect(0, 0, 540, 1110);
  g.save(); g.filter = `${blur ? `blur(${blur}px) ` : ''}${hue ? `hue-rotate(${hue}deg)` : ''}` || 'none';
  scroll = Math.min(scroll, Math.max(0, 540 * im.height / im.width - 1000));   // nunca más allá del final de la captura (el borde inferior queda tras el marco)
  g.drawImage(im, 0, 64 - scroll, 540, 540 * im.height / im.width); g.restore();
  g.fillStyle = '#fff'; g.fillRect(0, 0, 540, 64);
  g.fillStyle = '#121212'; g.font = k.sans(24, 700); g.textAlign = 'left'; g.fillText(time, 36, 46); g.textAlign = 'right'; g.fillText('●●● 5G', 504, 46);
  if (label) { g.fillStyle = 'rgba(18,18,18,.75)'; rr(g, 408, 76, 116, 32, 16); g.fill(); g.fillStyle = '#fff'; g.font = k.mono(16, 700); g.textAlign = 'center'; g.fillText(label, 466, 98); }
}
// Sello (rectángulo con texto) que cae con golpe. k = progreso 0..1 (outBack).
export function stamp(ctx, k2, txt, x, y, { color = C.red, size = 64, rot = -0.14 } = {}) {
  if (k2 <= 0) return; ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(2 - k2, 2 - k2); ctx.globalAlpha = Math.min(1, k2);
  ctx.font = k2 ? `${size}px ClashDisplay` : ''; ctx.font = `700 ${size}px ClashDisplay`; const w = ctx.measureText(txt).width + 70;
  ctx.strokeStyle = color; ctx.lineWidth = 9; rr(ctx, -w / 2, -size * 0.85, w, size * 1.6, 16); ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(txt, 0, size * 0.33); ctx.restore();
}
