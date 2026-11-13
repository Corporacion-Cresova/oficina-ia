// VIDEO 09 · "5 cosas que busca tu cliente" (lista) · una sola toma en el estudio 3D.
//  la lista: titular + cinco pedestales vacíos arriba (frame 0 completo).
//  1–5: cada objeto 3D cae bajo el foco (pin, reloj, burbuja de WhatsApp, cámara, estrella), gira, y al llegar
//       el siguiente sube a su lugar en la fila de arriba.
//  las cinco: sube el teléfono con la página de la clínica (captura IA, EJEMPLO) y cada objeto recibe su ✓. Cierre.
import * as THREE from 'three';
import { C, COMBOS, headline, slamIn, blurIn, prog, E, lerp, rr, rings, makeGrain, finish, loadImg, webShot } from '../cresova.js';
import { BEATS } from '../beats.js';
import { Estudio } from '../estudio3d.js';
import { cierre } from './cierre.js';
const Wt = (i) => BEATS.words[i].start;
const L3 = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
let studio, grain, web, clock, clockFace, bubble3, dots3, cam3, flash3, star;
const IDX = [7, 10, 15, 21, 27];                         // "Uno", "Dos", "Tres", "Cuatro", "Cinco"
const LABEL = ['UBICACIÓN', 'HORARIO', 'WHATSAPP', 'PORTAFOLIO', 'RESEÑAS'];
const HERO = [0, 2.3, 2.4], SLOT = (i) => [(i - 2) * 0.7, 4.22, 0];
const T_ALL = 15.75;                                      // "Tu página puede tener las cinco"

const phys = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, ...o });
const shapeRR = (w, h, r, tail) => { const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); if (tail) { s.lineTo(x + 0.28, y); s.lineTo(x + 0.05, y - 0.32); s.lineTo(x + 0.62, y); }
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; };

export async function init({ W, H, scale }) {
  studio = new Estudio(W, H, scale); grain = makeGrain(); web = await loadImg('/assets/web/clinica-dental-5.png');
  const S = studio.scene;
  // Reloj: disco con cara 2D (manecillas en la textura) y aro rojo.
  clock = new THREE.Group();
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; clockFace = { cv, g: cv.getContext('2d'), tex: new THREE.CanvasTexture(cv) };
  clockFace.tex.colorSpace = THREE.SRGBColorSpace;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.2, 64), [phys('#1b1a1a', { metalness: 0.6 }), new THREE.MeshBasicMaterial({ map: clockFace.tex, color: '#d8d3c9', toneMapped: false }), phys('#1b1a1a')]);
  disc.rotation.x = Math.PI / 2; disc.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.07, 20, 80), phys('#e20018', { emissive: '#3a0004', emissiveIntensity: 0.4 })); ring.position.z = 0.1;
  clock.add(disc, ring);
  // Burbuja de chat verde con tres puntos que "escriben".
  bubble3 = new THREE.Group();
  const bb = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeRR(1.55, 1.0, 0.42, true), { depth: 0.26, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 5, curveSegments: 24 }), phys('#1faf5a', { emissive: '#06331a', emissiveIntensity: 0.5 }));
  bb.position.z = -0.13; bb.castShadow = true; bubble3.add(bb);
  dots3 = [-0.36, 0, 0.36].map((x) => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), phys('#ffffff')); d.position.set(x, 0, 0.22); bubble3.add(d); return d; });
  // Cámara de fotos: cuerpo, joroba, lente con aro rojo, flash.
  cam3 = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.62), phys('#5a5654', { metalness: 0.3, roughness: 0.35 })); body.castShadow = true;
  const hump = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, 0.5), phys('#3b3938', { metalness: 0.45 })); hump.position.set(-0.25, 0.62, 0);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.42, 48), phys('#0d0d0d', { metalness: 0.8 })); lens.rotation.x = Math.PI / 2; lens.position.z = 0.5;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.27, 48), phys('#20304a', { metalness: 0.9, roughness: 0.05 })); glass.position.z = 0.715;
  const lring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.04, 16, 60), phys('#e20018')); lring.position.z = 0.71;
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 24), phys('#e20018')); btn.position.set(0.5, 0.54, 0);
  flash3 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.2 })); flash3.position.set(0.5, 0.3, 0.33);
  cam3.add(body, hump, lens, glass, lring, btn, flash3);
  // Estrella dorada con grosor.
  const st = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.4 : 0.92; const p = [Math.cos(a) * r, Math.sin(a) * r]; i ? st.lineTo(...p) : st.moveTo(...p); }
  star = new THREE.Mesh(new THREE.ExtrudeGeometry(st, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 5 }), phys('#f2b632', { metalness: 0.35, emissive: '#3a2600', emissiveIntensity: 0.4 }));
  star.geometry.translate(0, 0, -0.12); star.castShadow = true;
  [clock, bubble3, cam3, star].forEach((o) => { o.scale.setScalar(0.001); S.add(o); });
}

function drawClock(t) {
  const { g, tex } = clockFace; g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#121212'; for (let i = 0; i < 12; i++) { g.save(); g.translate(128, 128); g.rotate((i * Math.PI) / 6); g.fillRect(-3, -112, 6, i % 3 ? 14 : 24); g.restore(); }
  const spin = E.inOutCubic(prog(t, Wt(13) - 0.4, 1.0)) * 4;   // "a qué hora": las manecillas giran hasta las 8:00
  const hand = (a, len, w, col) => { g.save(); g.translate(128, 128); g.rotate(a); g.fillStyle = col; rr(g, -w / 2, -len, w, len + 14, w / 2); g.fill(); g.restore(); };
  hand(((4 + spin) / 12) * Math.PI * 2, 62, 12, '#121212');
  hand(spin * Math.PI * 2, 92, 8, '#121212'); hand(t * 2.4, 100, 3, '#e20018');
  g.fillStyle = '#e20018'; g.beginPath(); g.arc(128, 128, 9, 0, Math.PI * 2); g.fill(); tex.needsUpdate = true;
}

// Pose de cada objeto: cae al centro en su número, sube a la fila con el siguiente y sale en el cierre.
function pose(i, t) {
  const a = Wt(IDX[i]), next = i < 4 ? Wt(IDX[i + 1]) : T_ALL;
  const drop = E.outBack(prog(t, a - 0.3, 0.5)), up = E.inOutCubic(prog(t, next - 0.35, 0.55)), out = E.inCubic(prog(t, 17.6, 0.45));
  if (t < a - 0.3) return null;
  const hero = [HERO[0], lerp(7.5, HERO[1], drop), HERO[2]];
  const p = L3(hero, SLOT(i), up); p[1] += 0.06 * Math.sin(t * 2 + i) - 9 * out;
  const s = lerp(1, 0.42, up) * Math.min(1, prog(t, a - 0.3, 0.12) * 1.2);
  const rot = lerp(0.6 * Math.sin((t - a) * 1.1), 0.35 * Math.sin(t * 1.4 + i), up);
  return { p, s, rot };
}

export function draw(ctx, lt, opts) {
  const { scene, t } = opts, k = COMBOS[scene.combo];
  drawClock(t);
  const phoneIn = E.outCubic(prog(t, T_ALL - 0.1, 0.6)), out = E.inCubic(prog(t, 17.6, 0.45));
  const cam = L3([0.25 * Math.sin(t * 0.3), 2.65, 11.6 - 0.05 * t], [0, 2.7, 11.2], phoneIn), look = [0, 2.35, 0];
  const objs = [null, clock, bubble3, cam3, star], P = [0, 1, 2, 3, 4].map((i) => pose(i, t));
  objs.forEach((o, i) => { if (!o) return; const q = P[i]; o.visible = !!q && q.s > 0.01; if (!o.visible) return; o.position.set(...q.p); o.rotation.set(0, q.rot, 0); o.scale.setScalar(q.s * (i === 3 ? 1.05 : 1)); });
  // Typing de la burbuja y flash de la cámara.
  dots3.forEach((d, j) => { d.position.y = 0.1 * Math.max(0, Math.sin(t * 9 - j * 0.9)); });
  const fl = Math.max(0, 1 - Math.abs(t - Wt(22)) / 0.12); flash3.material.emissiveIntensity = 0.2 + 6 * fl;
  const pq = P[0];
  const img = studio.render({
    cam, look, keyI: 430, keyAt: [0, 0, 1.5],
    pin: pq ? { pos: [pq.p[0], pq.p[1] - 0.62 * pq.s, pq.p[2]], rot: pq.rot, scale: 0.55 * pq.s } : undefined,
    phone: { pos: [0, lerp(-5, 1.25, phoneIn) - 8 * out, 2.4], rotX: -0.05, rotY: 0.12 * Math.sin(t * 0.9), scale: 0.84 * (phoneIn > 0.01 ? 1 : 0) },
    phoneDraw: (g) => webShot(g, k, web, 110 * E.inOutCubic(prog(t, T_ALL + 0.4, 1.4))),
  });
  ctx.drawImage(img, 0, 0, 1080, 1920);
  // Destello 2D de la foto.
  if (fl > 0) { ctx.save(); ctx.globalAlpha = 0.35 * fl; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1080, 1920); ctx.restore(); }

  const fade = (a, d = 0.3) => 1 - E.outCubic(prog(t, a, d));
  // Gancho: titular + "5" fantasma + pedestales (marcas) vacíos de la fila.
  if (t < 3.4) { ctx.save(); ctx.globalAlpha = fade(3.1);
    headline(ctx, k.display, [['LA LISTA', C.white], ['DE TU CLIENTE.', C.red]], { y: 770, size: 100 });
    ctx.fillStyle = 'rgba(226,0,24,.9)'; ctx.font = k.display(520); ctx.textAlign = 'right'; ctx.fillText('5', 1010, 1260);
    ctx.restore(); }
  // Ranuras de la fila (círculos punteados que se llenan).
  if (t < 17.7) { ctx.save(); ctx.globalAlpha = fade(17.5);
    for (let i = 0; i < 5; i++) { const [x, y] = studio.project(...SLOT(i)); const filled = t > (i < 4 ? Wt(IDX[i + 1]) : T_ALL) + 0.15;
      ctx.setLineDash(filled ? [] : [6, 8]); ctx.strokeStyle = filled ? 'rgba(236,231,220,.25)' : 'rgba(236,231,220,.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 54, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = 'rgba(236,231,220,.6)'; ctx.font = k.mono(20, 700); ctx.textAlign = 'center'; ctx.fillText(String(i + 1).padStart(2, '0'), x, y + 84);
      // ✓ en "las cinco".
      const kc = E.outBack(prog(t, Wt(34) + i * 0.22, 0.3));
      if (kc > 0) { ctx.save(); ctx.translate(x + 46, y - 46); ctx.scale(kc, kc); ctx.fillStyle = C.green; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-2, 8); ctx.lineTo(10, -8); ctx.stroke(); ctx.restore(); }
    }
    ctx.restore(); }
  // Número grande + etiqueta del objeto en el centro.
  for (let i = 0; i < 5; i++) {
    const a = Wt(IDX[i]), b = (i < 4 ? Wt(IDX[i + 1]) : T_ALL) - 0.35;
    if (t < a - 0.1 || t > b + 0.3) continue;
    ctx.save(); ctx.globalAlpha = fade(b, 0.25);
    slamIn(ctx, t, a - 0.05, 300, 700, () => { ctx.fillStyle = C.white; ctx.font = k.display(150); ctx.textAlign = 'left'; ctx.fillText(String(i + 1).padStart(2, '0'), 74, 730);
      ctx.fillStyle = C.red; ctx.font = k.sans(40, 900); ctx.fillText(LABEL[i], 80, 790); });
    ctx.restore();
  }
  cierre(ctx, k, t, { t0: 17.85, tap: Wt(46) + 0.2, line: 'revísala tú mismo.' });
  finish(ctx, t, grain);
}
