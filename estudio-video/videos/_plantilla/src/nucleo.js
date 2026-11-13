// "El núcleo": objeto-personaje de la IA de Cresova (tanda 2). Es el círculo blanco del pin que se suelta y flota:
// esfera blanca brillante con un halo rojo que late, tres anillos rojos que giran y partículas en órbita.
// think = 0..1 sube la velocidad y el brillo cuando "piensa" o responde. Todo es función de t.
import * as THREE from 'three';

export class Nucleo {
  constructor(scene) {
    this.g = new THREE.Group();
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 64, 48),
      new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.5, roughness: 0.15, clearcoat: 1 }));
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32),
      new THREE.MeshBasicMaterial({ color: '#e20018', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.rings = [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.68 + i * 0.14, 0.02, 12, 120),
        new THREE.MeshStandardMaterial({ color: '#e20018', emissive: '#e20018', emissiveIntensity: 0.8, roughness: 0.3 }));
      this.g.add(m); return m;
    });
    this.dots = [...Array(10)].map((_, i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: i % 3 ? '#ffffff' : '#ff3344' }));
      this.g.add(m); return m;
    });
    this.g.add(this.core, this.halo); this.g.visible = false; scene.add(this.g);
  }

  update(t, { pos = [0, 0, 0], scale = 1, think = 0 } = {}) {
    this.g.visible = scale > 0.001; if (!this.g.visible) return;
    this.g.position.set(...pos); this.g.scale.setScalar(scale);
    const sp = 1 + 2 * think;
    this.rings.forEach((r, i) => r.rotation.set(t * 0.42 * sp * (i + 1) + i, t * 0.5 * sp + i * 1.3, i * 0.8));
    this.dots.forEach((d, i) => { const a = t * (0.8 + 0.15 * i) * sp + i * 0.63, R = 0.95 + 0.08 * Math.sin(i);
      d.position.set(Math.cos(a) * R, Math.sin(a * 1.3 + i) * 0.35, Math.sin(a) * R); });
    const p = 0.5 + 0.5 * Math.sin(t * 4 * sp);
    this.halo.scale.setScalar(1 + 0.25 * p * (0.4 + think)); this.halo.material.opacity = 0.12 + 0.2 * p * (0.3 + think);
    this.core.material.emissiveIntensity = 0.45 + 0.35 * think + 0.15 * p;
  }
}
