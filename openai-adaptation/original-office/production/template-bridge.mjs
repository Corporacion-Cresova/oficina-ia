// Trusted, finite Canvas bridge. No generated code, asset fetches or dynamic imports.
import {createHandDrawnStyle} from './hand-drawn-adapter.mjs';
export const templateCatalog=Object.freeze([
 Object.freeze({id:'annotated-benefit',engine:'canvas2d',source:'original-amano',status:'technical-template',audio:false}),
 Object.freeze({id:'problem-to-next-step',engine:'canvas2d',source:'original-amano',status:'technical-template',audio:false})
]);
const brands=new Set(['glowfy','velforce','quiba','purify','coden']);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
function text(v,max){return typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v)&&v.split(/\s+/).every(w=>w.length<=18);}
// Approval configuration comes from operator-controlled brand registry, NOT agent output.
export function compileTemplate(plan,approval){
 if(!exact(approval,['brand','sourceApproved','paletteApproved','palette'])||!brands.has(approval.brand)||approval.sourceApproved!==true||approval.paletteApproved!==true||!exact(approval.palette,['background','foreground','accent'])||!Object.values(approval.palette).every(color))throw Error('TRUSTED_BRAND_AND_SOURCE_APPROVAL_REQUIRED');
 if(!exact(plan,['brand','template','headline','detail','durationSeconds'])||plan.brand!==approval.brand||!templateCatalog.some(t=>t.id===plan.template)||!text(plan.headline,36)||!text(plan.detail,52)||!Number.isFinite(plan.durationSeconds)||plan.durationSeconds<3||plan.durationSeconds>10)throw Error('INVALID_TEMPLATE_PLAN');
 const p=structuredClone(plan),palette=structuredClone(approval.palette);
 const marker=createHandDrawnStyle({color:palette.accent,width:7});
 return Object.freeze({brand:p.brand,template:p.template,durationSeconds:p.durationSeconds,
  provenance:Object.freeze({source:'original-amano',geometry:'new-template-layout',voice:'none',externalAssets:false,commercialApproval:false}),
  draw(ctx,seconds){
   if(!Number.isFinite(seconds)||seconds<0||seconds>p.durationSeconds)throw Error('INVALID_TIME');
   // Fixed 540x960 logical layout. Caller may scale its context before rendering.
   const progress=Math.min(1,seconds/.7),drift=(1-progress)*18;
   ctx.save();
   try{
    ctx.fillStyle=palette.background;ctx.fillRect(0,0,540,960);
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=palette.foreground;
    ctx.font='bold 34px sans-serif';drawLines(ctx,p.headline,270,230+drift,38,18);
    ctx.fillStyle=palette.accent;ctx.fillRect(70,380,400,4);
    ctx.fillStyle=palette.foreground;ctx.font='26px sans-serif';drawLines(ctx,p.detail,270,520,34,24);
    if(p.template==='annotated-benefit'){
     marker.underline(ctx,Math.min(1,seconds/1.2),90,450,320);
     marker.check(ctx,Math.max(0,Math.min(1,(seconds-.8)/.7)),270,670,1.2);
    }else{
     marker.arrow(ctx,Math.max(0,Math.min(1,(seconds-.4)/1.1)),110,355,110,440);
     marker.underline(ctx,Math.max(0,Math.min(1,(seconds-1.3)/.8)),100,440,620);
    }
    ctx.font='14px sans-serif';ctx.fillStyle=palette.foreground;
    ctx.fillText('PRUEBA DE PLANTILLA · SIN VOZ · NO PUBLICAR',270,870);
   }finally{ctx.restore();}
  }
 });
}
function drawLines(ctx,value,x,y,height,max){
 const lines=[];let line='';for(const word of value.trim().split(/\s+/)){if(line&&line.length+1+word.length>max){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);
 lines.forEach((l,i)=>ctx.fillText(l,x,y+(i-(lines.length-1)/2)*height));
}
