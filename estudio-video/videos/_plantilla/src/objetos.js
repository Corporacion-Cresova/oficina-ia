// Biblioteca de objetos 3D de Cresova (v2, propuestas 2026-10-25). Cada objeto: crear(escena) → { g, anim(t, k) }.
// g = THREE.Group centrado con la base en y = 0; anim(t, k) mueve sus partes (k = 0..1 progreso de su acción principal).
// Materiales con intención: metal cepillado, cerámica, papel, madera, cera, vidrio. Todo es función de t.
import * as THREE from 'three';

// Microtextura compartida (ruido suave) en la rugosidad: rompe el look plástico de CG y da material real.
let NOISE = null;
function noise() { if (NOISE) return NOISE; const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), im = g.createImageData(256, 256);
  let sd = 7; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < im.data.length; i += 4) { const v = 200 + r() * 55; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0); NOISE = new THREE.CanvasTexture(c); NOISE.wrapS = NOISE.wrapT = THREE.RepeatWrapping; NOISE.repeat.set(3, 3); return NOISE; }
export const phys = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, roughnessMap: noise(), ...o });
export const metal = (color, rough = 0.22) => new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: rough, clearcoat: 0.4, roughnessMap: noise() });
const RED = '#e20018', CREAM = '#efe9de', WOOD = '#6b4a32', DARK = '#1b1a1a';
const shadow = (g) => g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
const lathe = (pts, seg = 64) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const rbox = (w, h, d, r, mat) => { const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4 }); geo.translate(0, 0, -d / 2); return new THREE.Mesh(geo, mat); };

// 1 · Campana de recepción: responder al instante.
export function campana(scene) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.22, 64), phys('#2a2523', { roughness: 0.45, clearcoat: 0.8 })); base.position.y = 0.11;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 72, 36, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#e9cf8f', metalness: 0.6, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 16), metal('#cfcfcf')); stem.position.y = 1.1;
  const btn = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), metal('#e8e8e8', 0.12)); btn.position.y = 1.24;
  dome.scale.y = 0.95; dome.position.y = 0.2; g.add(base, dome, stem, btn); shadow(g); scene.add(g);
  return { g, anim(t, k) { const p = Math.max(0, Math.sin(Math.PI * Math.min(1, k * 4))); btn.position.y = 1.24 - 0.09 * p; stem.position.y = 1.1 - 0.06 * p;
    dome.scale.setScalar(1 + 0.025 * Math.sin(t * 60) * Math.exp(-6 * Math.max(0, k - 0.12)) * (k > 0.12 ? 1 : 0)); } };
}

// 2 · Letrero colgante ABIERTO / CERRADO: tu página abre las 24 h.
export function letrero(scene) {
  const g = new THREE.Group(), sw = new THREE.Group(); g.add(sw);
  const face = (txt, col, bg) => canvasTex(640, 320, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.strokeStyle = col; c.lineWidth = 14; c.strokeRect(22, 22, w - 44, h - 44);
    c.fillStyle = col; c.font = '700 120px ClashDisplay'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, w / 2, h / 2 + 6); });
  const board = rbox(2.0, 1.0, 0.08, 0.1, phys(WOOD, { roughness: 0.7, clearcoat: 0.2 })); board.position.y = 1.4;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 0.88), new THREE.MeshStandardMaterial({ map: face('ABIERTO', RED, CREAM), roughness: 0.6 })); front.position.set(0, 1.4, 0.075);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 0.88), new THREE.MeshStandardMaterial({ map: face('CERRADO', '#ece7dc', '#1d1c1c'), roughness: 0.6 })); back.position.set(0, 1.4, -0.075); back.rotation.y = Math.PI;
  const cord = (x) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 8), phys('#c9b48a', { roughness: 0.9 })); c.position.set(x * 0.32, 2.17, 0); c.rotation.z = -x * 0.62; return c; };
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 10, 24), metal('#bdbdbd')); hook.position.y = 2.55;
  sw.add(board, front, back, cord(1), cord(-1), hook); sw.position.y = 0; shadow(g); scene.add(g);
  return { g, anim(t, k) { sw.rotation.y = Math.PI * (1 - Math.min(1, k)) + 0.18 * Math.sin(t * 1.3) * (1 - 0.5 * k); sw.rotation.z = 0.05 * Math.sin(t * 2.1); } };
}

// 3 · Sobre con sello de cera rojo (C de Cresova): mensajes, contacto.
export function sobre(scene) {
  const g = new THREE.Group(), paper = phys('#d8cdb8', { roughness: 0.9, clearcoat: 0 });
  const body = rbox(2.2, 1.4, 0.05, 0.04, paper); body.position.y = 0.9;
  const flapShape = new THREE.Shape(); flapShape.moveTo(-1.1, 0); flapShape.lineTo(1.1, 0); flapShape.lineTo(0, -0.78); flapShape.closePath();
  const flap = new THREE.Mesh(new THREE.ExtrudeGeometry(flapShape, { depth: 0.012, bevelEnabled: false }), phys('#cfc3ac', { roughness: 0.9, clearcoat: 0 }));
  const hinge = new THREE.Group(); hinge.position.set(0, 1.6, 0.04); hinge.add(flap); flap.position.z = 0.0;
  const sealTex = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#b80014'; c.fillRect(0, 0, w, h); c.fillStyle = '#7a000d'; c.font = '700 170px ClashDisplay'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('C', w / 2, h / 2 + 8); });
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.07, 40), [phys('#b80014', { roughness: 0.4 }), new THREE.MeshStandardMaterial({ map: sealTex, roughness: 0.35 }), phys('#b80014')]);
  seal.rotation.x = Math.PI / 2; seal.position.set(0, 1.04, 0.09);
  const letter = rbox(1.9, 1.2, 0.02, 0.03, phys('#e9e2d4', { roughness: 0.9, clearcoat: 0 })); letter.position.set(0, 0.95, 0.0);
  g.add(body, hinge, seal, letter); shadow(g); scene.add(g);
  return { g, anim(t, k) { const crack = Math.min(1, k * 3); seal.position.y = 1.04 - 0.6 * Math.max(0, crack - 0.3); seal.rotation.z = 0.8 * Math.max(0, crack - 0.3); seal.visible = crack < 0.95;
    hinge.rotation.x = -Math.PI * 0.92 * Math.min(1, Math.max(0, (k - 0.25) * 2.2)); letter.position.y = 0.95 + 0.9 * Math.max(0, Math.min(1, (k - 0.55) * 2.2)); } };
}

// 4 · Reloj de arena: la espera, pocos segundos.
export function relojArena(scene) {
  const g = new THREE.Group(), rot = new THREE.Group(); rot.position.y = 1.25; g.add(rot);
  const wood = phys(WOOD, { roughness: 0.65, clearcoat: 0.3 });
  const cap = (y) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.14, 48), wood); m.position.y = y; return m; };
  const post = (a) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.2, 12), wood); m.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6); return m; };
  const glass = new THREE.Mesh(lathe([[0.02, -1.06], [0.5, -1.0], [0.55, -0.7], [0.3, -0.25], [0.07, 0], [0.3, 0.25], [0.55, 0.7], [0.5, 1.0], [0.02, 1.06]]),
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 0.9, roughness: 0.05, thickness: 0.3, transparent: true, opacity: 0.35, ior: 1.4 }));
  const sandMat = phys('#d8b878', { roughness: 0.9, clearcoat: 0 });
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.55, 40), sandMat); top.rotation.x = Math.PI;
  const bot = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.5, 40), sandMat);
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 8), sandMat);
  rot.add(cap(1.12), cap(-1.12), post(0.3), post(2.4), post(4.5), glass, top, bot, stream); shadow(g); scene.add(g);
  return { g, anim(t, k) { const s = Math.min(1, k);
    top.scale.set(1 - 0.75 * s, Math.max(0.02, 1 - s), 1 - 0.75 * s); top.position.y = 0.32 + 0.24 * s;
    bot.scale.set(0.3 + 0.7 * s, Math.max(0.02, s), 0.3 + 0.7 * s); bot.position.y = -0.95 + 0.25 * s; stream.position.y = -0.45; stream.visible = s > 0.02 && s < 0.98; } };
}

// 5 · Llave + candado: tu dominio, tu página, a tu nombre.
export function llaveCandado(scene) {
  const g = new THREE.Group();
  const body = rbox(1.3, 1.1, 0.5, 0.18, phys(RED, { roughness: 0.25, clearcoat: 1 })); body.position.y = 0.75;
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 20, 48, Math.PI), metal('#cfcfcf', 0.15)); shackle.position.y = 1.32;
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 20), metal('#cfcfcf', 0.15)); legL.position.set(-0.42, 1.2, 0);
  const legR = legL.clone(); legR.position.x = 0.42;
  const sh = new THREE.Group(); sh.add(shackle, legL, legR);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 20), new THREE.MeshStandardMaterial({ color: '#2a0004' })); hole.rotation.x = Math.PI / 2; hole.position.set(0, 0.68, 0.26);
  const key = new THREE.Group(), gold = metal('#d7b45a', 0.2);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 16, 40), gold); ring.position.x = 0.95;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.75, 16), gold); shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.38;
  const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.05), gold); t1.position.set(0.12, -0.08, 0); const t2 = t1.clone(); t2.position.x = 0.26; t2.scale.y = 0.7;
  key.add(ring, shaft, t1, t2); key.rotation.y = -Math.PI / 2; const holder = new THREE.Group(); holder.add(key);
  g.add(body, sh, hole, holder); shadow(g); scene.add(g);
  return { g, anim(t, k) { const ins = Math.min(1, k * 2), turn = Math.max(0, Math.min(1, (k - 0.5) * 3)), open = Math.max(0, Math.min(1, (k - 0.75) * 4));
    holder.position.set(0, 0.68, 0.26 + 1.0 * (1 - ins)); holder.rotation.z = turn * Math.PI / 2; sh.position.y = 0.28 * open; sh.rotation.y = 0.6 * open; } };
}

// 6 · Vitrina de tienda: tu página = tu local abierto.
export function vitrina(scene) {
  const g = new THREE.Group();
  const wall = rbox(2.4, 1.9, 0.5, 0.06, phys('#bfb39f', { roughness: 0.85, clearcoat: 0 })); wall.position.y = 0.95;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.95), new THREE.MeshStandardMaterial({ color: '#2a2622', emissive: '#ffcf8a', emissiveIntensity: 0 })); win.position.set(-0.25, 0.85, 0.3);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.15), new THREE.MeshStandardMaterial({ color: '#1d1c1c', roughness: 0.5 })); door.position.set(0.82, 0.6, 0.3);
  const awnTex = canvasTex(512, 64, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ffffff' : RED; c.fillRect(i * 64, 0, 64, h); } });
  const awn = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 0.6), [phys(RED), phys(RED), new THREE.MeshStandardMaterial({ map: awnTex }), phys(RED), phys(RED), phys(RED)]); awn.position.set(0, 1.6, 0.45); awn.rotation.x = 0.35;
  const signTex = canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#121212'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffffff'; c.font = '700 54px ClashDisplay'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('TU NEGOCIO', w / 2, h / 2 + 3); });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.26), new THREE.MeshStandardMaterial({ map: signTex })); sign.position.set(0, 1.78, 0.31);
  g.add(wall, win, door, awn, sign); shadow(g); scene.add(g);
  return { g, anim(t, k) { win.material.emissiveIntensity = 1.2 * Math.min(1, k * 1.5) * (0.92 + 0.08 * Math.sin(t * 7)); } };
}

// 7 · Megáfono: anuncios, que te escuchen.
export function megafono(scene) {
  const g = new THREE.Group(), m = new THREE.Group(); m.position.y = 1.1; m.rotation.z = 0.25; g.add(m);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.2, 1.4, 48, 1, true), phys('#f4f1ea', { side: THREE.DoubleSide, roughness: 0.4 })); cone.rotation.z = -Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 12, 60), phys(RED)); rim.rotation.y = Math.PI / 2; rim.position.x = 0.7;
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.35, 32), phys(RED)); back.rotation.z = Math.PI / 2; back.position.x = -0.85;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.14), phys(DARK)); handle.position.set(-0.45, -0.38, 0);
  m.add(cone, rim, back, handle);
  const waves = [0, 1, 2].map(() => { const w = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.025, 8, 60), new THREE.MeshBasicMaterial({ color: RED, transparent: true })); w.rotation.y = Math.PI / 2; m.add(w); return w; });
  shadow(g); scene.add(g);
  return { g, anim(t, k) { const on = Math.min(1, k * 2); m.position.x = -0.06 * Math.sin(Math.PI * Math.min(1, k * 6));
    waves.forEach((w, i) => { const p = ((t * 0.9 + i / 3) % 1); w.position.x = 0.8 + 1.4 * p; w.scale.setScalar(1 + 0.8 * p); w.material.opacity = on * (1 - p); }); } };
}

// 8 · Engranes: sistemas, automatización.
function gearGeo(r, teeth, depth) {
  const s = new THREE.Shape(), n = teeth * 2;
  for (let i = 0; i <= n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2, rr = Math.floor(i / 2) % 2 ? r : r + 0.14; const p = [Math.cos(a) * rr, Math.sin(a) * rr]; i ? s.lineTo(...p) : s.moveTo(...p); }
  const h = new THREE.Path(); h.absarc(0, 0, r * 0.32, 0, Math.PI * 2, true); s.holes.push(h);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 3, curveSegments: 6 }); geo.translate(0, 0, -depth / 2); return geo;
}
export function engranes(scene) {
  const g = new THREE.Group();
  const a = new THREE.Mesh(gearGeo(0.7, 12, 0.22), metal('#bfbfbf', 0.28)); a.position.set(-0.55, 1.3, 0);
  const b = new THREE.Mesh(gearGeo(0.45, 8, 0.22), phys(RED, { metalness: 0.3, roughness: 0.3 })); b.position.set(0.62, 1.62, 0.02);
  const c = new THREE.Mesh(gearGeo(0.35, 6, 0.22), metal('#8c8c8c', 0.35)); c.position.set(0.55, 0.62, 0.01);
  g.add(a, b, c); shadow(g); scene.add(g);
  return { g, anim(t, k) { const w = t * 1.2 * Math.min(1, k * 2); a.rotation.z = w; b.rotation.z = -w * 12 / 8 + 0.2; c.rotation.z = -w * 12 / 6 + 0.1; } };
}

// 9 · Calendario de escritorio: citas, agenda.
export function calendario(scene) {
  const g = new THREE.Group();
  const stand = rbox(1.6, 0.25, 0.9, 0.08, phys(DARK, { roughness: 0.5 })); stand.position.y = 0.12; stand.rotation.x = Math.PI / 2;
  const page = (day, y, z) => { const tex = canvasTex(400, 440, (c, w, h) => { c.fillStyle = '#fbf8f2'; c.fillRect(0, 0, w, h); c.fillStyle = RED; c.fillRect(0, 0, w, 110);
      c.fillStyle = '#fff'; c.font = '700 64px ClashDisplay'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('NOV', w / 2, 58); c.fillStyle = '#121212'; c.font = '700 200px ClashDisplay'; c.fillText(day, w / 2, 280); });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.4, 0.01), [phys('#eee'), phys('#eee'), phys('#eee'), phys('#eee'), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), phys('#eee')]);
    const hg = new THREE.Group(); hg.position.set(0, 1.62, z); m.position.y = -0.7; hg.add(m); hg.rotation.x = -0.18; return hg; };
  const pages = ['15', '16', '17'].map((d, i) => page(d, 0, 0.02 - i * 0.02 + 0.06));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 8, 20), metal('#bdbdbd')); ring.position.set(0, 1.64, 0.08);
  g.add(stand, ...pages, ring); shadow(g); scene.add(g);
  return { g, anim(t, k) { pages.forEach((p, i) => { const f = Math.max(0, Math.min(1, k * 2 - i)); if (i === 2) return; p.rotation.x = -0.18 - Math.PI * 0.95 * E3(f); p.visible = f < 0.98; }); } };
}
const E3 = (x) => 1 - Math.pow(1 - x, 3);

// 10 · Taza de café con vapor: "en la mañana", trabajo humano.
export function taza(scene) {
  const g = new THREE.Group();
  const mug = new THREE.Mesh(lathe([[0, 0], [0.5, 0], [0.55, 0.05], [0.56, 0.95], [0.5, 0.97], [0.48, 0.12], [0, 0.12]]), phys('#f7f4ee', { roughness: 0.3, clearcoat: 1 }));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.565, 0.565, 0.16, 48, 1, true), phys(RED)); band.position.y = 0.6;
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.48, 40), phys('#3a2414', { roughness: 0.15, clearcoat: 1 })); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.85;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 14, 30, Math.PI * 1.2), phys('#f7f4ee', { clearcoat: 1 })); handle.position.set(0.58, 0.5, 0); handle.rotation.z = -Math.PI * 0.6;
  const saucer = new THREE.Mesh(lathe([[0, 0], [0.9, 0.02], [0.95, 0.07], [0, 0.04]]), phys('#f7f4ee', { clearcoat: 1 }));
  const wisp = canvasTex(128, 512, (c, w, h) => { for (let y = 0; y < h; y += 2) { const a = Math.sin(Math.PI * y / h) * 0.55, x = w / 2 + 22 * Math.sin(y / 38); const gr = c.createRadialGradient(x, y, 0, x, y, 26); gr.addColorStop(0, `rgba(255,255,255,${a * 0.25})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(x - 26, y - 26, 52, 52); } });
  const steam = [0, 1, 2].map((i) => { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.9), new THREE.MeshBasicMaterial({ map: wisp, transparent: true, depthWrite: false, opacity: 0.8 })); g.add(s); return s; });
  g.add(mug, band, coffee, handle, saucer); g.children.forEach((m) => { if (m.isMesh && !steam.includes(m)) { m.castShadow = true; m.receiveShadow = true; } }); scene.add(g);
  return { g, anim(t) { steam.forEach((s, i) => { s.position.set(-0.15 + i * 0.15, 1.85 + 0.12 * Math.sin(t * 1.3 + i), 0.0); s.rotation.y = -g.rotation.y; s.scale.set(1 + 0.1 * Math.sin(t * 1.7 + i), 1 + 0.08 * Math.sin(t * 1.1 + i * 2), 1); s.material.opacity = 0.75 + 0.2 * Math.sin(t * 2 + i); }); } };
}

export const CATALOGO = [
  ['campana', campana, 'Campana de recepción', 'responder al instante'],
  ['letrero', letrero, 'Letrero ABIERTO', 'tu página abre 24 h'],
  ['sobre', sobre, 'Sobre con sello de cera', 'mensajes y contacto'],
  ['relojArena', relojArena, 'Reloj de arena', 'la espera, pocos segundos'],
  ['llaveCandado', llaveCandado, 'Llave y candado', 'tu dominio, a tu nombre'],
  ['vitrina', vitrina, 'Vitrina de tienda', 'tu página = tu local'],
  ['megafono', megafono, 'Megáfono', 'anuncios que se escuchan'],
  ['engranes', engranes, 'Engranes', 'sistemas y automatización'],
  ['calendario', calendario, 'Calendario de escritorio', 'citas y agenda'],
  ['taza', taza, 'Taza de café', 'la mañana, el trabajo humano'],
];
