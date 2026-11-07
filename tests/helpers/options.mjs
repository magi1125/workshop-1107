// 設定画面・ポップアップ・記録のテストで共通に使う補助関数
import fs from 'node:fs';
import { waitFor, sleep, PAGE_HELPERS_PATH, AXE_PATH } from './extension.mjs';

/** 記録の値の項目（契約の「保存の形式」） */
export const RECORD_FIELDS = [
  'pageUrl',
  'pageTitle',
  'imageUrl',
  'embedded',
  'category',
  'name',
  'nameSource',
  'altState',
  'alt',
  'linkUrl',
  'rating',
  'ratedAt',
  // 契約「svg要素、role="img"の要素、input type="image"」で加わった項目（13項目）
  'element',
];

/** 記録の imageKey。svg と role-img はハッシュが必要なので、呼ぶ側が imageKey を渡す */
function imageKeyOf(rec, imageKey) {
  if (imageKey !== undefined) return imageKey;
  return rec.embedded ? 'embedded' : rec.imageUrl;
}

/** 自分の評価のキー（契約の形式） */
export function ownKey(rec, imageKey) {
  return 'r:' + JSON.stringify([rec.pageUrl, imageKeyOf(rec, imageKey), rec.name]);
}

/** 取り込んだ評価のキー（契約の形式） */
export function importedKey(evaluator, rec, imageKey) {
  // 取り決め：埋め込みの記録は '{element}:{ratedAt}'
  const key = imageKey !== undefined ? imageKey : rec.embedded ? `${rec.element || 'img'}:${rec.ratedAt}` : rec.imageUrl;
  return 'i:' + JSON.stringify([evaluator, rec.pageUrl, key, rec.name]);
}

/** 記録の値を、決めた項目だけにする */
export function pickRecord(rec) {
  return Object.fromEntries(RECORD_FIELDS.map((k) => [k, rec[k]]));
}

/** 自分の記録の値を作る（足りない項目は名前ありの画像の値で埋める） */
export function makeRecord(over = {}) {
  return {
    pageUrl: 'https://a.example/page',
    pageTitle: 'ページのタイトル',
    imageUrl: 'https://a.example/img/logo.png',
    embedded: false,
    category: 'named',
    name: '会社のロゴ',
    nameSource: 'alt',
    altState: 'present',
    alt: '会社のロゴ',
    linkUrl: null,
    rating: 'good',
    ratedAt: '2026-11-01T10:00:00.000Z',
    element: 'img',
    ...over,
  };
}

/** chrome.storage.local をまとめて書き換える（中身を消してから入れる） */
export async function seedStorage(h, items) {
  await h.swEval(async (items) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(items);
  }, items);
}

/** 設定画面の URL */
export function optionsUrl(h) {
  return `chrome-extension://${h.extensionId}/src/options/options.html`;
}

/** 設定画面を新しいタブで開く。window.confirm などのダイアログは受け入れる */
export async function openOptions(h) {
  const page = await h.context.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(optionsUrl(h), { waitUntil: 'load' });
  await waitForOptionsReady(page);
  return page;
}

/** 設定画面の表示が落ち着くまで待つ（記録の表か、記録が無い時の文字が出るまで） */
export async function waitForOptionsReady(page) {
  await waitFor(
    () =>
      page.evaluate(() => {
        const table = document.querySelector('table#records-table');
        const rec = document.querySelector('section#records');
        const text = rec ? rec.textContent : '';
        return (table && table.querySelector('caption') && /件の記録/.test(table.querySelector('caption').textContent)) ||
          /記録はまだありません/.test(text);
      }),
    { timeout: 5000, message: '設定画面に記録の表（caption「N件の記録」）か「記録はまだありません」が表示されません' },
  );
  await sleep(150);
}

/** 設定画面を読み込み直す */
export async function reloadOptions(page) {
  await page.reload({ waitUntil: 'load' });
  await waitForOptionsReady(page);
}

/** CSP で addScriptTag が使えない拡張機能のページに、CDP でスクリプトを読み込む */
export async function injectScript(page, file) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Runtime.evaluate', { expression: fs.readFileSync(file, 'utf8') });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** 拡張機能のページに page-helpers.js（window.__t）を読み込む */
export async function injectPageHelpers(page) {
  const has = await page.evaluate(() => typeof window.__t === 'object');
  if (!has) await injectScript(page, PAGE_HELPERS_PATH);
}

/** 拡張機能のページで axe-core を実行し、違反を文字列の配列で返す */
export async function axeViolations(page) {
  const has = await page.evaluate(() => typeof window.axe === 'object');
  if (!has) await injectScript(page, AXE_PATH);
  const ok = await page.evaluate(() => typeof window.axe === 'object');
  if (!ok) throw new Error('axe-core を読み込めませんでした');
  return page.evaluate(async () => {
    const r = await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return r.violations.map((v) => `${v.id}：${v.help}：${v.nodes.map((n) => JSON.stringify(n.target)).join(', ')}`);
  });
}

/**
 * 記録の表の本体の行を、セルの文字の配列で返す。
 * 列：評価、名前、ページ、画像、評価した人、日時、操作
 */
export async function tableRows(page) {
  return page.evaluate(() => {
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const table = document.querySelector('table#records-table');
    if (!table) return null;
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      if (tr.closest('thead')) continue;
      if (tr.querySelector('th[scope="col"]')) continue;
      if (tr.cells.length === 0) continue;
      rows.push(Array.from(tr.cells).map((c) => norm(c.textContent)));
    }
    return rows;
  });
}

/** 表の caption の文字 */
export async function captionText(page) {
  return page.evaluate(() => {
    const c = document.querySelector('table#records-table caption');
    return c ? c.textContent.replace(/\s+/g, ' ').trim() : null;
  });
}

/** #status の文字 */
export async function statusText(page) {
  return page.evaluate(() => {
    const s = document.querySelector('#status');
    return s ? s.textContent.replace(/\s+/g, ' ').trim() : null;
  });
}

/** #status の文字を空にする（同じ文字が続く場合に、新しく表示されたかを確かめるため） */
export async function clearStatus(page) {
  await page.evaluate(() => {
    const s = document.querySelector('#status');
    if (s) s.textContent = '';
  });
}

/** #status の文字が条件を満たすまで待つ */
export async function waitStatus(page, pred, message) {
  let last;
  await waitFor(
    async () => {
      last = await statusText(page);
      return pred(last ?? '');
    },
    { timeout: 5000, message },
  ).catch((e) => {
    throw new Error(`${e.message}（#status の文字：「${last}」）`);
  });
  return last;
}

/** settings を読む */
export async function readSettings(h) {
  return (await h.storageAll()).settings;
}

/** ポップアップを開く */
export async function openPopup(h, tabId) {
  const p = await h.context.newPage();
  await p.goto(`chrome-extension://${h.extensionId}/src/popup/popup.html?tabId=${tabId}`, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  return p;
}
