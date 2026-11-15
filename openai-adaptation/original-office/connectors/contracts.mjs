// Planning contracts only. No transport, credentials, OAuth, generation or publication.
import {createHash} from 'node:crypto';
const brands=new Set(['glowfy','velforce','quiba','purify','coden']);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const str=(x,n=256)=>typeof x==='string'&&x.length>0&&x.length<=n;
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function requireThat(x,reason){if(!x)throw Error(reason);}
function base(x){requireThat(x&&brands.has(x.brandId)&&str(x.jobId)&&Number.isSafeInteger(x.version)&&x.version>0,'INVALID_JOB');}
export function speechPlan(x){
 base(x);requireThat(str(x.text,5000)&&str(x.voiceId)&&str(x.modelId),'INVALID_SPEECH');
 // Cloned/custom voices are deliberately unsupported by this initial contract.
 requireThat(x.voiceProvenance==='licensed-catalog'&&x.voiceUseAuthorized===true,'VOICE_AUTHORIZATION_REQUIRED');
 requireThat(x.paidConsent===false,'PAID_EXECUTION_NOT_IMPLEMENTED');
 const scope={type:'speech',brandId:x.brandId,jobId:x.jobId,version:x.version,text:x.text,voiceId:x.voiceId,modelId:x.modelId,voiceProvenance:x.voiceProvenance};
 return Object.freeze({schemaVersion:1,...scope,planHash:hash(scope),status:'planning_only',executionEnabled:false,blockers:['verified-provider-connection','cost-estimate-and-explicit-consent','trusted-execution-adapter']});
}
export function publicationPlan(x){
 base(x);requireThat(['instagram','facebook','tiktok'].includes(x.platform)&&str(x.accountId),'INVALID_DESTINATION');
 requireThat(digest(x.artifactHash)&&typeof x.caption==='string'&&x.caption.length<=2200,'INVALID_CONTENT');
 requireThat(x.artifactKind==='production'&&x.artifactReviewed===true,'TECHNICAL_DEMO_NOT_PUBLISHABLE');
 requireThat(x.scheduleAt===null||(typeof x.scheduleAt==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x.scheduleAt)&&Number.isFinite(Date.parse(x.scheduleAt))),'TIMEZONE_REQUIRED');
 requireThat(['public','private','followers'].includes(x.visibility),'VISIBILITY_REQUIRED');
 const scope={type:'publication',brandId:x.brandId,jobId:x.jobId,version:x.version,platform:x.platform,accountId:x.accountId,artifactHash:x.artifactHash,caption:x.caption,scheduleAt:x.scheduleAt,visibility:x.visibility};
 return Object.freeze({schemaVersion:1,...scope,planHash:hash(scope),status:'planning_only',executionEnabled:false,blockers:['verified-brand-account-binding','provider-permissions','owner-publication-approval','trusted-execution-adapter']});
}
// This compares server-trusted approval records, never authenticates browser JSON.
export function approvalMatches(plan,record,now=Date.now()){
 return !!(record&&record.owner==='jorge'&&record.action===plan.type&&record.planHash===plan.planHash&&record.decision==='approve'&&Number.isFinite(record.expiresAt)&&record.expiresAt>now);
}
export function retryDisposition(state){
 if(['submitted','processing','unknown','published'].includes(state))return 'reconcile_do_not_resubmit';
 if(state==='not_attempted')return 'requires_live_adapter_and_owner_approval';
 return 'manual_review';
}
export function capabilities(){return {mode:'planning_only',network:false,speech:false,voiceCloning:false,publish:false,schedule:false,credentialsAccepted:false};}
