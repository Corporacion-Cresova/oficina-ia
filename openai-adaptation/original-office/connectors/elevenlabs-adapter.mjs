// Opt-in execution boundary. No concrete transport, environment access or credentials.
import {createHash} from 'node:crypto';
import {speechPlan} from './contracts.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Error(code)};
export function createElevenLabsAdapter({provider,resolveConnection,authorize,ledger,enabled=false,now=()=>Date.now(),maxAudioBytes=20*1024*1024}={}){
 return Object.freeze({
  async synthesize(input){
   if(!enabled||input?.optIn!==true)fail('VOICE_DISABLED');
   if(!provider||typeof provider.convert!=='function'||typeof resolveConnection!=='function'||typeof authorize!=='function'||!ledger?.reserve||!ledger?.finish)fail('VOICE_DEPENDENCIES_MISSING');
   // Recreate immutable scope rather than trusting a caller's hash.
   const p=speechPlan({...input,paidConsent:false});
   if(typeof input.connectionId!=='string'||!input.connectionId||input.connectionId.length>256)fail('CONNECTION_REQUIRED');
   const connection=await resolveConnection(input.connectionId);
   if(!connection||connection.provider!=='elevenlabs'||connection.verified!==true||connection.brandId!==p.brandId||connection.id!==input.connectionId||typeof connection.accountId!=='string'||!connection.accountId||connection.expiresAt<=now()||!Number.isFinite(connection.expiresAt))fail('CONNECTION_UNVERIFIED');
   // Trusted provider-side voice catalog, not a client claim of authorization.
   if(!Array.isArray(connection.authorizedCatalogVoices)||!connection.authorizedCatalogVoices.includes(p.voiceId))fail('VOICE_UNAUTHORIZED');
   if(!Number.isFinite(input.maxCredits)||input.maxCredits<=0)fail('CREDIT_LIMIT_REQUIRED');
   const scope=Object.freeze({action:'elevenlabs-speech',planHash:p.planHash,brandId:p.brandId,jobId:p.jobId,version:p.version,connectionId:connection.id,accountId:connection.accountId,maxCredits:input.maxCredits});
   const scopeHash=hash(JSON.stringify(scope));
   // authorize must retrieve server-owned approval, never accept browser approval JSON.
   const approval=await authorize(scopeHash,scope);
   if(!approval||approval.owner!=='jorge'||approval.decision!=='approve'||approval.scopeHash!==scopeHash||approval.creditsAuthorized!==true||!Number.isFinite(approval.expiresAt)||approval.expiresAt<=now())fail('CREDIT_APPROVAL_REQUIRED');
   const key=hash(JSON.stringify({planHash:p.planHash,accountId:connection.accountId,connectionId:connection.id}));
   // Reserve must be atomic and persistent. A prior unknown request is NOT retryable.
   if(await ledger.reserve(key,{scopeHash,brandId:p.brandId,jobId:p.jobId,version:p.version,state:'in_flight'})!==true)fail('RECONCILE_PRIOR_ATTEMPT');
   let result;
   try{
    result=await provider.convert(Object.freeze({text:p.text,voiceId:p.voiceId,modelId:p.modelId,connectionId:connection.id,accountId:connection.accountId,maxCredits:scope.maxCredits,idempotencyKey:key}));
    if(!result||!Buffer.isBuffer(result.audio)||result.audio.length===0||result.audio.length>maxAudioBytes||result.mimeType!=='audio/mpeg'||!Number.isFinite(result.creditsUsed)||result.creditsUsed<0||result.creditsUsed>scope.maxCredits||typeof result.requestId!=='string'||!result.requestId)fail('PROVIDER_RESULT_INVALID');
    const artifactHash=hash(result.audio);
    await ledger.finish(key,{state:'complete',requestId:result.requestId,creditsUsed:result.creditsUsed,artifactHash});
    return {brandId:p.brandId,jobId:p.jobId,version:p.version,planHash:p.planHash,audio:Buffer.from(result.audio),mimeType:result.mimeType,artifactHash,creditsUsed:result.creditsUsed,requestId:result.requestId,publicationApproved:false};
   }catch{
    // Redact provider exceptions: may contain keys/URLs. Ambiguous failure requires reconciliation.
    try{await ledger.finish(key,{state:'unknown',reason:'provider_or_persistence_failure'});}catch{}
    fail('VOICE_OUTCOME_UNKNOWN_RECONCILE');
   }
  }
 });
}
