// Detector de bloques negros (NaN del bloom) en un render: cuenta, por cuadro, los píxeles casi negros
// en la zona superior (filas 12–62 %) y marca los cuadros que saltan muy por encima de sus vecinos.
// Uso: node scripts/scan_negro.mjs "<video.mp4>" [...]
import { spawn } from 'node:child_process';
const W = 108, H = 192, R0 = Math.floor(H * 0.12), R1 = Math.floor(H * 0.62);
for (const file of process.argv.slice(2)) {
  const counts = await new Promise((res, rej) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-']);
    const out = []; let buf = Buffer.alloc(0);
    ff.stdout.on('data', (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= W * H) { const f = buf.subarray(0, W * H); let n = 0;
      for (let y = R0; y < R1; y++) for (let x = 0; x < W; x++) if (f[y * W + x] <= 1) n++; out.push(n); buf = buf.subarray(W * H); } });
    ff.on('close', (c) => (c ? rej(new Error('ffmpeg ' + c)) : res(out)));
  });
  const bad = [];
  counts.forEach((n, i) => { const nb = [counts[i - 4], counts[i + 4]].filter((v) => v !== undefined); const ref = Math.max(...nb);
    if (n > 400 && n > ref + 300) bad.push(`${i} (${(i / 30).toFixed(2)} s, ${n} px)`); });
  console.log(`${file.split('/').pop()}: ${counts.length} cuadros · ${bad.length ? 'BLOQUES: ' + bad.join(', ') : 'limpio'}`);
}
