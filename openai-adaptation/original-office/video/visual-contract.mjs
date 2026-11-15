// Finite trusted templates only. No code, URLs, paths, external assets or brand palette inference.
const profiles={
 ffmpeg_text:{id:'ffmpeg_text',template:'text-cards',minScenes:1,maxScenes:8,maxText:140,finalMaxText:140,maxWord:24,lineWidth:24,maxLines:6,minSeconds:2,maxSeconds:10,totalSeconds:60},
 canvas_demo:{id:'canvas_demo',template:'phone-cards-demo',minScenes:3,maxScenes:3,maxText:45,finalMaxText:29,maxWord:20,lineWidth:20,maxLines:3,minSeconds:2,maxSeconds:10,totalSeconds:30}
};
export const visualPlanSchema={type:'object',additionalProperties:false,required:['template','palette','motion','scenes'],properties:{template:{type:'string',enum:['text-cards','phone-cards-demo']},palette:{type:'string',enum:['neutral-slate','neutral-warm']},motion:{type:'string',enum:['soft','snappy']},scenes:{type:'array',items:{type:'object',additionalProperties:false,required:['index','composition'],properties:{index:{type:'integer'},composition:{type:'string',enum:['centered-text','phone-cards','closing-card']}}}}}};
export function rendererProfile(id){if(!Object.hasOwn(profiles,id))throw Error('UNKNOWN_RENDERER_PROFILE');return structuredClone(profiles[id]);}
export function validateScriptForRenderer(script,p){
 const expected=rendererProfile(p?.id);if(JSON.stringify(expected)!==JSON.stringify(p))throw Error('UNTRUSTED_RENDERER_PROFILE');
 if(!Array.isArray(script?.scenes)||script.scenes.length<p.minScenes||script.scenes.length>p.maxScenes)throw Error('SCENE_COUNT_FOR_RENDERER');let total=0;
 script.scenes.forEach((s,i)=>{if(typeof s.text!=='string'||!s.text.trim()||s.text.length>(i===script.scenes.length-1?p.finalMaxText:p.maxText)||!Number.isFinite(s.durationSeconds)||s.durationSeconds<p.minSeconds||s.durationSeconds>p.maxSeconds)throw Error('SCENE_CONTENT_FOR_RENDERER');let lines=1,n=0;for(const w of s.text.trim().split(/\s+/)){if(w.length>p.maxWord)throw Error('WORD_TOO_WIDE');if(n&&n+1+w.length>p.lineWidth){lines++;n=w.length;}else n+=(n?1:0)+w.length;}if(lines>p.maxLines)throw Error('TEXT_TOO_DENSE');total+=s.durationSeconds;});if(total>p.totalSeconds)throw Error('DURATION_FOR_RENDERER');return true;
}
export function validateVisualPlan(plan,script,p){
 validateScriptForRenderer(script,p);if(!plan||typeof plan!=='object'||Array.isArray(plan)||Object.keys(plan).sort().join(',')!=='motion,palette,scenes,template'||plan.template!==p.template||!['neutral-slate','neutral-warm'].includes(plan.palette)||!['soft','snappy'].includes(plan.motion)||!Array.isArray(plan.scenes)||plan.scenes.length!==script.scenes.length)throw Error('INVALID_VISUAL_PLAN');
 plan.scenes.forEach((s,i)=>{const expected=p.id==='ffmpeg_text'?'centered-text':i===script.scenes.length-1?'closing-card':'phone-cards';if(!s||Object.keys(s).sort().join(',')!=='composition,index'||s.index!==i||s.composition!==expected)throw Error('UNSUPPORTED_COMPOSITION');});return true;
}
export function visualStyle(plan){return {background:plan.palette==='neutral-warm'?'#241b18':'#11182b',accent:plan.palette==='neutral-warm'?'#d7b59a':'#8e9fff',transition:plan.motion==='soft'?.45:.2};}
