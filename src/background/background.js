// キーボードショートカットで評価モードを切り替える。既定でオンの設定と、実際の権限を合わせる
import { getState, setEnabled, toggle } from '../lib/tab-control.js';
import { syncDefaultOn } from '../lib/settings.js';

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-evaluation' || !tab || tab.id === undefined) {
    return;
  }
  try {
    // ショートカットの時は、ページの中の読み上げ用の領域で切り替えを伝える
    await toggle(tab.id, { announce: true });
  } catch {
    // 評価モードを使えないページでは何もしない
  }
});

// 利用者が chrome://extensions などで権限を外した時は、既定でオンの設定も外す
chrome.permissions.onRemoved.addListener(() => {
  syncDefaultOn();
});
chrome.runtime.onStartup.addListener(() => {
  syncDefaultOn();
});
chrome.runtime.onInstalled.addListener(() => {
  syncDefaultOn();
});

// 自動テストから呼び出すために公開する（docs/contract.md の「テストの方法」）
globalThis.altEval = { getState, setEnabled };
