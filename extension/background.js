import {DEFAULT_DAILY_LIMIT_MINUTES,DEFAULT_RULES,validateDailyLimit,validateRules,ruleFor,hostOf,rollover,creditInterval,budgetOf,ruleStatus,countdownBadge,remainingPhrase,nextMidnight} from './core.js';

let data, queue=Promise.resolve(), blockingSignature;
// Discarded tabs and content scripts waiting on this worker can leave Chrome APIs pending forever.
function within(promise,ms=1000) {
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('応答がタイムアウトしました')),ms);});
  return Promise.race([Promise.resolve(promise),timeout]).finally(()=>clearTimeout(timer));
}
function attempt(work,ms=1000) { return within(Promise.resolve().then(work),ms).catch(()=>{}); }
// All mutation is serialized, including asynchronous storage and ruleset writes.
function run(task) {
  const result=queue.then(async()=>{await load();return task();});
  queue=result.catch(error=>{console.error('じかんガード:',error);chrome.action.setBadgeText({text:'!'}).catch(()=>{});});
  return result;
}
async function load() {
  if (data) return;
  // Do not await: on some Chrome versions this call never settles and would freeze every settings read.
  try { void chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'})?.catch(()=>{}); } catch { /* local.setAccessLevel is absent before Chrome 140 */ }
  const stored=await chrome.storage.local.get('state');
  if (stored.state?.schema===1) {
    const saved=stored.state;
    const rawLimit=adoptDailyLimit(saved);
    data={schema:1,dailyLimitMinutes:Math.min(1440,Math.max(0,rawLimit)),rules:validateRules(saved.rules),since:saved.since || {},ledger:rollover(saved.ledger)};
  } else data={schema:1,dailyLimitMinutes:DEFAULT_DAILY_LIMIT_MINUTES,rules:structuredClone(DEFAULT_RULES),since:{},ledger:rollover(null)};
  await save();
  const existing=await within(chrome.alarms.get('reconcile')).catch(()=>true);
  if (!existing) await within(chrome.alarms.create('reconcile',{periodInMinutes:0.5})).catch(()=>{});
  await within(chrome.alarms.create('midnight',{when:nextMidnight(Date.now())})).catch(()=>{});
}
async function save() { await chrome.storage.local.set({state:data}); }
function adoptDailyLimit(saved) {
  if (Number.isInteger(saved?.dailyLimitMinutes)) return saved.dailyLimitMinutes;
  const rules=Array.isArray(saved?.rules) ? saved.rules : [];
  if (rules.some(rule=>Number.isInteger(rule?.limitMinutes))) return rules.reduce((sum,rule)=>sum+(Number.isInteger(rule?.limitMinutes) ? rule.limitMinutes : 0),0);
  return DEFAULT_DAILY_LIMIT_MINUTES;
}
function budget() { return budgetOf(data.dailyLimitMinutes,data.ledger); }
function publicState() {
  const today=budget();
  return {ok:true,day:data.ledger.day,dailyLimitMinutes:today.limitMinutes,usedMs:today.usedMs,remainingMs:today.remainingMs,blocked:today.blocked,rules:data.rules.map(rule=>ruleStatus(rule,data.ledger,today))};
}
async function paintCountdown(today=budget()) {
  if (!data.rules.some(rule=>rule.enabled)) {
    await chrome.action.setBadgeText({text:''});
    await chrome.action.setTitle({title:'じかんガード'});
    return;
  }
  const urgent=today.blocked || today.remainingMs<=5*60*1000;
  await chrome.action.setBadgeBackgroundColor({color:urgent ? '#9F4039' : '#245FC8'});
  await chrome.action.setBadgeTextColor({color:'#FFFFFF'});
  await chrome.action.setBadgeText({text:countdownBadge(today.remainingMs)});
  await chrome.action.setTitle({title:today.blocked ? 'じかんガード: 今日の上限です' : `じかんガード: あと${remainingPhrase(today.remainingMs)}`});
}
async function freshDay() {
  const before=data.ledger.day;
  data.ledger=rollover(data.ledger);
  if (before!==data.ledger.day) {
    await save();
    await within(chrome.alarms.create('midnight',{when:nextMidnight(Date.now())})).catch(()=>{});
  }
}
function blockUrl(domain) { return chrome.runtime.getURL(`blocked.html?domain=${encodeURIComponent(domain)}`); }
async function enforceTab(tab) {
  const rule=ruleFor(data.rules,hostOf(tab.pendingUrl || tab.url || ''));
  if (!rule || !ruleStatus(rule,data.ledger,budget()).blocked || !Number.isInteger(tab.id)) return;
  // Stop open video immediately, then replace the complete page (also handles SPAs).
  await attempt(()=>chrome.tabs.sendMessage(tab.id,{type:'BLOCK'}));
  await attempt(()=>chrome.tabs.update(tab.id,{url:blockUrl(rule.domain)}));
}
async function enforceBlockedTabs() {
  await Promise.all((await chrome.tabs.query({})).map(tab=>enforceTab(tab)));
}
async function syncBlocking(force=false, retryOpenTabs=false) {
  const today=budget();
  const rules=today.blocked ? data.rules.filter(rule=>rule.enabled).slice().sort((a,b)=>a.domain.localeCompare(b.domain)) : [];
  const signature=JSON.stringify(rules.map(rule=>[rule.domain,rule.excludedSubdomains || []]));
  if (!force && signature===blockingSignature) {
    // Chrome can temporarily reject tabs.update (for example while dragging a tab).
    // A saved DNR rule alone cannot replace an already-loaded page.
    if (retryOpenTabs && rules.length) await enforceBlockedTabs();
  } else {
    try {
      const old=await within(chrome.declarativeNetRequest.getDynamicRules());
      await within(chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds:old.map(r=>r.id),
        addRules:rules.map((rule,index)=>({id:index+1,priority:1,
          action:{type:'redirect',redirect:{url:blockUrl(rule.domain)}},
          condition:{requestDomains:[rule.domain],...(rule.excludedSubdomains?.length ? {excludedRequestDomains:rule.excludedSubdomains} : {}),resourceTypes:['main_frame']}}))
      }));
      blockingSignature=signature;
    } catch (error) { console.error('じかんガード:',error); }
    await enforceBlockedTabs();
  }
  await paintCountdown(today);
}
async function broadcastConfig() {
  await Promise.all((await chrome.tabs.query({})).map(tab=>{
    const rule=ruleFor(data.rules,hostOf(tab.url || '')) || null;
    return attempt(()=>chrome.tabs.sendMessage(tab.id,{type:'CONFIG',rule}));
  }));
}
async function handle(message,sender) {
  await freshDay();
  if (!message || typeof message.type!=='string') throw new Error('不明な操作です');
  const trusted=sender.id===chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  if (message.type==='GET_STATE' && trusted) {await syncBlocking();return publicState();}
  if (message.type==='OPEN_OPTIONS' && trusted) {await chrome.runtime.openOptionsPage();return {ok:true};}
  if (message.type==='SAVE_SETTINGS' && trusted) {
    const rules=validateRules(message.rules), dailyLimitMinutes=validateDailyLimit(message.dailyLimitMinutes), now=Date.now();
    for (const r of rules) {
      const old=data.rules.find(x=>x.domain===r.domain);
      if (!old || old.mode!==r.mode || old.enabled!==r.enabled || JSON.stringify(old.excludedSubdomains || [])!==JSON.stringify(r.excludedSubdomains || [])) data.since[r.domain]=now;
    }
    // Today's usage survives mode/limit changes, removal, and re-addition.
    data.dailyLimitMinutes=dailyLimitMinutes;
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
  if (ruleStatus(rule,data.ledger,budget()).blocked) {await enforceTab(tab);return {ok:true,blocked:true};}
  if (!Array.isArray(message.intervals) || message.intervals.length>64) throw new Error('計測データの形式が正しくありません');
  let foreground=false;
  // Count the selected tab of every non-minimized window, including one beside the focused window.
  if (rule.mode==='foreground' && sender.frameId===0 && tab.active) {
    const win=await chrome.windows.get(tab.windowId).catch(()=>null);
    foreground=Boolean(win && win.state!=='minimized');
  }
  const now=Date.now();
  for (const span of message.intervals) {
    if (!span || (rule.mode==='video' ? span.video!==true : !foreground || span.foreground!==true)) continue;
    data.ledger=creditInterval(data.ledger,rule.domain,span.start,span.end,now,data.since[rule.domain] || 0);
  }
  await save();await syncBlocking();
  const today=budget();
  return {ok:true,rule:ruleStatus(rule,data.ledger,today),blocked:today.blocked && rule.enabled};
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
    await Promise.all((await chrome.tabs.query({})).map(tab=>{
      if (!(hostOf(tab.url || '') && Number.isInteger(tab.id))) return;
      return attempt(()=>chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['media.js','content.js']}));
    }));
    await broadcastConfig();
  }).catch(()=>{});
});
// Reconcile persisted dynamic rules on every worker start, not just installation.
run(async()=>{await freshDay();await syncBlocking(true);}).catch(()=>{});
