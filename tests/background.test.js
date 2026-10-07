import test from 'node:test';
import assert from 'node:assert/strict';
import { localDay, nextMidnight } from '../extension/core.js';

const RULE = { domain: 'youtube.com', mode: 'video', enabled: true };
const NOW = +new Date(2026, 9, 2, 12);
let importId = 0;
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const event = () => {
  const listeners = [];
  return { addListener: (fn) => listeners.push(fn), listeners, emit: (...args) => listeners.forEach(fn => fn(...args)) };
};
const state = (rules = [RULE], usage = {}, at = NOW, dailyLimitMinutes = 1) => ({ schema: 1, dailyLimitMinutes, rules: copy(rules), since: {}, ledger: { day: localDay(at), usage: copy(usage) } });

async function harness(options = {}) {
  const oldChrome = globalThis.chrome, oldNow = Date.now;
  let now = options.now ?? NOW;
  const storage = options.state ? { state: copy(options.state) } : {};
  const tabs = new Map((options.tabs ?? [{ id: 1, windowId: 11, url: 'https://www.youtube.com/watch?v=1', active: true }]).map(tab => [tab.id, copy(tab)]));
  const windows = new Map((options.windows ?? [{ id: 11, focused: true, state: 'normal' }]).map(win => [win.id, copy(win)]));
  let dynamicRules = copy(options.dynamicRules ?? []);
  const alarms = new Map();
  const calls = { storageWrites: [], tabMessages: [], tabUpdates: [], injections: [], dynamicUpdates: [], badges: [], badgeColors: [], titles: [], openOptions: 0 };
  const api = {
    runtime: { id: 'test-extension', getURL: (path = '') => `chrome-extension://test-extension/${path}`,
      onMessage: event(), onStartup: event(), onInstalled: event(),
      openOptionsPage: async () => { calls.openOptions++; } },
    storage: { local: { setAccessLevel: async () => { if (options.hangAccessLevel) await new Promise(() => {}); }, get: async () => copy(storage),
      set: async (updates) => { Object.assign(storage, copy(updates)); calls.storageWrites.push(copy(updates)); } } },
    alarms: { onAlarm: event(), get: async name => copy(alarms.get(name)),
      create: async (name, alarm) => { alarms.set(name, copy(alarm)); } },
    tabs: { onUpdated: event(), onActivated: event(), onRemoved: event(),
      get: async id => { if (!tabs.has(id)) throw Error('No tab'); return copy(tabs.get(id)); },
      query: async () => Array.from(tabs.values(), copy),
      sendMessage: async (id, message) => { calls.tabMessages.push({ id, message: copy(message) }); if (options.hangTabMessages) await new Promise(() => {}); return { ok: true }; },
      update: async (id, updates) => { calls.tabUpdates.push({ id, updates: copy(updates) }); Object.assign(tabs.get(id), updates); return copy(tabs.get(id)); } },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: event(), get: async id => {
      if (!windows.has(id)) throw Error('No window'); return copy(windows.get(id));
    }, getAll: async () => Array.from(windows.values(), copy) },
    declarativeNetRequest: { getDynamicRules: async () => copy(dynamicRules), updateDynamicRules: async update => {
      calls.dynamicUpdates.push(copy(update));
      dynamicRules = [...dynamicRules.filter(rule => !update.removeRuleIds.includes(rule.id)), ...copy(update.addRules)];
    } },
    action: { setBadgeBackgroundColor: async value => { calls.badgeColors.push(copy(value)); }, setBadgeTextColor: async () => {},
      setBadgeText: async value => { calls.badges.push(copy(value)); }, setTitle: async value => { calls.titles.push(copy(value)); } },
    scripting: { executeScript: async value => { calls.injections.push(copy(value)); } }
  };
  Date.now = () => now;
  globalThis.chrome = api;
  await import(`../extension/background.js?mock=${++importId}`);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  const trusted = { id: api.runtime.id, url: api.runtime.getURL('options.html') };
  const content = (id = 1, frameId = 0, additions = {}) => ({ id: api.runtime.id, tab: copy(tabs.get(id)), frameId, url: tabs.get(id)?.url, ...additions });
  const send = (message, sender = trusted) => new Promise((resolve, reject) => {
    const listener = api.runtime.onMessage.listeners[0];
    if (!listener) return reject(Error('No onMessage listener registered'));
    const asynchronous = listener(message, sender, resolve);
    assert.equal(asynchronous, true, 'MV3 async handler preserves the response channel');
  });
  return { api, calls, storage, tabs, windows, alarms, trusted, content, send, settle,
    setNow: value => { now = value; }, dynamicRules: () => copy(dynamicRules),
    close: async () => { await settle(); Date.now = oldNow; globalThis.chrome = oldChrome; } };
}

async function using(options, body) { const h = await harness(options); try { await body(h); } finally { await h.close(); } }
const span = (start, end, extras = {}) => ({ start, end, video: true, foreground: false, ...extras });
const report = intervals => ({ type: 'REPORT', intervals });
const total = (h, domain = 'youtube.com') => (h.storage.state.ledger.usage[domain] ?? []).reduce((n, [a, b]) => n + b - a, 0);

test('worker startup creates durable defaults, recovery alarms, and reconciles stale dynamic rules', async () => using({ dynamicRules: [{ id: 88 }] }, async h => {
  assert.equal(h.storage.state.schema, 1);
  assert.equal(h.storage.state.dailyLimitMinutes, 30);
  assert.deepEqual(h.storage.state.rules.map(rule => rule.domain), ['youtube.com', 'tiktok.com']);
  assert.deepEqual(h.storage.state.rules[0].excludedSubdomains, ['music.youtube.com']);
  assert.equal(h.calls.badges.at(-1).text, '30:00');
  assert.match(h.calls.titles.at(-1).title, /あと30分/);
  assert.equal(h.alarms.get('reconcile').periodInMinutes, 0.5);
  assert.equal(h.alarms.get('midnight').when, nextMidnight(NOW));
  assert.deepEqual(h.dynamicRules(), []);
  assert.deepEqual(h.calls.dynamicUpdates[0].removeRuleIds, [88]);
}));

test('persisted exhausted budgets restore main-frame blocking and stop matching open tabs', async () => using({
  state: state([{...RULE, excludedSubdomains:['music.youtube.com']}], { 'youtube.com': [[NOW - 60000, NOW]] }),
  tabs: [{ id: 1, windowId: 11, url: 'https://www.youtube.com/watch?v=1', active: true }, { id: 2, windowId: 11, url: 'https://music.youtube.com', active: false }]
}, async h => {
  const [block] = h.dynamicRules();
  assert.deepEqual(block.condition, { requestDomains:['youtube.com'], excludedRequestDomains:['music.youtube.com'], resourceTypes: ['main_frame'] });
  assert.equal(block.action.type, 'redirect');
  assert.equal(block.action.redirect.url, h.api.runtime.getURL('blocked.html?domain=youtube.com'));
  assert.deepEqual(h.calls.tabUpdates.map(call => call.id), [1]);
  assert.ok(h.calls.tabMessages.some(call => call.id === 1 && call.message.type === 'BLOCK'));
  assert.equal(h.tabs.get(2).url, 'https://music.youtube.com');
  assert.deepEqual(block.condition.excludedRequestDomains, ['music.youtube.com']);
}));

test('only this extension own pages can get state or change settings', async () => using({ state: state() }, async h => {
  const okay = await h.send({ type: 'GET_STATE' }); assert.equal(okay.ok, true); assert.equal(okay.dailyLimitMinutes, 1); assert.equal(okay.remainingMs, 60000); assert.equal(okay.rules[0].remainingMs, 60000);
  for (const sender of [h.content(), { id: 'other-extension', url: h.trusted.url }, { id: h.api.runtime.id, url: 'https://example.com' }]) {
    assert.equal((await h.send({ type: 'GET_STATE' }, sender)).ok, false);
    assert.equal((await h.send({ type: 'SAVE_SETTINGS', rules: [] }, sender)).ok, false);
  }
  assert.equal(h.storage.state.rules.length, 1);
  assert.equal((await h.send({ type: 'OPEN_OPTIONS' })).ok, true);
  assert.equal(h.calls.openOptions, 1);
}));

test('settings normalize domains and preserve usage across limit, mode, removal and re-add changes', async () => using({ state: state([RULE], { 'youtube.com': [[NOW - 5000, NOW]] }) }, async h => {
  let response = await h.send({ type: 'SAVE_SETTINGS', dailyLimitMinutes: 2, rules: [{ ...RULE, domain: 'YouTube.COM.' }] });
  assert.equal(response.ok, true); assert.equal(response.dailyLimitMinutes, 2); assert.equal(response.usedMs, 5000); assert.equal(response.rules[0].usedMs, 5000); assert.equal(h.storage.state.since['youtube.com'], undefined);
  response = await h.send({ type: 'SAVE_SETTINGS', dailyLimitMinutes: 2, rules: [{ ...RULE, mode: 'foreground' }] });
  assert.equal(response.rules[0].usedMs, 5000); assert.equal(h.storage.state.since['youtube.com'], NOW);
  assert.equal((await h.send({ type: 'SAVE_SETTINGS', dailyLimitMinutes: 2, rules: [] })).ok, true);
  h.setNow(NOW + 1000);
  response = await h.send({ type: 'SAVE_SETTINGS', dailyLimitMinutes: 2, rules: [RULE] });
  assert.equal(response.rules[0].usedMs, 5000); assert.equal(h.storage.state.since['youtube.com'], NOW + 1000);
}));

test('invalid settings fail atomically without replacing saved rules', async () => using({ state: state() }, async h => {
  for (const message of [
    { type: 'SAVE_SETTINGS', rules: [RULE] },
    { type: 'SAVE_SETTINGS', dailyLimitMinutes: -1, rules: [RULE] },
    { type: 'SAVE_SETTINGS', dailyLimitMinutes: 1.5, rules: [RULE] },
    { type: 'SAVE_SETTINGS', dailyLimitMinutes: 1, rules: [RULE, { ...RULE, domain: 'www.youtube.com' }] },
    { type: 'SAVE_SETTINGS', dailyLimitMinutes: 1, rules: [{ ...RULE, enabled: 'true' }] }
  ]) {
    assert.equal((await h.send(message)).ok, false);
    assert.deepEqual(h.storage.state.rules, [RULE]);
    assert.equal(h.storage.state.dailyLimitMinutes, 1);
  }
}));

test('video mode counts only video-positive samples and unions duplicate reports across tabs/frames', async () => using({ state: state(), tabs: [
  { id: 1, windowId: 11, url: 'https://youtube.com/watch?v=1', active: true },
  { id: 2, windowId: 11, url: 'https://www.youtube.com/watch?v=2', active: false }
] }, async h => {
  await h.send(report([span(NOW - 5000, NOW - 4000, { video: false, foreground: true })]), h.content());
  assert.equal(total(h), 0);
  await h.send(report([span(NOW - 4000, NOW - 1000)]), h.content(1));
  await h.send(report([span(NOW - 3000, NOW)]), h.content(2, 9, { url: 'https://embed.example/player' }));
  await h.send(report([span(NOW - 4000, NOW - 1000)]), h.content(1));
  assert.equal(total(h), 4000);
}));

test('reports on an unconfigured or disabled site do not consume a budget', async () => using({ state: state([{ ...RULE, enabled: false }]) }, async h => {
  await h.send(report([span(NOW - 1000, NOW)]), h.content()); assert.equal(total(h), 0);
  h.tabs.get(1).url = 'https://other.example';
  assert.equal((await h.send(report([span(NOW - 1000, NOW)]), h.content())).rule, null);
  assert.equal(total(h), 0);
}));

test('excluded music subdomain can be separately registered with its own mode', async () => using({ state: state([{...RULE, excludedSubdomains:['music.youtube.com']}]), tabs: [
  { id: 1, windowId: 11, url: 'https://www.youtube.com/watch?v=1', active: false },
  { id: 2, windowId: 11, url: 'https://music.youtube.com/watch?v=2', active: true }
] }, async h => {
  assert.equal((await h.send({ type: 'HELLO' }, h.content(2))).rule, null);
  assert.equal((await h.send(report([span(NOW - 1000, NOW)]), h.content(2))).rule, null);
  assert.equal(total(h), 0);
  const musicRule = { ...RULE, domain: 'music.youtube.com', mode: 'foreground' };
  const response = await h.send({ type: 'SAVE_SETTINGS', dailyLimitMinutes: 1, rules: [{...RULE, excludedSubdomains:['music.youtube.com']}, musicRule] });
  assert.equal(response.ok, true);
  assert.deepEqual(h.calls.tabMessages.find(call => call.id === 2 && call.message.type === 'CONFIG').message.rule, musicRule);
  h.setNow(NOW + 2000);
  await h.send(report([span(NOW + 1000, NOW + 2000, { video: false, foreground: true })]), h.content(2));
  assert.equal(total(h, 'music.youtube.com'), 1000);
  assert.equal(total(h), 0);
}));

test('navigation and recovery do not redirect an excluded music subdomain at the limit', async () => using({
  state: state([{...RULE, excludedSubdomains:['music.youtube.com']}], { 'youtube.com': [[NOW - 60000, NOW]] }),
  tabs: [{ id: 1, windowId: 11, url: 'https://music.youtube.com/', active: true }],
  dynamicRules: [{ id: 77, condition: { requestDomains: ['youtube.com'] } }]
}, async h => {
  assert.deepEqual(h.calls.dynamicUpdates[0].removeRuleIds, [77]);
  assert.equal(h.calls.tabUpdates.length, 0);
  h.api.tabs.onUpdated.emit(1, { status: 'loading' }, h.tabs.get(1));
  h.api.alarms.onAlarm.emit({ name: 'reconcile' });
  await h.send({ type: 'GET_STATE' });
  assert.equal(h.calls.tabUpdates.length, 0);
  assert.equal(h.calls.tabMessages.some(call => call.message.type === 'BLOCK'), false);
}));

test('saving exclusions updates loaded tabs and DNR without erasing usage, and removing them restores blocking', async () => using({
  state: state([RULE], { 'youtube.com': [[NOW - 60000, NOW]] }),
  tabs: [{ id: 1, windowId: 11, url: 'https://example.com/', active: true }]
}, async h => {
  h.tabs.get(1).url = 'https://music.youtube.com/watch?v=1';
  const excluded = {...RULE, excludedSubdomains:['music.youtube.com','studio.youtube.com']};
  let response = await h.send({type:'SAVE_SETTINGS', dailyLimitMinutes:1, rules:[excluded]});
  assert.equal(response.ok, true);
  assert.equal(response.usedMs, 60000);
  assert.deepEqual(response.rules[0].excludedSubdomains, excluded.excludedSubdomains);
  assert.deepEqual(h.storage.state.rules, [excluded]);
  assert.deepEqual(h.dynamicRules()[0].condition.excludedRequestDomains, excluded.excludedSubdomains);
  assert.equal(h.calls.tabUpdates.length, 0);
  assert.equal(h.calls.tabMessages.at(-1).message.rule, null);
  assert.equal((await h.send({type:'HELLO'}, h.content())).rule, null);
  response = await h.send({type:'SAVE_SETTINGS', dailyLimitMinutes:1, rules:[RULE]});
  assert.equal(response.usedMs, 60000);
  assert.equal(h.dynamicRules()[0].condition.excludedRequestDomains, undefined);
  assert.match(h.tabs.get(1).url, /blocked.html/);
}));

test('excluded descendants cannot charge usage and re-inclusion cannot backfill earlier reports', async () => using({
  state: state([{...RULE, excludedSubdomains:['music.youtube.com']}]),
  tabs: [{id:1, windowId:11, url:'https://sub.music.youtube.com/', active:true}]
}, async h => {
  assert.equal((await h.send(report([span(NOW - 1000, NOW)]), h.content())).rule, null);
  assert.equal(total(h), 0);
  await h.send({type:'SAVE_SETTINGS', dailyLimitMinutes:1, rules:[RULE]});
  h.setNow(NOW + 1000);
  await h.send(report([span(NOW - 1000, NOW + 1000)]), h.content());
  assert.equal(total(h), 1000);
}));

test('foreground mode counts a selected tab in a visible unfocused window and skips hidden tabs and minimized windows', async () => using({ state: state([{ ...RULE, mode: 'foreground' }]) }, async h => {
  const foreground = (start, end) => report([span(start, end, { video: false, foreground: true })]);
  await h.send(foreground(NOW - 5000, NOW - 4000), h.content(1, 7));
  assert.equal(total(h), 0);
  h.tabs.get(1).active = false;
  await h.send(foreground(NOW - 4000, NOW - 3000), h.content());
  assert.equal(total(h), 0);
  h.tabs.get(1).active = true;
  h.windows.get(11).focused = false;
  h.windows.get(11).state = 'minimized';
  await h.send(foreground(NOW - 3000, NOW - 2000), h.content());
  assert.equal(total(h), 0);
  h.windows.get(11).state = 'normal';
  await h.send(report([span(NOW - 2000, NOW - 1000)]), h.content());
  assert.equal(total(h), 0);
  await h.send(foreground(NOW - 1000, NOW), h.content());
  assert.equal(total(h), 1000);
}));

test('content reports reject foreign extension senders and invalid envelope shapes', async () => using({ state: state() }, async h => {
  assert.equal((await h.send(report([span(NOW - 1000, NOW)]), h.content(1, 0, { id: 'other-extension' }))).ok, false);
  assert.equal((await h.send(report('bad'), h.content())).ok, false);
  assert.equal((await h.send(report(new Array(65).fill(span(NOW - 1000, NOW))), h.content())).ok, false);
  assert.equal((await h.send({ type: 'UNKNOWN' }, h.content())).ok, false);
  assert.equal(total(h), 0);
}));

test('stale, reversed and sleep-gap samples never reach durable usage', async () => using({ state: state() }, async h => {
  await h.send(report([span(NOW - 6000, NOW), span(NOW, NOW - 1000), span(NOW - 17000, NOW - 16000), span(NOW - 1000, NOW + 2000)]), h.content());
  assert.equal(total(h), 0);
}));

test('a report reaching the exact limit blocks all same-domain tabs and updates the badge', async () => using({ state: state([RULE], { 'youtube.com': [[NOW - 60000, NOW - 1000]] }), tabs: [
  { id: 1, windowId: 11, url: 'https://youtube.com/watch?v=1', active: true },
  { id: 2, windowId: 11, url: 'https://www.youtube.com/shorts/2', active: false }
] }, async h => {
  const response = await h.send(report([span(NOW - 1000, NOW)]), h.content());
  assert.equal(response.blocked, true); assert.equal(total(h), 60000);
  assert.deepEqual(h.calls.tabUpdates.map(call => call.id), [1, 2]);
  assert.equal(h.dynamicRules().length, 1);
  assert.equal(h.calls.badges.at(-1).text, '00:00');
  assert.match(h.calls.titles.at(-1).title, /今日の上限です/);
}));

test('midnight recovery clears yesterday usage and its persistent blocking rules', async () => using({ state: state([RULE], { 'youtube.com': [[NOW - 60000, NOW]] }) }, async h => {
  assert.equal(h.dynamicRules().length, 1);
  h.setNow(nextMidnight(NOW) + 1000);
  h.api.alarms.onAlarm.emit({ name: 'midnight' }); await h.settle();
  const response = await h.send({ type: 'GET_STATE' });
  assert.equal(response.rules[0].usedMs, 0); assert.equal(response.rules[0].blocked, false);
  assert.deepEqual(h.dynamicRules(), []);
  assert.equal(h.alarms.get('midnight').when, nextMidnight(nextMidnight(NOW) + 1000));
}));

test('concurrent reports serialize persistence and cannot lose or double-count usage', async () => using({ state: state() }, async h => {
  const responses = await Promise.all([
    h.send(report([span(NOW - 5000, NOW - 3000)]), h.content()),
    h.send(report([span(NOW - 4000, NOW - 1000)]), h.content()),
    h.send(report([span(NOW - 2000, NOW)]), h.content())
  ]);
  assert.ok(responses.every(result => result.ok)); assert.equal(total(h), 5000);
}));

test('reports cannot backfill time before the most recent mode activation', async () => using({ state: state() }, async h => {
  await h.send({ type: 'SAVE_SETTINGS', dailyLimitMinutes: 1, rules: [{ ...RULE, mode: 'foreground' }] });
  h.setNow(NOW + 1000);
  await h.send(report([span(NOW - 2000, NOW + 1000, { foreground: true })]), h.content());
  assert.equal(total(h), 1000);
}));

test('worker restart restores durable usage and replayed reports remain idempotent', async () => {
  let persisted;
  await using({ state: state() }, async h => {
    await h.send(report([span(NOW - 2000, NOW)]), h.content()); persisted = copy(h.storage.state);
  });
  await using({ state: persisted }, async h => {
    await h.send(report([span(NOW - 2000, NOW)]), h.content()); assert.equal(total(h), 2000);
  });
});

test('install/update injects both helpers only into ordinary HTTP(S) tabs', async () => using({ state: state(), tabs: [
  { id: 1, windowId: 11, url: 'https://youtube.com', active: true },
  { id: 2, windowId: 11, url: 'chrome://extensions', active: false },
  { id: 3, windowId: 11, url: 'http://example.com', active: false }
] }, async h => {
  h.api.runtime.onInstalled.emit({ reason: 'install' }); await h.settle();
  assert.deepEqual(h.calls.injections.map(call => call.target.tabId), [1, 3]);
  assert.deepEqual(h.calls.injections[0].files, ['media.js', 'content.js']);
  assert.equal(h.calls.injections[0].target.allFrames, true);
}));

test('a report from the old top-level domain cannot charge the destination after navigation', async () => using({ state: state([RULE, { ...RULE, domain: 'tiktok.com' }]) }, async h => {
  const oldTopSender = h.content();
  const oldFrameSender = h.content(1, 7, { url: 'https://embedded.example/video' });
  h.tabs.get(1).url = 'https://www.tiktok.com/@person/video/1';
  for (const sender of [oldTopSender, oldFrameSender]) {
    const response = await h.send(report([span(NOW - 1000, NOW)]), sender);
    assert.equal(response.ok, true);
    assert.equal(total(h, 'youtube.com'), 0);
    assert.equal(total(h, 'tiktok.com'), 0);
  }
  await h.send(report([span(NOW - 1000, NOW)]), h.content());
  assert.equal(total(h, 'tiktok.com'), 1000);
}));

test('same-host SPA navigation preserves eligible source reports', async () => using({ state: state() }, async h => {
  const originalSender = h.content();
  h.tabs.get(1).url = 'https://www.youtube.com/shorts/new-video';
  await h.send(report([span(NOW - 1000, NOW)]), originalSender);
  assert.equal(total(h), 1000);
}));

test('closed tabs return harmlessly without reviving or crediting stale reports', async () => using({ state: state() }, async h => {
  const originalSender = h.content();
  h.tabs.delete(1);
  const result = await h.send(report([span(NOW - 1000, NOW)]), originalSender);
  assert.equal(result.ok, true); assert.equal(result.rule, null); assert.equal(total(h), 0);
}));

test('recovery alarm retries a blocked-page redirect after a transient tabs.update failure', async () => using({
  state: state([RULE], { 'youtube.com': [[NOW - 60000, NOW - 1000]] })
}, async h => {
  const update = h.api.tabs.update;
  let attempts = 0;
  h.api.tabs.update = async (...args) => {
    attempts++;
    if (attempts === 1) throw Error('Tabs cannot be edited right now');
    return update(...args);
  };
  const result = await h.send(report([span(NOW - 1000, NOW)]), h.content());
  assert.equal(result.blocked, true);
  assert.equal(attempts, 1);
  assert.match(h.tabs.get(1).url, /^https:\/\/www\.youtube\.com/);
  const rulesetWrites = h.calls.dynamicUpdates.length;
  h.api.alarms.onAlarm.emit({ name: 'reconcile' });
  await h.send({ type: 'GET_STATE' });
  assert.equal(attempts, 2);
  assert.equal(h.calls.dynamicUpdates.length, rulesetWrites, 'retry does not rewrite an unchanged DNR ruleset');
  assert.match(h.tabs.get(1).url, /^chrome-extension:\/\/test-extension\/blocked\.html/);
}));

test('legacy per-site limits become one shared daily total, capped at one day', async () => using({
  state: { schema: 1, rules: [
    { domain: 'youtube.com', limitMinutes: 30, mode: 'video', enabled: true },
    { domain: 'tiktok.com', limitMinutes: 45, mode: 'foreground', enabled: true }
  ], since: {}, ledger: { day: localDay(NOW), usage: {} } }
}, async h => {
  assert.equal(h.storage.state.dailyLimitMinutes, 75);
  assert.equal('limitMinutes' in h.storage.state.rules[0], false);
}));

test('legacy limits above one day clamp to 1440 minutes', async () => using({
  state: { schema: 1, rules: [
    { domain: 'youtube.com', limitMinutes: 800, mode: 'video', enabled: true },
    { domain: 'tiktok.com', limitMinutes: 800, mode: 'video', enabled: true }
  ], since: {}, ledger: { day: localDay(NOW), usage: {} } }
}, async h => {
  assert.equal(h.storage.state.dailyLimitMinutes, 1440);
}));

test('toolbar countdown hides when no site is enabled', async () => using({
  state: state([{ ...RULE, enabled: false }])
}, async h => {
  assert.equal(h.calls.badges.at(-1).text, '');
  assert.equal(h.calls.titles.at(-1).title, 'じかんガード');
}));

test('combined usage of different sites shares one daily total and blocks every enabled site', async () => using({
  state: state([RULE, { domain: 'tiktok.com', mode: 'video', enabled: true }], {
    'youtube.com': [[NOW - 30000, NOW - 10000]],
    'tiktok.com': [[NOW - 50000, NOW - 15000]]
  }, NOW, 1),
  tabs: [
    { id: 1, windowId: 11, url: 'https://www.youtube.com/watch?v=1', active: true },
    { id: 2, windowId: 12, url: 'https://www.tiktok.com/@a/video/1', active: true }
  ],
  windows: [
    { id: 11, focused: true, state: 'normal' },
    { id: 12, focused: false, state: 'normal' }
  ]
}, async h => {
  assert.equal(h.calls.badges.at(-1).text, '00:05');
  assert.match(h.calls.titles.at(-1).title, /あと5秒/);
  assert.equal(h.calls.badgeColors.at(-1).color, '#9F4039');
  await h.send(report([span(NOW - 5000, NOW)]), h.content(2));
  assert.equal(total(h, 'tiktok.com'), 40000);
  const response = await h.send({ type: 'GET_STATE' });
  assert.equal(response.usedMs, 60000);
  assert.equal(response.blocked, true);
  assert.equal(response.rules.every(rule => rule.blocked), true);
  assert.deepEqual(h.dynamicRules().map(rule => rule.condition.requestDomains[0]).sort(), ['tiktok.com', 'youtube.com']);
  assert.deepEqual([...new Set(h.calls.tabUpdates.map(call => call.id))].sort(), [1, 2]);
  assert.equal(h.calls.badges.at(-1).text, '00:00');
}));

test('settings still load when storage access locking never settles', { timeout: 3000 }, async () => using({ hangAccessLevel: true, state: state() }, async h => {
  const response = await h.send({ type: 'GET_STATE' });
  assert.equal(response.ok, true);
  assert.equal(response.dailyLimitMinutes, 1);
  assert.equal(response.rules[0].domain, 'youtube.com');
}));

test('a tab that never answers cannot block settings', { timeout: 4000 }, async () => using({
  hangTabMessages: true,
  state: state([RULE], { 'youtube.com': [[NOW - 60000, NOW]] })
}, async h => {
  const started = performance.now();
  const response = await h.send({ type: 'GET_STATE' });
  assert.equal(response.ok, true);
  assert.equal(response.blocked, true);
  assert.ok(performance.now() - started < 3000);
}));
