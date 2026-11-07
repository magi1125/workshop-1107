// src/content/accessible-name.js を単独でページに読み込み、computeName と describe を契約どおりか確かめる。
// あわせて、Chromium 自身が計算したアクセシブルネーム（CDP）と比べる。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchPlain, ACCESSIBLE_NAME_PATH } from './helpers/extension.mjs';

// 契約の computeName / describe の期待値。
// source を省略したものは、名前が空で出どころが契約から決まらないもの（'alt' か 'none' を許す）
const EXPECTED = {
  'lby-single': { name: '犬の写真', source: 'aria-labelledby', category: 'named', altState: 'present', alt: 'altは使われない' },
  'lby-multi': { name: '茶色の 子犬', source: 'aria-labelledby', category: 'named', altState: 'missing', alt: null },
  'lby-label': { name: '参照先のラベル', source: 'aria-labelledby', category: 'named', altState: 'missing', alt: null },
  'lby-empty': { name: 'ラベルへ進む', source: 'aria-label', category: 'named', altState: 'missing', alt: null },
  'lby-missing': { name: '参照先が無い時のalt', source: 'alt', category: 'named', altState: 'present', alt: '参照先が無い時のalt' },
  'lby-over-label': { name: '犬の写真', source: 'aria-labelledby', category: 'named', altState: 'missing', alt: null },
  label: { name: '猫の 写真', source: 'aria-label', category: 'named', altState: 'present', alt: 'altは使われない' },
  'label-space': { name: '空白のラベルの次のalt', source: 'alt', category: 'named', altState: 'present', alt: '空白のラベルの次のalt' },
  alt: { name: '会社のロゴ', source: 'alt', category: 'named', altState: 'present', alt: '会社のロゴ' },
  'alt-ws': { name: '前後と 途中の空白', source: 'alt', category: 'named', altState: 'present', alt: '  前後と   途中の空白  ' },
  'alt-empty': { name: '', category: 'empty', altState: 'empty', alt: '' },
  'alt-spaces': { name: '', category: 'empty', altState: 'empty', alt: '   ' },
  'alt-empty-title': { name: '', category: 'empty', altState: 'empty', alt: '' },
  'alt-empty-label': { name: 'ラベルで名前あり', source: 'aria-label', category: 'named', altState: 'empty', alt: '' },
  'pres-alt': { name: '', presentational: true, category: 'empty', altState: 'present', alt: '飾りの線' },
  'none-noalt': { name: '', presentational: true, category: 'empty', altState: 'missing', alt: null },
  'pres-label': { name: 'ラベルがあれば名前あり', source: 'aria-label', category: 'named', altState: 'missing', alt: null },
  title: { name: 'タイトルだけ', source: 'title', category: 'named', altState: 'missing', alt: null },
  noattr: { name: '', source: 'none', category: 'none', altState: 'missing', alt: null },
  'hidden-alt': { name: '隠れた画像', source: 'alt', category: 'hidden', altState: 'present', alt: '隠れた画像' },
  'hidden-empty': { name: '', category: 'hidden', altState: 'empty', alt: '' },
  'hidden-noalt': { name: '', source: 'none', category: 'hidden', altState: 'missing', alt: null },
  'hidden-label': { name: '隠れたラベル', source: 'aria-label', category: 'hidden', altState: 'missing', alt: null },
  'self-hidden': { name: '自分で隠れた画像', source: 'alt', category: 'hidden', altState: 'present', alt: '自分で隠れた画像' },
  'hidden-false': { name: '隠れていない画像', source: 'alt', category: 'named', altState: 'present', alt: '隠れていない画像' },
  'data-src': { name: '埋め込みの画像', source: 'alt', category: 'named', embedded: true, imageUrl: null },
  'blob-src': { name: 'blobの画像', source: 'alt', category: 'named', embedded: true, imageUrl: null },
  'in-link': { name: '次のページ', source: 'alt', category: 'named', linkUrl: 'https://example.com/next' },
  'in-a-no-href': { name: 'hrefの無いa', source: 'alt', category: 'named', linkUrl: null },
};

// aria-hidden の中の画像（ブラウザとの比較から除く）
const HIDDEN_IDS = Object.entries(EXPECTED)
  .filter(([, e]) => e.category === 'hidden')
  .map(([id]) => id);

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('アクセシブルネームの計算（accessible-name.js）', { timeout: 120000 }, () => {
  let h;
  let page;
  let results; // { id: { computed, described } }

  before(async () => {
    h = await launchPlain();
    page = await h.browser.newPage();
    await page.goto(h.url('names.html'), { waitUntil: 'load' });
    // blob: の src を設定し終えるまで待つ
    await page.waitForFunction(() => document.getElementById('blob-src').src.startsWith('blob:'));
    await page.addScriptTag({ path: ACCESSIBLE_NAME_PATH });
    results = await page.evaluate(() => {
      const api = globalThis.AltEvalName;
      if (!api || typeof api.computeName !== 'function' || typeof api.describe !== 'function') return null;
      const out = {};
      for (const img of document.querySelectorAll('img[id]')) {
        out[img.id] = { computed: api.computeName(img), described: api.describe(img) };
      }
      return out;
    });
  });

  after(async () => {
    await h?.close();
  });

  test('globalThis.AltEvalName に computeName と describe が定義される', () => {
    assert.ok(results, 'globalThis.AltEvalName.computeName / describe が見つかりません');
  });

  for (const [id, exp] of Object.entries(EXPECTED)) {
    test(`computeName：#${id}`, () => {
      assert.ok(results, 'AltEvalName がありません');
      const c = results[id].computed;
      assert.equal(c.name, exp.name, `#${id} の name`);
      if (exp.source) assert.equal(c.source, exp.source, `#${id} の source`);
      else assert.ok(['alt', 'none'].includes(c.source), `#${id} の source が 'alt' か 'none' ではありません：${c.source}`);
      assert.equal(c.presentational, exp.presentational === true, `#${id} の presentational`);
    });

    test(`describe：#${id}`, () => {
      assert.ok(results, 'AltEvalName がありません');
      const d = results[id].described;
      const c = results[id].computed;
      assert.equal(d.category, exp.category, `#${id} の category`);
      assert.equal(d.name, c.name, `#${id} の describe().name が computeName と一致しません`);
      assert.equal(d.nameSource, c.source, `#${id} の nameSource`);
      assert.equal(d.presentational, c.presentational, `#${id} の presentational`);
      assert.equal(d.element, 'img', `#${id} の element`);
      if ('altState' in exp) assert.equal(d.altState, exp.altState, `#${id} の altState`);
      if ('alt' in exp) assert.equal(d.alt, exp.alt, `#${id} の alt`);
      if (exp.embedded) {
        assert.equal(d.embedded, true, `#${id} の embedded`);
        assert.equal(d.imageUrl, null, `#${id} の imageUrl（data: と blob: は記録しない）`);
      } else {
        assert.equal(d.embedded, false, `#${id} の embedded`);
        assert.equal(d.imageUrl, h.url(`img/${id}.png`), `#${id} の imageUrl`);
      }
      if ('linkUrl' in exp) assert.equal(d.linkUrl, exp.linkUrl, `#${id} の linkUrl`);
      else assert.equal(d.linkUrl, null, `#${id} の linkUrl`);
    });
  }

  test('computeName は画像の属性を変えた後の値で計算する', async () => {
    const r = await page.evaluate(() => {
      const img = document.getElementById('alt');
      const before = globalThis.AltEvalName.computeName(img).name;
      img.setAttribute('alt', '新しいロゴ');
      const after = globalThis.AltEvalName.computeName(img).name;
      img.setAttribute('alt', '会社のロゴ');
      return { before, after };
    });
    assert.deepEqual(r, { before: '会社のロゴ', after: '新しいロゴ' });
  });

  // Chromium が計算した名前を CDP で取得する
  async function browserNames() {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const out = {};
      for (const id of Object.keys(EXPECTED)) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${CSS_escape(id)}` });
        const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        const n = nodes[0];
        out[id] = {
          ignored: !!n.ignored,
          role: n.role?.value ?? null,
          rawName: n.name?.value ?? '',
          // 無視されたノードは読み上げられないので、名前は空とみなす
          name: n.ignored ? '' : norm(n.name?.value),
        };
      }
      return out;
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  test('computeName の名前が Chromium のアクセシブルネームと一致する（aria-hidden の中を除く）', async (t) => {
    assert.ok(results, 'AltEvalName がありません');
    const browser = await browserNames();
    const mismatches = [];
    for (const id of Object.keys(EXPECTED)) {
      if (HIDDEN_IDS.includes(id)) continue;
      const ours = results[id].computed.name;
      const theirs = browser[id].name;
      if (ours !== theirs) {
        mismatches.push(`#${id}：拡張機能「${ours}」／Chromium「${theirs}」（role=${browser[id].role}, ignored=${browser[id].ignored}）`);
      }
    }
    for (const m of mismatches) t.diagnostic(`名前の不一致 ${m}`);
    assert.deepEqual(mismatches, [], `Chromium と名前が一致しない画像があります：\n${mismatches.join('\n')}`);
  });

  // 分類（読み上げられるかどうか）と Chromium の扱いの差。契約の仕様に由来する既知の差がありうるため、報告だけする
  test(
    '分類と Chromium の扱いの差を報告する（既知のリスクの計測。失敗にはしない）',
    { todo: '企画書の既知のリスク：拡張機能の計算がブラウザと一致しない場合がある' },
    async (t) => {
      assert.ok(results, 'AltEvalName がありません');
      const browser = await browserNames();
      const diffs = [];
      for (const id of Object.keys(EXPECTED)) {
        const cat = results[id].described.category;
        const b = browser[id];
        // 'empty' と 'hidden' は読み上げられない（無視される）はず、'named' と 'none' は画像として伝わるはず
        const expectIgnored = cat === 'empty' || cat === 'hidden';
        if (expectIgnored !== b.ignored) {
          diffs.push(`#${id}：category=${cat}／Chromium role=${b.role}, ignored=${b.ignored}, name「${b.rawName}」`);
        }
      }
      for (const d of diffs) t.diagnostic(`扱いの差 ${d}`);
      assert.deepEqual(diffs, []);
    },
  );
});

// CSS.escape は Node に無いので、id に使う文字だけを扱う簡易版
function CSS_escape(s) {
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
