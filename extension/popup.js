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
  const remaining = document.createElement('div');
  remaining.className = 'remaining-line';
  const amount = document.createElement('strong');
  const label = document.createElement('span');
  label.textContent = 'のこり';
  remaining.append(amount, label);
  const track = document.createElement('div');
  track.className = 'progress-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  const bar = document.createElement('div');
  bar.className = 'progress-fill';
  track.append(bar);
  const meta = document.createElement('div');
  meta.className = 'site-meta';
  const usage = document.createElement('span');
  const mode = document.createElement('span');
  meta.append(usage, mode);
  card.append(top, remaining, track, meta);
  return {card, name, badge, monogram, amount, label, track, bar, usage, mode};
}

function render(state) {
  document.getElementById('today').textContent = state.day ? state.day.replaceAll('-', '.') : '';
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
    const blocked = enabled && Boolean(rule.blocked);
    const ratio = Number(rule.limitMinutes) > 0 ? Math.min(100, Math.max(0, Number(rule.usedMs) / (rule.limitMinutes * 600))) : 100;
    view.card.classList.toggle('is-blocked', blocked);
    view.card.classList.toggle('is-disabled', !enabled);
    view.badge.textContent = !enabled ? 'OFF' : blocked ? '今日の上限です' : 'ON';
    view.amount.textContent = enabled ? duration(rule.remainingMs) : '制限オフ';
    view.label.hidden = !enabled;
    view.bar.style.width = `${Number.isFinite(ratio) ? ratio : 0}%`;
    view.track.setAttribute('aria-valuenow', String(Math.round(Number.isFinite(ratio) ? ratio : 0)));
    view.track.setAttribute('aria-label', `${rule.domain}の今日の使用時間`);
    view.track.setAttribute('aria-valuetext', `${duration(rule.usedMs)}使用、上限${rule.limitMinutes}分`);
    view.usage.textContent = `${duration(rule.usedMs)} 使用 / ${rule.limitMinutes}分`;
    view.mode.textContent = rule.mode === 'foreground' ? '前面のタブ' : '動画の再生';
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
    showStatus('');
  } catch (error) {
    showStatus(`読み込みに失敗しました。${error.message || '拡張機能を開き直してください'}`, true);
  } finally { loading = false; }
}

document.getElementById('open-options').addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({type: 'OPEN_OPTIONS'});
    if (response?.ok === false) throw new Error(response.error || '設定を開けませんでした');
  } catch (error) { showStatus(error.message || '設定を開けませんでした', true); }
});
refresh();
const refreshTimer = setInterval(refresh, 2000);
window.addEventListener('pagehide', () => clearInterval(refreshTimer), {once: true});
