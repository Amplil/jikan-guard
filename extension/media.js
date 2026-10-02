// Shared between the classic content script and the module-based test/core code.
(() => {
  const MAX_GAP_MS = 5000;
  function advanced(previous, current, elapsedMs) {
    if (!previous || !current || !previous.playing || previous.seeking || current.seeking || elapsedMs<=0 || elapsedMs>MAX_GAP_MS) return false;
    const delta=current.time-previous.time;
    return Number.isFinite(delta) && delta>0 && delta <= elapsedMs/1000*Math.max(0.1,previous.rate)*1.6+0.35;
  }
  function snapshot(video) {
    return {time:video.currentTime, rate:video.playbackRate,
      playing: !video.paused && !video.ended && !video.seeking && video.readyState>=3 && video.playbackRate>0,
      seeking:video.seeking};
  }
  globalThis.JikanMedia = Object.freeze({MAX_GAP_MS,advanced,snapshot});
})();
