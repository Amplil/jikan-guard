'use strict';

const statusMessage = document.getElementById('blocked-status');
const checkButton = document.getElementById('check-again');
const title = document.getElementById('blocked-title');
const description = document.getElementById('blocked-description');
const budget = document.getElementById('blocked-budget');
const resetNote = document.getElementById('reset-note');
let domain = new URLSearchParams(location.search).get('domain') || '';
let loading = false;
let previousAvailability = null;

// Query strings are untrusted. Restrict navigation to a validated hostname.
if (!domain || domain.length > 253 || !domain.includes('.') || /^\d+(\.\d+){3}$/.test(domain) || !/^[a-z0-9.-]+$/i.test(domain) || domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) domain = '';
domain = domain.toLowerCase();
document.getElementById('blocked-domain').textContent = domain || '不明なサイト';

function say(message, error = false) {
  if (statusMessage.textContent !== message) statusMessage.textContent = message;
  statusMessage.classList.toggle('is-error', error);
}

function duration(ms) {
  const seconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60 ? ` ${seconds % 60}秒` : ''}`;
}

function render(state, requested) {
  const rule = (Array.isArray(state.rules) ? state.rules : []).find(item => domain === item.domain || domain.endsWith(`.${item.domain}`));
  const available = !rule || rule.enabled === false || !rule.blocked;
  checkButton.textContent = available ? 'サイトに戻る' : 'もう一度確認';
  title.textContent = available ? 'また、あなたのペースで。' : '今日は、ここまで。';
  description.textContent = available ? 'このサイトを利用できます。ボタンから戻れます' : '今日の合計時間を使い切りました';
  const limitLabel = Number.isInteger(state.dailyLimitMinutes) ? state.dailyLimitMinutes : 0;
  const remaining = Number.isFinite(Number(state.remainingMs)) ? state.remainingMs : 0;
  budget.textContent = !rule ? '制限の対象外' : rule.enabled === false ? '制限オフ' : available ? `のこり ${duration(remaining)}` : `1日の合計 ${limitLabel}分`;
  resetNote.hidden = available;
  if (requested && available) {location.replace(`https://${domain}/`); return;}
  if (requested) say('今日の上限に達しています。また明日お会いしましょう');
  else if (available && previousAvailability !== true) say('利用可能になりました。「サイトに戻る」を押してください');
  else if (!available && previousAvailability !== false) say('');
  previousAvailability = available;
}

async function refresh(requested = false) {
  if (loading || !domain) return;
  loading = true;
  checkButton.disabled = true;
  try {
    const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
    if (!state?.ok || !Array.isArray(state.rules)) throw new Error(state?.error || '利用状況を取得できませんでした');
    render(state, requested);
    if (statusMessage.classList.contains('is-error')) say('');
  } catch (error) {
    say(`確認できませんでした。${error.message || 'もう一度お試しください'}`, true);
  } finally {loading = false; checkButton.disabled = false;}
}

checkButton.addEventListener('click', () => refresh(true));
document.getElementById('blocked-options').addEventListener('click', async () => {
  try {
    const result = await chrome.runtime.sendMessage({type: 'OPEN_OPTIONS'});
    if (result?.ok === false) throw new Error(result.error || '設定を開けませんでした');
  } catch (error) {say(error.message || '設定を開けませんでした', true);}
});
if (domain) refresh();
else {
  title.textContent = 'サイトを確認できませんでした';
  description.textContent = '設定から対象のドメインを確認してください';
  budget.textContent = 'ドメイン不明';
  resetNote.hidden = true;
  say('有効なドメインが見つからないため、サイトには移動できません', true);
}
const refreshTimer = setInterval(() => refresh(), 2000);
window.addEventListener('pagehide', () => clearInterval(refreshTimer), {once: true});
