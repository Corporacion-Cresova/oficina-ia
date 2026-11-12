// Documentos presentables: cualquier entregable del equipo como un informe con la marca de
// Cresova (HTML para leer en el navegador y PDF para descargar o mandar por WhatsApp).
import path from 'node:path';
import { createRequire } from 'node:module';
import { marked } from 'marked';
import { state, readDeliverable } from './state.mjs';
import { getAgent } from './settings.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fecha = (t) => new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'long', timeStyle: 'short' }).format(t);

export function docHTML(id) {
  const d = state.deliverables.find((x) => x.id === id);
  const md = d && readDeliverable(id);
  if (!md) return null;
  const a = getAgent(d.agentId);
  const cuerpo = marked.parse(md.replace(/^#\s+.+\n+/, ''), { gfm: true, breaks: false });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.title)} · Cresova</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm 16mm 18mm; }
  :root { --rojo: #e30016; --tinta: #16141c; --gris: #5d6270; --linea: #e6e3ea; --suave: #f7f6f9; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, system-ui, sans-serif; color: var(--tinta); font-size: 11pt; line-height: 1.6; background: #fff; }
  .hoja { max-width: 820px; margin: 0 auto; padding: 32px 28px 48px; }
  header.portada { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 18px; border-bottom: 3px solid var(--rojo); margin-bottom: 26px; }
  .marca { display: flex; gap: 10px; align-items: center; font-family: Montserrat, sans-serif; font-weight: 800; letter-spacing: .12em; font-size: 13pt; }
  .marca i { width: 30px; height: 30px; border-radius: 7px; background: var(--rojo); color: #fff; display: grid; place-items: center; font-style: normal; font-size: 15pt; letter-spacing: 0; }
  .meta { text-align: right; color: var(--gris); font-size: 9.5pt; line-height: 1.45; }
  .meta b { color: var(--tinta); }
  h1.titulo { font-family: Montserrat, sans-serif; font-size: 21pt; line-height: 1.2; margin: 0 0 8px; letter-spacing: -.01em; }
  .resumen { background: var(--suave); border-left: 4px solid var(--rojo); padding: 12px 16px; margin: 14px 0 24px; font-size: 10.5pt; }
  .resumen b { display: block; font-family: Montserrat, sans-serif; font-size: 8.5pt; letter-spacing: .12em; text-transform: uppercase; color: var(--rojo); margin-bottom: 4px; }
  .cuerpo h1, .cuerpo h2 { font-family: Montserrat, sans-serif; font-size: 14pt; margin: 26px 0 8px; padding-bottom: 5px; border-bottom: 1px solid var(--linea); }
  .cuerpo h3 { font-family: Montserrat, sans-serif; font-size: 11.5pt; margin: 18px 0 6px; }
  .cuerpo p { margin: 8px 0; }
  .cuerpo ul, .cuerpo ol { padding-left: 22px; margin: 8px 0; }
  .cuerpo li { margin: 3px 0; }
  .cuerpo strong { color: #000; }
  .cuerpo table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; page-break-inside: avoid; }
  .cuerpo th { background: var(--tinta); color: #fff; text-align: left; padding: 7px 9px; font-weight: 600; }
  .cuerpo td { padding: 6px 9px; border-bottom: 1px solid var(--linea); vertical-align: top; }
  .cuerpo tr:nth-child(even) td { background: var(--suave); }
  .cuerpo blockquote { margin: 10px 0; padding: 8px 14px; border-left: 3px solid var(--linea); color: var(--gris); }
  .cuerpo code { background: var(--suave); padding: 1px 5px; border-radius: 4px; font-size: 9.5pt; }
  .cuerpo a { color: var(--rojo); }
  .pregunta { margin-top: 26px; border: 2px solid var(--rojo); border-radius: 10px; padding: 12px 16px; }
  .pregunta b { color: var(--rojo); font-family: Montserrat, sans-serif; }
  footer { margin-top: 36px; padding-top: 10px; border-top: 1px solid var(--linea); color: var(--gris); font-size: 8.5pt; display: flex; justify-content: space-between; }
  @media print { .hoja { padding: 0; } }
</style></head><body><div class="hoja">
<header class="portada">
  <div class="marca"><i>C</i>CRESOVA</div>
  <div class="meta"><b>${esc(a?.nombre || d.agentId)}</b> · ${esc(a?.rol || '')}<br>Para: el dueño<br>${fecha(d.ts)}</div>
</header>
<h1 class="titulo">${esc(d.title.replace(/^[^\p{L}\p{N}]+/u, ''))}</h1>
${d.summary ? `<div class="resumen"><b>Resumen ejecutivo</b>${esc(d.summary)}</div>` : ''}
<div class="cuerpo">${cuerpo}</div>
${d.question ? `<div class="pregunta"><b>Necesito tu decisión:</b> ${esc(d.question)}${d.options?.length ? `<br>Opciones: ${d.options.map(esc).join(' · ')}` : ''}</div>` : ''}
<footer><span>Oficina Cresova · documento interno</span><span>${esc(d.id.slice(0, 8))}</span></footer>
</div></body></html>`;
}

let chromium = null;
export async function docPDF(id) {
  const html = docHTML(id);
  if (!html) return null;
  chromium ||= createRequire(path.join(process.env.ESTUDIO_TOOLKIT || '/opt/estudio', 'package.json'))('playwright').chromium;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
  } finally { await browser.close(); }
}

export const nombreArchivo = (id) => {
  const d = state.deliverables.find((x) => x.id === id);
  return `${(d?.title || 'informe').replace(/^[^\p{L}\p{N}]+/u, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'informe'}.pdf`;
};
