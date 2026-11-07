// 評価モードの状態の取得と切り替え。ポップアップとバックグラウンドで共通（docs/contract.md の「メッセージ」）

const CONTENT_FILES = ['src/content/accessible-name.js', 'src/content/content.js'];
const OFF_STATE = Object.freeze({ enabled: false, total: 0, rated: 0 });

// 評価モードのスクリプトがまだ挿入されていないタブでは、オフの状態を返す
export async function getState(tabId) {
  try {
    const state = await chrome.tabs.sendMessage(tabId, { type: 'altEval:getState' });
    return state || { ...OFF_STATE };
  } catch {
    return { ...OFF_STATE };
  }
}

// 挿入できないページ（chrome:// のページやChromeウェブストアなど）では例外を投げる
export async function setEnabled(tabId, enabled, { announce = false } = {}) {
  if (enabled) {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  } else {
    const current = await getState(tabId);
    if (!current.enabled) {
      return current;
    }
  }
  return chrome.tabs.sendMessage(tabId, { type: 'altEval:setEnabled', enabled, announce });
}

export async function toggle(tabId, options) {
  const current = await getState(tabId);
  return setEnabled(tabId, !current.enabled, options);
}
