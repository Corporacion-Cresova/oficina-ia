import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createLocalRenderer} from './video/local-renderer.mjs';
test('all FFmpeg text files disable expansion including brand and technical label',async()=>{const s=await fs.readFile(new URL('./video/local-renderer.mjs',import.meta.url),'utf8');assert.equal((s.match(/drawtext=/g)||[]).length,3);assert.equal((s.match(/expansion=none/g)||[]).length,3);});
test('real FFmpeg frame renders percent text literally, not a decoded empty card',async()=>{
 const d=await fs.mkdtemp(path.join(os.tmpdir(),'literal-percent-'));try{
 const render=createLocalRenderer();const result=await render.render({brandContext:{name:'Marca 50%'},script:{scenes:[{text:'Ahorra 50% hoy',durationSeconds:2}]},outDir:d});assert.equal((await render.inspect(result.file)).passed,true);
 const frame=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-ss','1','-i',result.file,'-vf','crop=320:200:20:220','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:1024*1024});assert.equal(frame.status,0,frame.stderr.toString());
 // At least 150 near-white pixels in the center crop prove glyphs actually exist.
 // Background and accent bar are outside the threshold/crop. Decode pass alone is not enough.
 let ink=0;for(let i=0;i<frame.stdout.length;i+=3)if(frame.stdout[i]>210&&frame.stdout[i+1]>210&&frame.stdout[i+2]>210)ink++;assert.ok(ink>150,`No visible central text: ${ink}`);
 assert.equal(await fs.readFile(path.join(d,'scene-0.txt'),'utf8'),'Ahorra 50% hoy');
 }finally{await fs.rm(d,{recursive:true,force:true});}
});
