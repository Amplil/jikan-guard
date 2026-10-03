import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  MAX_GAP_MS, DEFAULT_RULES, localDay, localMidnight, nextMidnight,
  hostMatches, hostOf, normalizeDomain, validateDailyLimit, validateRules, ruleFor,
  rollover, mergeIntervals, usedMs, totalUsedMs, creditInterval, budgetOf, ruleStatus,
  countdownBadge, remainingPhrase, mediaAdvanced
} from '../extension/core.js';

const instant = () => +new Date(2026, 9, 2, 12, 0, 0);
const emptyLedger = (now = instant()) => ({ day: localDay(now), usage: {} });
const rule = (overrides = {}) => ({ domain: 'youtube.com', mode: 'video', enabled: true, ...overrides });

// Fixtures use local dates deliberately: budgets reset in the user's local day.
test('default rules independently configure YouTube and TikTok playback', () => {
  assert.deepEqual(validateRules(DEFAULT_RULES), [rule(), rule({ domain: 'tiktok.com' })]);
});

test('domain normalization canonicalizes case, trailing dot and international names', () => {
  assert.equal(normalizeDomain('  YouTube.COM.  '), 'youtube.com');
  assert.equal(normalizeDomain('例え.テスト'), 'xn--r8jz45g.xn--zckzah');
  assert.equal(normalizeDomain('a-b.example.com'), 'a-b.example.com');
});

for (const input of [undefined, null, 12, {}, '', ' ', 'localhost', 'https://youtube.com',
  'youtube.com/watch', 'youtube.com:443', '*.youtube.com', 'user@youtube.com',
  'youtube.com?x=1', 'youtube.com#x', 'you tube.com', 'youtube.com\\evil.test',
  '127.0.0.1', '127.1', '2130706433', '0x7f000001', '[::1]', '-a.example', 'a-.example',
  'a..example', `${'a'.repeat(64)}.com`, `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`]) {
  test(`rejects invalid domain ${JSON.stringify(input)}`, () => assert.throws(() => normalizeDomain(input)));
}

test('host matching uses a dot boundary, including subdomains and canonical host case', () => {
  for (const host of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'WWW.YOUTUBE.COM.']) {
    assert.equal(hostMatches(host, 'youtube.com'), true, host);
  }
  for (const host of ['notyoutube.com', 'youtube.com.evil.test', 'youtube-com.test', 'tiktok.com', '']) {
    assert.equal(hostMatches(host, 'youtube.com'), false, host);
  }
});

test('URL host extraction accepts only HTTP(S) and excludes credentials/path from host', () => {
  assert.equal(hostOf('https://WWW.YouTube.COM./watch?v=1'), 'www.youtube.com');
  assert.equal(hostOf('https://youtube.com@evil.test/watch'), 'evil.test');
  assert.equal(hostOf('http://tiktok.com:8080/a'), 'tiktok.com');
  for (const url of ['not a url', '', 'file:///youtube.com', 'chrome://extensions', 'javascript:alert(1)', 'data:text/html,x']) {
    assert.equal(hostOf(url), '', url);
  }
});

test('rule validation accepts independent modes and exactly 50 sites', () => {
  assert.deepEqual(validateRules([]), []);
  assert.deepEqual(validateRules([rule(), rule({ domain: 'tiktok.com', mode: 'foreground', enabled: false })]),
    [rule(), rule({ domain: 'tiktok.com', mode: 'foreground', enabled: false })]);
  assert.equal(validateRules(Array.from({ length: 50 }, (_, i) => rule({ domain: `site${i}.example` }))).length, 50);
});

test('daily limit accepts the closed range from zero through one day', () => {
  assert.equal(validateDailyLimit(0), 0);
  assert.equal(validateDailyLimit(1440), 1440);
});

for (const limitMinutes of [-1, 1441, 0.5, NaN, Infinity, '30', null, undefined]) {
  test(`rejects non-integer or out-of-range daily limit ${String(limitMinutes)}`, () => assert.throws(() => validateDailyLimit(limitMinutes)));
}

test('rule validation rejects malformed input, unsupported modes and nonboolean enabled', () => {
  for (const input of [null, {}, 'rules', [null], [12], new Array(51).fill(rule())]) assert.throws(() => validateRules(input));
  for (const mode of ['', 'playback', 'VIDEO', undefined, null]) assert.throws(() => validateRules([rule({ mode })]));
  for (const enabled of [0, 1, 'true', undefined, null]) assert.throws(() => validateRules([rule({ enabled })]));
});

test('duplicate and overlapping domain rules are rejected regardless of order or enabled state', () => {
  for (const domains of [['youtube.com', 'YouTube.COM.'], ['youtube.com', 'www.youtube.com'], ['www.youtube.com', 'youtube.com']]) {
    assert.throws(() => validateRules(domains.map((domain, i) => rule({ domain, enabled: i === 0 }))));
  }
  assert.equal(validateRules([rule({ domain: 'a.example.com' }), rule({ domain: 'b.example.com' })]).length, 2);
});

test('normalized rule output drops per-site limits and unrecognized keys without mutating source data', () => {
  const source = rule({ domain: 'YOUTUBE.COM', limitMinutes: 12, extra: 'ignored' });
  assert.deepEqual(validateRules([source]), [rule()]);
  assert.equal(source.domain, 'YOUTUBE.COM');
  assert.equal(source.limitMinutes, 12);
  assert.equal(source.extra, 'ignored');
});

test('rule lookup selects configured parent domain without suffix false positives', () => {
  const rules = [rule(), rule({ domain: 'tiktok.com', mode: 'foreground' })];
  assert.equal(ruleFor(rules, 'm.tiktok.com'), rules[1]);
  assert.equal(ruleFor(rules, 'www.youtube.com'), rules[0]);
  assert.equal(ruleFor(rules, 'fakeyoutube.com'), undefined);
});

test('local date and midnight helpers use local calendar boundaries', () => {
  const t = +new Date(2026, 9, 2, 23, 59, 59, 999);
  assert.equal(localDay(t), '2026-10-02');
  assert.equal(localMidnight(t), +new Date(2026, 9, 2));
  assert.equal(nextMidnight(t), +new Date(2026, 9, 3));
  assert.equal(localDay(nextMidnight(t)), '2026-10-03');
});

test('rollover preserves same-day identity and starts a fresh ledger at a new local day', () => {
  const now = instant(), ledger = emptyLedger(now);
  ledger.usage['youtube.com'] = [[now - 1000, now]];
  assert.equal(rollover(ledger, now + 1), ledger);
  assert.deepEqual(rollover(ledger, nextMidnight(now)), { day: '2026-10-03', usage: {} });
  assert.deepEqual(rollover(null, now), emptyLedger(now));
  assert.equal(usedMs(ledger, 'youtube.com'), 1000);
});

test('interval merge handles insertion, containment, touching edges and multi-interval bridges', () => {
  assert.deepEqual(mergeIntervals([], 10, 20), [[10, 20]]);
  assert.deepEqual(mergeIntervals([[20, 30]], 0, 10), [[0, 10], [20, 30]]);
  assert.deepEqual(mergeIntervals([[0, 10]], 20, 30), [[0, 10], [20, 30]]);
  assert.deepEqual(mergeIntervals([[0, 10]], 2, 8), [[0, 10]]);
  assert.deepEqual(mergeIntervals([[2, 8]], 0, 10), [[0, 10]]);
  assert.deepEqual(mergeIntervals([[0, 10], [20, 30]], 10, 20), [[0, 30]]);
  assert.deepEqual(mergeIntervals([[0, 10], [20, 30], [40, 50]], 5, 45), [[0, 50]]);
  const original = [[0, 10], [20, 30]];
  mergeIntervals(original, 5, 25);
  assert.deepEqual(original, [[0, 10], [20, 30]]);
});

test('interval unions match a seeded discrete coverage model for arbitrary arrival order', () => {
  let seed = 247369, intervals = [];
  const covered = new Set();
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let i = 0; i < 500; i++) {
    const start = random() % 2000, end = start + 1 + random() % 40;
    intervals = mergeIntervals(intervals, start, end);
    for (let j = start; j < end; j++) covered.add(j);
    assert.equal(intervals.reduce((sum, [a, b]) => sum + b - a, 0), covered.size);
    for (let j = 1; j < intervals.length; j++) assert.ok(intervals[j - 1][1] < intervals[j][0]);
  }
});

test('same-domain concurrent tab intervals count union wall-clock time exactly once', () => {
  const now = instant(); let ledger = emptyLedger(now);
  ledger = creditInterval(ledger, 'youtube.com', now - 4000, now - 1000, now);
  ledger = creditInterval(ledger, 'youtube.com', now - 3000, now, now);
  ledger = creditInterval(ledger, 'youtube.com', now - 4000, now - 1000, now);
  assert.equal(usedMs(ledger, 'youtube.com'), 4000);
  assert.deepEqual(ledger.usage['youtube.com'], [[now - 4000, now]]);
});

test('different domains retain independent counters even at the same wall-clock time', () => {
  const now = instant(); let ledger = emptyLedger(now);
  ledger = creditInterval(ledger, 'youtube.com', now - 3000, now, now);
  ledger = creditInterval(ledger, 'tiktok.com', now - 2000, now, now);
  assert.equal(usedMs(ledger, 'youtube.com'), 3000);
  assert.equal(usedMs(ledger, 'tiktok.com'), 2000);
  assert.equal(usedMs(ledger, 'example.com'), 0);
  assert.equal(totalUsedMs(ledger), 5000);
});

test('mode activation clips only new reports and preserves already-used daily budget', () => {
  const now = instant(), since = now - 1000;
  let ledger = creditInterval(emptyLedger(now), 'youtube.com', now - 5000, now - 3000, now);
  ledger = creditInterval(ledger, 'youtube.com', now - 3000, now, now, since);
  assert.equal(usedMs(ledger, 'youtube.com'), 3000);
  assert.deepEqual(ledger.usage['youtube.com'], [[now - 5000, now - 3000], [since, now]]);
  ledger = creditInterval(ledger, 'youtube.com', now - 3000, now - 2000, now, since);
  assert.equal(usedMs(ledger, 'youtube.com'), 3000);
});

test('checkpoint serialization and repeated reports cannot double-charge a domain', () => {
  const now = instant();
  let ledger = creditInterval(emptyLedger(now), 'youtube.com', now - 4000, now - 1000, now);
  ledger = JSON.parse(JSON.stringify(ledger));
  ledger = creditInterval(ledger, 'youtube.com', now - 4000, now - 1000, now);
  ledger = creditInterval(ledger, 'youtube.com', now - 2000, now, now);
  assert.equal(usedMs(ledger, 'youtube.com'), 4000);
});

test('credit accepts exact maximum gap and exact stale-event boundary', () => {
  const now = instant();
  let ledger = creditInterval(emptyLedger(now), 'youtube.com', now - MAX_GAP_MS, now, now);
  assert.equal(usedMs(ledger, 'youtube.com'), MAX_GAP_MS);
  ledger = creditInterval(emptyLedger(now), 'youtube.com', now - 16000, now - 15000, now);
  assert.equal(usedMs(ledger, 'youtube.com'), 1000);
});

test('credit rejects zero, reverse, oversize, sleep, stale and nonfinite spans', () => {
  const now = instant();
  const spans = [[now, now], [now, now - 1], [now - MAX_GAP_MS - 1, now],
    [now - 3600000, now], [now - 17000, now - 15001], [now, now + 1001],
    [NaN, now], [now - 1000, NaN], [Infinity, now], [-Infinity, now]];
  for (const [start, end] of spans) {
    const ledger = creditInterval(emptyLedger(now), 'youtube.com', start, end, now);
    assert.equal(usedMs(ledger, 'youtube.com'), 0, `${start} → ${end}`);
  }
});

test('small future clock skew is clipped to now and entirely-future spans get no credit', () => {
  const now = instant();
  assert.equal(usedMs(creditInterval(emptyLedger(now), 'youtube.com', now - 1000, now + 1000, now), 'youtube.com'), 1000);
  assert.equal(usedMs(creditInterval(emptyLedger(now), 'youtube.com', now + 10, now + 1000, now), 'youtube.com'), 0);
});

test('midnight rollover credits only the current-day portion, without yesterday leakage', () => {
  const midnight = +new Date(2026, 9, 3), now = midnight + 2000;
  let ledger = creditInterval(emptyLedger(midnight - 1), 'youtube.com', midnight - 4000, midnight - 1000, midnight - 1);
  assert.equal(usedMs(ledger, 'youtube.com'), 3000);
  ledger = creditInterval(ledger, 'youtube.com', midnight - 2000, midnight + 1000, now);
  assert.equal(ledger.day, '2026-10-03');
  assert.equal(usedMs(ledger, 'youtube.com'), 1000);
  ledger = creditInterval(ledger, 'youtube.com', midnight - 3000, midnight - 1000, now);
  assert.equal(usedMs(ledger, 'youtube.com'), 1000);
});

test('DST and non-UTC calendar boundaries use local midnight, not fixed 24-hour arithmetic', () => {
  const moduleUrl = new URL('../extension/core.js', import.meta.url).href;
  const program = `import assert from 'node:assert/strict';
    import { localDay, localMidnight, nextMidnight, creditInterval, usedMs } from ${JSON.stringify(moduleUrl)};
    const spring = +new Date(2026, 2, 8, 12), autumn = +new Date(2026, 10, 1, 12);
    assert.equal(nextMidnight(spring)-localMidnight(spring), 23*3600000);
    assert.equal(nextMidnight(autumn)-localMidnight(autumn), 25*3600000);
    assert.equal(localDay(Date.parse('2026-10-03T03:59:59Z')), '2026-10-02');
    const midnight = +new Date(2026, 2, 9), now = midnight+2000;
    const ledger = creditInterval({day:localDay(midnight-1),usage:{}}, 'youtube.com', midnight-2000, midnight+1000, now);
    assert.equal(ledger.day, '2026-03-09'); assert.equal(usedMs(ledger, 'youtube.com'), 1000);`;
  execFileSync(process.execPath, ['--input-type=module', '-e', program], { env: { ...process.env, TZ: 'America/New_York' }, stdio: 'pipe' });
});

test('shared daily budget blocks exactly at the combined total and stays off for disabled rules', () => {
  const now = instant();
  const ledger = emptyLedger(now);
  ledger.usage['youtube.com'] = [[now - 40000, now]];
  ledger.usage['tiktok.com'] = [[now - 19999, now]];
  const under = budgetOf(1, ledger);
  assert.equal(under.usedMs, 59999);
  assert.equal(under.remainingMs, 1);
  assert.equal(under.blocked, false);
  assert.equal(ruleStatus(rule(), ledger, under).blocked, false);
  ledger.usage['tiktok.com'] = [[now - 20000, now]];
  const exact = budgetOf(1, ledger);
  assert.equal(exact.usedMs, 60000);
  assert.equal(exact.blocked, true);
  assert.equal(ruleStatus(rule(), ledger, exact).blocked, true);
  assert.equal(ruleStatus(rule({ domain: 'tiktok.com' }), ledger, exact).blocked, true);
  assert.equal(ruleStatus(rule({ enabled: false }), ledger, exact).blocked, false);
  assert.equal(budgetOf(0, emptyLedger(now)).blocked, true);
  ledger.usage['youtube.com'] = [[now - 70000, now]];
  delete ledger.usage['tiktok.com'];
  assert.equal(budgetOf(1, ledger).remainingMs, 0);
});

test('toolbar badge uses 1h30m above one hour and mm:ss below it', () => {
  assert.equal(countdownBadge(0), '00:00');
  assert.equal(countdownBadge(1), '00:01');
  assert.equal(countdownBadge(9 * 60000 + 59000), '09:59');
  assert.equal(countdownBadge(10 * 60000), '10:00');
  assert.equal(countdownBadge(59 * 60000 + 59000), '59:59');
  assert.equal(countdownBadge(60 * 60000), '1h0m');
  assert.equal(countdownBadge(90 * 60000), '1h30m');
  assert.equal(countdownBadge(10 * 3600000), '10h0m');
  assert.equal(countdownBadge(10 * 3600000 + 30 * 60000), '10h30m');
  assert.equal(countdownBadge(24 * 3600000), '24h0m');
  assert.equal(remainingPhrase(40000), '40秒');
  assert.equal(remainingPhrase(90000), '1分30秒');
  assert.equal(remainingPhrase(30 * 60000), '30分');
  assert.equal(remainingPhrase(90 * 60000), '1時間30分');
});

const media = (overrides = {}) => ({ playing: true, seeking: false, time: 10, rate: 1, ...overrides });

test('real video advance is accepted at normal and altered speed without changing wall-clock credit', () => {
  for (const rate of [0.25, 0.5, 1, 2, 4, 16]) {
    assert.equal(mediaAdvanced(media({ rate }), media({ time: 10 + rate }), 1000), true, `rate ${rate}`);
  }
});

test('media that was paused or seeking, missing samples, no progress and sleep gaps are excluded', () => {
  for (const previous of [null, undefined, media({ playing: false }), media({ seeking: true })]) {
    assert.equal(mediaAdvanced(previous, media({ time: 11 }), 1000), false);
  }
  assert.equal(mediaAdvanced(media(), null, 1000), false);
  assert.equal(mediaAdvanced(media(), media({ time: 11, seeking: true }), 1000), false);
  for (const time of [10, 9, NaN, Infinity]) assert.equal(mediaAdvanced(media(), media({ time }), 1000), false);
  for (const elapsed of [0, -1, MAX_GAP_MS + 1, Infinity, NaN]) assert.equal(mediaAdvanced(media(), media({ time: 11 }), elapsed), false);
});

test('seek-like large jumps are excluded while a final progressing interval before pause counts', () => {
  assert.equal(mediaAdvanced(media(), media({ time: 60 }), 1000), false);
  assert.equal(mediaAdvanced(media({ rate: 2 }), media({ time: 50 }), 1000), false);
  assert.equal(mediaAdvanced(media(), media({ time: 11, playing: false }), 1000), true);
});

// Verify the actual classic content-script helper, not just the module copy.
await import('../extension/media.js');
const browserMedia = globalThis.JikanMedia;

test('classic content script and pure counter share media-advance decisions', () => {
  assert.equal(browserMedia.MAX_GAP_MS, MAX_GAP_MS);
  const previousSamples = [null, media(), media({ playing: false }), media({ seeking: true }), media({ rate: 0.5 }), media({ rate: 2 })];
  const currentSamples = [null, media({ time: 10 }), media({ time: 11 }), media({ time: 12 }), media({ time: 100 }), media({ time: 11, seeking: true }), media({ time: 11, playing: false })];
  for (const previous of previousSamples) for (const current of currentSamples) for (const elapsed of [0, 250, 1000, 5000, 5001]) {
    assert.equal(browserMedia.advanced(previous, current, elapsed), mediaAdvanced(previous, current, elapsed));
  }
});

test('media snapshot requires an unpaused, unended, nonseeking video with future data', () => {
  const video = { currentTime: 20, playbackRate: 2, paused: false, ended: false, seeking: false, readyState: 4 };
  assert.deepEqual(browserMedia.snapshot(video), { time: 20, rate: 2, playing: true, seeking: false });
  for (const overrides of [{ paused: true }, { ended: true }, { seeking: true }, { readyState: 0 }, { readyState: 2 }, { playbackRate: 0 }]) {
    assert.equal(browserMedia.snapshot({ ...video, ...overrides }).playing, false);
  }
  assert.equal(browserMedia.snapshot({ ...video, readyState: 3 }).playing, true);
  assert.equal(browserMedia.snapshot({ ...video, muted: true }).playing, true, 'muted playback is still playback');
});
