// Procesa efectos de assets/sfx/generated → assets/sfx/listos (regla de TASTE: sin loudnorm en clips cortos).
// Recorta el silencio inicial, fundido de cola de 60 ms y ganancia para que el pico quede en -1 dBFS. 48 kHz WAV.
// Uso: node scripts/sfx_proc.mjs <id-01>[,<id-01>...]
import { execFileSync, spawnSync } from "node:child_process";
const ids = (process.argv[2] || "").split(",").filter(Boolean);
for (const id of ids) {
  const src = `assets/sfx/generated/${id}.mp3`, tmp = `cache/_sfx_${id}.wav`, dst = `assets/sfx/listos/${id}.wav`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-af", "silenceremove=start_periods=1:start_threshold=-50dB", "-ar", "48000", tmp]);
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", tmp]).toString());
  const err = spawnSync("ffmpeg", ["-hide_banner", "-i", tmp, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr || "";
  const max = Number((err.match(/max_volume: (-?[\d.]+)/) || [])[1] || 0);
  const gain = (-1 - max).toFixed(2);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-af", `volume=${gain}dB,afade=t=out:st=${Math.max(0, dur - 0.06).toFixed(3)}:d=0.06`, "-ar", "48000", dst]);
  console.log(id, "dur", dur.toFixed(2), "max", max, "gain", gain, "→", dst);
}
