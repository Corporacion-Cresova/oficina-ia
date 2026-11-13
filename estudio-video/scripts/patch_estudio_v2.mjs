// Amplía estudio3d.js (copias de los videos 02+): teléfono 3D con grosor y pantalla 2D, y objetos opcionales
// (mapa, pines, ficha y tarjetas solo se muestran si el estado los trae).
import { readFileSync, writeFileSync } from "node:fs";
for (const v of process.argv.slice(2)) {
  const f = `videos/${v}/src/estudio3d.js`;
  let s = readFileSync(f, "utf8");
  if (s.includes("this.phone")) { console.log("ya parchado", f); continue; }
  const rep = (a, b) => { if (!s.includes(a)) throw Error(`${f}: no encontré «${a.slice(0, 60)}»`); s = s.replace(a, b); };
  rep("    this.composer = new EffectComposer(r);",
`    // Teléfono 3D con grosor: cuerpo carbón satinado, marco metálico y pantalla 2D (canvas 540×1110).
    this.phone = new THREE.Group();
    const PW = 2.2, PH = 4.52;
    const pbody = new THREE.Mesh(new THREE.ExtrudeGeometry(roundRect(PW, PH, 0.32), { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 6 }),
      new THREE.MeshPhysicalMaterial({ color: '#161515', roughness: 0.35, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.2 }));
    pbody.position.z = -0.08; pbody.castShadow = true;
    const pcv = document.createElement('canvas'); pcv.width = 540; pcv.height = 1110;
    const ptex = new THREE.CanvasTexture(pcv); ptex.colorSpace = THREE.SRGBColorSpace; ptex.anisotropy = 4;
    const pscreen = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(PW * 0.92, PH * 0.955, 0.26)), new THREE.MeshBasicMaterial({ map: ptex, color: '#d9d5cd', toneMapped: false }));
    { const uv = pscreen.geometry.attributes.uv, pos = pscreen.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / (PW * 0.92) + 0.5, pos.getY(i) / (PH * 0.955) + 0.5); }
    pscreen.position.z = 0.14;
    this.phone.add(pbody, pscreen); this.phone.userData = { cv: pcv, ctx: pcv.getContext('2d'), tex: ptex }; this.phone.visible = false; s.add(this.phone);

    this.composer = new EffectComposer(r);`);
  rep("    setPin(this.pin, st.pin); setPin(this.pin2, st.pin2);",
`    const hidePin = { pos: [0, 0, 0], scale: 0 };
    setPin(this.pin, st.pin || hidePin); setPin(this.pin2, st.pin2 || hidePin);
    this.map.visible = this.dots.visible = st.mapY !== undefined;
    if (st.phone && st.phone.scale > 0.001) {
      const p = this.phone, d = p.userData; p.visible = true; p.position.set(...st.phone.pos); p.rotation.order = 'YXZ';
      p.rotation.set(st.phone.rotX || 0, st.phone.rotY || 0, st.phone.rotZ || 0); p.scale.setScalar(st.phone.scale);
      if (st.phoneDraw) { d.ctx.clearRect(0, 0, 540, 1110); st.phoneDraw(d.ctx); d.tex.needsUpdate = true; }
    } else this.phone.visible = false;`);
  rep("    this.pin2.userData.mat.emissiveIntensity = st.pin2.glow || 0;\n    this.map.position.y = st.mapY;",
      "    this.pin2.userData.mat.emissiveIntensity = (st.pin2 && st.pin2.glow) || 0;\n    this.map.position.y = st.mapY ?? -5;");
  rep("    this.pts.forEach(([x, z], i) => {", "    if (st.dot) this.pts.forEach(([x, z], i) => {");
  rep("    setCard(this.ficha, st.ficha, st.fichaDraw);\n    this.cards.forEach((c, i) => setCard(c, st.cards[i],",
      "    setCard(this.ficha, st.ficha || { scale: 0 }, st.fichaDraw);\n    this.cards.forEach((c, i) => setCard(c, (st.cards || [])[i] || { scale: 0 },");
  writeFileSync(f, s); console.log("parchado", f);
}
