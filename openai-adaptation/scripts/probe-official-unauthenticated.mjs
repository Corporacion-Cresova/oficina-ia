// Explicit compatibility probe. No login, model list, thread or turn is requested.
// Fresh HOME/CODEX_HOME and allowlisted environment; never reads existing auth.
import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {attachStdio} from '../src/stdio-transport.mjs';
const binary=process.argv[2];if(!binary||!path.isAbsolute(binary))throw new Error('Pass absolute path of trusted official Codex binary');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'office-unauth-home-'));const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'office-empty-workspace-'));
const child=spawn(binary,['app-server','--listen','stdio://'],{cwd:workspace,env:{HOME:home,CODEX_HOME:home,PATH:path.dirname(binary)+':/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
const transport=attachStdio(child,{timeoutMs:10000});
try{
const init=await transport.rpc.request('initialize',{clientInfo:{name:'office-compatibility-check',title:'Office compatibility check',version:'0.1.0'}});
transport.rpc.send({method:'initialized'});
const account=await transport.rpc.request('account/read',{refreshToken:false});
if(account.account!==null)throw new Error('Unexpected account in isolated unauthenticated probe');
console.log(JSON.stringify({initialize:'passed',responseKeys:Object.keys(init),account:null,requiresOpenaiAuth:account.requiresOpenaiAuth,loginPerformed:false,inferencePerformed:false}));
}finally{transport.close();}
