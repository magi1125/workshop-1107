// サイドパネル：表示中のタブの画像の一覧と評価の状況（docs/contract.md の「サイドパネル」）
import { getState, setEnabled } from '../lib/tab-control.js';
import { elementSuffix } from '../lib/records.js';

const $ = (selector) => document.querySelector(selector);
const pageEl = $('#page');
const modeEl = $('#mode');
const toggleEl = $('#toggle');
const summaryEl = $('#summary');
const filterRow = $('#filter-row');
const filterEl = $('#filter');
const itemsEl = $('#items');
const statusEl = $('#status');

const STATE_TEXT = { good: '○ 良い', poor: '× 悪い' };
const fixedTabId = (() => {
  const param = new URLSearchParams(location.search).get('tabId');
  return param !== null && /^\d+$/.test(param) ? Number(param) : null;
})();

let tabId = null;
let windowId = null;
let refreshSeq = 0;
let enabled = false;
let items = [];

const el = (tag, text, props = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) {
    node.textContent = text;
  }
  Object.assign(node, props);
  return node;
};

const announce = (text) => {
  statusEl.textContent = '';
  setTimeout(() => {
    statusEl.textContent = text;
  }, 50);
};

const send = (message) => chrome.tabs.sendMessage(tabId, message);

// タブのURLは、tabs 権限が無いと、許可されたタブでしか読めない。読めない時は、使えるページとして扱う
const isUnusable = (url) => typeof url === 'string' && url !== '' && !/^(https?|file):/i.test(url);

// URLが読めないタブで、評価モードを使えないページ（chrome:// など）かを、何もしないスクリプトを入れてみて調べる。
// 使えないページでは「chrome:// の URL にはアクセスできない」などのエラーになる。許可が無いだけなら、別のエラーになる
async function isRestrictedPage(id) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: id }, func: () => true });
    return false;
  } catch (error) {
    return /cannot access (a |contents of url )?["']?(chrome|edge|about|devtools|chrome-extension|view-source)[:-]|cannot be scripted|extensions gallery/i
      .test(String(error && error.message));
  }
}

async function currentTab() {
  if (fixedTabId !== null) {
    return chrome.tabs.get(fixedTabId);
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showList(show) {
  filterRow.hidden = !show;
  itemsEl.hidden = !show;
}

// 一覧を作り直す。一覧の中にフォーカスがあれば、同じ画像の同じボタンにフォーカスを戻す
function renderItems() {
  const active = document.activeElement;
  const focusedItem = itemsEl.contains(active) ? active.closest('li') : null;
  const focusedId = focusedItem ? Number(focusedItem.dataset.id) : null;
  const focusedClass = focusedItem ? active.className : null;
  const focusedIndex = focusedItem ? [...itemsEl.children].indexOf(focusedItem) : 0;

  const filter = filterEl.value;
  const shown = items.filter((item) =>
    filter === 'all' || (filter === 'unrated' ? !item.rating : item.rating === filter));

  itemsEl.replaceChildren(...shown.map((item) => {
    const li = el('li');
    li.dataset.id = String(item.id);
    const lineId = `line-${item.id}`;
    const line = el('p', item.line + elementSuffix(item), { className: 'line', id: lineId });
    const state = el('p', STATE_TEXT[item.rating] || '未評価', { className: 'state' });
    const actions = el('div', null, { className: 'actions' });
    for (const [value, label] of [['good', '○ 良い'], ['poor', '× 悪い']]) {
      const button = el('button', label, { type: 'button', className: `rate-${value}` });
      button.setAttribute('aria-pressed', String(item.rating === value));
      button.setAttribute('aria-describedby', lineId);
      button.addEventListener('click', () => rateItem(item, item.rating === value ? null : value));
      actions.append(button);
    }
    const reveal = el('button', 'ページの画像へ移動', { type: 'button', className: 'reveal' });
    reveal.setAttribute('aria-describedby', lineId);
    reveal.addEventListener('click', () => revealItem(item));
    actions.append(reveal);
    li.append(line, state, actions);
    return li;
  }));

  if (focusedId !== null) {
    const className = focusedClass.split(' ')[0];
    let target = itemsEl.querySelector(`li[data-id="${focusedId}"] .${className}`);
    if (!target) {
      // 絞り込みで一覧から消えた時は、同じ位置の画像の同じボタンに移す。一覧が空なら、件数の表示に移す
      const lis = itemsEl.querySelectorAll('li');
      const li = lis[Math.min(focusedIndex, lis.length - 1)];
      target = li ? li.querySelector(`.${className}`) : null;
    }
    if (!target) {
      summaryEl.setAttribute('tabindex', '-1');
      target = summaryEl;
    }
    target.focus();
  }
}

function renderSummary() {
  if (!enabled) {
    summaryEl.textContent = '評価モードをオンにすると、画像の一覧を表示します';
    return;
  }
  if (items.length === 0) {
    summaryEl.textContent = 'このページに評価できる画像はありません';
    return;
  }
  const good = items.filter((item) => item.rating === 'good').length;
  const poor = items.filter((item) => item.rating === 'poor').length;
  summaryEl.textContent = `画像 ${items.length}枚（良い ${good}、悪い ${poor}、未評価 ${items.length - good - poor}）`;
}

// 古い呼び出しの結果で、新しい表示を上書きしないよう、呼び出しごとに番号を付ける
async function refresh() {
  const seq = ++refreshSeq;
  const stale = () => seq !== refreshSeq;
  const tab = await currentTab().catch(() => undefined);
  if (stale()) {
    return;
  }
  if (!tab || isUnusable(tab.url)) {
    tabId = tab ? tab.id : null;
    pageEl.textContent = tab && tab.title ? tab.title : '';
    modeEl.textContent = 'このページでは評価モードを使えません';
    toggleEl.hidden = true;
    summaryEl.hidden = true;
    showList(false);
    return;
  }
  tabId = tab.id;
  let result = null;
  try {
    result = await send({ type: 'altEval:list' });
  } catch {
    result = null;
  }
  const restricted = !result && await isRestrictedPage(tab.id);
  if (stale()) {
    return;
  }
  if (restricted) {
    pageEl.textContent = '';
    modeEl.textContent = 'このページでは評価モードを使えません';
    toggleEl.hidden = true;
    summaryEl.hidden = true;
    showList(false);
    return;
  }
  // ページのタイトルとホスト名は、評価モードのスクリプトから受け取る。まだ入っていない時は、タブの情報を使う
  const title = (result && result.title) || tab.title || '';
  let host = result ? result.host : '';
  if (!result && tab.url) {
    host = tab.url.startsWith('file:') ? '' : new URL(tab.url).hostname;
  }
  pageEl.textContent = title || host ? `${title || '（タイトルなし）'}（${host || 'ローカルのファイル'}）` : '';
  enabled = Boolean(result && result.enabled);
  items = enabled ? result.items : [];
  modeEl.textContent = `評価モード：${enabled ? 'オン' : 'オフ'}`;
  toggleEl.hidden = false;
  toggleEl.textContent = enabled ? '評価モードをオフにする' : '評価モードをオンにする';
  summaryEl.hidden = false;
  renderSummary();
  showList(enabled && items.length > 0);
  renderItems();
}

async function rateItem(item, rating) {
  try {
    const updated = await send({ type: 'altEval:rate', id: item.id, rating });
    if (updated && updated.rating === rating) {
      // 一覧は、ページからの変化の知らせ（altEval:changed）で作り直す
      announce(rating ? `「${STATE_TEXT[rating]}」と評価しました` : '評価を取り消しました');
    } else {
      announce('評価を保存できませんでした');
    }
  } catch {
    announce('評価を保存できませんでした');
  }
}

async function revealItem(item) {
  try {
    const ok = await send({ type: 'altEval:reveal', id: item.id });
    announce(ok ? 'ページの画像へ移動しました' : 'この画像はページから無くなりました');
  } catch {
    announce('この画像はページから無くなりました');
  }
}

toggleEl.addEventListener('click', async () => {
  if (tabId === null) {
    return;
  }
  try {
    const next = await setEnabled(tabId, !enabled, { announce: false });
    if (next && next.excluded) {
      announce('このサイトは、評価モードを使わないサイトに登録されています');
    } else {
      announce(next && next.enabled ? '評価モードをオンにしました' : '評価モードをオフにしました');
    }
  } catch {
    announce('ツールバーのボタンかショートカットで、評価モードをオンにしてください');
  }
  await refresh();
});

filterEl.addEventListener('change', renderItems);

// ページの評価ボックスや評価が変わったら、表示を更新する
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === 'altEval:changed' && sender.tab && sender.tab.id === tabId) {
    refresh();
  }
});

// このウィンドウのタブの切り替えと、表示中のタブの読み込みだけに追従する
if (fixedTabId === null) {
  chrome.windows.getCurrent().then((win) => {
    windowId = win.id;
  });
  chrome.tabs.onActivated.addListener((info) => {
    if (windowId === null || info.windowId === windowId) {
      refresh();
    }
  });
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (id === tabId && change.status === 'complete') {
      refresh();
    }
  });
}

refresh();
