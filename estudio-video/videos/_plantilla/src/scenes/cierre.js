// Cierre reutilizable (jerarquía de 3 niveles, alineación central): logo → DEMO GRATIS + "primero la ves." → botón + teléfono.
// t0 = inicio del cierre (≈ palabra "Pide"); tap = momento en que el cursor toca el botón (≈ "WhatsApp" o el final de la frase).
// Opciones para agentes y sistemas (tanda 2): title = 'AGENDA UNA LLAMADA', button = 'Escribe AGENTE por WhatsApp', tagline = 'WEB · AGENTES DE IA · SISTEMAS'.
import { C, rr, fitText, drawLogo, slamIn, blurIn, prog, E, lerp, bump, textShine } from '../cresova.js';
export function cierre(ctx, k, t, { t0, tap, line = 'primero la ves.', title = 'DEMO GRATIS', button = 'Escríbenos por WhatsApp', tagline = '', claro = false }) {
  const INK = claro ? C.coal : C.white, SOFT = claro ? C.red : C.cream;
  if (t < t0 - 0.05) return;
  const kl = E.inOutCubic(prog(t, t0, 0.55));
  if (kl > 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(250, 330, 580 * kl, 160); ctx.clip(); drawLogo(ctx, 540, 410, 560, claro ? 'light' : 'dark'); ctx.restore();
    if (kl < 1) { ctx.fillStyle = C.red; ctx.fillRect(250 + 580 * kl - 3, 320, 6, 180); }
  }
  if (tagline) { const ka = E.outCubic(prog(t, t0 + 0.45, 0.4)); if (ka > 0) { ctx.save(); ctx.globalAlpha = ka * 0.85; ctx.fillStyle = claro ? C.coal : C.cream; ctx.font = k.mono(26, 700); ctx.textAlign = 'center'; ctx.fillText(tagline, 540, 528 + (1 - ka) * 10); ctx.restore(); } }
  slamIn(ctx, t, t0 + 0.35, 540, 660, () => textShine(ctx, t, t0 + 1.2, 0.9, (c) => { c.fillStyle = INK; fitText(c, title, k.display, 540, 700, 900, 170, 'center'); }));
  blurIn(ctx, t, t0 + 0.8, 0.45, () => { ctx.fillStyle = SOFT; fitText(ctx, line, k.serif, 540, 820, 940, 96, 'center'); });
  const kb = E.outBack(prog(t, t0 + 0.55, 0.4));
  if (kb > 0) {
    const s = kb * (t > tap ? 1 / bump(t, tap, 0.2, 1.07) : 1) * (t > tap + 1 ? 1 + 0.018 * Math.sin((t - tap - 1) * 5) : 1);
    ctx.save(); ctx.translate(540, 1030); ctx.scale(s, s); ctx.fillStyle = C.green; ctx.shadowColor = 'rgba(31,175,90,.55)'; ctx.shadowBlur = 40 + 20 * Math.sin(t * 4);
    rr(ctx, -410, -65, 820, 130, 65); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.fillStyle = C.white; ctx.textAlign = 'center'; fitText(ctx, button, (z) => k.sans(z, 900), 0, 17, 740, 48, 'center'); ctx.restore();
  }
  const kc = prog(t, tap - 0.6, 0.6);
  if (kc > 0 && t < tap + 0.8) {
    const x = lerp(900, 700, E.outCubic(kc)), y = lerp(1260, 1050, E.outCubic(kc));
    ctx.save(); ctx.globalAlpha = 1 - prog(t, tap + 0.5, 0.3); ctx.fillStyle = C.white; ctx.strokeStyle = C.coal; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 34, y + 84); ctx.lineTo(x + 44, y + 50); ctx.lineTo(x + 80, y + 44); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    const kr = prog(t, tap, 0.45);
    if (kr > 0 && kr < 1) { ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${1 - kr})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(700, 1050, 20 + 90 * kr, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  }
  const kt = E.outCubic(prog(t, tap + 0.1, 0.4));
  if (kt > 0) { ctx.save(); ctx.globalAlpha = kt * 0.8; ctx.fillStyle = claro ? C.coal : C.cream; ctx.font = k.sans(40, 500); ctx.textAlign = 'center'; ctx.fillText('+504 0000-0000', 540, 1160 + (1 - kt) * 12); ctx.restore(); }
}
