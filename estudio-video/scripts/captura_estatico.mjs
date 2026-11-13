// Uso (desde la raíz de cresova-motion): node scripts/captura_estatico.mjs <html relativo a la raíz> <png de salida> [ancho] [alto]
// Sirve la raíz por HTTP local, espera fuentes y window.__listo (si la página lo define) y guarda la captura.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright';
const [,, html, out, w = '1080', h = '1080'] = process.argv;
const root = process.cwd();
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  const fallos = [];
  p.on('pageerror', (e) => fallos.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') fallos.push(m.text()); });
  p.on('response', (x) => { if (x.status() >= 400) fallos.push(x.status() + ' ' + x.url()); });
  try {
    await p.goto(`http://127.0.0.1:${srv.address().port}/${html}`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForFunction(() => window.__listo !== false, null, { timeout: 180000 });
    await p.screenshot({ path: out });
    console.log(fallos.length ? 'FALLOS: ' + fallos.join(' | ') : 'ok ' + out);
  } catch (e) { console.log('ERROR ' + e.message + ' | ' + fallos.join(' | ')); }
  await b.close(); srv.close();
});
