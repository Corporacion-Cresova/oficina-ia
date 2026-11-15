// Capa "a mano" (plan de mejoras v2): trazos de marcador que se dibujan solos sobre el video — círculo, subrayado, flecha,
// palomita y tachado. Temblor leve y determinista (no es una línea perfecta de computadora). k = progreso del trazo 0..1.
const jit = (i, s) => Math.sin(i * 12.9898 + s * 78.233) * 43758.5453 % 1;   // ruido determinista −1..1
function stroke(ctx, pts, k, { color = '#E20018', width = 9, alpha = 0.95 } = {}) {
  if (k <= 0 || pts.length < 2) return;
  const n = Math.max(2, Math.floor(pts.length * Math.min(1, k)));
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); ctx.restore();
}
// Círculo de marcador alrededor de (cx, cy) con radios rx, ry; da 1.15 vueltas como lo haría una mano.
export function circulo(ctx, k, cx, cy, rx, ry, o = {}) {
  const pts = []; const seed = o.seed ?? 1;
  for (let i = 0; i <= 90; i++) { const a = -2.2 + (i / 90) * Math.PI * 2 * 1.15, w = 1 + 0.05 * jit(i, seed) + 0.04 * (i / 90);
    pts.push([cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w]); }
  stroke(ctx, pts, k, o);
}
// Subrayado ligeramente ondulado de x1 a x2.
export function subrayado(ctx, k, x1, x2, y, o = {}) {
  const pts = []; for (let i = 0; i <= 40; i++) { const x = x1 + (x2 - x1) * (i / 40); pts.push([x, y + 4 * Math.sin(i * 0.5 + (o.seed ?? 0)) + 2 * jit(i, o.seed ?? 2)]); }
  stroke(ctx, pts, k, o);
}
// Flecha curva de (x1, y1) a (x2, y2) con punta.
export function flecha(ctx, k, x1, y1, x2, y2, o = {}) {
  const mx = (x1 + x2) / 2 + (o.bend ?? 60), my = (y1 + y2) / 2 - (o.bend ?? 60) * 0.5, pts = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([(1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mx + t * t * x2, (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * my + t * t * y2]); }
  stroke(ctx, pts, Math.min(1, k * 1.25), o);
  const kh = Math.max(0, (k - 0.75) / 0.25); if (kh <= 0) return;
  const [ax, ay] = pts[38], ang = Math.atan2(y2 - ay, x2 - ax), L = 34 * kh;
  stroke(ctx, [[x2 - Math.cos(ang - 0.5) * L, y2 - Math.sin(ang - 0.5) * L], [x2, y2], [x2 - Math.cos(ang + 0.5) * L, y2 - Math.sin(ang + 0.5) * L]], 1, o);
}
// Palomita (✓) de marcador.
export function palomita(ctx, k, x, y, s = 1, o = {}) {
  stroke(ctx, [[x - 30 * s, y], [x - 8 * s, y + 24 * s], [x + 40 * s, y - 34 * s]].flatMap((p, i, a) => i ? [...Array(10)].map((_, j) => [a[i - 1][0] + (p[0] - a[i - 1][0]) * (j + 1) / 10, a[i - 1][1] + (p[1] - a[i - 1][1]) * (j + 1) / 10]) : [p]), k, { width: 11, ...o });
}
// Tachado en zigzag sobre un rectángulo.
export function tachado(ctx, k, x, y, w, h, o = {}) {
  const pts = []; for (let i = 0; i <= 6; i++) pts.push([x + (w * i) / 6, y + (i % 2 ? h : 0) + 6 * jit(i, o.seed ?? 3)]);
  const dense = []; for (let i = 1; i < pts.length; i++) for (let j = 0; j < 8; j++) dense.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * j / 8, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * j / 8]);
  stroke(ctx, dense, k, o);
}
