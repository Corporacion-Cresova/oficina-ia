// Capa superior genérica (videos 02+): marco HUD con capítulos de beats.scenes y subtítulos Editorial.
// Palabra clave del grupo: caption.key si existe; si no, la palabra más larga del grupo.
import { COMBOS, hud, caption, prog, E, clamp01 } from '../cresova.js';
import { BEATS } from '../beats.js';
export function draw(ctx, _lt, { scene, t }) {
  const k = COMBOS[scene.combo];
  const sc = BEATS.scenes.find((s) => t >= s.start && t < s.end) || BEATS.scenes.at(-1);
  const claro = !!scene.claro;
  hud(ctx, k, { vt: t, chapter: BEATS.scenes.indexOf(sc) + 1, total: BEATS.scenes.length, name: sc.name, dark: !claro, dur: BEATS.duration });
  const caps = BEATS.captions;
  const gi = caps.findIndex((c, i) => t >= c.start - 0.05 && t < Math.min((caps[i + 1]?.start ?? Infinity) - 0.05, c.end + 0.5));
  if (gi < 0 || t > BEATS.duration - 0.2) return;
  const c = caps[gi], words = c.text.replace(/"([^"]*)"/g, '“$1”').split(' ');
  const key = c.key ?? words.reduce((b, w, i) => (w.replace(/[^\p{L}]/gu, '').length > words[b].replace(/[^\p{L}]/gu, '').length ? i : b), 0);
  const said = BEATS.words.slice(c.from, c.to + 1).filter((w) => w.start <= t).length;
  const kin = E.outCubic(prog(t, c.start - 0.05, 0.14));
  ctx.save(); ctx.globalAlpha = clamp01(kin); ctx.translate(0, (1 - kin) * 14);
  caption(ctx, k, words, { style: 'editorial', said, key: words.length > 1 ? key : -1, dark: !claro });
  ctx.restore();
}
