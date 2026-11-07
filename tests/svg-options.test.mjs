// 契約「svg要素、role="img"の要素、input type="image"」：設定画面の記録の表、書き出し、取り込みのテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchExtension, waitFor, sleep } from './helpers/extension.mjs';
import {
  RECORD_FIELDS,
  makeRecord,
  ownKey,
  importedKey,
  pickRecord,
  seedStorage,
  openOptions,
  reloadOptions,
  tableRows,
  clearStatus,
  waitStatus,
} from './helpers/options.mjs';

const NAME_COL = 1;
// 「（svg要素）」などの前に空白を入れる実装も許す
const normName = (s) => s.replace(/\s+(?=（(svg要素|role="img"の要素|input type="image")）$)/, '');

const svgTitle = makeRecord({
  pageUrl: 'https://a.example/icons',
  pageTitle: 'アイコンのページ',
  element: 'svg',
  imageUrl: null,
  embedded: true,
  name: '家',
  nameSource: 'svg-title',
  alt: null,
  altState: 'missing',
  ratedAt: '2026-11-06T10:00:00.000Z',
});
const riNone = makeRecord({
  pageUrl: 'https://a.example/icons',
  pageTitle: 'アイコンのページ',
  element: 'role-img',
  imageUrl: null,
  embedded: true,
  category: 'none',
  name: '',
  nameSource: 'none',
  alt: null,
  altState: 'missing',
  rating: 'poor',
  ratedAt: '2026-11-05T10:00:00.000Z',
});
const iiAlt = makeRecord({
  pageUrl: 'https://a.example/form',
  pageTitle: 'フォーム',
  element: 'input-image',
  imageUrl: 'https://a.example/img/send.png',
  name: '送信',
  alt: '送信',
  ratedAt: '2026-11-04T10:00:00.000Z',
});
const svgHidden = makeRecord({
  pageUrl: 'https://a.example/icons',
  pageTitle: 'アイコンのページ',
  element: 'svg',
  imageUrl: null,
  embedded: true,
  category: 'hidden',
  name: '飾り',
  nameSource: 'aria-label',
  alt: null,
  altState: 'missing',
  ratedAt: '2026-11-03T10:00:00.000Z',
});
const svgNone = makeRecord({
  pageUrl: 'https://a.example/icons',
  pageTitle: 'アイコンのページ',
  element: 'svg',
  imageUrl: null,
  embedded: true,
  category: 'none',
  name: '',
  nameSource: 'none',
  alt: null,
  altState: 'missing',
  ratedAt: '2026-11-02T10:00:00.000Z',
});
const imgRec = makeRecord({ pageUrl: 'https://a.example/', name: '会社のロゴ', ratedAt: '2026-11-01T10:00:00.000Z' });
const XSS = '<img src=x onerror="window.__pwned=7">';
const svgXss = makeRecord({
  pageUrl: 'https://a.example/x',
  pageTitle: 'XSS',
  element: 'svg',
  imageUrl: null,
  embedded: true,
  name: XSS,
  nameSource: 'svg-title',
  alt: null,
  altState: 'missing',
  ratedAt: '2026-10-01T10:00:00.000Z',
});

// 日時の新しい順
const ROWS = [
  [svgTitle, 'svg:0000000a', '名前：家（title要素から）（svg要素）'],
  [riNone, 'role-img:0000000b', '名前なし（「画像」とだけ読み上げられるか、読み飛ばされる場合があります）（role="img"の要素）'],
  [iiAlt, undefined, '名前：送信（altから）（input type="image"）'],
  [svgHidden, 'svg:0000000c', 'スクリーンリーダーに伝わらない画像（aria-hidden）。名前：飾り（svg要素）'],
  [svgNone, 'svg:0000000d', '名前なし（「画像」とだけ読み上げられるか、読み飛ばされる場合があります）（svg要素）'],
  [imgRec, undefined, '名前：会社のロゴ（altから）'],
  [svgXss, 'svg:0000000e', `名前：${XSS}（title要素から）（svg要素）`],
];

describe('設定画面：svg・role="img"・input type="image" の記録', { timeout: 180000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    await seedStorage(h, {
      ...Object.fromEntries(ROWS.map(([r, ik]) => [ownKey(r, ik), r])),
      settings: { defaultOn: false, excludedSites: [], exportedSites: [] },
    });
    page = await openOptions(h);
  });

  after(async () => {
    await h?.close();
  });

  test('記録の表の名前の列：img 以外の記録は、1行目の後に「（svg要素）」「（role="img"の要素）」「（input type="image"）」を加える', async () => {
    const rows = await tableRows(page);
    assert.ok(rows, '記録の表がありません');
    assert.deepEqual(
      rows.map((r) => normName(r[NAME_COL])),
      ROWS.map((r) => r[2]),
    );
  });

  test('名前の列の HTML は文字のまま表示され、スクリプトは実行されない', async () => {
    const r = await page.evaluate(() => ({
      imgs: document.querySelectorAll('table#records-table tbody img, table#records-table [onerror]').length,
      pwned: window.__pwned,
    }));
    assert.equal(r.imgs, 0, '名前の文字列から要素が作られました');
    assert.equal(r.pwned, undefined);
  });

  test('svg・role="img" の記録は、画像の列に「画像のURLはありません」と表示し、「画像を表示」ボタンを置かない', async () => {
    const rows = await tableRows(page);
    const IMG_COL = 3;
    for (const i of [0, 1, 3, 4]) {
      assert.match(rows[i][IMG_COL], /画像のURLはありません/, `${i + 1}行目の画像の列：${rows[i][IMG_COL]}`);
      assert.doesNotMatch(rows[i][IMG_COL], /画像を表示/);
    }
    assert.match(rows[2][IMG_COL], /画像を表示/, 'input type="image" の記録には「画像を表示」ボタンを置く');
  });

  test('書き出したファイルの記録に element が入る（13項目）', async () => {
    await page.locator('fieldset#export-sites input[type="checkbox"][value="a.example"]').check();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator('#export-button').click()]);
    const json = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(json.version, 1, 'version は1のまま');
    assert.equal(json.records.length, ROWS.length);
    for (const r of json.records) assert.deepEqual(Object.keys(r).sort(), [...RECORD_FIELDS].sort());
    const byTime = Object.fromEntries(json.records.map((r) => [r.ratedAt, r]));
    for (const [rec] of ROWS) {
      const strip = (u) => (u == null ? u : u.replace(/[?#].*$/, ''));
      assert.deepEqual(byTime[rec.ratedAt], { ...pickRecord(rec), pageUrl: strip(rec.pageUrl), imageUrl: strip(rec.imageUrl) });
    }
  });

  describe('取り込み', () => {
    const fileOf = (records) => ({ format: 'alt-tsushinbo', version: 1, exportedAt: '2026-11-07T09:00:00.000Z', evaluator: '鈴木', records });

    async function importFile(content) {
      await clearStatus(page);
      await page.locator('#import-file').setInputFiles({
        name: 'records.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(content)),
      });
      return waitStatus(page, (s) => s !== '', '#status に取り込みの結果が表示されません');
    }

    const imported = async () => Object.fromEntries(Object.entries(await h.storageAll()).filter(([k]) => k.startsWith('i:')));

    test('element の無い記録は img として取り込み、不明な element の記録は取り込まない', async () => {
      const noElement = makeRecord({ pageUrl: 'https://z.example/old', name: '古い形式の記録' });
      delete noElement.element;
      const bad = makeRecord({ pageUrl: 'https://z.example/bad', name: '不明な種類', element: 'canvas' });
      const svg = makeRecord({
        pageUrl: 'https://z.example/svg',
        name: 'svgの記録',
        element: 'svg',
        imageUrl: null,
        embedded: true,
        nameSource: 'svg-title',
        alt: null,
        altState: 'missing',
      });
      const status = await importFile(fileOf([noElement, bad, svg]));
      assert.match(status, /^2件を取り込みました/, `#status：${status}`);
      assert.match(status, /1件は形式が合わないため取り込みませんでした/, `#status：${status}`);
      const all = await imported();
      const values = Object.values(all);
      const old = values.find((v) => v.name === '古い形式の記録');
      assert.ok(old, `element の無い記録が取り込まれていません：${JSON.stringify(Object.keys(all))}`);
      assert.equal(old.element, 'img', 'element の無い記録は img とみなす');
      assert.deepEqual(Object.keys(old).sort(), [...RECORD_FIELDS, 'evaluator', 'importedAt'].sort());
      assert.ok(all[importedKey('鈴木', noElement)], '取り込んだ img の記録のキー');
      const s = values.find((v) => v.name === 'svgの記録');
      assert.ok(s, 'svg の記録が取り込まれていません');
      assert.equal(s.element, 'svg');
      assert.equal(s.nameSource, 'svg-title');
      assert.ok(!values.some((v) => v.name === '不明な種類'), '不明な element の記録が取り込まれました');
    });

    test('取り込んだ svg の記録も、表の名前の列に「（svg要素）」が付く', async () => {
      await reloadOptions(page);
      const rows = await tableRows(page);
      const row = rows.find((r) => r[NAME_COL].includes('svgの記録'));
      assert.ok(row, '取り込んだ svg の記録が表にありません');
      assert.equal(normName(row[NAME_COL]), '名前：svgの記録（title要素から）（svg要素）');
      await sleep(100);
      assert.equal(await page.evaluate(() => window.__pwned), undefined);
    });
  });
});
