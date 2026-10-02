/** Pure counter and validation functions. All intervals are elapsed wall-clock ms. */
import './media.js';
export const MAX_GAP_MS = globalThis.JikanMedia.MAX_GAP_MS;
export const DEFAULT_RULES = Object.freeze([
  { domain: 'youtube.com', limitMinutes: 30, mode: 'video', enabled: true },
  { domain: 'tiktok.com', limitMinutes: 30, mode: 'video', enabled: true }
]);
export function localDay(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function localMidnight(now) { const d = new Date(now); d.setHours(0,0,0,0); return +d; }
export function nextMidnight(now) { const d = new Date(now); d.setHours(24,0,0,0); return +d; }
export function hostMatches(host, domain) {
  host = String(host).toLowerCase().replace(/\.$/,'');
  return host === domain || host.endsWith(`.${domain}`);
}
export function hostOf(url) {
  try { const u = new URL(url); return ['http:','https:'].includes(u.protocol) ? u.hostname.toLowerCase().replace(/\.$/,'') : ''; }
  catch { return ''; }
}
export function normalizeDomain(input) {
  if (typeof input !== 'string') throw new Error('ドメインを入力してください');
  const raw = input.trim().toLowerCase().replace(/\.$/,'');
  // Hostnames only: explicit boundaries prevent wildcard/URL/path injection.
  if (!raw || raw.length > 253 || /[\s/:?#@*\\]/.test(raw)) throw new Error('URLではなくドメインを入力してください（例: youtube.com）');
  let domain;
  try { domain = new URL(`https://${raw}/`).hostname; } catch { throw new Error('正しいドメインを入力してください'); }
  if (!domain.includes('.') || !domain.split('.').every(p => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)) || /^\d+(\.\d+){3}$/.test(domain)) throw new Error('正しいドメインを入力してください（IPアドレス・localhostは対象外）');
  return domain;
}
export function validateRules(input) {
  if (!Array.isArray(input) || input.length > 50) throw new Error('登録できるサイトは50件までです');
  const result = input.map(r => {
    if (!r || typeof r !== 'object') throw new Error('設定の形式が正しくありません');
    const domain = normalizeDomain(r.domain);
    const limitMinutes = r.limitMinutes;
    if (!Number.isInteger(limitMinutes) || limitMinutes < 0 || limitMinutes > 1440) throw new Error('上限は0〜1440分の整数で入力してください');
    if (!['video','foreground'].includes(r.mode)) throw new Error('計測方法を選んでください');
    if (typeof r.enabled !== 'boolean') throw new Error('有効・無効の設定が正しくありません');
    return {domain, limitMinutes, mode:r.mode, enabled:r.enabled};
  });
  for (let i=0;i<result.length;i++) for (let j=0;j<i;j++) {
    if (hostMatches(result[i].domain,result[j].domain) || hostMatches(result[j].domain,result[i].domain)) throw new Error(`${result[i].domain} と ${result[j].domain} は重複しています。親ドメインだけを登録してください`);
  }
  return result;
}
export function ruleFor(rules, host) { return rules.find(r=>hostMatches(host,r.domain)); }
export function rollover(ledger, now=Date.now()) {
  if (!ledger || ledger.day !== localDay(now)) return {day:localDay(now), usage:{}};
  return ledger;
}
export function mergeIntervals(intervals, start, end) {
  const merged = []; let s=start, e=end, inserted=false;
  for (const [a,b] of intervals) {
    if (b < s) merged.push([a,b]);
    else if (e < a) { if (!inserted) { merged.push([s,e]); inserted=true; } merged.push([a,b]); }
    else { s=Math.min(s,a); e=Math.max(e,b); }
  }
  if (!inserted) merged.push([s,e]);
  return merged;
}
export function usedMs(ledger, domain) { return (ledger.usage[domain] || []).reduce((s,[a,b])=>s+b-a,0); }
/** Reject stale/sleep spans; trim to today and the latest mode activation. */
export function creditInterval(ledger, domain, start, end, now=Date.now(), since=0) {
  const next=rollover(ledger,now);
  if (![start,end,now].every(Number.isFinite) || end<=start || end-start>MAX_GAP_MS || end>now+1000 || now-end>15000) return next;
  const s=Math.max(start,localMidnight(now),since), e=Math.min(end,now);
  if (e>s) next.usage[domain]=mergeIntervals(next.usage[domain] || [],s,e);
  return next;
}
export function ruleStatus(rule, ledger) {
  const used = usedMs(ledger,rule.domain), remaining=Math.max(0,rule.limitMinutes*60000-used);
  return {...rule,usedMs:used,remainingMs:remaining,blocked:rule.enabled && remaining<=0};
}
/** Validate actual media advance; never count the seek jump or playback-speed multiplier. */
export const mediaAdvanced = globalThis.JikanMedia.advanced;
