import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
const script=new URL('../server-manual-production.mjs',import.meta.url).pathname;
const password='synthetic-only-fixture-password';
function req(port,url,body,auth=true,host='office.example.com') {return new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port,path:url,method:body?'POST':'GET',headers:{Host:host,...(auth?{Authorization:'Basic '+Buffer.from('jorge:'+password).toString('base64')}:{}),'Content-Type':'application/json'}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text}));});r.on('error',reject);r.end(body?JSON.stringify(body):undefined);});}
const env=(dir,port)=>({PATH:process.env.PATH,OFFICE_PASSWORD:password,OFFICE_ORIGIN:'https://office.example.com',OFFICE_DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(port)});
async function start(environment) {const child=spawn(process.execPath,[script],{env:environment,stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',()=>reject(new Error('startup failed')));});return child;}
async function stop(child){await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});}
test('production entrypoint refuses insecure origin, missing secret and enabled model without leaking values',()=>{
for(const override of [{OFFICE_ORIGIN:'http://office.example.com'},{OFFICE_PASSWORD:''},{OPENAI_API_KEY:'synthetic-not-real-key'},{OFFICE_ENABLE_CHATGPT_DRAFTS:'1'}]){
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-prod-'));try {const r=spawnSync(process.execPath,[script],{env:{...env(dir,3000),...override},encoding:'utf8',timeout:3000});assert.equal(r.status,1);assert.ok(!r.stderr.includes(password));assert.ok(!r.stderr.includes('synthetic-not-real-key'));}finally{fs.rmSync(dir,{recursive:true,force:true});}}
});
test('production manual entrypoint authenticates, rejects AI and persists across actual process restart',async()=>{
const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-prod-'));let child;
try {child=await start(env(dir,port));assert.equal((await req(port,'/health',null,false)).status,200);assert.equal((await req(port,'/',null,false)).status,401);assert.equal((await req(port,'/api/tasks',null,true,'wrong.example.com')).status,403);const status=JSON.parse((await req(port,'/api/status')).text);assert.equal(status.functionalOffice,false);assert.equal(status.inferenceConnected,false);assert.equal((await req(port,'/api/assistant/draft',{prompt:'test'})).status,503);assert.equal((await req(port,'/api/tasks',{title:'Synthetic persisted task'})).status,201);await stop(child);child=null;child=await start(env(dir,port));assert.equal(JSON.parse((await req(port,'/api/tasks')).text).tasks[0].title,'Synthetic persisted task');}finally{if(child)await stop(child);fs.rmSync(dir,{recursive:true,force:true});}
});
test('manual image copies no model runtime or original source and runs unprivileged',()=>{
const docker=fs.readFileSync(new URL('../Dockerfile.manual',import.meta.url),'utf8');assert.match(docker,/USER node/);assert.match(docker,/HEALTHCHECK/);assert.match(docker,/EXPOSE 3000/);assert.ok(!/COPY.*(?:server-chatgpt|chatgpt-runtime|\. \.|\.\/ \.)/.test(docker));assert.ok(!/npm install|npm ci|codex|claude/i.test(docker));
});
