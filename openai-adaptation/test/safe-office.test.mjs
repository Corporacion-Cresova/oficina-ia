import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createOffice } from '../src/safe-office.mjs';
const password = 'test-only-not-a-production-secret';
const authorization = `Basic ${Buffer.from(`jorge:${password}`).toString('base64')}`;
async function fixture(t, dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'office-tests-'))) {
  const server = createOffice({ password, dataDir }); server.listen(0, '127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return { url:`http://127.0.0.1:${server.address().port}`, dataDir, server };
}
test('no password fails before listening',()=>assert.throws(()=>createOffice({dataDir:'/tmp/test'}),/PASSWORD_REQUIRED/));
test('relative data directory rejected',()=>assert.throws(()=>createOffice({password,dataDir:'data'}),/ABSOLUTE/));
test('health is alive only, not functional readiness',async t=>{const f=await fixture(t);const r=await fetch(f.url+'/health');assert.deepEqual(await r.json(),{service:'office-integration-scaffold',alive:true});});
test('status requires password',async t=>{const f=await fixture(t);assert.equal((await fetch(f.url+'/api/status')).status,401);});
test('wrong and malformed authorization rejected',async t=>{const f=await fixture(t);for(const a of ['Basic garbage','Bearer x',`Basic ${Buffer.from('jorge:bad').toString('base64')}`])assert.equal((await fetch(f.url+'/api/status',{headers:{authorization:a}})).status,401);});
test('status never claims inference or office readiness',async t=>{const f=await fixture(t);const r=await fetch(f.url+'/api/status',{headers:{authorization}});const s=await r.json();for(const k of ['functionalOffice','inferenceConnected','externalActionsEnabled','paidApiEnabled'])assert.equal(s[k],false);});
test('task creation and recovery after restart',async t=>{const f=await fixture(t);const r=await fetch(f.url+'/api/tasks',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({title:'Prueba interna'})});assert.equal(r.status,201);const created=(await r.json()).task;assert.equal(created.executionEnabled,false);await new Promise(resolve=>f.server.close(resolve));const second=await fixture(t,f.dataDir);const items=await(await fetch(second.url+'/api/tasks',{headers:{authorization}})).json();assert.equal(items.tasks[0].id,created.id);});
test('foreign browser origin blocked',async t=>{const f=await fixture(t);const r=await fetch(f.url+'/api/tasks',{method:'POST',headers:{authorization,origin:'https://foreign.example','content-type':'application/json'},body:'{"title":"x"}'});assert.equal(r.status,403);});
test('execution payload not accepted as a manual task',async t=>{const f=await fixture(t);const r=await fetch(f.url+'/api/tasks',{method:'POST',headers:{authorization,'content-type':'application/json'},body:'{"title":"x","execute":true}'});assert.equal(r.status,400);});
test('old upstream actions unavailable',async t=>{const f=await fixture(t);for(const url of ['/api/run','/api/publish','/api/keys'])assert.equal((await fetch(f.url+url,{method:'POST',headers:{authorization}})).status,404);});
test('corrupt data does not silently reset history',()=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'office-corrupt-'));fs.writeFileSync(path.join(d,'manual-tasks.json'),'{broken');assert.throws(()=>createOffice({password,dataDir:d}));});
