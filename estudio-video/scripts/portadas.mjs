// Portadas explicativas para la serie "Cresova explica": toma el cuadro 0 del video, tapa la franja del titular con el
// color del fondo y escribe el TEMA del episodio en grande (Clash Display) con la etiqueta "CRESOVA EXPLICA · EP 0X".
// Uso: node scripts/portadas.mjs  (lista abajo) → <carpeta>/portadas/<nombre> - portada.jpg (sobrescribe)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
const D = 'revision-tanda2b-2026-10-25/portadas';
const LIST = [
  ['videos/14-que-es-un-agente/renders/previews/14 Que es un agente - v1.mp4', 'EP 01', ['¿QUÉ ES UN', 'AGENTE DE IA?'], 'oscuro'],
  ['videos/15-whatsapp-pierde-clientes/renders/previews/15 WhatsApp pierde clientes - v1.mp4', 'EP 02', ['¿TU WHATSAPP', 'PIERDE CLIENTES?'], 'oscuro'],
  ['videos/17-excel-o-sistema/renders/previews/17 Excel o sistema - v1.mp4', 'EP 03', ['¿EXCEL O', 'SISTEMA?'], 'claro'],
  ['videos/18-tres-tareas/renders/previews/18 Tres tareas - v1.mp4', 'EP 04', ['3 TAREAS PARA', 'AUTOMATIZAR'], 'claro'],
  ['videos/19-dominio-hosting-correo/renders/previews/19 Dominio hosting correo - v1.mp4', 'EP 05', ['DOMINIO, HOSTING', 'Y CORREO'], 'claro'],
  ['videos/20-antes-de-contratar/renders/previews/20 Antes de contratar - v1.mp4', 'EP 06', ['ANTES DE PAGAR', 'UNA PÁGINA'], 'claro'],
];
if (!existsSync('cache/ClashDisplay-Bold.ttf')) copyFileSync('assets/fonts/Clash Display/ClashDisplay-Bold.ttf', 'cache/ClashDisplay-Bold.ttf');
if (!existsSync('cache/JetBrainsMono.ttf')) copyFileSync('assets/fonts/JetBrains Mono/JetBrainsMono[wght].ttf', 'cache/JetBrainsMono.ttf');
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
for (const [src, ep, lines, tema] of LIST) {
  const name = src.split('/').pop().replace('.mp4', '');
  const bg = tema === 'claro' ? '0xE6E1D8' : '0x0B0A0A', ink = tema === 'claro' ? '0x121212' : '0xFFFFFF';
  const size = Math.max(...lines.map((l) => l.length)) > 12 ? 104 : 128;
  const f = [
    `drawbox=x=0:y=250:w=1080:h=360:color=${bg}@1:t=fill`,
    `drawtext=fontfile=cache/JetBrainsMono.ttf:text='${esc('CRESOVA EXPLICA · ' + ep)}':fontcolor=0xE20018:fontsize=34:x=74:y=300`,
    `drawtext=fontfile=cache/ClashDisplay-Bold.ttf:text='${esc(lines[0])}':fontcolor=${ink}:fontsize=${size}:x=70:y=360`,
    `drawtext=fontfile=cache/ClashDisplay-Bold.ttf:text='${esc(lines[1])}':fontcolor=0xE20018:fontsize=${size}:x=70:y=${360 + size * 1.02}`,
  ].join(',');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', f, '-q:v', '2', `${D}/${name} - portada.jpg`]);
  console.log('ok', name);
}
