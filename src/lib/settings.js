// 設定の読み書きと、評価モードを既定でオンにするための登録・解除（docs/contract.md の「評価モードを既定でオンにする」）

const SETTINGS_KEY = 'settings';
const AUTO_SCRIPT_ID = 'altEvalAuto';
const ALL_URLS = { origins: ['<all_urls>'] };
const DEFAULTS = Object.freeze({ defaultOn: false, excludedSites: [], exportedSites: [] });

export async function getSettings() {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
  return {
    defaultOn: stored.defaultOn === true,
    excludedSites: Array.isArray(stored.excludedSites) ? stored.excludedSites : [],
    exportedSites: Array.isArray(stored.exportedSites) ? stored.exportedSites : [],
  };
}

export async function updateSettings(changes) {
  const next = { ...DEFAULTS, ...(await getSettings()), ...changes };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function setExcluded(host, excluded) {
  const { excludedSites } = await getSettings();
  const rest = excludedSites.filter((site) => site !== host);
  return updateSettings({ excludedSites: excluded ? [...rest, host] : rest });
}

async function registerAuto() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_ID] });
  if (existing.length > 0) {
    return;
  }
  await chrome.scripting.registerContentScripts([{
    id: AUTO_SCRIPT_ID,
    matches: ['<all_urls>'],
    js: ['src/content/accessible-name.js', 'src/content/content.js'],
    runAt: 'document_idle',
  }]);
}

async function unregisterAuto() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_ID] });
  if (existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] });
  }
}

// 既定でオンにする。利用者の操作（クリック）の中から呼ぶ。許可されなかったら false を返す
export async function enableDefaultOn() {
  const granted = await chrome.permissions.request(ALL_URLS);
  if (!granted) {
    return false;
  }
  await registerAuto();
  await updateSettings({ defaultOn: true });
  return true;
}

// 既定でオフに戻し、すべてのサイトへの権限も返す
export async function disableDefaultOn() {
  await updateSettings({ defaultOn: false });
  await unregisterAuto();
  try {
    await chrome.permissions.remove(ALL_URLS);
  } catch {
    // インストール時から付いている権限（テストのコピーなど）は返せないため、そのままにする
  }
}

// 設定と、実際の権限・登録を合わせる。権限が無いのに既定でオンになっていたら、オフに戻す
export async function syncDefaultOn() {
  const { defaultOn } = await getSettings();
  const granted = await chrome.permissions.contains(ALL_URLS);
  if (defaultOn && granted) {
    await registerAuto();
    return;
  }
  if (defaultOn) {
    await updateSettings({ defaultOn: false });
  }
  await unregisterAuto();
}
