// Separate opt-in entrypoint. NEVER imported by server-safe or upstream server.
// Deployment/operator must validate OS sandbox and official binary before enabling.
import {ChatGPTDraftRuntime,launchIsolatedCodex} from './src/chatgpt-runtime.mjs';
import {createOffice} from './src/safe-office.mjs';
if(process.env.OFFICE_ENABLE_CHATGPT_DRAFTS!=='1')throw new Error('CHATGPT_DRAFTS_NOT_EXPLICITLY_ENABLED');
if(process.env.OFFICE_HOST_ISOLATION_VERIFIED!=='1')throw new Error('HOST_ISOLATION_NOT_VERIFIED');
for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY','AZURE_OPENAI_API_KEY'])if(process.env[key])throw new Error('PAID_CREDENTIAL_NOT_ALLOWED');
const {OFFICE_CODEX_BINARY:binary,OFFICE_CODEX_HOME:home,OFFICE_MODEL:model,OFFICE_WORKSPACE:workspace}=process.env;
const runtime=new ChatGPTDraftRuntime({childFactory:()=>launchIsolatedCodex({binary,home,workspace,enabled:true}),workspace,model});
let server;
try {
 await runtime.connect();
 server=createOffice({password:process.env.OFFICE_PASSWORD,dataDir:process.env.OFFICE_DATA_DIR,publicOrigin:process.env.OFFICE_ORIGIN||'',draftRuntime:runtime});
 server.on('error',()=>{runtime.close();process.exitCode=1;});
 server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Authenticated draft transport connected. No inference verified yet. Full office migration incomplete.'));
} catch {runtime.close();console.error('ChatGPT draft service not started: validate isolated login, configuration and required settings.');process.exitCode=1;}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{runtime.close();server?.close(()=>process.exit(0));server?.closeAllConnections();});
