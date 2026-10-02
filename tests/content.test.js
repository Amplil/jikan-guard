import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const content=fs.readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
const media=fs.readFileSync(new URL('../extension/media.js',import.meta.url),'utf8');
function events(target={}) {const listeners={};return Object.assign(target,{addEventListener(k,fn){(listeners[k]??=[]).push(fn);},emit(k){for(const fn of listeners[k]||[]) fn({type:k});}});}
async function setup(mode='video',count=1) {
  let now=Date.UTC(2026,9,2,12), mono=0;
  const reports=[], timers=[], listeners=[];
  const videos=Array.from({length:count},()=>events({nodeType:1,localName:'video',isConnected:true,currentTime:0,playbackRate:1,paused:false,ended:false,seeking:false,readyState:4,pause(){this.paused=true;this.emit('pause');}}));
  const document=events({nodeType:9,visibilityState:'visible',querySelectorAll:s=>s==='video'?videos:[]});
  const window=events({});window.top=window;
  const chrome={runtime:{onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async m=>{
    if(m.type==='HELLO') return {ok:true,rule:{domain:'youtube.com',mode,enabled:true}};
    reports.push(structuredClone(m));return {ok:true};
  }}};
  const FakeDate=class extends Date {static now(){return now;}};
  const context=vm.createContext({document,window,chrome,Date:FakeDate,performance:{now:()=>mono},setInterval:fn=>{timers.push(fn);return 1;},clearInterval(){},MutationObserver:class{observe(){}},console});
  vm.runInContext(media,context);vm.runInContext(content,context);
  await new Promise(resolve=>setImmediate(resolve));
  const tick=async(ms=1000,advance=true)=>{
    now+=ms;mono+=ms;if(advance) for(const v of videos) if(!v.paused&&!v.seeking&&v.readyState>=3) v.currentTime+=ms/1000*v.playbackRate;
    for(const fn of timers)fn();await new Promise(resolve=>setImmediate(resolve));
  };
  const advanceClock=ms=>{now+=ms;mono+=ms;};
  const spent=()=>reports.flatMap(x=>x.intervals).reduce((n,s)=>n+s.end-s.start,0);
  return {videos,document,window,reports,tick,advanceClock,spent,now:()=>now,send:m=>listeners.forEach(fn=>fn(m,{},()=>{})),context,timers};
}
test('content counts real elapsed video time rather than playback-speed time',async()=>{
 const f=await setup();f.videos[0].playbackRate=2;f.videos[0].emit('ratechange');await f.tick();await f.tick();assert.equal(f.spent(),2000);
});
test('two simultaneous video elements produce one interval',async()=>{
 const f=await setup('video',2);await f.tick();assert.equal(f.reports.length,1);assert.equal(f.spent(),1000);
});
test('pause and buffering contribute no advancing spans',async()=>{
 const f=await setup();await f.tick();f.videos[0].pause();await f.tick();await f.tick();assert.equal(f.spent(),1000);
 f.videos[0].paused=false;f.videos[0].readyState=2;f.videos[0].emit('waiting');await f.tick();assert.equal(f.spent(),1000);
 f.videos[0].readyState=4;f.videos[0].emit('playing');await f.tick();assert.equal(f.spent(),2000);
});
test('hidden videos continue to count while hidden foreground tabs do not',async()=>{
 const v=await setup();v.document.visibilityState='hidden';v.document.emit('visibilitychange');await v.tick();assert.equal(v.spent(),1000);
 const f=await setup('foreground');f.document.visibilityState='hidden';f.document.emit('visibilitychange');await f.tick();assert.equal(f.spent(),0);
});
test('foreground mode counts static visible content, not just video',async()=>{
 const f=await setup('foreground',0);await f.tick();assert.equal(f.spent(),1000);
});
test('foreground focus-return boundary cannot credit preceding unfocused time',async()=>{
 const f=await setup('foreground',0);await f.tick();const old=f.spent();
 // Move time without invoking sample: window focus event clips the previous interval.
 f.advanceClock(600);f.window.emit('focus');await f.tick();assert.equal(f.spent(),old+1000);
});
test('sleep/stalled timer gaps and seek jumps are rejected',async()=>{
 const f=await setup();await f.tick(60000);assert.equal(f.spent(),0);await f.tick();assert.equal(f.spent(),1000);
 f.videos[0].seeking=true;f.videos[0].currentTime+=100;f.videos[0].emit('seeking');await f.tick();assert.equal(f.spent(),1000);
 f.videos[0].seeking=false;f.videos[0].emit('seeked');await f.tick();assert.equal(f.spent(),2000);
});
test('BLOCK pauses all open videos and prevents further credit',async()=>{
 const f=await setup('video',2);await f.tick();f.send({type:'BLOCK'});assert(f.videos.every(v=>v.paused));await f.tick();assert.equal(f.spent(),1000);
});
test('configuration disables a live page and can switch mode',async()=>{
 const f=await setup();await f.tick();f.send({type:'CONFIG',rule:{mode:'video',enabled:false}});await f.tick();assert.equal(f.spent(),1000);
 f.send({type:'CONFIG',rule:{mode:'foreground',enabled:true}});f.videos[0].pause();await f.tick();assert.equal(f.spent(),2000);
});
test('reinjection guard prevents duplicate timers',async()=>{
 const f=await setup();vm.runInContext(content,f.context);assert.equal(f.timers.length,1);
});

test('blocked content immediately re-pauses a video if page navigation was delayed',async()=>{
 const f=await setup();await f.tick();f.send({type:'BLOCK'});
 const video=f.videos[0];video.paused=false;video.emit('playing');
 assert.equal(video.paused,true);
 await f.tick();assert.equal(f.spent(),1000);
});
