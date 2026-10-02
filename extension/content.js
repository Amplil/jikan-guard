(() => {
  if (globalThis.__jikanGuardLoaded) return;
  globalThis.__jikanGuardLoaded=true;
  let rule=null, stopped=false, blocked=false, pending=[], lastSend=0, sending=false;
  let lastWall=Date.now(), lastMono=performance.now(), priorVisible=document.visibilityState==='visible';
  let foregroundSince=lastWall;
  let helloNeeded=true, helloSending=false, nextHello=0, configEpoch=0;
  const media=globalThis.JikanMedia;
  const videos=new Map(), roots=new WeakSet();
  const isTop=window===window.top;
  function snapshot(video) {try{return media.snapshot(video);}catch{return null;}}
  function track(video) {
    if (videos.has(video)) return;
    videos.set(video,snapshot(video));
    for (const event of ['playing','pause','waiting','stalled','seeking','seeked','ended','ratechange','timeupdate','emptied']) video.addEventListener(event,onMediaEvent,{passive:true});
  }
  function discover(node) {
    if (node.nodeType!==1 && node.nodeType!==9 && node.nodeType!==11) return;
    if (node.nodeType===1 && node.localName==='video') track(node);
    for (const video of node.querySelectorAll?.('video') || []) track(video);
    // Open shadow roots are visible to the extension; closed roots are not.
    if (node.shadowRoot) observe(node.shadowRoot);
    for (const element of node.querySelectorAll?.('*') || []) if (element.shadowRoot) observe(element.shadowRoot);
  }
  function observe(root) {
    if (roots.has(root)) return;
    roots.add(root); discover(root);
    const observer=new MutationObserver(changes=>{
      if (!rule?.enabled || stopped) return;
      for (const change of changes) for (const node of change.addedNodes) discover(node);
    });
    observer.observe(root,{childList:true,subtree:true});
  }
  function sample() {
    const now=Date.now(), mono=performance.now(), elapsed=mono-lastMono;
    let playing=false;
    for (const [video,previous] of videos) {
      if (!video.isConnected) {videos.delete(video);continue;}
      const current=snapshot(video);
      if (media.advanced(previous,current,elapsed)) playing=true;
      videos.set(video,current);
    }
    if (rule?.enabled && !blocked && elapsed>0 && elapsed<=media.MAX_GAP_MS && Math.abs(now-lastWall-elapsed)<1000) {
      const foreground=isTop && priorVisible;
      if ((rule.mode==='video' && playing) || (rule.mode==='foreground' && foreground)) {
        const start=rule.mode==='foreground' ? Math.max(lastWall,foregroundSince) : lastWall;
        const span={start,end:now,video:playing,foreground};
        const previous=pending.at(-1);
        if (previous && previous.end===span.start && previous.video===span.video && previous.foreground===span.foreground && span.end-previous.start<=media.MAX_GAP_MS) previous.end=span.end;
        else pending.push(span);
        if (pending.length>64) pending.shift();
      }
    }
    lastWall=now;lastMono=mono;priorVisible=document.visibilityState==='visible';
  }
  async function flush(force=false) {
    if (stopped || sending || !pending.length || (!force && Date.now()-lastSend<1000)) return;
    const intervals=pending, epoch=configEpoch;pending=[];sending=true;lastSend=Date.now();
    try {
      const result=await chrome.runtime.sendMessage({type:'REPORT',intervals});
      if (!result?.ok) throw new Error(result?.error || '計測できません');
      // Ignore replies from before a configuration change or BFCache restore.
      if (epoch===configEpoch) {
        if ('rule' in result) rule=result.rule;
        if (result.blocked) stopVideos();
      }
    } catch (error) {
      // Retry recent intervals; the background union makes retries idempotent.
      if (String(error).includes('Extension context invalidated')) {stopped=true;clearInterval(timer);}
      else if (epoch===configEpoch && !blocked) pending=[...intervals,...pending].slice(-64);
    } finally {sending=false;}
  }
  function pulse(force=false) { if (stopped) return;void refreshRule();sample();void flush(force); }
  function onMediaEvent(event) {
    if (blocked && event.type==='playing') {stopVideos();return;}
    pulse(['pause','waiting','seeking','ended','emptied'].includes(event.type));
  }
  function stopVideos() {blocked=true;pending=[];for (const video of videos.keys()) try {video.pause();}catch{}}
  function configure(next) {
    configEpoch++;helloNeeded=false;
    sample();pending=[];rule=next;blocked=false;
    if (rule?.enabled) discover(document);
    lastWall=Date.now();lastMono=performance.now();
    priorVisible=document.visibilityState==='visible';
  }
  async function refreshRule() {
    if (stopped || helloSending || !helloNeeded || Date.now()<nextHello) return;
    helloSending=true;
    const epoch=configEpoch;
    try {
      const result=await chrome.runtime.sendMessage({type:'HELLO'});
      if (!result?.ok) throw new Error(result?.error || '設定を取得できません');
      if (epoch===configEpoch) configure(result.rule || null);
    } catch (error) {
      if (String(error).includes('Extension context invalidated')) {stopped=true;clearInterval(timer);}
      else if (epoch===configEpoch) nextHello=Date.now()+30000;
    } finally {
      helloSending=false;
      // A restore/CONFIG can supersede an in-flight handshake.
      if (helloNeeded && epoch!==configEpoch) void refreshRule();
    }
  }
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if (message?.type==='BLOCK') {stopVideos();respond({ok:true});}
    if (message?.type==='CONFIG') {configure(message.rule);respond({ok:true});}
  });
  observe(document);
  const timer=setInterval(()=>pulse(),1000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') foregroundSince=Date.now();pulse(true);},{passive:true});
  window.addEventListener('blur',()=>pulse(true),{passive:true});
  window.addEventListener('focus',()=>{foregroundSince=Date.now();pulse();},{passive:true});
  window.addEventListener('pagehide',()=>pulse(true),{passive:true});
  window.addEventListener('pageshow',event=>{
    lastWall=Date.now();lastMono=performance.now();
    if (event.persisted) {
      configEpoch++;helloNeeded=true;nextHello=0;
      pending=[];rule=null;
      priorVisible=document.visibilityState==='visible';foregroundSince=lastWall;
      for (const video of videos.keys()) videos.set(video,snapshot(video));
      void refreshRule();
    }
  }, {passive:true});
  void refreshRule();
})();
