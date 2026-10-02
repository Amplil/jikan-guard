import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scripts=['media.js','content.js'].map(file=>fs.readFileSync(new URL(`../extension/${file}`,import.meta.url),'utf8'));
const ENABLED={domain:'youtube.com',mode:'foreground',enabled:true};
function events(target={}) {
  const listeners={};
  return Object.assign(target,{
    addEventListener(type,fn){(listeners[type]??=new Set()).add(fn);},
    emit(type,extra={}){for(const fn of listeners[type] || []) fn({type,...extra});}
  });
}
function deferred() {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function harness({initialRule=ENABLED,onHello,onReport}={}) {
  let now=Date.UTC(2026,9,2,12),mono=0,serverRule=initialRule,helloCalls=0,clears=0;
  const reports=[],listeners=[],timers=new Map();
  const video=events({nodeType:1,localName:'video',isConnected:true,currentTime:0,playbackRate:1,paused:false,ended:false,seeking:false,readyState:4,
    pause(){this.paused=true;this.emit('pause');}});
  const document=events({nodeType:9,visibilityState:'visible',querySelectorAll:selector=>selector==='video'?[video]:[]});
  const window=events({});window.top=window;
  const chrome={runtime:{onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async message=>{
    if(message.type==='HELLO') {
      helloCalls++;
      return onHello ? onHello(helloCalls,serverRule) : {ok:true,rule:serverRule};
    }
    reports.push(structuredClone(message));
    return onReport ? onReport(reports.length,serverRule) : {ok:true,rule:serverRule};
  }}};
  const FakeDate=class extends Date {static now(){return now;}};
  const context=vm.createContext({document,window,chrome,Date:FakeDate,performance:{now:()=>mono},
    setInterval:fn=>{timers.set(1,fn);return 1;},clearInterval:id=>{clears++;timers.delete(id);},
    MutationObserver:class{observe(){}},console});
  for(const script of scripts) vm.runInContext(script,context);
  const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();
  return {window,document,video,reports,settle,helloCalls:()=>helloCalls,clears:()=>clears,setRule:rule=>{serverRule=rule;},
    send:message=>listeners.forEach(fn=>fn(message,{},()=>{})),
    tick:async(ms=1000)=>{now+=ms;mono+=ms;if(!video.paused&&!video.seeking&&video.readyState>=3)video.currentTime+=ms/1000*video.playbackRate;for(const fn of timers.values())fn();await settle();},
    elapsed:ms=>{now+=ms;mono+=ms;}};
}

test('a transient first HELLO failure retries after 30 seconds and recovers without reload',async()=>{
  const h=await harness({onHello:(count,rule)=>count===1?Promise.reject(Error('Temporary worker failure')):{ok:true,rule}});
  for(let i=0;i<29;i++)await h.tick();
  assert.equal(h.helloCalls(),1);assert.equal(h.reports.length,0);
  await h.tick();assert.equal(h.helloCalls(),2);
  await h.tick();assert.equal(h.reports.length,1);
});

test('repeated failed HELLO responses retry no more often than once per 30 seconds',async()=>{
  const h=await harness({onHello:()=>({ok:false,error:'Temporary storage failure'})});
  for(let i=0;i<59;i++)await h.tick();assert.equal(h.helloCalls(),2);
  await h.tick();assert.equal(h.helloCalls(),3);assert.equal(h.reports.length,0);
});

test('an invalidated extension context stops its timer and never retries HELLO',async()=>{
  const h=await harness({onHello:()=>Promise.reject(Error('Extension context invalidated.'))});
  for(let i=0;i<90;i++)await h.tick();
  h.window.emit('pageshow',{persisted:true});await h.settle();
  assert.equal(h.helloCalls(),1);assert.equal(h.clears(),1);assert.equal(h.reports.length,0);
});

test('successful unconfigured documents do not keep polling HELLO',async()=>{
  const h=await harness({initialRule:null});
  for(let i=0;i<65;i++)await h.tick();
  assert.equal(h.helloCalls(),1);assert.equal(h.reports.length,0);
});

test('ordinary initial pageshow does not duplicate the initial handshake',async()=>{
  const h=await harness();h.window.emit('pageshow',{persisted:false});await h.settle();await h.tick();
  assert.equal(h.helloCalls(),1);assert.equal(h.reports.length,1);
});

for(const [label,initialRule] of [['unconfigured',null],['disabled',{...ENABLED,enabled:false}],['video',{...ENABLED,mode:'video'}]]) {
  test(`BFCache restore refreshes a ${label} document to the current foreground rule`,async()=>{
    const h=await harness({initialRule});h.video.pause();
    h.window.emit('pagehide',{persisted:true});h.setRule(ENABLED);h.elapsed(60000);
    h.window.emit('pageshow',{persisted:true});await h.settle();await h.tick();
    assert.equal(h.helloCalls(),2);assert.equal(h.reports.length,1);
    const [span]=h.reports[0].intervals;assert.equal(span.end-span.start,1000);
  });
}

test('an old HELLO reply cannot overwrite a newer CONFIG broadcast',async()=>{
  const first=deferred();const h=await harness({onHello:()=>first.promise});
  h.send({type:'CONFIG',rule:ENABLED});first.resolve({ok:true,rule:null});await h.settle();await h.tick();
  assert.equal(h.helloCalls(),1);assert.equal(h.reports.length,1);
});

test('a restore supersedes an unfinished HELLO and then requests fresh configuration',async()=>{
  const first=deferred();const h=await harness({onHello:(count,rule)=>count===1?first.promise:{ok:true,rule}});
  h.window.emit('pageshow',{persisted:true});first.resolve({ok:true,rule:null});await h.settle();await h.tick();
  assert.equal(h.helloCalls(),2);assert.equal(h.reports.length,1);
});

test('an old REPORT reply cannot overwrite CONFIG or re-block a reconfigured document',async()=>{
  const first=deferred();const h=await harness({onReport:count=>count===1?first.promise:{ok:true}});
  await h.tick();h.send({type:'CONFIG',rule:ENABLED});first.resolve({ok:true,rule:null,blocked:true});await h.settle();await h.tick();
  assert.equal(h.video.paused,false);assert.equal(h.reports.length,2);
});

test('an old failed REPORT is not requeued after configuration changes',async()=>{
  const first=deferred();const h=await harness({onReport:count=>count===1?first.promise:{ok:true}});
  await h.tick();const oldEnd=h.reports[0].intervals[0].end;
  h.send({type:'CONFIG',rule:ENABLED});first.reject(Error('Temporary delivery failure'));await h.settle();await h.tick();
  assert.equal(h.reports.length,2);assert.equal(h.reports[1].intervals[0].start,oldEnd);
  assert.equal(h.reports[1].intervals.reduce((n,span)=>n+span.end-span.start,0),1000);
});

test('playing events after BLOCK pause the video again without a pause-event recursion',async()=>{
  const h=await harness({initialRule:{...ENABLED,mode:'video'}});await h.tick();
  h.send({type:'BLOCK'});h.video.paused=false;h.video.emit('playing');await h.tick();
  assert.equal(h.video.paused,true);assert.equal(h.reports.length,1);
});
