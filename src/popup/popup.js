// 評価モードの切り替えと件数の表示
import { getState, setEnabled } from '../lib/tab-control.js';

const modeEl = document.getElementById('mode');
const countsEl = document.getElementById('counts');
const toggleEl = document.getElementById('toggle');
const statusEl = document.getElementById('status');
const shortcutEl = document.getElementById('shortcut');

// popup.html?tabId= で開いた時は、そのタブを対象にする（自動テスト用。docs/contract.md）
async function targetTabId() {
  const param = new URLSearchParams(location.search).get('tabId');
  if (param !== null && /^\d+$/.test(param)) {
    return Number(param);
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : undefined;
}

function render(state) {
  modeEl.textContent = `評価モード：${state.enabled ? 'オン' : 'オフ'}`;
  countsEl.textContent = state.enabled ? `画像 ${state.total}枚、評価済み ${state.rated}枚` : '';
  toggleEl.textContent = state.enabled ? '評価モードをオフにする' : '評価モードをオンにする';
  toggleEl.disabled = false;
  toggleEl.removeAttribute('aria-disabled');
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
  const tabId = await targetTabId();
  if (tabId === undefined) {
    modeEl.textContent = 'このページでは評価モードを使えません';
    return;
  }
  render(await getState(tabId));

  toggleEl.addEventListener('click', async () => {
    if (toggleEl.getAttribute('aria-disabled') === 'true') {
      return;
    }
    // 2回続けて押された時に、切り替えが2回走らないよう、先に押せなくする。
    // disabled にするとフォーカスが外れてしまうため、aria-disabled を使う
    toggleEl.setAttribute('aria-disabled', 'true');
    const current = await getState(tabId);
    try {
      // ポップアップを操作している時は、ポップアップの中で切り替えを伝える
      const next = await setEnabled(tabId, !current.enabled, { announce: false });
      render(next);
      statusEl.textContent = next.enabled
        ? `評価モードをオンにしました。画像は${next.total}枚です`
        : '評価モードをオフにしました';
    } catch {
      toggleEl.removeAttribute('aria-disabled');
      statusEl.textContent = 'このページでは評価モードを使えません';
    }
  });
}

main();
