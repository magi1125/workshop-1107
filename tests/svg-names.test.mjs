// 契約「svg要素、role="img"の要素、input type="image"」：accessible-name.js の isCandidate・computeName・describe のテスト。
// accessible-name.js を単独でページに読み込んで呼び出し、あわせて Chromium が計算した名前（CDP）と比べる。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchPlain, ACCESSIBLE_NAME_PATH } from './helpers/extension.mjs';

const SOURCES = ['aria-labelledby', 'aria-label', 'alt', 'title', 'svg-title', 'none'];

// 契約の表から求めた期待値。
// source を省略したものは、名前が空で出どころが契約から決まらないもの（SOURCES のどれかであればよい）
const SVG_COMMON = { element: 'svg', alt: null, altState: 'missing', imageUrl: null, embedded: true };
const RI_COMMON = { element: 'role-img', alt: null, altState: 'missing', imageUrl: null, embedded: true };
const II = (over) => ({ element: 'input-image', embedded: false, ...over });

const EXPECTED = {
  // svg
  'svg-lby': { ...SVG_COMMON, name: '虫めがね', source: 'aria-labelledby', category: 'named' },
  'svg-label': { ...SVG_COMMON, name: '家の アイコン', source: 'aria-label', category: 'named' },
  'svg-title': { ...SVG_COMMON, name: '星の アイコン', source: 'svg-title', category: 'named' },
  'svg-role-img': { ...SVG_COMMON, name: '売上のグラフ', source: 'svg-title', category: 'named' },
  'svg-gdoc': { ...SVG_COMMON, name: '配置図', source: 'aria-label', category: 'named' },
  'svg-pres': { ...SVG_COMMON, name: '', presentational: true, category: 'empty' },
  'svg-none-role': { ...SVG_COMMON, name: '', presentational: true, category: 'empty' },
  'svg-pres-label': { ...SVG_COMMON, name: 'ラベルがあれば名前あり', source: 'aria-label', category: 'named' },
  'svg-nothing': { ...SVG_COMMON, name: '', source: 'none', category: 'none' },
  'svg-self-hidden': { ...SVG_COMMON, name: '隠れたアイコン', source: 'svg-title', category: 'hidden' },
  'svg-hidden-nothing': { ...SVG_COMMON, name: '', source: 'none', category: 'hidden' },
  'svg-hidden-label': { ...SVG_COMMON, name: '隠れたラベル', source: 'aria-label', category: 'hidden' },
  'svg-in-link': { ...SVG_COMMON, name: 'ホーム', source: 'svg-title', category: 'named', linkUrl: 'https://example.com/home' },
  'svg-outer': { ...SVG_COMMON, name: '外側', source: 'svg-title', category: 'named' },
  // role="img"
  'ri-lby': { ...RI_COMMON, name: '晴れのち曇り', source: 'aria-labelledby', category: 'named' },
  'ri-label': { ...RI_COMMON, name: '笑顔', source: 'aria-label', category: 'named' },
  'ri-title': { ...RI_COMMON, name: '星3つ', source: 'title', category: 'named' },
  'ri-nothing': { ...RI_COMMON, name: '', source: 'none', category: 'none' },
  'ri-content': { ...RI_COMMON, name: '', source: 'none', category: 'none' },
  'ri-multi': { ...RI_COMMON, name: '最初の値がimg', source: 'aria-label', category: 'named' },
  'ri-self-hidden': { ...RI_COMMON, name: '隠れた絵文字', source: 'aria-label', category: 'hidden' },
  'ri-hidden-nothing': { ...RI_COMMON, name: '', source: 'none', category: 'hidden' },
  'ri-wrapper': { ...RI_COMMON, name: '地図', source: 'aria-label', category: 'named' },
  // input type="image"
  'ii-alt': II({ name: '検索する', source: 'alt', category: 'named', altState: 'present', alt: '検索する' }),
  'ii-label': II({ name: 'ラベルで送信', source: 'aria-label', category: 'named', altState: 'present', alt: 'altは使われない' }),
  'ii-lby': II({ name: '参照先で送信', source: 'aria-labelledby', category: 'named', altState: 'present', alt: 'altは使われない' }),
  'ii-title': II({ name: 'タイトルで送信', source: 'title', category: 'named', altState: 'missing', alt: null }),
  'ii-nothing': II({ name: '', source: 'none', category: 'none', altState: 'missing', alt: null }),
  // Chromium は名前の無い input type="image" を「送信」というボタンとして読み上げるため、空の alt でも none（取り決めの「svg要素、role="img"の要素、input type="image"」）
  'ii-empty-alt': II({ name: '', category: 'none', altState: 'empty', alt: '' }),
  'ii-data': II({ name: '埋め込みのボタン', source: 'alt', category: 'named', altState: 'present', alt: '埋め込みのボタン', embedded: true, imageUrl: null }),
  'ii-in-link': II({ name: 'リンクの中', source: 'alt', category: 'named', altState: 'present', alt: 'リンクの中', linkUrl: 'https://example.com/go' }),
  'ii-hidden': II({ name: '隠れたボタン', source: 'alt', category: 'hidden', altState: 'present', alt: '隠れたボタン' }),
};

// 対象の候補にならない要素
const NOT_CANDIDATES = {
  'svg-inner': 'ほかの svg の中の svg',
  'svg-role-button': 'role="button" の svg',
  'ri-not-first': 'role の最初の値が img でない',
  'ri-inner-img': 'role="img" の中の img',
  'ri-inner-svg': 'role="img" の中の svg',
  'ri-inner-ri': 'role="img" の中の role="img"',
  'ri-inner-input': 'role="img" の中の input type="image"',
  'text-input': 'input type="text"',
  'plain-div': 'role の無い div',
};

// Chromium と名前が一致しなければ失敗にする、基本の場合
const STRICT_BROWSER = ['svg-lby', 'svg-label', 'svg-title', 'svg-role-img', 'svg-in-link', 'ri-lby', 'ri-label', 'ri-title', 'ii-alt', 'ii-label', 'ii-lby'];

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('svg要素・role="img"・input type="image" の名前（accessible-name.js）', { timeout: 120000 }, () => {
  let h;
  let page;
  let results;
  let candidates;

  before(async () => {
    h = await launchPlain();
    page = await h.browser.newPage();
    await page.goto(h.url('svg-names.html'), { waitUntil: 'load' });
    await page.addScriptTag({ path: ACCESSIBLE_NAME_PATH });
    ({ results, candidates } = await page.evaluate(
      ({ ids, notIds }) => {
        const api = globalThis.AltEvalName;
        if (!api) return { results: null, candidates: null };
        const results = {};
        for (const id of ids) {
          const el = document.getElementById(id);
          try {
            results[id] = { computed: api.computeName(el), described: api.describe(el) };
          } catch (e) {
            results[id] = { error: String(e) };
          }
        }
        const candidates = {};
        if (typeof api.isCandidate === 'function') {
          for (const id of [...ids, ...notIds]) candidates[id] = api.isCandidate(document.getElementById(id));
        }
        return { results, candidates: typeof api.isCandidate === 'function' ? candidates : null };
      },
      { ids: Object.keys(EXPECTED), notIds: Object.keys(NOT_CANDIDATES) },
    ));
  });

  after(async () => {
    await h?.close();
  });

  test('globalThis.AltEvalName に isCandidate が定義される', () => {
    assert.ok(results, 'globalThis.AltEvalName がありません');
    assert.ok(candidates, 'globalThis.AltEvalName.isCandidate が関数ではありません');
  });

  describe('isCandidate', () => {
    for (const [id, exp] of Object.entries(EXPECTED)) {
      test(`isCandidate：#${id}（${exp.element}）は対象の候補`, () => {
        assert.ok(candidates, 'isCandidate がありません');
        assert.equal(candidates[id], true);
      });
    }
    for (const [id, why] of Object.entries(NOT_CANDIDATES)) {
      test(`isCandidate：#${id}（${why}）は対象にしない`, () => {
        assert.ok(candidates, 'isCandidate がありません');
        assert.equal(candidates[id], false);
      });
    }

    test('isCandidate：ふつうの img は候補', async () => {
      const r = await page.evaluate(() => {
        const api = globalThis.AltEvalName;
        if (typeof api?.isCandidate !== 'function') return null;
        const img = document.createElement('img');
        img.src = '/img/plain.png';
        img.alt = 'ふつうの画像';
        document.body.append(img);
        const out = api.isCandidate(img);
        img.remove();
        return out;
      });
      assert.equal(r, true);
    });

    // 評価ボックスのホスト要素を作り、中に svg・role="img"・img を入れる
    const inBox = (where) =>
      page.evaluate((where) => {
        const api = globalThis.AltEvalName;
        if (typeof api?.isCandidate !== 'function') return null;
        const host = document.createElement('alt-eval-box');
        host.setAttribute('data-alt-eval', 'box');
        const html =
          '<svg width="20" height="20"><title>箱の中</title></svg><span role="img" aria-label="箱の中"></span><img alt="箱の中" src="/img/in-box.png">';
        let root;
        if (where === 'shadow') {
          root = host.attachShadow({ mode: 'open' });
          root.innerHTML = html;
        } else {
          host.innerHTML = html;
          root = host;
        }
        document.body.append(host);
        const out = Array.from(root.querySelectorAll('svg, [role], img')).map((e) => api.isCandidate(e));
        host.remove();
        return out;
      }, where);

    test('isCandidate：評価ボックス（alt-eval-box）の子の要素は候補にしない', async () => {
      assert.deepEqual(await inBox('light'), [false, false, false], 'svg・role="img"・img');
    });

    test('isCandidate：評価ボックスのシャドウルートの中の要素は候補にしない', async () => {
      assert.deepEqual(await inBox('shadow'), [false, false, false], 'svg・role="img"・img');
    });

    test('isCandidate：role の値の大文字・小文字と、svg の role の値（img・graphics-document・presentation・none 以外）', async () => {
      const r = await page.evaluate(() => {
        const api = globalThis.AltEvalName;
        if (typeof api?.isCandidate !== 'function') return null;
        const wrap = document.createElement('div');
        wrap.innerHTML =
          '<svg role="graphics-symbol" width="20" height="20"></svg>' +
          '<svg role="link" width="20" height="20"></svg>' +
          '<svg role="none" width="20" height="20"></svg>' +
          '<span role="button img" aria-label="x"></span>';
        document.body.append(wrap);
        const out = Array.from(wrap.children).map((e) => api.isCandidate(e));
        wrap.remove();
        return out;
      });
      assert.ok(r, 'isCandidate がありません');
      assert.deepEqual(r, [false, false, true, false]);
    });
  });

  for (const [id, exp] of Object.entries(EXPECTED)) {
    test(`computeName：#${id}`, () => {
      assert.ok(results, 'AltEvalName がありません');
      assert.ok(!results[id].error, `例外：${results[id].error}`);
      const c = results[id].computed;
      assert.equal(c.name, exp.name, `#${id} の name`);
      if (exp.source) assert.equal(c.source, exp.source, `#${id} の source`);
      else assert.ok(SOURCES.includes(c.source), `#${id} の source が契約の値ではありません：${c.source}`);
      assert.equal(c.presentational, exp.presentational === true, `#${id} の presentational`);
    });

    test(`describe：#${id}`, () => {
      assert.ok(results, 'AltEvalName がありません');
      assert.ok(!results[id].error, `例外：${results[id].error}`);
      const d = results[id].described;
      const c = results[id].computed;
      assert.equal(d.element, exp.element, `#${id} の element`);
      assert.equal(d.category, exp.category, `#${id} の category`);
      assert.equal(d.name, c.name, `#${id} の describe().name が computeName と一致しません`);
      assert.equal(d.nameSource, c.source, `#${id} の nameSource`);
      assert.equal(d.presentational, c.presentational, `#${id} の presentational`);
      assert.equal(d.altState, exp.altState, `#${id} の altState`);
      assert.equal(d.alt, exp.alt, `#${id} の alt`);
      assert.equal(d.embedded, exp.embedded, `#${id} の embedded`);
      const imageUrl = 'imageUrl' in exp ? exp.imageUrl : h.url(`img/${id}.png`);
      assert.equal(d.imageUrl, imageUrl, `#${id} の imageUrl`);
      assert.equal(d.linkUrl, exp.linkUrl ?? null, `#${id} の linkUrl`);
    });
  }

  test('svg の title 要素の文字を変えると、computeName は変えた後の値で計算する', async () => {
    const r = await page.evaluate(() => {
      const svg = document.getElementById('svg-title');
      const t = svg.querySelector('title');
      const old = t.textContent;
      const before = globalThis.AltEvalName.computeName(svg).name;
      t.textContent = '新しい星';
      const after = globalThis.AltEvalName.computeName(svg).name;
      t.textContent = old;
      return { before, after };
    });
    assert.deepEqual(r, { before: '星の アイコン', after: '新しい星' });
  });

  // Chromium が計算した名前を CDP で取得する
  async function browserNames(ids) {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const out = {};
      for (const id of ids) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${id}` });
        const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        const n = nodes[0];
        out[id] = {
          ignored: !!n.ignored,
          role: n.role?.value ?? null,
          rawName: n.name?.value ?? '',
          name: n.ignored ? '' : norm(n.name?.value),
        };
      }
      return out;
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  const visibleIds = () => Object.keys(EXPECTED).filter((id) => EXPECTED[id].category !== 'hidden');

  async function mismatches(ids) {
    const browser = await browserNames(ids);
    const out = [];
    for (const id of ids) {
      const ours = results[id].computed?.name;
      const b = browser[id];
      if (ours !== b.name) out.push(`#${id}：拡張機能「${ours}」／Chromium「${b.name}」（role=${b.role}, ignored=${b.ignored}）`);
    }
    return out;
  }

  test('基本の場合（svg の title 要素・aria-label、role="img" の aria-label など）の名前が Chromium と一致する', async (t) => {
    assert.ok(results, 'AltEvalName がありません');
    const m = await mismatches(STRICT_BROWSER);
    for (const x of m) t.diagnostic(`名前の不一致 ${x}`);
    assert.deepEqual(m, [], `契約の表と Chromium が基本の場合で食い違います：\n${m.join('\n')}`);
  });

  test(
    'そのほかの要素の名前と Chromium の名前の差を報告する（aria-hidden の中を除く。失敗にはしない）',
    { todo: '契約の表と Chromium の計算が異なる場合がある（input type="image" の既定の名前など）' },
    async (t) => {
      assert.ok(results, 'AltEvalName がありません');
      const ids = visibleIds().filter((id) => !STRICT_BROWSER.includes(id));
      const m = await mismatches(ids);
      for (const x of m) t.diagnostic(`名前の不一致 ${x}`);
      assert.deepEqual(m, []);
    },
  );

  test(
    '分類と Chromium の扱い（無視されるか）の差を報告する（失敗にはしない）',
    { todo: '既知のリスクの計測' },
    async (t) => {
      assert.ok(results, 'AltEvalName がありません');
      const ids = Object.keys(EXPECTED);
      const browser = await browserNames(ids);
      const diffs = [];
      for (const id of ids) {
        const cat = results[id].described?.category;
        const expectIgnored = cat === 'empty' || cat === 'hidden';
        if (expectIgnored !== browser[id].ignored) {
          diffs.push(`#${id}：category=${cat}／Chromium role=${browser[id].role}, ignored=${browser[id].ignored}, name「${browser[id].rawName}」`);
        }
      }
      for (const d of diffs) t.diagnostic(`扱いの差 ${d}`);
      assert.deepEqual(diffs, []);
    },
  );
});
