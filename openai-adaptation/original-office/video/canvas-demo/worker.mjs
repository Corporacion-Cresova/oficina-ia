import fs from 'node:fs/promises';import path from 'node:path';import{createRequire}from'node:module';import{spawn}from'node:child_process';import{once}from'node:events';import{draw}from'./scene.mjs';
const [manifest]=process.argv.slice(2);const config=JSON.parse(await fs.readFile(manifest,'utf8'));
const {createCanvas,GlobalFonts}=createRequire(import.meta.url)('@napi-rs/canvas');
if(!GlobalFonts.registerFromPath(config.fontRegular,'DejaVu Sans')||!GlobalFonts.registerFromPath(config.fontBold,'DejaVu Sans'))throw Error('Fuentes locales requeridas');
const W=540,H=960,fps=24,duration=config.durations.reduce((a,b)=>a+b,0),canvas=createCanvas(W,H),ctx=canvas.getContext('2d');
const options={W,H,headings:config.headings,durations:config.durations,brandName:config.brandName,style:config.style};
const child=spawn(config.ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-crf','20','-movflags','+faststart',path.join(config.outDir,'canvas-demo.mp4')],{stdio:['pipe','ignore','pipe']});let errors='';child.stderr.on('data',d=>errors=(errors+d).slice(-3000));const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(`Encoder failed ${code}: ${errors}`)));});done.catch(()=>{});child.stdin.on('error',()=>{});
let timer=setTimeout(()=>child.kill('SIGKILL'),110000);const cleanup=()=>{child.kill('SIGKILL');process.exit(1);};process.once('SIGTERM',cleanup);process.once('SIGINT',cleanup);
try{
 for(let i=0;i<Math.ceil(fps*duration);i++){draw(ctx,i/fps,options);const frame=canvas.toBuffer('image/png');if([24,72,120].includes(i))await fs.writeFile(path.join(config.outDir,`frame-${i}.png`),frame);if(child.stdin.destroyed)throw Error('Encoder input closed');if(!child.stdin.write(frame))await Promise.race([once(child.stdin,'drain'),done.then(()=>{throw Error('Encoder closed early');})]);}child.stdin.end();await done;
 for(const t of [0,1,3,5]){draw(ctx,t,options);const a=canvas.toBuffer('image/png');draw(ctx,duration-t,options);draw(ctx,t,options);if(!a.equals(canvas.toBuffer('image/png')))throw Error('Non deterministic seek');}
 await fs.writeFile(path.join(config.outDir,'render-proof.json'),JSON.stringify({frames:Math.ceil(fps*duration),fps,duration,width:W,height:H,deterministicSeeks:true,audio:false,aiGenerated:false,kind:'technical_canvas_demo'},null,2));
}finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');}
