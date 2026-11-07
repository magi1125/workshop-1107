// 評価モードの切り替え、件数の表示、使わないサイトの登録
import { getState, setEnabled } from '../lib/tab-control.js';
import { getSettings, setExcluded } from '../lib/settings.js';

const siteEl = document.getElementById('site');
const modeEl = document.getElementById('mode');
const countsEl = document.getElementById('counts');
const toggleEl = document.getElementById('toggle');
const excludeEl = document.getElementById('exclude');
const statusEl = document.getElementById('status');
const optionsEl = document.getElementById('open-options');
const shortcutEl = document.getElementById('shortcut');

const EXCLUDE_LABEL = 'このサイトでは評価モードを使わない';
const INCLUDE_LABEL = 'このサイトで評価モードを使えるようにする';

// popup.html?tabId= で開いた時は、そのタブを対象にする（自動テスト用。docs/contract.md）
async function targetTab() {
  const param = new URLSearchParams(location.search).get('tabId');
  if (param !== null && /^\d+$/.test(param)) {
    return chrome.tabs.get(Number(param));
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// http・https・file のページだけで評価モードを使える
function pageKind(tab) {
  try {
    const url = new URL(tab.url);
    if (/^https?:$/.test(url.protocol)) {
      return { host: url.hostname, web: true };
    }
    return url.protocol === 'file:' ? { host: '', web: false } : null;
  } catch {
    return null;
  }
}

function setBusy(button, busy) {
  if (busy) {
    // disabled にするとフォーカスが外れてしまうため、aria-disabled を使う
    button.setAttribute('aria-disabled', 'true');
  } else {
    button.removeAttribute('aria-disabled');
  }
}

const isBusy = (button) => button.getAttribute('aria-disabled') === 'true';

function render(state, excluded) {
  if (excluded) {
    modeEl.textContent = '評価モード：このサイトでは使わない設定です';
    countsEl.textContent = '';
    toggleEl.hidden = true;
  } else {
    modeEl.textContent = `評価モード：${state.enabled ? 'オン' : 'オフ'}`;
    countsEl.textContent = state.enabled ? `画像 ${state.total}枚、評価済み ${state.rated}枚` : '';
    toggleEl.hidden = false;
    toggleEl.textContent = state.enabled ? '評価モードをオフにする' : '評価モードをオンにする';
    toggleEl.disabled = false;
  }
  excludeEl.textContent = excluded ? INCLUDE_LABEL : EXCLUDE_LABEL;
  setBusy(toggleEl, false);
  setBusy(excludeEl, false);
}

async function showShortcut() {
  const commands = await chrome.commands.getAll();
  const command = commands.find((c) => c.name === 'toggle-evaluation');
  shortcutEl.textContent = command && command.shortcut
    ? `ショートカット：${command.shortcut}`
    : 'ショートカットは chrome://extensions/shortcuts で設定できます';
}

async function main() {
  showShortcut();
  optionsEl.addEventListener('click', () => chrome.runtime.openOptionsPage());

  const tab = await targetTab().catch(() => undefined);
  const kind = tab ? pageKind(tab) : null;
  if (!tab || kind === null) {
    modeEl.textContent = 'このページでは評価モードを使えません';
    toggleEl.hidden = true;
    return;
  }
  const tabId = tab.id;
  const { host } = kind;
  // ローカルのファイルはホスト名が空になり、登録するとすべてのファイルが対象になってしまうため、登録のボタンを出さない
  siteEl.textContent = kind.web ? `サイト：${host}` : 'ローカルのファイル';
  excludeEl.hidden = !kind.web;
  let excluded = kind.web && (await getSettings()).excludedSites.includes(host);
  render(await getState(tabId), excluded);

  toggleEl.addEventListener('click', async () => {
    if (isBusy(toggleEl)) {
      return;
    }
    setBusy(toggleEl, true);
    const current = await getState(tabId);
    try {
      // ポップアップを操作している時は、ポップアップの中で切り替えを伝える
      const next = await setEnabled(tabId, !current.enabled, { announce: false });
      if (next.excluded) {
        // ほかの画面で、このサイトが使わないサイトに登録されていた
        excluded = true;
        render(next, excluded);
        statusEl.textContent = 'このサイトは、評価モードを使わないサイトに登録されています';
        return;
      }
      render(next, excluded);
      statusEl.textContent = next.enabled
        ? `評価モードをオンにしました。画像は${next.total}枚です`
        : '評価モードをオフにしました';
    } catch {
      setBusy(toggleEl, false);
      statusEl.textContent = 'このページでは評価モードを使えません';
    }
  });

  excludeEl.addEventListener('click', async () => {
    if (isBusy(excludeEl)) {
      return;
    }
    setBusy(excludeEl, true);
    try {
      await setExcluded(host, !excluded);
    } catch {
      setBusy(excludeEl, false);
      statusEl.textContent = '設定を保存できませんでした';
      return;
    }
    excluded = !excluded;
    if (excluded) {
      // 登録したら、表示中のタブの評価モードをオフにする
      await setEnabled(tabId, false, { announce: false }).catch(() => {});
      statusEl.textContent = `${host} を、評価モードを使わないサイトに登録しました`;
    } else {
      statusEl.textContent = `${host} で評価モードを使えるようにしました`;
    }
    render(await getState(tabId), excluded);
  });
}

main();
