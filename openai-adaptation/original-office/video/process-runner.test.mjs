import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import os from'node:os';import path from'node:path';import{spawn}from'node:child_process';import{once}from'node:events';import{runBounded}from'./canvas-demo/process-runner.mjs';
test('normal process output returns after close',async()=>{assert.equal(await runBounded(process.execPath,['-e','process.stdout.write("ok")']),'ok');});
test('nonzero and spawn failure reject',async()=>{await assert.rejects(runBounded(process.execPath,['-e','process.stderr.write("fixture failure");process.exit(2)']),/failed 2/);await assert.rejects(runBounded('/nonexistent/canvas-demo-command',[]),/ENOENT/);});
test('stdout and stderr are bounded',async()=>{await assert.rejects(runBounded(process.execPath,['-e','process.stdout.write("x".repeat(200000))'],{maxStdoutBytes:1000}),/stdout limit/);await assert.rejects(runBounded(process.execPath,['-e','process.stderr.write("x".repeat(200000))'],{maxStderrBytes:1000}),/stderr limit/);});
test('timeout terminates owned leader and TERM-ignoring descendant, not unrelated process',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-lifecycle-')),pidFile=path.join(dir,'pids.json');
 const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(unrelated,'spawn');
 try{
 const script=`const{spawn}=require('node:child_process');const fs=require('node:fs');process.on('SIGTERM',()=>{});const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({leader:process.pid,descendant:c.pid}));setInterval(()=>{},1000);`;
 const began=Date.now();await assert.rejects(runBounded(process.execPath,['-e',script],{timeoutMs:600,killGraceMs:100}),/timeout/);assert.ok(Date.now()-began>=690);
 const pids=JSON.parse(await fs.readFile(pidFile,'utf8'));
 for(const pid of Object.values(pids)){let active=false;try{const stat=await fs.readFile(`/proc/${pid}/stat`,'utf8');const state=stat.slice(stat.lastIndexOf(')')+2).split(' ')[0];active=!['Z','X'].includes(state);}catch(e){if(e.code!=='ENOENT')throw e;}assert.equal(active,false,`owned process ${pid} still running`);}
 assert.equal(unrelated.exitCode,null);assert.equal(process.kill(unrelated.pid,0),true);
 }finally{unrelated.kill('SIGKILL');await once(unrelated,'close');}
});
test('leader exit cannot strand descendant inheriting output pipes',async()=>{
 const script='const{spawn}=require("node:child_process");spawn(process.execPath,["-e",\'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)\'],{stdio:["ignore",1,2]});process.exit(0)';
 await assert.rejects(runBounded(process.execPath,['-e',script],{timeoutMs:300,killGraceMs:100}),/timeout/);
});
