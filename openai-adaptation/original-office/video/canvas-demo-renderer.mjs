import {rendererProfile,validateScriptForRenderer,validateVisualPlan,visualStyle} from './visual-contract.mjs';
import fs from 'node:fs/promises';import{randomUUID}from'node:crypto';import path from 'node:path';import {fileURLToPath}from'node:url';import {runBounded as run} from './canvas-demo/process-runner.mjs';
const worker=fileURLToPath(new URL('./canvas-demo/worker.mjs',import.meta.url));
export function createCanvasDemoRenderer({ffmpeg='ffmpeg',ffprobe='ffprobe',fontRegular='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',fontBold='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'}={}){
 return {
 profile:rendererProfile('canvas_demo'),
 async render({brief,brandContext,script,art,outDir}){
  if(brief.style!=='technical-canvas-demo')throw Error('Canvas demo requiere selección explícita technical-canvas-demo');
  const profile=rendererProfile('canvas_demo');validateScriptForRenderer(script,profile);if(art?.visualPlan)validateVisualPlan(art.visualPlan,script,profile);const style=art?.visualPlan?visualStyle(art.visualPlan):null;

  if(!Array.isArray(script.scenes)||script.scenes.length!==3)throw Error('Demo Canvas requiere tres escenas');
  const headings=script.scenes.map(s=>s.text),durations=script.scenes.map(s=>s.durationSeconds);
  if(headings.some(t=>typeof t!=='string'||t.length>45||t.split(/\s+/).some(w=>w.length>20))||headings[2].length>29||durations.some(n=>!Number.isFinite(n)||n<2||n>10))throw Error('Texto/tiempo excede límites de animática Canvas');
  const parent=await fs.lstat(outDir);if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('Directorio render inválido');outDir=path.join(outDir,`canvas-${randomUUID()}`);await fs.mkdir(outDir,{mode:0o700});const manifest=path.join(outDir,'canvas-demo-plan.json');await fs.writeFile(manifest,JSON.stringify({brandName:brandContext.name,headings,durations,outDir,ffmpeg,fontRegular,fontBold,style}),{mode:0o600});
  await run(process.execPath,['--max-old-space-size=256',worker,manifest]);
  const proof=JSON.parse(await fs.readFile(path.join(outDir,'render-proof.json'),'utf8'));
  return{file:path.join(outDir,'canvas-demo.mp4'),kind:'technical_canvas_demo',metadata:{...proof,branding:'neutral-unverified',productUI:'illustration-not-real-interface',publicationAllowed:false,visualPlanApplied:!!art?.visualPlan}};
 },
 async inspect(file){const p=JSON.parse(await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file]));const v=p.streams.find(s=>s.codec_type==='video'),audioPresent=p.streams.some(s=>s.codec_type==='audio');await run(ffmpeg,['-hide_banner','-loglevel','error','-threads','1','-i',file,'-f','null','-']);return{passed:!!v&&v.width===540&&v.height===960&&v.codec_name==='h264'&&v.avg_frame_rate==='24/1'&&!audioPresent,width:v?.width,height:v?.height,fps:v?.avg_frame_rate,codec:v?.codec_name,duration:Number(p.format.duration),decoded:true,audioPresent,visualInspected:false,commercialQuality:'not_verified'};}
 };
}
