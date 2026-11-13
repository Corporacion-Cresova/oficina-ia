// Parche puntual (one take + menos adorno). Se ejecuta una vez desde la raíz de cresova-motion.
import { readFileSync, writeFileSync } from "node:fs";
const S = "videos/01-te-encuentran/src/";
const ed = (f, pairs) => {
  let s = readFileSync(S + f, "utf8");
  for (const [a, b] of pairs) { if (!s.includes(a)) throw Error(`${f}: no encontré «${a.slice(0, 70)}»`); s = s.split(a).join(b); }
  writeFileSync(S + f, s);
};
// 1) Todas las escenas aceptan fg (sin fondo) para poder superponerlas en las transiciones del one take.
for (const f of ["s1-gancho.js", "s2-busqueda.js", "s3-ficha.js", "s4-se-fue.js", "s5-te-encuentran.js", "s6-cierre.js"]) {
  let s = readFileSync(S + "scenes/" + f, "utf8");
  s = s.replace("export function draw(ctx, _lt, { scene, t }) {", "export function draw(ctx, _lt, { scene, t, fg = false, noBar = false }) {");
  s = s.replace(/\n  bg\(ctx, ([^\n]*)\n  ambient\(ctx, t, '(dark|light)'\);/, "\n  if (!fg) { bg(ctx, $1 ambient(ctx, t, '$2'); }");
  s = s.replace(/^\s*sweep\(ctx[^\n]*\n/gm, "");                         // fuera los brillos cuadrados
  s = s.replace(/sweep\(ctx, t, 19\.6[^\n]*\n/, "");
  writeFileSync(S + "scenes/" + f, s);
}
// 2) Menos adorno: polvo más escaso y tenue, brillo de fondo más suave, golpes de zoom a la mitad.
ed("cresova.js", [
  ["Array.from({ length: 70 }", "Array.from({ length: 34 }"],
  ["v: 8 + r() * 26", "v: 6 + r() * 14"],
  ["tone === 'dark' ? 'rgba(226,0,24,.16)' : 'rgba(226,0,24,.07)'", "tone === 'dark' ? 'rgba(226,0,24,.10)' : 'rgba(226,0,24,.05)'"],
  ["const y = (d.y - t * d.v + 1920 * 10) % 1920, a = 0.25 + 0.25 * Math.sin(t * 1.3 + d.ph);", "const y = (d.y - t * d.v + 1920 * 10) % 1920, a = 0.14 + 0.12 * Math.sin(t * 1.3 + d.ph);"],
  ["export function punch(t, times, amt = 0.06, d = 0.5) {", "export function punch(t, times, amt = 0.06, d = 0.5) {\n  amt *= 0.5; // feedback v2: menos movimiento de adorno"],
]);
// 3) Escena 1: sin anillos permanentes; la barra se puede omitir (en la transición la dibuja la escena 2).
ed("scenes/s1-gancho.js", [
  ["  rings(ctx, t, 540, 965, 0.0, { every: 1.0, max: 420, n: 2, color: '226,0,24' });\n", ""],
  ["  const s = bump(t, Wt(2) - 0.04, 0.4, 1.05);", "  const s = bump(t, Wt(2) - 0.04, 0.4, 1.05);\n  if (!noBar) {"],
  ["searchBar(ctx, k, 90, 900, 900, 'lo que vendes', { cursorOn: Math.floor(t * 2) % 2 === 0, glow: 0.3 + 0.15 * Math.sin(t * 3) });\n  ctx.restore();", "searchBar(ctx, k, 90, 900, 900, 'lo que vendes', { cursorOn: Math.floor(t * 2) % 2 === 0, glow: 0.3 + 0.15 * Math.sin(t * 3) });\n  ctx.restore(); }"],
  ["headline(ctx, k.display, [['¿TE', C.white], ['ENCUENTRAN?', C.red]], { y: 520, size: 190 });", "textShine(ctx, t, 0.25, 0.9, (c) => headline(c, k.display, [['¿TE', C.white], ['ENCUENTRAN?', C.red]], { y: 520, size: 190 }));"],
  ["import { C, COMBOS, headline, bg, searchBar, bump, camera, ambient, punch, rings, sweep } from '../cresova.js';", "import { C, COMBOS, headline, bg, searchBar, bump, camera, ambient, punch, textShine } from '../cresova.js';"],
]);
ed("scenes/s6-cierre.js", [
  ["slamIn(ctx, t, Wt(46) - 0.05, 540, 660, () => { ctx.fillStyle = C.white; fitText(ctx, 'DEMO GRATIS', k.display, 540, 700, 900, 170, 'center'); });",
   "slamIn(ctx, t, Wt(46) - 0.05, 540, 660, () => textShine(ctx, t, Wt(47) + 0.3, 0.9, (c) => { c.fillStyle = C.white; fitText(c, 'DEMO GRATIS', k.display, 540, 700, 900, 170, 'center'); }));"],
  ["import { C, COMBOS, bg, rr, fitText, drawLogo, slamIn, blurIn, prog, E, lerp, bump, ambient, sweep, camera } from '../cresova.js';", "import { C, COMBOS, bg, rr, fitText, drawLogo, slamIn, blurIn, prog, E, lerp, bump, ambient, camera, textShine } from '../cresova.js';"],
]);
ed("scenes/s5-te-encuentran.js", [["import { C, COMBOS, bg, headline, miniCard, slamIn, blurIn, prog, E, camera, ambient, punch, sweep } from '../cresova.js';", "import { C, COMBOS, bg, headline, miniCard, slamIn, blurIn, prog, E, camera, ambient, punch } from '../cresova.js';"]]);
// Escena 5: el halo rojo solo con fondo (no en superposición).
ed("scenes/s5-te-encuentran.js", [["  const g = ctx.createRadialGradient(540, 1000, 0, 540, 1000, 620);", "  if (!fg) { const g = ctx.createRadialGradient(540, 1000, 0, 540, 1000, 620);"],
  ["  ctx.fillStyle = g; ctx.fillRect(0, 300, 1080, 1400);", "  ctx.fillStyle = g; ctx.fillRect(0, 300, 1080, 1400); }"]]);
console.log("parche aplicado");
