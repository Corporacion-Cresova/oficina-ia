// Biblioteca de objetos 3D de Cresova · lote 2 (2026-10-25): hojas de cálculo, estante con cajas, letrero de calle, terreno,
// tabla con lista, lupa, cuaderno, maceta con planta, bombillo, letras "IA", burbuja de comentario.
// Mismo contrato que objetos.js: crear(escena) → { g, anim(t, k, extra), ...partes }. Base en y = 0.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { phys, metal } from './objetos.js';

const RED = '#e20018', CREAM = '#efe9de', WOOD = '#6b4a32', DARK = '#1b1a1a';
const shadow = (g) => g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
const lathe = (pts, seg = 64) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData = { c, g }; return t; };
const sheetMat = (tex) => [phys('#f2efe9'), phys('#f2efe9'), phys('#f2efe9'), phys('#f2efe9'), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), phys('#e9e4da')];
const E3 = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const clamp = (x) => Math.max(0, Math.min(1, x));

// 1 · Pila de hojas de cálculo (archivos sueltos). parts.sheets = cada hoja (para coreografía propia).
export function hojasCalculo(scene, n = 6) {
  const g = new THREE.Group();
  const names = ['inventario_final.xlsx', 'inventario_final_v2.xlsx', 'pedidos_mayo.xlsx', 'clientes_NUEVO.xlsx', 'precios (2).xlsx', 'inventario_FINAL_ok.xlsx'];
  const sheets = [...Array(n)].map((_, i) => {
    const tex = canvasTex(512, 672, (c, w, h) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.fillStyle = '#1f7a4a'; c.fillRect(0, 0, w, 64);
      c.fillStyle = '#fff'; c.font = '700 26px Satoshi'; c.fillText(names[i % names.length], 20, 42);
      c.strokeStyle = '#d4d9d4'; c.lineWidth = 2; for (let x = 0; x <= w; x += 85) { c.beginPath(); c.moveTo(x, 64); c.lineTo(x, h); c.stroke(); } for (let y = 64; y <= h; y += 34) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      c.fillStyle = '#4a4a4a'; c.font = '500 18px Satoshi'; for (let y = 1; y < 17; y++) for (let x = 0; x < 6; x++) if ((x * 7 + y * 3 + i) % 4) c.fillText(['Caja', '12', 'L 450', '3', 'Pend.', '✓'][x] + (x ? '' : ' ' + y), x * 85 + 8, 64 + y * 34 + 23); });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.97, 0.012), sheetMat(tex)); m.castShadow = true; m.receiveShadow = true;
    m.position.set(0.04 * Math.sin(i * 2.1), 0.02 + i * 0.016, 0); m.rotation.set(-Math.PI / 2, 0, 0.12 * Math.sin(i * 1.7)); g.add(m); return m; });
  scene.add(g);
  return { g, sheets, anim() {} };
}

// 2 · Estante con cajas: del desorden al orden (k = 0 desordenado → 1 ordenado por color).
export function estante(scene) {
  const g = new THREE.Group(), wood = phys(WOOD, { roughness: 0.7, clearcoat: 0.2 });
  const plank = (y) => { const m = new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.08, 0.7, 3, 0.02), wood); m.position.y = y; return m; };
  const side = (x) => { const m = new THREE.Mesh(new RoundedBoxGeometry(0.08, 2.5, 0.7, 3, 0.02), wood); m.position.set(x, 1.25, 0); return m; };
  g.add(plank(0.06), plank(0.9), plank(1.74), plank(2.5), side(-1.3), side(1.3));
  const cols = ['#c8a47a', '#c8a47a', RED, '#c8a47a', RED, '#2a2827', '#c8a47a', '#2a2827', RED];
  const boxes = cols.map((c, i) => { const b = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.5, 0.5, 3, 0.03), phys(c, { roughness: 0.85, clearcoat: 0 }));
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.06, 0.52), phys('#e6dccb', { roughness: 0.5 })); tape.position.y = 0.2;
    b.add(body, tape); g.add(b); b.userData.i = i; return b; });
  // Orden final: por color, de izquierda a derecha y de abajo hacia arriba.
  const order = [...boxes].sort((a, b) => cols[a.userData.i].localeCompare(cols[b.userData.i]));
  const target = (j) => [-0.82 + (j % 3) * 0.82, 0.36 + Math.floor(j / 3) * 0.84, 0];
  const messy = (i) => [-1.15 + ((i * 37) % 24) / 10, 0.28 + ((i * 13) % 5) * 0.14, 0.25 + ((i * 7) % 5) / 12];
  shadow(g); scene.add(g);
  return { g, boxes, anim(t, k) { order.forEach((b, j) => { const i = b.userData.i, kk = E3(clamp(k * 1.6 - j * 0.07)); const a = messy(i), c = target(j);
      b.position.set(a[0] + (c[0] - a[0]) * kk, a[1] + (c[1] - a[1]) * kk + 0.5 * Math.sin(Math.PI * kk), a[2] + (c[2] - a[2]) * kk);
      b.rotation.set(0, (1 - kk) * (i % 2 ? 0.6 : -0.5), (1 - kk) * ((i % 3) - 1) * 0.3); }); } };
}

// 3 · Letrero de calle con el dominio (tunegocio.com).
export function letreroCalle(scene, txt = 'tunegocio.com') {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.0, 20), metal('#9a9a9a', 0.35)); pole.position.y = 1.5;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10), metal('#9a9a9a', 0.35)); cap.position.y = 3.02;
  const tex = canvasTex(1024, 220, (c, w, h) => { c.fillStyle = '#121212'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 8; c.strokeRect(14, 14, w - 28, h - 28);
    c.fillStyle = '#fff'; c.font = '700 96px ClashDisplay'; c.textBaseline = 'middle'; c.fillText(txt, 60, h / 2 + 6); c.fillStyle = RED; c.beginPath(); c.moveTo(w - 140, 60); c.lineTo(w - 50, h / 2); c.lineTo(w - 140, h - 60); c.closePath(); c.fill(); });
  const sign = new THREE.Mesh(new RoundedBoxGeometry(2.2, 0.48, 0.06, 3, 0.03), [phys(DARK), phys(DARK), phys(DARK), phys(DARK), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), phys(DARK)]);
  const arm = new THREE.Group(); arm.position.y = 2.65; sign.position.x = 1.05; arm.add(sign); g.add(pole, cap, arm); shadow(g); scene.add(g);
  return { g, anim(t, k) { arm.rotation.y = (1 - E3(k)) * -1.4 + 0.04 * Math.sin(t * 1.5); } };
}

// 4 · Terreno: bloque de tierra con pasto (el hosting donde está construida tu página).
export function terreno(scene) {
  const g = new THREE.Group();
  const side = canvasTex(256, 128, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5a3a22'); gr.addColorStop(1, '#3a2414'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(${150 + (i % 40)},${110 + (i % 30)},${70 + (i % 20)},.35)`; c.fillRect((i * 53) % w, (i * 29) % h, 3, 2); } c.fillStyle = '#3f8a3a'; c.fillRect(0, 0, w, 12); });
  const top = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#3f8a3a'; c.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { c.fillStyle = i % 3 ? '#4f9c46' : '#2f6e2b'; c.fillRect((i * 97) % w, (i * 61) % h, 2, 5); } });
  const block = new THREE.Mesh(new RoundedBoxGeometry(3.0, 0.7, 2.0, 3, 0.05), [new THREE.MeshStandardMaterial({ map: side }), new THREE.MeshStandardMaterial({ map: side }), new THREE.MeshStandardMaterial({ map: top, roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: '#3a2414' }), new THREE.MeshStandardMaterial({ map: side }), new THREE.MeshStandardMaterial({ map: side })]);
  block.position.y = 0.35; g.add(block); shadow(g); scene.add(g);
  return { g, top: 0.7, anim() {} };
}

// 5 · Tabla con lista (clipboard): extra.checks = cuántos ítems marcados (0..4); extra.items = textos.
export function tablaLista(scene, items = ['¿La veo antes de pagar?', '¿El dominio es mío?', '¿Qué incluye?', '¿Quién me ayuda?']) {
  const g = new THREE.Group();
  const board = new THREE.Mesh(new RoundedBoxGeometry(2.0, 2.7, 0.06, 4, 0.05), phys('#8a6440', { roughness: 0.6 })); board.position.y = 1.35;
  const tex = canvasTex(720, 900, () => {});
  const draw = (checks) => { const { g: c } = tex.userData, w = 720, h = 900; c.fillStyle = '#fbf8f2'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#121212'; c.font = '700 54px ClashDisplay'; c.fillText('ANTES DE PAGAR', 50, 110); c.fillStyle = RED; c.fillRect(50, 132, 120, 8);
    items.forEach((it, i) => { const y = 250 + i * 160; c.strokeStyle = '#121212'; c.lineWidth = 6; c.strokeRect(50, y - 50, 70, 70);
      if (i < checks) { c.strokeStyle = RED; c.lineWidth = 12; c.lineCap = 'round'; c.beginPath(); c.moveTo(62, y - 14); c.lineTo(84, y + 10); c.lineTo(124, y - 52); c.stroke(); }
      c.fillStyle = '#2a2827'; c.font = '500 40px Satoshi'; c.fillText(it, 150, y); });
    tex.needsUpdate = true; };
  draw(0);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.25), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })); paper.position.set(0, 1.25, 0.035);
  const clip = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.28, 0.12, 3, 0.04), metal('#bdbdbd', 0.2)); clip.position.set(0, 2.62, 0.07);
  g.add(board, paper, clip); shadow(g); scene.add(g); let last = -1;
  return { g, anim(t, k, extra = {}) { const n = extra.checks ?? 0; if (n !== last) { draw(n); last = n; } } };
}

// 6 · Lupa: vidrio con brillo y mango oscuro.
export function lupa(scene) {
  const g = new THREE.Group(), l = new THREE.Group(); g.add(l);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 20, 64), metal('#2a2827', 0.3));
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.6, 48), new THREE.MeshPhysicalMaterial({ color: '#dff0ff', transmission: 0.95, transparent: true, opacity: 0.28, roughness: 0.02, clearcoat: 1, side: THREE.DoubleSide }));
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.0, 20), phys(RED, { roughness: 0.3 })); handle.position.set(0.62, -0.95, 0); handle.rotation.z = 0.6;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 16), metal('#bdbdbd', 0.2)); neck.position.set(0.48, -0.66, 0); neck.rotation.z = 0.6;
  l.add(ring, glass, handle, neck); l.position.y = 1.6; shadow(g); glass.castShadow = false; scene.add(g);
  return { g, anim(t) { l.rotation.z = 0.08 * Math.sin(t * 1.4); l.position.y = 1.6 + 0.05 * Math.sin(t * 2); } };
}

// 7 · Cuaderno abierto con anillos y anotaciones a mano; parts.loose = hojas sueltas que pueden volar.
export function cuaderno(scene) {
  const g = new THREE.Group();
  const pageTex = (lines) => canvasTex(512, 680, (c, w, h) => { c.fillStyle = '#fbf6ea'; c.fillRect(0, 0, w, h); c.strokeStyle = '#b9cde0'; c.lineWidth = 2; for (let y = 90; y < h; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.strokeStyle = '#e8a0a0'; c.beginPath(); c.moveTo(60, 0); c.lineTo(60, h); c.stroke(); c.fillStyle = '#23324a'; c.font = 'italic 500 30px Gambetta';
    lines.forEach((ln, i) => c.fillText(ln, 74, 120 + i * 80)); c.strokeStyle = '#23324a'; c.lineWidth = 3; c.beginPath(); c.moveTo(74, 132 + 80); c.lineTo(300, 128 + 80); c.stroke(); });
  const L = ['Sra. Ana · 3 cajas', 'Don Luis — ¿pagó?', 'Pedido #?? martes', 'Café 12 bolsas', 'llamar a Rosa!!', 'ver inventario'];
  const left = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 2.0), sheetMat(pageTex(L.slice(0, 3)))); left.position.set(-0.78, 0.06, 0); left.rotation.z = 0.04;
  const right = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 2.0), sheetMat(pageTex(L.slice(3)))); right.position.set(0.78, 0.06, 0); right.rotation.z = -0.04;
  [left, right].forEach((m) => { m.material[2] = m.material[4]; });
  const cover = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.06, 2.1, 3, 0.02), phys('#23324a', { roughness: 0.6 })); cover.position.y = 0.02;
  const rings = [...Array(7)].map((_, i) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.015, 8, 20), metal('#bdbdbd', 0.25)); r.position.set(0, 0.1, -0.8 + i * 0.27); r.rotation.y = Math.PI / 2; return r; });
  const loose = [0, 1, 2].map((i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.01, 1.6), sheetMat(pageTex([['Pedido · ' + ['Ana', 'Luis', 'Rosa'][i]], ['2 cajas'], ['entregar ¿jueves?']].flat()))); m.material[2] = m.material[4]; m.position.set(0.7 - i * 0.5, 0.1 + i * 0.01, 0.2 + i * 0.1); m.rotation.y = 0.3 * (i - 1); g.add(m); return m; });
  g.add(cover, left, right, ...rings); shadow(g); scene.add(g);
  return { g, loose, anim() {} };
}

// 8 · Maceta con planta que crece (k = 0 semilla → 1 planta con hojas).
export function maceta(scene) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(lathe([[0, 0], [0.42, 0], [0.5, 0.06], [0.6, 0.78], [0.66, 0.8], [0.66, 0.9], [0.58, 0.9], [0.5, 0.2], [0, 0.2]]), phys('#c4643c', { roughness: 0.85, clearcoat: 0 }));
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.57, 40), new THREE.MeshStandardMaterial({ color: '#3a2414', roughness: 1 })); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.82;
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.82, 0), new THREE.Vector3(0.05, 1.3, 0), new THREE.Vector3(-0.06, 1.8, 0.02), new THREE.Vector3(0.03, 2.3, 0)]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.035, 10), phys('#3f8a3a', { roughness: 0.5 }));
  const leafShape = new THREE.Shape(); leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(0.22, 0.12, 0.5, 0); leafShape.quadraticCurveTo(0.22, -0.12, 0, 0);
  const leafGeo = new THREE.ExtrudeGeometry(leafShape, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 });
  const leaves = [[1.25, 0.3], [1.55, 2.8], [1.85, 0.6], [2.1, 3.6], [2.3, 1.5]].map(([y, a], i) => { const m = new THREE.Mesh(leafGeo, phys(i % 2 ? '#4f9c46' : '#3f8a3a', { roughness: 0.45, side: THREE.DoubleSide }));
    const h = new THREE.Group(); h.userData.y0 = y; h.position.set(curve.getPoint((y - 0.82) / 1.48).x, y, 0); h.rotation.set(0.3, a, 0.35); h.add(m); g.add(h); return h; });
  g.add(pot, soil, stem); shadow(g); scene.add(g);
  return { g, anim(t, k) { const s = E3(k); stem.scale.set(1, 0.05 + 0.95 * s, 1); stem.position.y = 0.82 * (1 - (0.05 + 0.95 * s));
    leaves.forEach((l, i) => { const kk = E3(clamp(k * 1.6 - 0.2 - i * 0.15)); l.scale.setScalar(Math.max(0.001, kk)); l.position.y = 0.82 + (l.userData.y0 - 0.82) * (0.05 + 0.95 * s); l.rotation.y += 0.002 * Math.sin(t + i); }); } };
}

// 9 · Bombillo: vidrio, filamento que se enciende y rosca metálica (k = encendido).
export function bombillo(scene) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(lathe([[0.18, 0], [0.2, 0.15], [0.32, 0.4], [0.55, 0.75], [0.6, 1.0], [0.5, 1.3], [0.28, 1.45], [0, 1.5]]), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 0.9, transparent: true, opacity: 0.35, roughness: 0.03, clearcoat: 1, side: THREE.DoubleSide, emissive: '#ffd27a', emissiveIntensity: 0 }));
  glass.position.y = 0.55;
  const fil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 8, 40, Math.PI * 1.6), new THREE.MeshStandardMaterial({ color: '#ffcc66', emissive: '#ffb347', emissiveIntensity: 0 })); fil.position.y = 1.45; fil.rotation.z = Math.PI * 0.2;
  const wires = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.7, 6), metal('#bdbdbd')); wires.position.y = 1.05;
  const base = new THREE.Group(); for (let i = 0; i < 5; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 32), metal(i % 2 ? '#b8b8b8' : '#d6d6d6', 0.25)); r.position.y = 0.12 + i * 0.09; base.add(r); }
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.1, 20), phys(DARK)); tip.position.y = 0.05;
  const light = new THREE.PointLight('#ffcf80', 0, 6, 2); light.position.y = 1.45;
  g.add(glass, fil, wires, base, tip, light); shadow(g); glass.castShadow = false; scene.add(g);
  return { g, anim(t, k) { const on = E3(k) * (0.92 + 0.08 * Math.sin(t * 9)); fil.material.emissiveIntensity = 6 * on; glass.material.emissiveIntensity = 0.5 * on; light.intensity = 9 * on; } };
}

// 10 · Letras "IA" en bloques (juguete de madera lacada): caen y rebotan (k por letra).
export function letrasIA(scene) {
  const g = new THREE.Group();
  const geo = (shape) => { const e = new THREE.ExtrudeGeometry(shape, { depth: 0.45, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 5, curveSegments: 12 }); e.translate(0, 0, -0.225); return e; };
  const I = new THREE.Shape(); I.moveTo(-0.22, 0); I.lineTo(0.22, 0); I.lineTo(0.22, 1.5); I.lineTo(-0.22, 1.5); I.closePath();
  const A = new THREE.Shape(); A.moveTo(-0.72, 0); A.lineTo(-0.3, 0); A.lineTo(-0.2, 0.32); A.lineTo(0.2, 0.32); A.lineTo(0.3, 0); A.lineTo(0.72, 0); A.lineTo(0.2, 1.5); A.lineTo(-0.2, 1.5); A.closePath();
  const h = new THREE.Path(); h.moveTo(-0.1, 0.62); h.lineTo(0.1, 0.62); h.lineTo(0, 1.0); h.closePath(); A.holes.push(h);
  const li = new THREE.Mesh(geo(I), phys(RED, { roughness: 0.25, clearcoat: 1 })), la = new THREE.Mesh(geo(A), phys('#f4f1ea', { roughness: 0.3, clearcoat: 1 }));
  li.position.x = -0.75; la.position.x = 0.45; g.add(li, la); shadow(g); scene.add(g);
  return { g, letters: [li, la], anim(t, k) { [li, la].forEach((m, i) => { const kk = clamp(k * 1.5 - i * 0.25), d = E3(kk); const b = kk < 1 ? Math.abs(Math.sin(kk * Math.PI * 2.5)) * (1 - kk) * 0.5 : 0;
      m.position.y = (1 - d) * 4 + b; m.rotation.z = (1 - d) * (i ? -0.5 : 0.4); }); } };
}

// 11 · Burbuja de comentario 3D (con grosor) con texto en la cara.
export function burbujaComentario(scene, { user = 'tu_negocio', text = 'IA' } = {}) {
  const g = new THREE.Group();
  const s = new THREE.Shape(), w = 2.4, hh = 1.2, r = 0.3, x = -w / 2, y = 0;
  s.moveTo(x + r, y); s.lineTo(x + 0.5, y); s.lineTo(x + 0.25, y - 0.38); s.lineTo(x + 0.85, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + hh - r); s.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
  s.lineTo(x + r, y + hh); s.quadraticCurveTo(x, y + hh, x, y + hh - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 5, curveSegments: 16 }), phys('#ffffff', { roughness: 0.35, clearcoat: 1 }));
  body.position.set(0, 0.5, -0.1);
  const tex = canvasTex(800, 400, (c, W, H) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H); c.fillStyle = '#d9d4c8'; c.beginPath(); c.arc(80, 90, 44, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#121212'; c.font = '900 36px Satoshi'; c.fillText(user, 145, 82); c.fillStyle = '#8c877d'; c.font = '500 26px Satoshi'; c.fillText('ahora · EJEMPLO', 145, 118);
    c.fillStyle = RED; c.font = '700 170px ClashDisplay'; c.fillText(text, 60, 320); });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: '#e8e4dc' })); face.position.set(0, 1.1, 0.16);
  g.add(body, face); shadow(g); face.castShadow = false; scene.add(g);
  return { g, anim(t) { g.rotation.z = 0.03 * Math.sin(t * 1.2); } };
}

export const CATALOGO2 = [
  ['hojas', hojasCalculo, 'Hojas de cálculo', 'el Excel que ya no alcanza', 'claro'],
  ['estante', estante, 'Estante con cajas', 'inventario en orden', 'madera'],
  ['letreroCalle', letreroCalle, 'Letrero de calle', 'tu dominio = tu dirección', 'claro'],
  ['terreno', terreno, 'Terreno', 'el hosting donde vive tu página', 'claro'],
  ['tablaLista', tablaLista, 'Tabla con lista', 'antes de contratar', 'claro'],
  ['lupa', lupa, 'Lupa', 'revisamos tu negocio', 'claro'],
  ['cuaderno', cuaderno, 'Cuaderno de pedidos', 'cuando ya no alcanza', 'madera'],
  ['maceta', maceta, 'Planta que crece', 'creces', 'oscuro'],
  ['bombillo', bombillo, 'Bombillo', 'innovas', 'oscuro'],
  ['letrasIA', letrasIA, 'Letras IA', 'comenta IA', 'claro'],
  ['burbuja', burbujaComentario, 'Comentario 3D', 'la conversación', 'claro'],
];
