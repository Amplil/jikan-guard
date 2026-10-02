import {DEFAULT_RULES,validateRules,ruleFor,hostOf,rollover,creditInterval,ruleStatus,nextMidnight} from './core.js';

let data, queue=Promise.resolve(), blockingSignature;
// All mutation is serialized, including asynchronous storage and ruleset writes.
function run(task) {
  const result=queue.then(async()=>{await load();return task();});
  queue=result.catch(error=>{console.error('じかんガード:',error);chrome.action.setBadgeText({text:'!'}).catch(()=>{});});
  return result;
}
async function load() {
  if (data) return;
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const stored=await chrome.storage.local.get('state');
  if (stored.state?.schema===1) {
    data=stored.state;
    data.rules=validateRules(data.rules);
    data.since=data.since || {};
    data.ledger=rollover(data.ledger);
  } else data={schema:1,rules:structuredClone(DEFAULT_RULES),since:{},ledger:rollover(null)};
  await save();
  if (!(await chrome.alarms.get('reconcile'))) await chrome.alarms.create('reconcile',{periodInMinutes:0.5});
  await chrome.alarms.create('midnight',{when:nextMidnight(Date.now())});
}
async function save() { await chrome.storage.local.set({state:data}); }
function publicState() {
  return {ok:true,day:data.ledger.day,rules:data.rules.map(r=>ruleStatus(r,data.ledger))};
}
async function freshDay() {
  const before=data.ledger.day;
  data.ledger=rollover(data.ledger);
  if (before!==data.ledger.day) {
    await save();
    await chrome.alarms.create('midnight',{when:nextMidnight(Date.now())});
  }
}
function blockUrl(domain) { return chrome.runtime.getURL(`blocked.html?domain=${encodeURIComponent(domain)}`); }
async function enforceTab(tab) {
  const rule=ruleFor(data.rules,hostOf(tab.pendingUrl || tab.url || ''));
  if (!rule || !ruleStatus(rule,data.ledger).blocked || !Number.isInteger(tab.id)) return;
  // Stop open video immediately, then replace the complete page (also handles SPAs).
  await chrome.tabs.sendMessage(tab.id,{type:'BLOCK'}).catch(()=>{});
  await chrome.tabs.update(tab.id,{url:blockUrl(rule.domain)}).catch(()=>{});
}
async function enforceBlockedTabs() {
  for (const tab of await chrome.tabs.query({})) await enforceTab(tab);
}
async function syncBlocking(force=false, retryOpenTabs=false) {
  const domains=data.rules.filter(r=>ruleStatus(r,data.ledger).blocked).map(r=>r.domain).sort();
  const signature=JSON.stringify(domains);
  if (!force && signature===blockingSignature) {
    // Chrome can temporarily reject tabs.update (for example while dragging a tab).
    // A saved DNR rule alone cannot replace an already-loaded page.
    if (retryOpenTabs && domains.length) await enforceBlockedTabs();
    return;
  }
  const old=await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds:old.map(r=>r.id),
    addRules:domains.map((domain,index)=>({id:index+1,priority:1,
      action:{type:'redirect',redirect:{url:blockUrl(domain)}},
      condition:{requestDomains:[domain],resourceTypes:['main_frame']}}))
  });
  blockingSignature=signature;
  await chrome.action.setBadgeBackgroundColor({color:'#B34834'});
  await chrome.action.setBadgeText({text:domains.length ? String(domains.length) : ''});
  await enforceBlockedTabs();
}
async function broadcastConfig() {
  for (const tab of await chrome.tabs.query({})) {
    const rule=ruleFor(data.rules,hostOf(tab.url || '')) || null;
    await chrome.tabs.sendMessage(tab.id,{type:'CONFIG',rule}).catch(()=>{});
  }
}
async function handle(message,sender) {
  await freshDay();
  if (!message || typeof message.type!=='string') throw new Error('不明な操作です');
  const trusted=sender.id===chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  if (message.type==='GET_STATE' && trusted) {await syncBlocking();return publicState();}
  if (message.type==='OPEN_OPTIONS' && trusted) {await chrome.runtime.openOptionsPage();return {ok:true};}
  if (message.type==='SAVE_SETTINGS' && trusted) {
    const rules=validateRules(message.rules), now=Date.now();
    for (const r of rules) {
      const old=data.rules.find(x=>x.domain===r.domain);
      if (!old || old.mode!==r.mode || old.enabled!==r.enabled) data.since[r.domain]=now;
    }
    // Today's usage survives mode/limit changes, removal, and re-addition.
    data.rules=rules;
    await save();await syncBlocking(true);await broadcastConfig();return publicState();
  }
  if (!sender.tab || sender.id!==chrome.runtime.id) throw new Error('この操作は許可されていません');
  const tab=await chrome.tabs.get(sender.tab.id).catch(()=>null);
  if (!tab) return {ok:true,rule:null};
  const rule=ruleFor(data.rules,hostOf(tab.url || ''));
  if (message.type==='HELLO') {await syncBlocking();return {ok:true,rule:rule || null};}
  if (message.type!=='REPORT') throw new Error('不明な操作です');
  // A report queued by the previous document must never charge its new destination.
  if (hostOf(sender.tab.url || '')!==hostOf(tab.url || '')) return {ok:true,rule:null};
  if (!rule?.enabled) return {ok:true,rule:rule || null};
  if (ruleStatus(rule,data.ledger).blocked) {await enforceTab(tab);return {ok:true,blocked:true};}
  if (!Array.isArray(message.intervals) || message.intervals.length>64) throw new Error('計測データの形式が正しくありません');
  let foreground=false;
  if (rule.mode==='foreground' && sender.frameId===0 && tab.active) {
    const win=await chrome.windows.get(tab.windowId).catch(()=>null);
    foreground=Boolean(win?.focused && win.state!=='minimized');
  }
  const now=Date.now();
  for (const span of message.intervals) {
    if (!span || (rule.mode==='video' ? span.video!==true : !foreground || span.foreground!==true)) continue;
    data.ledger=creditInterval(data.ledger,rule.domain,span.start,span.end,now,data.since[rule.domain] || 0);
  }
  await save();await syncBlocking();
  return {ok:true,rule,blocked:ruleStatus(rule,data.ledger).blocked};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  run(()=>handle(message,sender)).then(respond,error=>respond({ok:false,error:error.message}));
  return true;
});
chrome.alarms.onAlarm.addListener(()=>{run(async()=>{await freshDay();await syncBlocking(false,true);}).catch(()=>{});});
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{
  if (change.url || change.status==='loading') run(async()=>{await freshDay();await syncBlocking();await enforceTab(tab);}).catch(()=>{});
});
chrome.runtime.onStartup.addListener(()=>{run(async()=>{await freshDay();await syncBlocking(true);}).catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{
  run(async()=>{
    await freshDay();await syncBlocking(true);
    // Existing tabs need a content script after first installation or extension reload.
    for (const tab of await chrome.tabs.query({})) if (hostOf(tab.url || '') && Number.isInteger(tab.id)) {
      await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['media.js','content.js']}).catch(()=>{});
    }
    await broadcastConfig();
  }).catch(()=>{});
});
// Reconcile persisted dynamic rules on every worker start, not just installation.
run(async()=>{await freshDay();await syncBlocking(true);}).catch(()=>{});
