// First audited port: ver_tablero reads ONLY an explicit manual-task snapshot.
// No imports of upstream state, functions, databases, files, network or credentials.
export class ReadOnlyToolBridge {
 constructor(tasks = []) {
  if(!Array.isArray(tasks)||tasks.length>1000)throw new Error('INVALID_SNAPSHOT');
  this.snapshot=tasks.map(t=>{if(!t||typeof t.id!=='string'||t.id.length>200||typeof t.title!=='string'||t.title.length>500||!['manual-pending','manual-completed','cancelled'].includes(t.status))throw new Error('INVALID_SNAPSHOT');return {id:t.id,title:t.title,status:t.status,source:'manual-workspace'};});
  this.scope=null;this.calls=new Set();
 }
 specs(){return [{type:'function',name:'ver_tablero',description:'Read a bounded snapshot of manual internal tasks. These are not executed AI jobs or the upstream live board.',inputSchema:{type:'object',properties:{},additionalProperties:false}}];}
 bind(threadId,turnId){if(!threadId||!turnId)throw new Error('SCOPE_REQUIRED');this.scope={threadId,turnId};this.calls.clear();}
 clear(){this.scope=null;this.calls.clear();}
 handle(message){
  const p=message.params||{};const fail=()=>({contentItems:[{type:'inputText',text:'Tool unavailable: not authorized for this active scope.'}],success:false});
  if(message.method!=='item/tool/call'||!this.scope||p.threadId!==this.scope.threadId||p.turnId!==this.scope.turnId||p.tool!=='ver_tablero'||p.namespace||typeof p.callId!=='string'||!p.callId||p.callId.length>200||this.calls.has(p.callId)||this.calls.size>=10)return fail();
  if(!p.arguments||Array.isArray(p.arguments)||typeof p.arguments!=='object'||Object.keys(p.arguments).length)return fail();
  this.calls.add(p.callId);
  return {contentItems:[{type:'inputText',text:JSON.stringify({source:'manual-snapshot-not-upstream',tasks:this.snapshot.slice(0,100),total:this.snapshot.length,truncated:this.snapshot.length>100})}],success:true};
 }
}
