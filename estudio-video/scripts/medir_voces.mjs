// Mide tono base (F0 mediano, Hz), variación de tono y velocidad de cada muestra de voz.
// ponytail: autocorrelación simple por ventana; suficiente para comparar voces masculinas, no es un pitch tracker de estudio.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
const DIR = "assets/vo/pruebas", SR = 16000, WIN = 640, HOP = 320; // 40 ms / 20 ms
const WORDS = 19; // palabras de la frase de prueba (G7 es otra frase: su velocidad no se compara)
const f0 = (x) => {
  let best = 0, lag = 0;
  for (let L = Math.floor(SR / 300); L <= Math.floor(SR / 60); L++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + L < x.length; i++) { s += x[i] * x[i + L]; e1 += x[i] * x[i]; e2 += x[i + L] * x[i + L]; }
    const r = s / Math.sqrt(e1 * e2 || 1);
    if (r > best) { best = r; lag = L; }
  }
  return best > 0.55 ? SR / lag : 0;
};
const med = (a) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const rows = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith(".mp3"))) {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", `${DIR}/${f}`, "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  const pcm = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const ps = []; let voiced = 0;
  for (let i = 0; i + WIN < pcm.length; i += HOP) {
    const w = Float64Array.from(pcm.subarray(i, i + WIN), (v) => v / 32768);
    const rms = Math.sqrt(w.reduce((a, v) => a + v * v, 0) / WIN);
    if (rms < 0.02) continue;
    voiced++;
    const p = f0(w); if (p) ps.push(p);
  }
  const m = med(ps), semis = ps.map((p) => 12 * Math.log2(p / m)), spread = med(semis.map(Math.abs));
  const talk = (voiced * HOP) / SR;
  rows.push({ voz: f.replace("Prueba voz - ", "").replace(".mp3", ""), f0: Math.round(m), variacion_st: +spread.toFixed(1), palabras_seg: f.includes("G7") ? "-" : +(WORDS / talk).toFixed(2) });
}
rows.sort((a, b) => a.f0 - b.f0);
console.table(rows);
