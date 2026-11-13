// plan/beats.json desde la toma de voz de ElevenLabs (tiempos por carácter → palabras → grupos de subtítulo).
// Uso: node scripts/beats_from_voice.mjs videos/<video> [toma=1]
// Grupos: 2–4 palabras, cortando en puntuación. Las escenas se agregan a mano después (campo "scenes").
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [dir, take = "1"] = process.argv.slice(2);
const a = JSON.parse(readFileSync(`${dir}/assets/vo/Voz toma ${take}.alignment.json`, "utf8"));
copyFileSync(`${dir}/assets/vo/Voz toma ${take}.mp3`, `${dir}/assets/vo/Voz final.mp3`);
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", `${dir}/assets/vo/Voz final.mp3`, "-ar", "48000", `${dir}/assets/vo/Voz final.wav`]);
const c = a.characters, s = a.character_start_times_seconds, e = a.character_end_times_seconds;
const words = []; let cur = null, tag = false;
c.forEach((ch, i) => {
  if (ch === "[") { tag = true; return; } if (tag) { if (ch === "]") tag = false; return; }
  if (/\s/.test(ch)) { if (cur) { words.push(cur); cur = null; } return; }
  if (!cur) cur = { w: "", start: s[i], end: e[i] }; cur.w += ch; cur.end = e[i];
});
if (cur) words.push(cur);
const W = words.filter((w) => !/^[—–-]+$/.test(w.w)).map((w, i) => ({ i, w: w.w, start: +w.start.toFixed(3), end: +w.end.toFixed(3) }));
const caps = []; let g = [];
W.forEach((w, i) => {
  g.push(i);
  const punct = /[.,;:?!…»"”]$/.test(w.w), next = W[i + 1];
  if (g.length >= 4 || (punct && g.length >= 2) || (punct && next && /^[A-ZÁÉÍÓÚÑ¿«"“]/.test(next.w)) || !next) {
    caps.push({ from: g[0], to: g.at(-1), start: W[g[0]].start, end: W[g.at(-1)].end, text: g.map((j) => W[j].w).join(" ") }); g = [];
  }
});
const duration = +(W.at(-1).end + 2.5).toFixed(2);
const f = `${dir}/plan/beats.json`;
const old = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
writeFileSync(f, JSON.stringify({ ...old, version: 1, voice: "assets/vo/Voz final.wav", voice_take: `Voz toma ${take} (eleven_v4, El Faraón)`, duration, fps: 30, words: W, captions: caps }, null, 1));
console.log(dir, "·", W.length, "palabras ·", caps.length, "subtítulos · voz", W.at(-1).end.toFixed(2), "s · video", duration, "s");
