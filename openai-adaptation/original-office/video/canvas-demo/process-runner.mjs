// Linux/POSIX-only ownership-scoped process supervisor. Never targets a PID/group
// not created here. No shell, no caller-supplied process IDs, no global pkill.
import {spawn} from 'node:child_process';
export function runBounded(bin,args,{timeoutMs=120000,killGraceMs=250,maxStdoutBytes=1024*1024,maxStderrBytes=32768}={}){
 if(process.platform==='win32')return Promise.reject(new Error('Canvas supervisor requires POSIX process groups'));
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>300000||!Number.isFinite(killGraceMs)||killGraceMs<1||killGraceMs>5000)throw Error('Invalid process limits');
 return new Promise((resolve,reject)=>{
  const child=spawn(bin,args,{detached:true,stdio:['ignore','pipe','pipe'],shell:false});
  let out=[],outBytes=0,err=[],errBytes=0,reason=null,closed=false,exitCode=null,spawnError=null,stopping=false;
  let timer,escalate,cleanupDeadline;const pid=child.pid;
  const signalGroup=signal=>{if(!Number.isInteger(pid)||pid<1)return;try{process.kill(-pid,signal);}catch(e){if(e.code!=='ESRCH'){reason||=new Error('Unable to terminate owned process group');}}};
  const finish=()=>{
   if(!closed)return;
   if(stopping&&escalate)return; // Always finish TERM→KILL cleanup, even if leader exits first.
   clearTimeout(timer);clearTimeout(cleanupDeadline);
   if(spawnError)return reject(spawnError);
   if(reason)return reject(reason);
   if(exitCode!==0)return reject(new Error(`Renderer failed ${exitCode}: ${Buffer.concat(err).toString('utf8')}`));
   resolve(Buffer.concat(out).toString('utf8'));
  };
  const stop=error=>{
   reason||=error;if(stopping)return;stopping=true;clearTimeout(timer);signalGroup('SIGTERM');
   escalate=setTimeout(()=>{signalGroup('SIGKILL');escalate=null;finish();},killGraceMs);
   cleanupDeadline=setTimeout(()=>{
    signalGroup('SIGKILL');
    if(!closed){child.stdout.destroy();child.stderr.destroy();reject(new Error(`${reason?.message||'Process failed'}; process closure was not confirmed`));}
   },killGraceMs+5000);
  };
  const consume=(stream,limit,isOut)=>stream.on('data',data=>{
   const buf=Buffer.from(data);if(isOut){outBytes+=buf.length;if(outBytes>limit)return stop(new Error('Renderer stdout limit exceeded'));out.push(buf);}
   else{errBytes+=buf.length;if(errBytes>limit)return stop(new Error('Renderer stderr limit exceeded'));err.push(buf);}
  });
  consume(child.stdout,maxStdoutBytes,true);consume(child.stderr,maxStderrBytes,false);
  child.once('error',e=>{spawnError=e;});
  child.once('close',code=>{closed=true;exitCode=code;
   // A normal leader may leave descendants. Terminate only its owned process group.
   if(!stopping)signalGroup('SIGKILL');finish();
  });
  timer=setTimeout(()=>stop(new Error('Render timeout; owned worker group terminated')),timeoutMs);
 });
}
