// サイドパネルと、content.js へのメッセージ（altEval:list・rate・reveal）のテストで共通に使う補助関数
import { waitFor, sleep } from './extension.mjs';

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** service worker から、タブの content.js にメッセージを送り、返事を返す */
export async function sendToTab(h, tabId, msg) {
  return h.swEval(({ tabId, msg }) => chrome.tabs.sendMessage(tabId, msg), { tabId, msg });
}

/** altEval:list を送る */
export async function listItems(h, tabId) {
  return sendToTab(h, tabId, { type: 'altEval:list' });
}

/**
 * ページの評価ボックスを、DOM の順に、契約の items の形に合わせて読み取る。
 * element は、テスト側で求めた画像の種類（page-helpers.js の elementKind）
 */
export async function domItems(page) {
  return page.evaluate(() => {
    const t = window.__t;
    const kindOf = new Map();
    for (const img of t.targetImages()) {
      const box = t.boxFor(img);
      if (box) kindOf.set(box, { kind: t.elementKind(img), imgId: img.id || null });
    }
    return t.boxes().map((box) => {
      const s = t.state(box);
      const rating = s.pressed.good === 'true' ? 'good' : s.pressed.poor === 'true' ? 'poor' : null;
      const k = kindOf.get(box) || {};
      return {
        dataId: box.getAttribute('data-id'),
        element: k.kind ?? null,
        imgId: k.imgId ?? null,
        category: s.category,
        line: s.line,
        rating,
        mode: s.mode,
      };
    });
  });
}

/** 画像の id から、altEval:list の要素を探す（DOM の順で対応させる） */
export async function itemForImage(h, page, tabId, imgId) {
  const dom = await domItems(page);
  const idx = dom.findIndex((d) => d.imgId === imgId);
  if (idx < 0) throw new Error(`画像 #${imgId} の評価ボックスが見つかりません`);
  const res = await listItems(h, tabId);
  const item = res?.items?.[idx];
  if (!item) throw new Error(`altEval:list に画像 #${imgId} の要素がありません：${JSON.stringify(res)}`);
  return item;
}

/** サイドパネルを、指定のタブを対象にして、普通のタブとして開く */
export async function openSidePanel(h, tabId) {
  const p = await h.context.newPage();
  p.__errors = [];
  p.on('pageerror', (e) => p.__errors.push(String(e?.message || e)));
  await p.goto(`chrome-extension://${h.extensionId}/src/sidepanel/sidepanel.html?tabId=${tabId}`, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  return p;
}

/** サイドパネルの表示をまとめて読み取る */
export async function panelState(p) {
  return p.evaluate(() => {
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const shown = (el) => !!el && el.getClientRects().length > 0 && el.checkVisibility({ visibilityProperty: true });
    const q = (s) => document.querySelector(s);
    const items = Array.from(document.querySelectorAll('ol#items > li')).map((li) => {
      const line = li.querySelector('p.line');
      const state = li.querySelector('p.state');
      const btn = (sel) => {
        const b = li.querySelector(sel);
        if (!b) return null;
        return {
          tag: b.localName,
          text: norm(b.textContent),
          pressed: b.getAttribute('aria-pressed'),
          describedby: (b.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean),
        };
      };
      return {
        shown: shown(li),
        line: line ? norm(line.textContent) : null,
        lineId: line ? line.id || null : null,
        state: state ? norm(state.textContent) : null,
        good: btn('button.rate-good'),
        poor: btn('button.rate-poor'),
        reveal: btn('button.reveal'),
      };
    });
    return {
      mode: norm(q('#mode')?.textContent),
      toggle: q('#toggle') ? norm(q('#toggle').textContent) : null,
      toggleShown: shown(q('#toggle')),
      summary: q('#summary') ? norm(q('#summary').textContent) : null,
      summaryShown: shown(q('#summary')),
      filterShown: shown(q('#filter')),
      itemsShown: shown(q('#items')),
      page: norm(q('#page')?.textContent),
      status: q('#status') ? norm(q('#status').textContent) : null,
      items,
    };
  });
}

/** サイドパネルの表示が条件を満たすまで待ち、最後の状態を返す */
export async function waitPanel(p, pred, message) {
  let last;
  await waitFor(
    async () => {
      last = await panelState(p);
      return pred(last);
    },
    { timeout: 5000, message },
  ).catch((e) => {
    throw new Error(`${e.message}（サイドパネル：${JSON.stringify(last)}）`);
  });
  return last;
}

/** 拡張機能のページに、altEval:changed の通知を記録する受信者を加える */
export async function installChangedListener(page) {
  await page.evaluate(() => {
    if (window.__changed) return;
    window.__changed = [];
    chrome.runtime.onMessage.addListener((m, sender) => {
      if (m && m.type === 'altEval:changed') {
        window.__changed.push({ t: Date.now(), tabId: sender?.tab?.id ?? null });
      }
    });
  });
}

/** 受け取った通知を返し、記録を空にする */
export async function takeChanged(page) {
  return page.evaluate(() => window.__changed.splice(0));
}

export { norm, sleep };
