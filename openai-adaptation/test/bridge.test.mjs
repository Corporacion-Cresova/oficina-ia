import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerBackend,clearBackend,query,tool,createSdkMcpServer } from '../src/sdk-bridge.mjs';
import { OfficeEventStream } from '../src/event-stream.mjs';
function streamFixture(events,opts={}) {
 const client=new EventEmitter(); client.close=()=>client.emit('closed'); let interrupts=0;
 const adapter={client,startThread:async()=> 't',startTurn:async()=>{setTimeout(()=>{for(const event of events)client.emit('notification',event)},0);return {turn:{id:'u'}}},interrupt:async()=>{interrupts++}};
 return {stream:new OfficeEventStream(adapter,{timeoutMs:50,...opts}),client,get interrupts(){return interrupts}};
}
const delta=(text,threadId='t')=>({method:'item/agentMessage/delta',params:{threadId,turnId:'u',delta:text}});
const complete=(status='completed')=>({method:'turn/completed',params:{threadId:'t',turn:{id:'u',status}}});
test('bridge fails without real registered backend',()=>{clearBackend();assert.throws(()=>query({prompt:'x'}),/NOT_CONNECTED/)});
test('all unmapped SDK controls fail explicitly',()=>{for(const k of ['hooks','canUseTool','mcpServers','allowedTools','disallowedTools','maxTurns','maxBudgetUsd','settingSources','resume','plugins'])assert.throws(()=>query({prompt:'x',options:{[k]:[]}}),/UNPORTED/)});
test('tool descriptors do not execute handlers',()=>{let called=false;const t=tool('x','d',{},()=>{called=true});const s=createSdkMcpServer({name:'x',tools:[t]});assert.equal(s.type,'unported-office-tools');assert.equal(called,false);assert.ok(Object.isFrozen(s.tools))});
test('translate messages and final result without fabricated cost',async()=>{const f=streamFixture([delta('a'),delta('ignored','foreign'),delta('b'),complete()]);const out=[];for await(const msg of f.stream.stream('p'))out.push(msg);assert.equal(out.length,3);assert.equal(out[2].result,'ab');assert.equal(out[2].subtype,'success');assert.equal(out[2].total_cost_usd,undefined);assert.equal(f.client.listenerCount('notification'),0)});
test('failed turn never becomes success',async()=>{const f=streamFixture([complete('failed')]);const out=[];for await(const msg of f.stream.stream('p'))out.push(msg);assert.equal(out[0].subtype,'error_during_execution')});
test('timeout cleans listeners and interrupts',async()=>{const f=streamFixture([],{timeoutMs:5});await assert.rejects(async()=>{for await(const msg of f.stream.stream('p')){}},/TURN_TIMEOUT/);assert.ok(f.interrupts>=1);assert.equal(f.client.listenerCount('notification'),0)});
test('already aborted does not start thread',async()=>{const f=streamFixture([]);const c=new AbortController();c.abort();await assert.rejects(async()=>{for await(const msg of f.stream.stream('p',{signal:c.signal})){}},/ABORTED/)});
test('transport closure fails stream',async()=>{const f=streamFixture([]);setTimeout(()=>f.client.close(),5);await assert.rejects(async()=>{for await(const msg of f.stream.stream('p')){}},/TRANSPORT_CLOSED/)});
test('backend closes after iterator',async()=>{let closed=false;registerBackend(async()=>({async *stream(){yield {type:'result'}},async close(){closed=true}}));try{const q=query({prompt:'x',options:{model:'test'}});for await(const m of q){}assert.equal(closed,true)}finally{clearBackend()}});
