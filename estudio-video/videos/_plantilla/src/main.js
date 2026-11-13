import { W, H, scenes } from './data.js';
import { loadAssets } from './cresova.js';
const scale = Number(new URLSearchParams(location.search).get('scale')) || 1;
const canvas = document.getElementById('c');
canvas.width = Math.max(2, 2 * Math.round(W * scale / 2));
canvas.height = Math.max(2, 2 * Math.round(H * scale / 2));
const ctx = canvas.getContext('2d');
await loadAssets();
const mods = await Promise.all(scenes.map(s => import(`./scenes/${s.mod || s.id}.js`)));
await Promise.all(mods.map(m => m.init?.({ W, H, scale })));
await document.fonts.ready;
window.renderFrame = async t => {
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  for (let i=0;i<scenes.length;i++) {
    const s=scenes[i];if(t<s.start || t>=s.end)continue;
    ctx.save();ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
    // `scene` lleva los parámetros propios de la escena (p. ej. combinación de fuentes).
    await mods[i].draw(ctx,t-s.start,{W,H,scale,dur:s.end-s.start,t,scene:s});ctx.restore();
  }
};
window.grab=(type,quality=.95)=>canvas.toDataURL(type,quality);
window.__ready=true;
