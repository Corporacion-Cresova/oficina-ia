// Mezcla voz + música + efectos de un video según plan/beats.json → renders/mix.wav (-16 LUFS, TP -1.5).
// Uso: node scripts/mezcla.mjs videos/<video>
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const dir = process.argv[2];
const b = JSON.parse(readFileSync(`${dir}/plan/beats.json`, "utf8"));
const D = b.duration, inputs = ["-i", `${dir}/assets/vo/Voz final.wav`, "-i", `${dir}/${b.music.file}`];
const f = [];
// Voz: base.
f.push(`[0:a]aresample=48000,apad=whole_dur=${D}[vo]`);
// Música: ganancia, hueco de medio compás y fade final.
const [g0, g1] = b.music.gap, [f0, f1] = b.music.fade_out;
f.push(`[1:a]aresample=48000,atrim=0:${D},volume=${b.music.gain_db}dB,volume='if(between(t,${g0},${g1}),0,1)':eval=frame,afade=t=out:st=${f0}:d=${f1 - f0},apad=whole_dur=${D}[mu]`);
const names = [];
b.sfx.forEach((c, i) => {
  inputs.push("-i", `assets/sfx/listos/${c.sfx}.wav`);
  const ms = Math.max(0, Math.round(c.t * 1000));
  f.push(`[${i + 2}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${c.db}dB,adelay=${ms}|${ms}[s${i}]`);
  names.push(`[s${i}]`);
});
f.push(`${names.join("")}amix=inputs=${names.length}:normalize=0:duration=longest[fx]`);
f.push(`[vo][mu][fx]amix=inputs=3:normalize=0:duration=first,atrim=0:${D},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]`);
mkdirSync(`${dir}/renders`, { recursive: true });
execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", f.join(";"), "-map", "[out]", "-ac", "2", `${dir}/renders/mix.wav`], { stdio: "inherit" });
console.log("mezcla lista:", `${dir}/renders/mix.wav`);
