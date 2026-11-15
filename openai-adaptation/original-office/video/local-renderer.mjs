import {rendererProfile,validateScriptForRenderer,validateVisualPlan,visualStyle} from './visual-contract.mjs';
// Original project-local preview renderer. No copyrighted skill implementation is bundled.
// FFmpeg primitives only, no AI, network, voice or third-party assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
function command(bin,args,opts={}){return new Promise((resolve,reject)=>{const p=spawn(bin,args,{...opts,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{p.kill('SIGKILL');reject(new Error('Render timeout'));},120000);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err=(err+d).slice(-4000));p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',c=>{clearTimeout(timer);c===0?resolve(out):reject(new Error(`${bin} failed (${c}): ${err}`));});});}
function wrap(text,width=24){const words=text.trim().split(/\s+/),lines=[''];for(const w of words){if(w.length>width)throw new Error('Texto contiene palabra demasiado larga');let i=lines.length-1;if(lines[i].length&&lines[i].length+w.length+1>width)lines.push(w);else lines[i]+=(lines[i]?' ':'')+w;}if(lines.length>6)throw new Error('Texto demasiado denso para vista móvil');return lines.join('\n');}
export function createLocalRenderer({ffmpeg='ffmpeg',ffprobe='ffprobe',fontFile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'}={}){return {
 profile:rendererProfile('ffmpeg_text'),
 async render({brandContext,script,art,outDir}){
  const profile=rendererProfile('ffmpeg_text');validateScriptForRenderer(script,profile);if(art?.visualPlan)validateVisualPlan(art.visualPlan,script,profile);const style=art?.visualPlan?visualStyle(art.visualPlan):{background:'#11182b',accent:'#8e9fff',transition:.3};
  await fs.access(fontFile);await fs.mkdir(outDir,{recursive:true});const files=[];let seconds=0;
  await fs.writeFile(path.join(outDir,'brand.txt'),brandContext.name);await fs.writeFile(path.join(outDir,'label.txt'),'ANIMÁTICA · SIN VOZ');
  for(let i=0;i<script.scenes.length;i++){
   const s=script.scenes[i];await fs.writeFile(path.join(outDir,`scene-${i}.txt`),wrap(s.text));
   const fade=Math.min(style.transition,s.durationSeconds/4);const font=fontFile.replace(/:/g,'\\:');
   const filter=`drawbox=x=36:y=118:w=288:h=4:color=${style.accent.replace('#','0x')}:t=fill,drawtext=fontfile=${font}:textfile=brand.txt:expansion=none:fontcolor=white:fontsize=24:x=36:y=64,drawtext=fontfile=${font}:textfile=scene-${i}.txt:expansion=none:fontcolor=white:fontsize=23:line_spacing=12:x=(w-text_w)/2:y=(h-text_h)/2,drawtext=fontfile=${font}:textfile=label.txt:expansion=none:fontcolor=0x9aa4b9:fontsize=13:x=(w-text_w)/2:y=575,fade=t=in:st=0:d=${fade},fade=t=out:st=${s.durationSeconds-fade}:d=${fade}`;
   const file=`scene-${i}.mp4`;files.push(file);seconds+=s.durationSeconds;
   await command(ffmpeg,['-hide_banner','-loglevel','error','-y','-threads','1','-filter_threads','1','-f','lavfi','-i',`color=c=${style.background.replace('#','0x')}:s=360x640:r=30:d=${s.durationSeconds}`,'-vf',filter,'-c:v','libx264','-threads','1','-preset','ultrafast','-pix_fmt','yuv420p','-an',file],{cwd:outDir});
  }
  await fs.writeFile(path.join(outDir,'concat.txt'),files.map(f=>`file '${f}'`).join('\n'));
  const file=path.join(outDir,'preview.mp4');await command(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','1','-i','concat.txt','-c','copy','-movflags','+faststart','preview.mp4'],{cwd:outDir});
  return {file,kind:'silent_animatic',metadata:{width:360,height:640,fps:30,duration:seconds,audio:false,engine:'ffmpeg-local',aiGenerated:false,branding:'neutral-preview-not-approved-brand-style',visualPlanApplied:!!art?.visualPlan}};
 },
 async inspect(file){const raw=await command(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file]);const p=JSON.parse(raw),v=p.streams.find(s=>s.codec_type==='video');await command(ffmpeg,['-hide_banner','-loglevel','error','-threads','1','-i',file,'-f','null','-']);return {passed:!!v&&v.width===360&&v.height===640&&v.codec_name==='h264'&&Number(p.format.duration)>0,width:v?.width,height:v?.height,duration:Number(p.format.duration),codec:v?.codec_name,decoded:true,audioPresent:p.streams.some(s=>s.codec_type==='audio'),visualInspected:false};}
};}
