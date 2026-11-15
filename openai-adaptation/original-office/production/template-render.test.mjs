// Technical local integration proof only, not an active worker or brand-approved creative.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';import {compileTemplate,templateCatalog} from './template-bridge.mjs';
const {createCanvas}=createRequire(import.meta.url)('@napi-rs/canvas');
for(const {id} of templateCatalog)test(`real MP4 of trusted original-primitives template ${id}`,{timeout:120000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'original-template-'));const output=path.join(dir,'preview.mp4');let child;
 try{
 const template=compileTemplate({brand:'glowfy',template:id,headline:'Prueba de plantilla',detail:'Siguiente paso ilustrado',durationSeconds:3},{brand:'glowfy',sourceApproved:true,paletteApproved:true,palette:{background:'#192035',foreground:'#ffffff',accent:'#d7b59a'}});
 const canvas=createCanvas(540,960),ctx=canvas.getContext('2d');child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','24','-i','pipe:0','-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',output],{stdio:['pipe','ignore','pipe']});let stderr='';child.stderr.on('data',b=>stderr=(stderr+b).slice(-4096));const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',c=>c===0?resolve():reject(Error(stderr)));});done.catch(()=>{});child.stdin.on('error',()=>{});
 for(let n=0;n<72;n++){template.draw(ctx,n/24);if(!child.stdin.write(canvas.toBuffer('image/png')))await Promise.race([once(child.stdin,'drain'),done.then(()=>{throw Error('early close')})]);}child.stdin.end();await done;
 const p=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{maxBuffer:1024*1024});assert.equal(p.status,0);const meta=JSON.parse(p.stdout),v=meta.streams.find(s=>s.codec_type==='video');assert.equal(v.width,540);assert.equal(v.height,960);assert.equal(v.nb_frames,'72');assert.equal(v.avg_frame_rate,'24/1');assert.equal(meta.streams.some(s=>s.codec_type==='audio'),false);
 const decode=spawnSync('ffmpeg',['-v','error','-threads','1','-i',output,'-f','null','-'],{timeout:10000});assert.equal(decode.status,0,decode.stderr.toString());assert.equal(template.provenance.commercialApproval,false);
 }finally{child?.kill('SIGKILL');await fs.rm(dir,{recursive:true,force:true});}
});
