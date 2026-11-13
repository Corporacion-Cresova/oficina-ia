// Cierre reutilizable (jerarquía de 3 niveles, alineación central): logo → DEMO GRATIS + "primero la ves." → botón + teléfono.
// t0 = inicio del cierre (≈ palabra "Pide"); tap = momento en que el cursor toca el botón (≈ "WhatsApp" o el final de la frase).
import { C, rr, fitText, drawLogo, slamIn, blurIn, prog, E, lerp, bump, textShine } from '../cresova.js';
export function cierre(ctx, k, t, { t0, tap, line = 'primero la ves.' }) {
  if (t < t0 - 0.05) return;
  const kl = E.inOutCubic(prog(t, t0, 0.55));
  if (kl > 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(250, 330, 580 * kl, 160); ctx.clip(); drawLogo(ctx, 540, 410, 560, 'dark'); ctx.restore();
    if (kl < 1) { ctx.fillStyle = C.red; ctx.fillRect(250 + 580 * kl - 3, 320, 6, 180); }
  }
  slamIn(ctx, t, t0 + 0.35, 540, 660, () => textShine(ctx, t, t0 + 1.2, 0.9, (c) => { c.fillStyle = C.white; fitText(c, 'DEMO GRATIS', k.display, 540, 700, 900, 170, 'center'); }));
  blurIn(ctx, t, t0 + 0.8, 0.45, () => { ctx.fillStyle = C.cream; ctx.font = k.serif(96); ctx.textAlign = 'center'; ctx.fillText(line, 540, 820); });
  const kb = E.outBack(prog(t, t0 + 0.55, 0.4));
  if (kb > 0) {
    const s = kb * (t > tap ? 1 / bump(t, tap, 0.2, 1.07) : 1) * (t > tap + 1 ? 1 + 0.018 * Math.sin((t - tap - 1) * 5) : 1);
    ctx.save(); ctx.translate(540, 1030); ctx.scale(s, s); ctx.fillStyle = C.green; ctx.shadowColor = 'rgba(31,175,90,.55)'; ctx.shadowBlur = 40 + 20 * Math.sin(t * 4);
    rr(ctx, -410, -65, 820, 130, 65); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.fillStyle = C.white; ctx.font = k.sans(48, 900); ctx.textAlign = 'center'; ctx.fillText('Escríbenos por WhatsApp', 0, 17); ctx.restore();
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
  if (kt > 0) { ctx.save(); ctx.globalAlpha = kt * 0.8; ctx.fillStyle = C.cream; ctx.font = k.sans(40, 500); ctx.textAlign = 'center'; ctx.fillText('+504 0000-0000', 540, 1160 + (1 - kt) * 12); ctx.restore(); }
}
