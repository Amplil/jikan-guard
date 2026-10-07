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
  saveButton.disabled = false;
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
  if (selector === '.exclusions-input') {
    row.querySelector('.field-exclusions').hidden = false;
    row.querySelector('.exclusion-domain-input').setAttribute('aria-invalid', 'true');
    return row.querySelector('.exclusion-domain-input');
  }
  input.setAttribute('aria-invalid', 'true');
  return input;
}

function positionMenu(button, menu) {
  const anchor = button.getBoundingClientRect();
  const inset = 8;
  const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
  menu.style.maxWidth = `${Math.max(1, Math.min(300, width - inset * 2))}px`;
  menu.style.maxHeight = `${Math.max(1, height - inset * 2)}px`;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(inset, Math.min(anchor.right - bounds.width, width - bounds.width - inset))}px`;
  const below = anchor.bottom + 5;
  const preferred = below + bounds.height <= height - inset ? below : anchor.top - bounds.height - 5;
  menu.style.top = `${Math.max(inset, Math.min(preferred, height - bounds.height - inset))}px`;
}

function bindMenu(container, button, menu) {
  const close = () => {
    if (menu.matches(':popover-open')) menu.hidePopover();
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    list.querySelectorAll('[role="menu"]').forEach(other => {
      if (other.matches(':popover-open')) other.hidePopover();
      other.hidden = true;
    });
    list.querySelectorAll('[aria-haspopup="menu"]').forEach(other => other.setAttribute('aria-expanded', 'false'));
    menu.hidden = false; menu.showPopover(); button.setAttribute('aria-expanded', 'true');
    positionMenu(button, menu);
    menu.querySelector('[role="menuitem"]').focus({preventScroll:true});
  };
  menu.addEventListener('toggle', () => {
    const opened = menu.matches(':popover-open');
    menu.hidden = !opened; button.setAttribute('aria-expanded', String(opened));
  });
  button.addEventListener('click', () => {if (menu.hidden) open(); else close();});
  container.addEventListener('keydown', event => {
    if (event.key === 'Escape') {event.preventDefault(); close(); button.focus();}
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const current = items.indexOf(event.target);
      if (menu.hidden) open();
      const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  });
  container.addEventListener('focusout', event => {if (!container.contains(event.relatedTarget)) close();});
  return close;
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
  const summary = row.querySelector('.exclusions-summary');
  const savedNames = rule.excludedSubdomains || [];
  summary.hidden = savedNames.length === 0;
  savedNames.forEach(name => {
    const item = document.createElement('li');
    item.textContent = name;
    row.querySelector('.saved-exclusions-list').append(item);
  });
  const exclusionsInput = row.querySelector('.exclusions-input');
  exclusionsInput.value = (rule.excludedSubdomains || []).join('\n');
  const editor = row.querySelector('.field-exclusions');
  const menuButton = row.querySelector('.rule-menu-button');
  const menu = row.querySelector('.rule-menu');
  menu.id = `rule-menu-${nextId}`;
  menuButton.setAttribute('aria-controls', menu.id);
  const closeMenu = bindMenu(row.querySelector('.site-menu'), menuButton, menu);
  row.querySelector('.edit-exclusions').addEventListener('click', () => {
    closeMenu(); editor.hidden = false;
    if (!entries.children.length) appendExclusion('');
    entries.querySelector('input').focus();
  });
  row.querySelector('.close-exclusions').addEventListener('click', () => {
    editor.hidden = true; menuButton.focus();
  });
  const hint = row.querySelector('.exclusions-hint');
  hint.id = `exclusions-hint-${nextId}`;
  const entries = row.querySelector('.exclusions-list');
  const syncExclusions = () => {
    const inputs = Array.from(entries.querySelectorAll('input'));
    const names = inputs.map(input => input.value.trim()).filter(Boolean);
    exclusionsInput.value = names.join('\n');
    let parent;
    try { parent = normalizeDomain(domainInput.value); }
    catch { parent = domainInput.value.trim() || '親ドメイン'; }
    row.querySelector('.add-exclusion').disabled = saving || inputs.length >= 50;
    menuButton.setAttribute('aria-label', `${domainInput.value.trim() || 'このサイト'}の設定${names.length ? `（対象外${names.length}件）` : ''}`);
    inputs.forEach((input, index) => {
      const suffix = input.closest('li').querySelector('.subdomain-suffix');
      suffix.textContent = `.${parent}`;
      suffix.title = `.${parent}`;
      input.setAttribute('aria-label', `対象外にするサブドメイン ${index + 1}`);
      const label = input.value.trim() ? `${input.value.trim()}.${parent}` : `サブドメイン ${index + 1}`;
      input.closest('li').querySelector('.remove-exclusion').setAttribute('aria-label', `${label}の対象外登録を削除`);
      input.closest('li').querySelector('.exclusion-menu-button').setAttribute('aria-label', `${label}の設定`);
    });
  };
  let nextExclusionId = 0;
  const appendExclusion = name => {
    const entry = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'exclusion-domain-input';
    input.value = name ? name.slice(0, -(rule.domain.length + 1)) : '';
    input.placeholder = '例：music'; input.maxLength = 253;
    input.autocomplete = 'off'; input.setAttribute('autocapitalize', 'none'); input.spellcheck = false;
    input.setAttribute('aria-describedby', `${hint.id} ${errorId}`);
    input.addEventListener('keydown', event => {if (event.key === 'Enter') event.preventDefault();});
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'remove-exclusion'; remove.textContent = '対象外の登録を削除する';
    remove.setAttribute('role', 'menuitem');
    remove.addEventListener('click', () => {
      entry.remove(); clearError(row); syncExclusions(); markDirty();
      const remaining = entries.querySelector('input');
      if (remaining) remaining.focus(); else row.querySelector('.add-exclusion').focus();
    });
    const group = document.createElement('div');
    group.className = 'subdomain-input-group';
    const suffix = document.createElement('span');
    suffix.className = 'subdomain-suffix';
    group.append(input, suffix);
    const menuContainer = document.createElement('div');
    menuContainer.className = 'site-menu';
    const entryMenuButton = document.createElement('button');
    entryMenuButton.type = 'button'; entryMenuButton.className = 'exclusion-menu-button icon-button'; entryMenuButton.textContent = '⋯';
    entryMenuButton.setAttribute('aria-haspopup', 'menu'); entryMenuButton.setAttribute('aria-expanded', 'false');
    const entryMenu = document.createElement('div');
    entryMenu.className = 'rule-menu'; entryMenu.hidden = true; entryMenu.setAttribute('role', 'menu');
    entryMenu.setAttribute('popover', 'auto');
    entryMenu.id = `${menu.id}-exclusion-${++nextExclusionId}`;
    entryMenuButton.setAttribute('aria-controls', entryMenu.id);
    entryMenu.append(remove); menuContainer.append(entryMenuButton, entryMenu);
    entry.append(group, menuContainer); entries.append(entry); bindMenu(menuContainer, entryMenuButton, entryMenu); syncExclusions();
    return input;
  };
  (rule.excludedSubdomains || []).forEach(appendExclusion);
  row.querySelector('.add-exclusion').addEventListener('click', () => {
    if (saving || entries.children.length >= 50) return;
    appendExclusion('').focus();
  });
  syncExclusions();
  const updateLabels = () => {
    const name = domainInput.value.trim() || 'このサイト';
    row.querySelector('legend').textContent = `${name}の設定`;
    row.querySelector('.delete-rule').setAttribute('aria-label', `${name}のドメインを削除する`);
    const enabled = row.querySelector('.enabled-input').checked;
    row.querySelector('.toggle-text').textContent = enabled ? '有効' : '無効';
    row.classList.toggle('rule-disabled', !enabled);
  };
  row.addEventListener('input', () => {clearError(row); updateLabels(); syncExclusions(); markDirty();});
  row.addEventListener('change', () => {clearError(row); updateLabels(); syncExclusions(); markDirty();});
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

function normalizeSubdomain(value, domain) {
  const name = value.trim().toLowerCase().replace(/\.$/, '');
  if (!name || /[\s/:?#@*\\]/.test(name)) throw new Error('music のようにサブドメイン部分だけを入力してください');
  if (name === domain || name.endsWith(`.${domain}`)) throw new Error(`.${domain} は右側に付きます。サブドメイン部分だけを入力してください`);
  return normalizeDomain(`${name}.${domain}`);
}

function collectRules() {
  const rules = [];
  let firstInvalid = null;
  for (const row of list.children) {
    clearError(row);
    let domain;
    try { domain = normalizeDomain(row.querySelector('.domain-input').value); }
    catch (error) { const input = setError(row, error.message, '.domain-input'); firstInvalid ||= input; continue; }
    let excludedSubdomains;
    try {
      const names = row.querySelector('.exclusions-input').value.split('\n').map(value => value.trim()).filter(Boolean).map(value => normalizeSubdomain(value, domain));
      excludedSubdomains = globalThis.JikanDomains.validateExclusions(domain, names, normalizeDomain);
    } catch (error) { const input = setError(row, error.message, '.exclusions-input'); firstInvalid ||= input; continue; }
    const candidate = {domain, mode: row.querySelector('.mode-input').value, enabled: row.querySelector('.enabled-input').checked, ...(excludedSubdomains.length ? {excludedSubdomains} : {})};
    const overlap = rules.find(rule => globalThis.JikanDomains.overlaps(candidate, rule));
    if (overlap) {
      const input = setError(row, `${overlap.domain} と範囲が重複しています。どちらか1つにしてください`, '.domain-input');
      firstInvalid ||= input;
      continue;
    }
    rules.push(candidate);
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
  form.querySelectorAll('input,textarea,select,button').forEach(control => {control.disabled = busy;});
  for (const row of list.children) row.querySelector('.add-exclusion').disabled = busy || row.querySelector('.exclusions-list').children.length >= 50;
  saveButton.disabled = busy || !ready || !dirty;
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
  if (!ready || saving || !dirty) return;
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
    saveButton.disabled = true;
    setStatus('設定は保存されています');
    loadStatus.hidden = true;
    updateCount();
  } catch (error) {
    loadStatus.textContent = `読み込みに失敗しました。${error.message || 'ページを再読み込みしてください'}`;
    loadStatus.classList.add('is-error');
    setStatus('ページを再読み込みして、もう一度お試しください', true);
  }
}
function repositionMenus() {
  list.querySelectorAll('.rule-menu:popover-open').forEach(menu => positionMenu(menu.parentElement.querySelector('[aria-haspopup="menu"]'), menu));
}
window.addEventListener('resize', repositionMenus);
window.addEventListener('scroll', repositionMenus, true);
initialize();
