'use strict';

const form = document.getElementById('settings-form');
const list = document.getElementById('rule-list');
const template = document.getElementById('rule-template');
const saveButton = document.getElementById('save-settings');
const addButton = document.getElementById('add-rule');
const saveStatus = document.getElementById('save-status');
const loadStatus = document.getElementById('load-status');
let ready = false;
let saving = false;
let dirty = false;
let nextId = 0;

function setStatus(message, error = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle('is-error', error);
}

function markDirty() {
  if (!ready || saving) return;
  dirty = true;
  setStatus('未保存の変更があります');
}

function updateCount() {
  const count = list.children.length;
  document.getElementById('rule-count').textContent = `${count} / 50`;
  document.getElementById('rules-empty').hidden = count !== 0;
  addButton.disabled = !ready || saving || count >= 50;
}

function clearError(row) {
  const error = row.querySelector('.rule-error');
  error.hidden = true;
  error.textContent = '';
  row.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
}

function setError(row, message, selector) {
  const error = row.querySelector('.rule-error');
  error.hidden = false;
  error.textContent = message;
  const input = row.querySelector(selector);
  input.setAttribute('aria-invalid', 'true');
  return input;
}

function addRow(rule = {domain: '', mode: 'video', enabled: true}, focus = false) {
  const row = template.content.firstElementChild.cloneNode(true);
  const domainInput = row.querySelector('.domain-input');
  const errorId = `rule-error-${++nextId}`;
  row.querySelector('.rule-error').id = errorId;
  row.querySelectorAll('input,select').forEach(input => input.setAttribute('aria-describedby', errorId));
  domainInput.value = rule.domain;
  row.querySelector('.mode-input').value = rule.mode;
  row.querySelector('.enabled-input').checked = rule.enabled !== false;
  const updateLabels = () => {
    const name = domainInput.value.trim() || 'このサイト';
    row.querySelector('legend').textContent = `${name}の設定`;
    row.querySelector('.delete-rule').setAttribute('aria-label', `${name}を削除`);
    const enabled = row.querySelector('.enabled-input').checked;
    row.querySelector('.toggle-text').textContent = enabled ? '有効' : '無効';
    row.classList.toggle('rule-disabled', !enabled);
  };
  row.addEventListener('input', () => {clearError(row); updateLabels(); markDirty();});
  row.addEventListener('change', () => {clearError(row); updateLabels(); markDirty();});
  row.querySelector('.delete-rule').addEventListener('click', () => {
    if (saving) return;
    const sibling = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    markDirty();
    updateCount();
    if (sibling) sibling.querySelector('.domain-input').focus();
    else addButton.focus();
  });
  updateLabels();
  list.append(row);
  updateCount();
  if (focus) domainInput.focus();
}

function normalizeDomain(value) {
  let raw = value.trim().toLowerCase();
  if (!raw) throw new Error('ドメインを入力してください');
  // Permit pasted HTTP(S) URLs, while preserving plain-domain-only settings.
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    if (url.username || url.password || url.port) throw new Error('認証情報やポート番号を含まないドメインを入力してください');
    raw = url.hostname;
  }
  raw = raw.replace(/\.$/, '');
  if (/[\s/:?#@*\\]/.test(raw)) throw new Error('youtube.com のようなドメインを入力してください');
  try { raw = new URL(`https://${raw}/`).hostname; }
  catch { throw new Error('有効なドメインを入力してください'); }
  if (raw.length > 253 || !raw.includes('.') || !/^[a-z0-9.-]+$/.test(raw) || /^\d+(\.\d+){3}$/.test(raw) || raw.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('youtube.com のような有効なドメインを入力してください');
  }
  return raw;
}

function collectRules() {
  const rules = [];
  let firstInvalid = null;
  for (const row of list.children) {
    clearError(row);
    let domain;
    try { domain = normalizeDomain(row.querySelector('.domain-input').value); }
    catch (error) { const input = setError(row, error.message, '.domain-input'); firstInvalid ||= input; continue; }
    const overlap = rules.find(rule => domain === rule.domain || domain.endsWith(`.${rule.domain}`) || rule.domain.endsWith(`.${domain}`));
    if (overlap) {
      const input = setError(row, `${overlap.domain} と範囲が重複しています。どちらか1つにしてください`, '.domain-input');
      firstInvalid ||= input;
      continue;
    }
    rules.push({domain, mode: row.querySelector('.mode-input').value, enabled: row.querySelector('.enabled-input').checked});
  }
  if (firstInvalid) { firstInvalid.focus(); return null; }
  return rules;
}

function readDailyLimit(value) {
  const text = String(value ?? '').trim();
  const minutes = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error('上限は0〜1,440の整数で入力してください');
  return minutes;
}

function setBusy(busy) {
  saving = busy;
  form.querySelectorAll('input,select,button').forEach(control => {control.disabled = busy;});
  saveButton.disabled = busy || !ready;
  saveButton.textContent = busy ? '保存しています…' : '設定を保存';
  updateCount();
}

document.getElementById('daily-limit').addEventListener('input', () => {
  const error = document.getElementById('daily-limit-error');
  error.hidden = true;
  error.textContent = '';
  document.getElementById('daily-limit').removeAttribute('aria-invalid');
  markDirty();
});

addButton.addEventListener('click', () => {
  if (!ready || saving || list.children.length >= 50) return;
  addRow(undefined, true);
  markDirty();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!ready || saving) return;
  const rules = collectRules();
  const limitInput = document.getElementById('daily-limit');
  const limitError = document.getElementById('daily-limit-error');
  let dailyLimitMinutes = null;
  try {
    dailyLimitMinutes = readDailyLimit(limitInput.value);
    limitError.hidden = true;
    limitError.textContent = '';
    limitInput.removeAttribute('aria-invalid');
  } catch (error) {
    limitError.hidden = false;
    limitError.textContent = error.message;
    limitInput.setAttribute('aria-invalid', 'true');
  }
  if (dailyLimitMinutes === null || !rules) {
    setStatus('入力内容を確認してください', true);
    if (dailyLimitMinutes === null) limitInput.focus();
    return;
  }
  setBusy(true);
  setStatus('設定を保存しています…');
  try {
    const state = await withTimeout(chrome.runtime.sendMessage({type: 'SAVE_SETTINGS', dailyLimitMinutes, rules}));
    if (!state?.ok || !Array.isArray(state.rules)) throw new Error(state?.error || '保存できませんでした');
    // Refresh only after this explicit save, never while the user is editing.
    list.replaceChildren();
    document.getElementById('daily-limit').value = state.dailyLimitMinutes;
    (Array.isArray(state.rules) ? state.rules : rules).forEach(rule => addRow(rule));
    dirty = false;
    setStatus('保存しました');
  } catch (error) {
    setStatus(`保存できませんでした。${error.message || 'もう一度お試しください'}`, true);
  } finally {setBusy(false);}
});

window.addEventListener('beforeunload', event => {
  if (dirty) {event.preventDefault(); event.returnValue = '';}
});

function withTimeout(promise, ms = 8000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('応答がありません。ページを再読み込みしてください')), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

async function initialize() {
  try {
    const state = await withTimeout(chrome.runtime.sendMessage({type: 'GET_STATE'}));
    if (!state?.ok || !Array.isArray(state.rules)) throw new Error(state?.error || '設定を取得できませんでした');
    document.getElementById('daily-limit').value = state.dailyLimitMinutes;
    (Array.isArray(state.rules) ? state.rules : []).forEach(rule => addRow(rule));
    ready = true;
    saveButton.disabled = false;
    loadStatus.hidden = true;
    updateCount();
  } catch (error) {
    loadStatus.textContent = `読み込みに失敗しました。${error.message || 'ページを再読み込みしてください'}`;
    loadStatus.classList.add('is-error');
    setStatus('ページを再読み込みして、もう一度お試しください', true);
  }
}
initialize();
