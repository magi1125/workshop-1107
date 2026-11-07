// キーボードショートカットで評価モードを切り替える
import { getState, setEnabled, toggle } from '../lib/tab-control.js';

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

// 自動テストから呼び出すために公開する（docs/contract.md の「テストの方法」）
globalThis.altEval = { getState, setEnabled };
