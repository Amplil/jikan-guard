'use strict';

const siteList = document.getElementById('site-list');
const statusMessage = document.getElementById('popup-status');
const cards = new Map();
let loading = false;
let lastMessage = '';

function duration(ms) {
  const seconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分${seconds % 60 ? ` ${seconds % 60}秒` : ''}`;
  return `${Math.floor(minutes / 60)}時間${minutes % 60 ? ` ${minutes % 60}分` : ''}`;
}

function clock(ms) {
  const seconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 1) return `${hours}h${minutes}m`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function refreshDelay(ms) {
  const seconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  if (seconds < 3600) return 1000;
  return ((seconds % 60) + 1) * 1000;
}

function showStatus(message, error = false) {
  if (message !== lastMessage) statusMessage.textContent = message;
  lastMessage = message;
  statusMessage.classList.toggle('is-error', error);
  statusMessage.hidden = !message;
}

function makeCard() {
  const card = document.createElement('article');
  card.className = 'site-card';
  const top = document.createElement('div');
  top.className = 'site-card-top';
  const identity = document.createElement('div');
  identity.className = 'site-identity';
  const monogram = document.createElement('span');
  monogram.className = 'site-monogram';
  monogram.setAttribute('aria-hidden', 'true');
  const name = document.createElement('h3');
  const badge = document.createElement('span');
  badge.className = 'badge';
  identity.append(monogram, name);
  top.append(identity, badge);
  const used = document.createElement('div');
  used.className = 'remaining-line';
  const amount = document.createElement('strong');
  const label = document.createElement('span');
  label.textContent = '使用';
  used.append(amount, label);
  const meta = document.createElement('div');
  meta.className = 'site-meta';
  const mode = document.createElement('span');
  meta.append(mode);
  card.append(top, used, meta);
  return {card, name, badge, monogram, amount, mode};
}

function render(state) {
  document.getElementById('today').textContent = state.day ? state.day.replaceAll('-', '.') : '';
  const limit = Number(state.dailyLimitMinutes) || 0;
  const used = Number(state.usedMs) || 0;
  const remaining = Number(state.remainingMs) || 0;
  const blocked = Boolean(state.blocked);
  const ratio = limit > 0 ? Math.min(100, Math.max(0, used / (limit * 600))) : (blocked ? 100 : 0);
  const hero = document.getElementById('budget-hero');
  const track = document.getElementById('budget-track');
  hero.classList.toggle('is-blocked', blocked);
  document.getElementById('remaining').textContent = clock(remaining);
  document.getElementById('budget-fill').style.width = `${Number.isFinite(ratio) ? ratio : 0}%`;
  track.setAttribute('aria-valuenow', String(Math.round(Number.isFinite(ratio) ? ratio : 0)));
  track.setAttribute('aria-valuetext', `${duration(used)}使用、1日の合計${limit}分`);
  document.getElementById('budget-meta').textContent = `${duration(used)} 使用 / 合計 ${limit}分`;
  const rules = Array.isArray(state.rules) ? state.rules : [];
  const present = new Set();
  for (const rule of rules) {
    present.add(rule.domain);
    if (!cards.has(rule.domain)) cards.set(rule.domain, makeCard());
    const view = cards.get(rule.domain);
    view.name.textContent = rule.domain;
    view.name.title = rule.domain;
    view.monogram.textContent = String(rule.domain).replace(/^www\./, '').slice(0, 1).toUpperCase();
    const enabled = rule.enabled !== false;
    const siteBlocked = enabled && Boolean(rule.blocked);
    view.card.classList.toggle('is-blocked', siteBlocked);
    view.card.classList.toggle('is-disabled', !enabled);
    view.badge.textContent = !enabled ? 'OFF' : siteBlocked ? '今日の上限です' : '計測中';
    view.amount.textContent = duration(rule.usedMs);
    view.mode.textContent = rule.mode === 'foreground' ? '見えているタブ' : '動画の再生';
    siteList.append(view.card);
  }
  for (const [domain, view] of cards) {
    if (!present.has(domain)) { view.card.remove(); cards.delete(domain); }
  }
  document.getElementById('empty-state').hidden = rules.length > 0;
}

async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
    if (!state?.ok || !Array.isArray(state.rules)) throw new Error(state?.error || '利用状況を取得できませんでした');
    render(state);
    nextWait = refreshDelay(state.remainingMs);
    showStatus('');
  } catch (error) {
    nextWait = 1000;
    showStatus(`読み込みに失敗しました。${error.message || '拡張機能を開き直してください'}`, true);
  } finally { loading = false; }
}

document.getElementById('open-options').addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({type: 'OPEN_OPTIONS'});
    if (response?.ok === false) throw new Error(response.error || '設定を開けませんでした');
  } catch (error) { showStatus(error.message || '設定を開けませんでした', true); }
});
let refreshTimer = 0;
let closed = false;
let nextWait = 1000;
async function tick() {
  const started = Date.now();
  await refresh();
  if (closed) return;
  refreshTimer = setTimeout(tick, Math.max(0, nextWait - (Date.now() - started)));
}
tick();
window.addEventListener('pagehide', () => { closed = true; clearTimeout(refreshTimer); }, {once: true});
