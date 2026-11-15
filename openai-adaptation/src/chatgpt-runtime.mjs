import path from 'node:path';import fs from 'node:fs';import {spawn} from 'node:child_process';
import {attachStdio} from './stdio-transport.mjs';import {OfficeAdapter} from './adapter.mjs';import {OfficeEventStream} from './event-stream.mjs';
// Explicit process factory for operators, NEVER called by server-safe.mjs.
// Login must first be completed by the owner using official Codex in this isolated home.
export function launchIsolatedCodex({ binary, home, workspace, enabled = false }) {
 if (!enabled) throw new Error('EXPLICIT_OPERATOR_ENABLE_REQUIRED');
 for(const p of [binary,home,workspace])if(!path.isAbsolute(p||''))throw new Error('ABSOLUTE_PATHS_REQUIRED');
 const root=fs.realpathSync(home);if(root!==home || fs.lstatSync(home).isSymbolicLink())throw new Error('ISOLATED_HOME_REQUIRED');
 // No inherited config, plugins, skills, MCP or alternative providers.
 const permitted = new Set(['auth.json']);
 for(const name of fs.readdirSync(home))if(!permitted.has(name))throw new Error('HOME_NOT_CLEAN');
 if(!fs.existsSync(path.join(home,'auth.json')))throw new Error('OWNER_CHATGPT_LOGIN_REQUIRED');
 if(fs.lstatSync(path.join(home,'auth.json')).isSymbolicLink())throw new Error('AUTH_SYMLINK_REJECTED');
 const auth=JSON.parse(fs.readFileSync(path.join(home,'auth.json'),'utf8'));
 if(auth.OPENAI_API_KEY)throw new Error('API_CREDENTIAL_REJECTED');
 // Workspace must be empty to avoid project config, AGENTS or arbitrary skills.
 if(fs.readdirSync(workspace).length)throw new Error('EMPTY_WORKSPACE_REQUIRED');
 return spawn(binary,['app-server','--listen','stdio://'],{cwd:workspace,env:{PATH:path.dirname(binary),HOME:home,CODEX_HOME:home,LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
}
export class ChatGPTDraftRuntime {
 constructor({ childFactory, workspace, model, timeoutMs = 60000 }) {
  if(typeof childFactory!=='function')throw new Error('EXPLICIT_TRANSPORT_FACTORY_REQUIRED');
  this.factory=childFactory;this.workspace=workspace;this.model=model;this.timeoutMs=timeoutMs;this.connection=null;this.busy=false;this.inferenceVerified=false;
 }
 status(){return {transportConnected:!!this.connection && !this.connection.rpc.closed,chatgptAccountObserved:!!this.adapter?.ready,inferenceConnected:!!this.adapter?.ready && this.inferenceVerified,accountKind:this.adapter?.ready?'chatgpt':null,externalActionsEnabled:false,paidApiEnabled:false,busy:this.busy};}
 async connect(){
  if(this.connection)throw new Error('ALREADY_CONNECTED');
  try {
   this.connection=attachStdio(this.factory());
   this.adapter=new OfficeAdapter(this.connection.rpc,{workspace:this.workspace,model:this.model,env:{}});
   this.connection.rpc.on('closed',()=>{if(this.adapter)this.adapter.ready=false;});
   await this.adapter.initialize();return this.status();
  }catch(e){this.close();throw new Error('CHATGPT_CONNECTION_UNAVAILABLE');}
 }
 async draft(prompt){
  if(!this.adapter?.ready)throw new Error('CHATGPT_LOGIN_REQUIRED');
  if(this.busy)throw new Error('DRAFT_ALREADY_RUNNING');
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>4000)throw new Error('INVALID_PROMPT');
  this.busy=true;this.controller=new AbortController();
  this.active=new OfficeEventStream(this.adapter,{timeoutMs:this.timeoutMs,instructions:'Draft text only. Do not use tools, shell, files, network, delegation or perform external actions. Never claim actions were completed.'});
  let output='';
  try{for await(const e of this.active.stream(prompt,{signal:this.controller.signal})){if(e.type==='result'){if(e.subtype!=='success')throw new Error('DRAFT_FAILED');output=e.result;}}this.inferenceVerified=true;return {text:output,source:'chatgpt-app-server',toolApprovalPolicy:'deny-all-server-requests'};}
  finally{this.busy=false;this.controller=null;this.active=null;}
 }
 cancel(){this.controller?.abort();}
 close(){this.inferenceVerified=false;this.cancel();this.connection?.close();this.connection=null;if(this.adapter)this.adapter.ready=false;}
}
