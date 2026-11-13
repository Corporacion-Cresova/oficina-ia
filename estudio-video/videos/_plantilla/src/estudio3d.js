// Estudio 3D de Cresova (Three.js) para el piloto completo en one take.
// Objetos de marca con luz real que se componen con las capas 2D: pin clásico con grosor (objeto-personaje),
// segundo pin ("otro negocio"), Honduras en relieve, puntos de negocios, tarjetas 3D con grosor cuya cara
// frontal es un dibujo 2D (ficha y carrusel), piso reflejante, foco, contraluz y bloom. Todo es función de t.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
// Limpia píxeles NaN/inf antes del bloom (un NaN se expande en un bloque negro en el blur del bloom).
const Sanitize = { uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; bool bad(float x){ return !(x >= 0.0 || x < 0.0) || abs(x) > 6.0e4; } void main(){ vec4 c = texture2D(tDiffuse, vUv); if (bad(c.r) || bad(c.g) || bad(c.b)) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = vec4(min(c.rgb, vec3(64.0)), c.a); }' };

const HN = [[-89.35, 15.07], [-88.7, 15.7], [-88.2, 15.72], [-87.6, 15.88], [-86.9, 15.75], [-86.0, 15.95], [-85.4, 15.88], [-84.8, 15.85],
  [-84.3, 15.82], [-83.8, 15.42], [-83.15, 15.0], [-83.4, 14.95], [-83.6, 14.8], [-84.2, 14.75], [-84.5, 14.62], [-84.9, 14.8], [-85.15, 14.35],
  [-85.6, 13.95], [-86.0, 13.98], [-86.3, 13.75], [-86.75, 13.75], [-86.8, 13.3], [-87.3, 12.98], [-87.5, 13.3], [-87.8, 13.4], [-87.7, 13.8],
  [-88.0, 13.9], [-88.5, 13.85], [-88.85, 14.05], [-89.2, 14.4], [-89.35, 14.45], [-89.15, 14.9]];
const inside = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const LON0 = -86.25, LAT0 = 14.45, SC = 1.25;                       // centro de Honduras → origen; 1° ≈ 1.25 unidades
export const toXZ = (lon, lat) => [(lon - LON0) * SC, -(lat - LAT0) * SC];

const roundRect = (w, h, r) => { const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; };

export class Estudio {
  constructor(W, H, scale) {
    this.W = W; this.H = H;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(W * scale); this.canvas.height = Math.round(H * scale);
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(this.canvas.width, this.canvas.height, false);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.78;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color('#0c0b0b'); s.fog = new THREE.Fog('#0c0b0b', 16, 42);
    const pm = new THREE.PMREMGenerator(r); s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; s.environmentIntensity = 0.35;
    this.camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 100);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ color: '#0e0d0d', roughness: 0.38, metalness: 0.5 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor); this.floor = floor;

    const key = this.key = new THREE.SpotLight('#fff3e6', 520, 44, 0.38, 0.6, 1.6);
    key.position.set(0, 14, 4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02; s.add(key, key.target);
    // Relleno cálido frontal + luz de recorte blanca trasera: modelan la forma y dan el brillo de borde "premium".
    this.fill = new THREE.DirectionalLight('#ffe9d6', 0.35); this.fill.position.set(-6, 5, 8); s.add(this.fill);
    this.kick = new THREE.PointLight('#ffffff', 28, 18, 1.6); this.kick.position.set(4.5, 4.5, -4); s.add(this.kick);
    const rim = this.rim = new THREE.PointLight('#ff1a2b', 70, 22, 1.8); rim.position.set(-3, 3.5, -6); s.add(rim);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#120002', 0.18); s.add(this.hemi);

    // Pines: silueta clásica con GROSOR (extrusión con bisel). Punta en (0,0), círculo r=1 en (0,2).
    const DEPTH = 0.42, outline = new THREE.Shape();
    const tg = (a) => [Math.cos((a * Math.PI) / 180), 2 + Math.sin((a * Math.PI) / 180)];
    outline.moveTo(0, 0); outline.lineTo(...tg(-30)); outline.absarc(0, 2, 1, (-30 * Math.PI) / 180, (210 * Math.PI) / 180, false); outline.lineTo(0, 0);
    const hole = new THREE.Path(); hole.absarc(0, 2, 0.42, 0, Math.PI * 2, true); outline.holes.push(hole);
    const pinGeo = new THREE.ExtrudeGeometry(outline, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 6, curveSegments: 64 });
    pinGeo.translate(0, 0, -DEPTH / 2);
    const discGeo = new THREE.CylinderGeometry(0.42, 0.42, DEPTH * 0.7, 64);
    const makePin = (bodyColor, discColor, glow) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshPhysicalMaterial({ color: bodyColor, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, emissive: glow, emissiveIntensity: 0.2 });
      const body = new THREE.Mesh(pinGeo, mat); body.castShadow = true;
      const disc = new THREE.Mesh(discGeo, new THREE.MeshStandardMaterial({ color: discColor, roughness: 0.35, emissive: discColor, emissiveIntensity: 0.12 }));
      disc.rotation.x = Math.PI / 2; disc.position.y = 2; disc.castShadow = true;
      g.add(body, disc); g.userData.mat = mat; s.add(g); return g;
    };
    this.pin = makePin('#e20018', '#ffffff', '#3a0004');
    this.pin2 = makePin('#f4f1ea', '#e20018', '#ffffff');
    this.red = new THREE.Color('#e20018'); this.grey = new THREE.Color('#4a4642');

    // Honduras en relieve.
    const shape = new THREE.Shape(HN.map(([lo, la]) => { const [x, z] = toXZ(lo, la); return new THREE.Vector2(x, -z); }));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3 });
    geo.rotateX(-Math.PI / 2);
    this.map = new THREE.Mesh(geo, [
      new THREE.MeshStandardMaterial({ color: '#1d1b1b', roughness: 0.45, metalness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: '#b00012', emissive: '#e20018', emissiveIntensity: 0.35, roughness: 0.4 }),
    ]);
    this.map.castShadow = true; this.map.receiveShadow = true; s.add(this.map);

    // Puntos de negocios (sin luz propia: el color por instancia permite apagarlos uno a uno).
    const pts = [];
    for (let lo = -89.4; lo <= -83.1; lo += 0.2) for (let la = 12.9; la <= 16.0; la += 0.2) if (inside(lo, la, HN)) pts.push(toXZ(lo, la));
    this.pts = pts;
    this.dots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10), new THREE.MeshBasicMaterial({ color: '#ffffff' }), pts.length);
    s.add(this.dots);
    this.mx = new THREE.Matrix4(); this.col = new THREE.Color();

    // Tarjetas 3D: cuerpo con grosor + cara frontal con textura 2D (canvas).
    const makeCard = (w, h, px, py) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(roundRect(w, h, 0.14), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4 }),
        new THREE.MeshPhysicalMaterial({ color: '#f3efe7', roughness: 0.45, clearcoat: 0.6 }));
      body.position.z = -0.05; body.castShadow = true;
      const cv = document.createElement('canvas'); cv.width = px; cv.height = py;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const face = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(w * 0.985, h * 0.985, 0.13)), new THREE.MeshBasicMaterial({ map: tex, color: '#cdc8be', transparent: true, toneMapped: false }));
      // ShapeGeometry no trae UV 0..1: se las normalizamos al rectángulo.
      const uv = face.geometry.attributes.uv, pos = face.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / (w * 0.985) + 0.5, pos.getY(i) / (h * 0.985) + 0.5);
      face.position.z = 0.09;
      g.add(body, face); g.userData = { cv, ctx: cv.getContext('2d'), tex }; g.scale.setScalar(0); s.add(g); return g;
    };
    this.ficha = makeCard(3.3, 3.3 * 520 / 860, 860, 520);
    this.cards = [0, 1, 2].map(() => makeCard(1.9, 2.8, 380, 560));

    // Teléfono 3D con grosor: cuerpo carbón satinado, marco metálico y pantalla 2D (canvas 540×1110).
    this.phone = new THREE.Group();
    const PW = 2.2, PH = 4.52;
    const pbody = new THREE.Mesh(new THREE.ExtrudeGeometry(roundRect(PW, PH, 0.32), { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 6 }),
      new THREE.MeshPhysicalMaterial({ color: '#161515', roughness: 0.35, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.2 }));
    pbody.position.z = -0.08; pbody.castShadow = true;
    const pcv = document.createElement('canvas'); pcv.width = 540; pcv.height = 1110;
    const ptex = new THREE.CanvasTexture(pcv); ptex.colorSpace = THREE.SRGBColorSpace; ptex.anisotropy = 4;
    const pscreen = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(PW * 0.92, PH * 0.955, 0.26)), new THREE.MeshBasicMaterial({ map: ptex, color: '#e6e2da', toneMapped: false }));
    { const uv = pscreen.geometry.attributes.uv, pos = pscreen.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / (PW * 0.92) + 0.5, pos.getY(i) / (PH * 0.955) + 0.5); }
    pscreen.position.z = 0.14;
    this.phone.add(pbody, pscreen); this.phone.userData = { cv: pcv, ctx: pcv.getContext('2d'), tex: ptex }; this.phone.visible = false; s.add(this.phone);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(s, this.camera));
    this.composer.addPass(new ShaderPass(Sanitize));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.canvas.width, this.canvas.height), 0.22, 0.45, 0.92); this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.v = new THREE.Vector3();
  }

  // Tema del set: 'oscuro' (estudio negro, por defecto) o 'claro' (set blanco cálido, sombras suaves; serie educativa).
  setTema(tema) {
    const claro = tema === 'claro', madera = tema === 'madera', s = this.scene;
    if (madera) { s.background.set('#1d1510'); s.fog.color.copy(s.background); s.fog.near = 14; s.fog.far = 36;
      if (!this.woodTex) { const c = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d');
        for (let i = 0; i < 16; i++) { const y = i * 64, h = 60; g.fillStyle = ['#7a5232', '#6f4a2c', '#84593a', '#744e30'][i % 4]; g.fillRect(0, y, 1024, h); g.fillStyle = '#3b2616'; g.fillRect(0, y + h, 1024, 4);
          for (let k = 0; k < 40; k++) { g.strokeStyle = 'rgba(40,24,12,' + (0.08 + Math.random() * 0.12) + ')'; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const yy = y + Math.random() * h; g.moveTo(0, yy); for (let x = 0; x <= 1024; x += 64) g.lineTo(x, yy + Math.sin(x / 90 + k) * 3); g.stroke(); } }
        this.woodTex = new THREE.CanvasTexture(c); this.woodTex.colorSpace = THREE.SRGBColorSpace; this.woodTex.wrapS = this.woodTex.wrapT = THREE.RepeatWrapping; this.woodTex.repeat.set(5, 5); this.woodTex.anisotropy = 8; }
      this.floor.material.map = this.woodTex; this.floor.material.color.set('#ffffff'); this.floor.material.metalness = 0; this.floor.material.roughness = 0.6; this.floor.material.needsUpdate = true;
      this.hemi.intensity = 0.35; this.hemi.groundColor.set('#3a2414'); this.rim.intensity = 25; this.rim.color.set('#ff7a3a'); this.fill.intensity = 0.7; this.fill.color.set('#ffd6a6'); this.kick.intensity = 22;
      this.key.color.set('#ffe0b8'); this.bloom.strength = 0.12; this.renderer.toneMappingExposure = 0.85; s.environmentIntensity = 0.45; return; }
    if (this.floor.material.map) { this.floor.material.map = null; this.floor.material.needsUpdate = true; } this.rim.color.set('#ff1a2b'); this.key.color.set('#fff3e6'); this.fill.color.set('#ffe9d6');
    this.fill.intensity = claro ? 0.8 : 0.35; this.kick.intensity = claro ? 10 : 28;
    s.background.set(claro ? '#e9e3d8' : '#0c0b0b'); s.fog.color.copy(s.background); s.fog.near = claro ? 14 : 16; s.fog.far = claro ? 34 : 42;
    this.floor.material.color.set(claro ? '#e4ddd1' : '#0e0d0d'); this.floor.material.metalness = claro ? 0 : 0.5; this.floor.material.roughness = claro ? 0.95 : 0.38;
    this.hemi.intensity = claro ? 0.55 : 0.18; this.bloom.strength = claro ? 0.0 : 0.22; this.hemi.groundColor.set(claro ? '#d9cfc2' : '#120002'); this.rim.intensity = claro ? 18 : 70;
    this.renderer.toneMappingExposure = claro ? 0.86 : 0.78; s.environmentIntensity = claro ? 0.55 : 0.35;
  }

  // Coordenadas de pantalla (px de diseño) de un punto 3D con la cámara actual.
  project(x, y, z) { this.v.set(x, y, z).project(this.camera); return [(this.v.x + 1) / 2 * this.W, (1 - this.v.y) / 2 * this.H]; }

  render(st) {
    const { cam, look, keyI = 520, keyAt = [0, 0, 0] } = st;
    this.key.intensity = keyI; this.key.target.position.set(...keyAt);
    this.camera.position.set(...cam); this.camera.lookAt(...look); this.camera.updateProjectionMatrix();
    const setPin = (p, o) => { p.visible = o.scale > 0.001; p.position.set(...o.pos); p.rotation.order = 'YXZ'; p.rotation.set(o.tilt || 0, o.rot || 0, 0); p.scale.setScalar(Math.max(0.001, o.scale)); };
    const hidePin = { pos: [0, 0, 0], scale: 0 };
    setPin(this.pin, st.pin || hidePin); setPin(this.pin2, st.pin2 || hidePin);
    this.map.visible = this.dots.visible = st.mapY !== undefined;
    if (st.phone && st.phone.scale > 0.001) {
      const p = this.phone, d = p.userData; p.visible = true; p.position.set(...st.phone.pos); p.rotation.order = 'YXZ';
      p.rotation.set(st.phone.rotX || 0, st.phone.rotY || 0, st.phone.rotZ || 0); p.scale.setScalar(st.phone.scale);
      if (st.phoneDraw) { d.ctx.clearRect(0, 0, 540, 1110); st.phoneDraw(d.ctx); d.tex.needsUpdate = true; }
    } else this.phone.visible = false;
    this.pin.userData.mat.color.copy(this.red).lerp(this.grey, st.pinOff || 0);
    this.pin.userData.mat.emissiveIntensity = 0.2 * (1 - (st.pinOff || 0));
    this.pin2.userData.mat.emissiveIntensity = (st.pin2 && st.pin2.glow) || 0;
    this.map.position.y = st.mapY ?? -5;
    if (st.dot) this.pts.forEach(([x, z], i) => {
      const [k, b] = st.dot(x, z, i);
      this.mx.makeScale(k, k * (0.6 + 0.4 * ((i * 7) % 5) / 4), k); this.mx.setPosition(x, st.mapY + 0.42, z); this.dots.setMatrixAt(i, this.mx);
      this.dots.setColorAt(i, this.col.setRGB(0.93 * b, 0.9 * b, 0.86 * b));
    });
    this.dots.instanceMatrix.needsUpdate = true; if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
    const setCard = (c, o, draw) => {
      c.visible = o.scale > 0.001; if (!c.visible) return;
      c.position.set(...o.pos); c.rotation.set(o.tiltX || 0, o.rotY || 0, 0); c.scale.setScalar(o.scale);
      if (draw) { const d = c.userData; d.ctx.clearRect(0, 0, d.cv.width, d.cv.height); draw(d.ctx); d.tex.needsUpdate = true; }
    };
    setCard(this.ficha, st.ficha || { scale: 0 }, st.fichaDraw);
    this.cards.forEach((c, i) => setCard(c, (st.cards || [])[i] || { scale: 0 }, st.cardsDraw && !c.userData.drawn ? ((g) => { st.cardsDraw(g, i); c.userData.drawn = true; }) : null));
    this.composer.render();
    return this.canvas;
  }
}
