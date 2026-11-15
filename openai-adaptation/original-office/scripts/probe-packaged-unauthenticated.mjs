// Reproducible transport probe only. Fresh temporary HOME, no login or inference.
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {attachStdio} from '../codex/stdio-transport.mjs';
import {textOnlyArgs} from '../codex/text-only-config.mjs';
const binary=process.argv[2]||'/usr/local/bin/codex';
if(!path.isAbsolute(binary))throw Error('ABSOLUTE_BINARY_REQUIRED');
const version=execFileSync(binary,['--version'],{encoding:'utf8',env:{PATH:path.dirname(binary),LANG:'C.UTF-8'}}).trim();
if(version!=='codex-cli 0.167.0-alpha.4')throw Error('PINNED_VERSION_MISMATCH');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'office-runtime-probe-'));const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'office-probe-workspace-'));
const child=spawn(binary,textOnlyArgs(),{cwd:workspace,env:{HOME:home,CODEX_HOME:home,PATH:path.dirname(binary),LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
const ended=new Promise(resolve=>child.once('exit',resolve));const transport=attachStdio(child,{timeoutMs:8000});
try{
 await transport.rpc.request('initialize',{clientInfo:{name:'office-packaging-probe',version:'0.1.0'}});transport.rpc.send({method:'initialized'});
 const account=await transport.rpc.request('account/read',{refreshToken:false});if(account.account!==null)throw Error('FRESH_PROBE_UNEXPECTED_ACCOUNT');
 console.log(JSON.stringify({version,initialize:true,account:null,authenticationRequired:account.requiresOpenaiAuth,loginPerformed:false,inferencePerformed:false,toolIsolationVerified:false}));
}catch{console.error('Unauthenticated compatibility probe failed. No login/inference attempted.');process.exitCode=1;}
finally{transport.close();await Promise.race([ended,new Promise(r=>setTimeout(r,1000))]);fs.rmSync(home,{recursive:true,force:true});fs.rmSync(workspace,{recursive:true,force:true});}
