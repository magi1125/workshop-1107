// 契約「svg要素、role="img"の要素、input type="image"」：評価ボックスの挿入・1行目・印（小さい画像）・キーボード・変化への追従・保存のキーのテスト
// 契約「小さい画像の印（バッジ）」により、幅か高さが48px未満の要素は data-mode="badge" になる
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, waitForBoxCount, waitFor, clickRatingInBox } from './helpers/extension.mjs';

const HIDDEN = 'スクリーンリーダーに伝わらない画像（aria-hidden）。';
const NONE_SVG = '名前なし（「画像」とだけ読み上げられるか、読み飛ばされる場合があります）';
const NONE_IMG = '名前なし（ファイル名が読み上げられる場合があります）';

// [対象の要素のセレクター, 基準の要素のセレクター, element, category, 1行目, data-mode]
const EXPECTED = [
  ['#svg-big', '#svg-big', 'svg', 'named', '名前：大きい図（title要素から）', 'inline'],
  ['#svg-in-btn', '#svg-btn', 'svg', 'hidden', `${HIDDEN}名前なし`, 'badge'],
  ['#svg-in-link', '#svg-link', 'svg', 'named', '名前：ホーム（aria-labelから）', 'badge'],
  ['#ri-stars', '#ri-stars', 'role-img', 'named', '名前：評価：星4つ（aria-labelから）', 'inline'],
  ['#ri-none', '#ri-none', 'role-img', 'none', NONE_SVG, 'inline'],
  ['#ri-hidden', '#ri-hidden-outer', 'role-img', 'hidden', `${HIDDEN}名前：飾りの星`, 'inline'],
  ['#svg-hidden-noname', '#svg-hidden-outer', 'svg', 'hidden', `${HIDDEN}名前なし`, 'inline'],
  ['#svg-pres', '#svg-pres', 'svg', 'empty', '読み上げられない画像（role="presentation"）', 'inline'],
  ['#svg-noname-a', '#svg-noname-a', 'svg', 'none', NONE_SVG, 'inline'],
  ['#svg-noname-b', '#svg-noname-b', 'svg', 'none', NONE_SVG, 'inline'],
  ['#same-1 > svg', '#same-1 > svg', 'svg', 'none', NONE_SVG, 'inline'],
  ['#same-2 > svg', '#same-2 > svg', 'svg', 'none', NONE_SVG, 'inline'],
  ['#long-1 > svg', '#long-1 > svg', 'svg', 'none', NONE_SVG, 'inline'],
  ['#long-2 > svg', '#long-2 > svg', 'svg', 'none', NONE_SVG, 'inline'],
  ['#svg-small', '#svg-small', 'svg', 'named', '名前：小さいアイコン（title要素から）', 'badge'],
  ['#ii-alt', '#ii-alt', 'input-image', 'named', '名前：検索（altから）', 'inline'],
  // input type="image" は、名前が無いと「送信」などの決まった名前で読み上げられる（取り決めの「1行目の文字」）
  ['#ii-none', '#ii-none', 'input-image', 'none', '名前なし（「送信」などの決まった名前で読み上げられる場合があります）', 'inline'],
  ['#ii-hidden', '#ii-hidden-outer', 'input-image', 'hidden', `${HIDDEN}空のalt`, 'inline'],
  ['#svg-outer', '#svg-outer', 'svg', 'named', '名前：外側（title要素から）', 'inline'],
  ['#svg-mutable', '#svg-mutable', 'svg', 'named', '名前：変わる前（aria-labelから）', 'inline'],
];

// 評価ボックスを入れない要素（role="img" の中の svg、svg の中の svg）
const NO_BOX = ['#star1', '#star2', '#svg-inner'];

// ---- FNV-1a（32ビット）。契約は「outerHTML の先頭4,000文字」。文字の数え方の解釈が2通りあるため、両方を求める ----
function fnv1aCodeUnits(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
function fnv1aUtf8(str) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(str, 'utf8')) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
const hashOf = (outerHTML) => fnv1aCodeUnits(outerHTML.slice(0, 4000));

describe('svg要素・role="img"・input type="image" の評価ボックス', { timeout: 240000 }, () => {
  let h;
  let page;
  let pageUrl;
  let outerBefore; // 評価モードをオンにする前の outerHTML
  let fpBefore; // 保存のキーのハッシュの元（id・class・style 属性を除いた outerHTML）

  const KEY_SELECTORS = ['#svg-noname-a', '#svg-noname-b', '#same-1 > svg', '#same-2 > svg', '#long-1 > svg', '#long-2 > svg', '#ri-none', '#svg-in-link', '#svg-big', '#ri-stars'];

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    pageUrl = h.url('svg-boxes.html');
    page = await h.openFixture('svg-boxes.html');
    outerBefore = await page.evaluate(
      (sels) => Object.fromEntries(sels.map((s) => [s, document.querySelector(s).outerHTML])),
      KEY_SELECTORS,
    );
    // 取り決め：要素を複製し、自分と子孫の id・class・style 属性を除いた outerHTML
    fpBefore = await page.evaluate(
      (sels) => Object.fromEntries(sels.map((s) => {
        const clone = document.querySelector(s).cloneNode(true);
        for (const n of [clone, ...clone.querySelectorAll('*')]) {
          n.removeAttribute('id');
          n.removeAttribute('class');
          n.removeAttribute('style');
        }
        return [s, clone.outerHTML];
      })),
      KEY_SELECTORS,
    );
    await h.enable(page);
    await waitForBoxCount(page, EXPECTED.length).catch(() => {});
  });

  after(async () => {
    await h?.close();
  });

  /** セレクターの要素の評価ボックスの状態 */
  const stateOf = (sel) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const box = el && window.__t.boxFor(el);
      if (!box) return null;
      return { ...window.__t.state(box), popoverOpen: box.matches(':popover-open'), index: window.__t.boxes().indexOf(box) };
    }, sel);

  async function click(sel, rating) {
    const s = await stateOf(sel);
    if (!s) throw new Error(`${sel} の評価ボックスが見つかりません`);
    // 印（data-mode="badge"）の評価ボックスは、マウスを重ねて開いてから押す
    await clickRatingInBox(page, page.locator('alt-eval-box[data-alt-eval="box"]').nth(s.index), rating);
  }

  async function waitRecord(key, pred = (v) => v !== undefined, message) {
    let all;
    try {
      return (await waitFor(
        async () => {
          all = await h.storageAll();
          return pred(all[key]) ? { v: all[key] } : null;
        },
        { message: message || `保存の結果が条件を満たしません：${key}` },
      )).v;
    } catch (e) {
      throw new Error(`${e.message}\n保存されているキー：${JSON.stringify(Object.keys(all || {}).filter((k) => k.startsWith('r:')))}`);
    }
  }

  test('対象の要素1つにつき評価ボックスが1つ挿入され、total に数えられる', async () => {
    const n = await page.evaluate(() => window.__t.boxes().length);
    assert.equal(n, EXPECTED.length, '評価ボックスの数');
    const state = await h.getState(page);
    assert.equal(state.total, EXPECTED.length, 'getState の total');
  });

  test('テストの補助関数が求める対象と基準の要素が、期待どおり（テスト自体の確認）', async () => {
    const r = await page.evaluate(
      (exp) =>
        exp.map(([sel, anchorSel, kind]) => {
          const el = document.querySelector(sel);
          return [window.__t.elementKind(el), window.__t.anchorFor(el) === document.querySelector(anchorSel)];
        }),
      EXPECTED,
    );
    assert.deepEqual(r, EXPECTED.map((e) => [e[2], true]));
    const targets = await page.evaluate(() => window.__t.targetImages().length);
    assert.equal(targets, EXPECTED.length);
  });

  for (const [sel, anchorSel, kind, category, line, mode] of EXPECTED) {
    test(`${sel}（${kind}）：${anchorSel} の直後に、分類 ${category} の評価ボックスがあり、1行目は「${line}」`, async () => {
      const s = await stateOf(sel);
      assert.ok(s, `${sel} の評価ボックスが ${anchorSel} の直後にありません`);
      assert.equal(s.category, category, 'data-category');
      assert.equal(s.line, line, '1行目（p.line）');
      assert.equal(s.lineAriaHidden, category === 'named' ? 'true' : null, 'p.line の aria-hidden は named の時だけ "true"');
      assert.equal(s.groupLabel, '直前の画像の評価');
      assert.equal(s.mode, mode, 'data-mode');
      if (mode === 'compact' || mode === 'badge') assert.equal(s.popoverOpen, true, '小さい表示と印は popover で最前面に表示する');
    });
  }

  test('role="img" の中の svg と、svg の中の svg には評価ボックスを入れない（外側の要素の評価ボックスだけ）', async () => {
    const r = await page.evaluate((sels) => {
      const out = {};
      for (const s of sels) {
        const el = document.querySelector(s);
        // 要素自身の直後にも、要素の中にも評価ボックスが無い
        out[s] = !!(el.nextElementSibling?.localName === 'alt-eval-box' || el.querySelector('alt-eval-box'));
      }
      const stars = document.getElementById('ri-stars');
      out.insideStars = stars.querySelectorAll('alt-eval-box').length;
      const outer = document.getElementById('svg-outer');
      out.insideSvg = outer.querySelectorAll('alt-eval-box').length;
      out.afterStars = 0;
      for (let e = stars.nextElementSibling; e && e.localName === 'alt-eval-box'; e = e.nextElementSibling) out.afterStars++;
      out.afterBtn = 0;
      for (let e = document.getElementById('svg-btn').nextElementSibling; e && e.localName === 'alt-eval-box'; e = e.nextElementSibling) out.afterBtn++;
      return out;
    }, NO_BOX);
    for (const s of NO_BOX) assert.equal(r[s], false, `${s} に評価ボックスがあります`);
    assert.equal(r.insideStars, 0, 'role="img" の要素の中に評価ボックスがあります');
    assert.equal(r.insideSvg, 0, 'svg の中に評価ボックスがあります');
    assert.equal(r.afterStars, 1, 'role="img" の要素の直後の評価ボックスは1つ');
    assert.equal(r.afterBtn, 1, 'ボタンの直後の評価ボックスは1つ');
  });

  test('評価ボックスは、ボタン・リンクの中に入らない', async () => {
    const inside = await page.evaluate(
      () => document.querySelectorAll('button alt-eval-box, a alt-eval-box, svg alt-eval-box, [role="img"] alt-eval-box').length,
    );
    assert.equal(inside, 0);
  });

  test('評価ボックスの並びは、対象の要素の文書の順', async () => {
    const r = await page.evaluate(() => {
      const boxes = window.__t.boxes();
      return window.__t.targetImages().map((el) => boxes.indexOf(window.__t.boxFor(el)));
    });
    assert.deepEqual(r, EXPECTED.map((_, i) => i));
  });

  test('評価ボックスを挿入しても、対象の要素の outerHTML は変わらない（保存のキーのハッシュが変わらない）', async () => {
    const now = await page.evaluate((sels) => Object.fromEntries(sels.map((s) => [s, document.querySelector(s).outerHTML])), KEY_SELECTORS);
    for (const s of KEY_SELECTORS) assert.equal(now[s], outerBefore[s], `${s} の outerHTML が変わりました`);
  });

  test('Tab キーの順番：評価ボックスは文書の順に並び、ボタン・input の直後に、その要素の評価ボックスが来る', async () => {
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo(0, 0);
    });
    await page.locator('h1').click();
    const seq = [];
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press('Tab');
      const a = await page.evaluate(() => window.__t.describeActive());
      const label = a == null ? 'null' : a.kind === 'box' ? `box:${a.boxIndex}` : `page:${a.id || a.tag}`;
      seq.push(label);
      if (a && a.kind === 'page' && a.id === 'foot') break;
    }
    const collapsed = seq.filter((x, i) => i === 0 || x !== seq[i - 1]);
    const boxSeq = collapsed.filter((x) => x.startsWith('box:')).map((x) => Number(x.slice(4)));
    assert.deepEqual(boxSeq, EXPECTED.map((_, i) => i), `Tab キーの順番：${collapsed.join(' → ')}`);
    const idx = Object.fromEntries(EXPECTED.map((e, i) => [e[0], i]));
    const after = (id) => collapsed[collapsed.indexOf(`page:${id}`) + 1];
    assert.equal(after('svg-btn'), `box:${idx['#svg-in-btn']}`, 'ボタンの次は、ボタンの中のアイコンの評価ボックス');
    assert.equal(after('svg-link'), `box:${idx['#svg-in-link']}`, 'リンクの次は、リンクの中のアイコンの評価ボックス');
    assert.equal(after('ii-alt'), `box:${idx['#ii-alt']}`, 'input type="image" の次は、その評価ボックス');
  });

  describe('保存のキーと記録', () => {
    test('名前の無い svg のキーは "svg:" + outerHTML の先頭4,000文字の FNV-1a（16進数8桁）で、記録に element が入る', async () => {
      const hash = hashOf(fpBefore['#svg-noname-a']);
      assert.match(hash, /^[0-9a-f]{8}$/);
      await click('#svg-noname-a', 'good');
      const key = 'r:' + JSON.stringify([pageUrl, `svg:${hash}`, '']);
      const v = await waitRecord(key);
      assert.equal(Object.keys(v).length, 13, `記録の項目：${Object.keys(v).join(', ')}`);
      const { ratedAt, ...rest } = v;
      assert.deepEqual(rest, {
        pageUrl,
        pageTitle: 'svg要素とrole="img"の評価ボックス',
        imageUrl: null,
        embedded: true,
        category: 'none',
        name: '',
        nameSource: 'none',
        altState: 'missing',
        alt: null,
        linkUrl: null,
        rating: 'good',
        element: 'svg',
      });
      assert.equal(typeof ratedAt, 'string');
    });

    test('名前の無い別のアイコンは、別のキーで評価され、押した状態も独立している', async () => {
      const b = await stateOf('#svg-noname-b');
      assert.deepEqual(b.pressed, { good: 'false', poor: 'false' }, 'まだ評価していない svg が押した状態になっています');
      await click('#svg-noname-b', 'poor');
      const keyA = 'r:' + JSON.stringify([pageUrl, `svg:${hashOf(fpBefore['#svg-noname-a'])}`, '']);
      const keyB = 'r:' + JSON.stringify([pageUrl, `svg:${hashOf(fpBefore['#svg-noname-b'])}`, '']);
      assert.notEqual(keyA, keyB);
      const vb = await waitRecord(keyB, (v) => v && v.rating === 'poor');
      assert.equal(vb.element, 'svg');
      const all = await h.storageAll();
      assert.equal(all[keyA]?.rating, 'good', 'もう一方のアイコンの評価が変わりました');
      assert.deepEqual((await stateOf('#svg-noname-a')).pressed, { good: 'true', poor: 'false' });
      assert.deepEqual((await stateOf('#svg-noname-b')).pressed, { good: 'false', poor: 'true' });
    });

    test('outerHTML が同じ svg は同じキーで、押した状態がそろう', async () => {
      assert.equal(fpBefore['#same-1 > svg'], fpBefore['#same-2 > svg'], 'テストのページの前提');
      await click('#same-1 > svg', 'good');
      await waitFor(async () => (await stateOf('#same-2 > svg')).pressed.good === 'true', {
        message: '同じ outerHTML のもう一方の評価ボックスが押した状態になりません',
      });
      const key = 'r:' + JSON.stringify([pageUrl, `svg:${hashOf(fpBefore['#same-1 > svg'])}`, '']);
      await waitRecord(key, (v) => v && v.rating === 'good');
    });

    test('ハッシュは outerHTML の先頭4,000文字だけから求める（その後が違う svg は同じキー）', async () => {
      const a = fpBefore['#long-1 > svg'];
      const b = fpBefore['#long-2 > svg'];
      assert.ok(a.length > 4000 && a !== b && a.slice(0, 4000) === b.slice(0, 4000), 'テストのページの前提');
      assert.notEqual(fnv1aCodeUnits(a), fnv1aCodeUnits(b), 'テストの前提：全体のハッシュは違う');
      await click('#long-1 > svg', 'poor');
      const key = 'r:' + JSON.stringify([pageUrl, `svg:${hashOf(a)}`, '']);
      await waitRecord(key, (v) => v && v.rating === 'poor', `先頭4,000文字のハッシュのキー ${key} で保存されません`);
      await waitFor(async () => (await stateOf('#long-2 > svg')).pressed.poor === 'true', {
        message: '先頭4,000文字が同じ svg の評価ボックスの押した状態がそろいません',
      });
    });

    test('role="img" の要素のキーは "role-img:" + ハッシュで、element は role-img', async () => {
      await click('#ri-none', 'good');
      const key = 'r:' + JSON.stringify([pageUrl, `role-img:${hashOf(fpBefore['#ri-none'])}`, '']);
      const v = await waitRecord(key);
      assert.equal(v.element, 'role-img');
      assert.equal(v.imageUrl, null);
      assert.equal(v.embedded, true);
      assert.equal(v.alt, null);
      assert.equal(v.altState, 'missing');
      assert.equal(v.category, 'none');
    });

    test('名前のある svg（リンクの中）：キーの3番目は名前、linkUrl はリンクの href', async (t) => {
      await click('#svg-in-link', 'good');
      const outer = fpBefore['#svg-in-link'];
      const k16 = 'r:' + JSON.stringify([pageUrl, `svg:${fnv1aCodeUnits(outer.slice(0, 4000))}`, 'ホーム']);
      const k8 = 'r:' + JSON.stringify([pageUrl, `svg:${fnv1aUtf8(outer.slice(0, 4000))}`, 'ホーム']);
      const found = await waitFor(
        async () => {
          const all = await h.storageAll();
          return all[k16] ? ['UTF-16 のコード単位', all[k16]] : all[k8] ? ['UTF-8 のバイト', all[k8]] : null;
        },
        { message: 'svg のキー（UTF-16 のコード単位か UTF-8 のバイトの FNV-1a）で保存されません' },
      ).catch(async (e) => {
        const keys = Object.keys(await h.storageAll()).filter((k) => k.includes('ホーム'));
        throw new Error(`${e.message}（期待：${k16}、実際：${JSON.stringify(keys)}）`);
      });
      t.diagnostic(`日本語を含む outerHTML のハッシュは ${found[0]} で求めていた`);
      const v = found[1];
      assert.equal(v.element, 'svg');
      assert.equal(v.name, 'ホーム');
      assert.equal(v.nameSource, 'aria-label');
      assert.equal(v.category, 'named');
      assert.equal(v.linkUrl, 'https://example.com/home');
    });

    test('input type="image" のキーは src の URL で、element は input-image', async () => {
      await click('#ii-alt', 'good');
      const imageUrl = h.url('img/ii-alt.png');
      const key = 'r:' + JSON.stringify([pageUrl, imageUrl, '検索']);
      const v = await waitRecord(key);
      const { ratedAt, ...rest } = v;
      assert.deepEqual(rest, {
        pageUrl,
        pageTitle: 'svg要素とrole="img"の評価ボックス',
        imageUrl,
        embedded: false,
        category: 'named',
        name: '検索',
        nameSource: 'alt',
        altState: 'present',
        alt: '検索',
        linkUrl: null,
        rating: 'good',
        element: 'input-image',
      });
    });

    test('評価の数（rated）に svg・role="img"・input type="image" も数える', async () => {
      const s = await h.getState(page);
      // svg-noname-a・b、same-1・2、long-1・2、ri-none、svg-in-link、ii-alt
      assert.equal(s.rated, 9, JSON.stringify(s));
    });

    test('評価を取り消すと、svg のキーが削除される', async () => {
      const key = 'r:' + JSON.stringify([pageUrl, `svg:${hashOf(fpBefore['#svg-noname-a'])}`, '']);
      const before = await stateOf('#svg-noname-a');
      assert.ok((await h.storageAll())[key], `取り消す前の評価がありません（押した状態：${JSON.stringify(before.pressed)}）`);
      await click('#svg-noname-a', 'good');
      await waitFor(async () => (await stateOf('#svg-noname-a')).pressed.good === 'false', { message: '押した状態が取り消されません' });
      await waitRecord(key, (v) => v === undefined, 'キーが削除されません');
    });
  });

  describe('変化への追従', () => {
    test('オンにした後で追加した svg に評価ボックスが挿入される', async () => {
      await page.evaluate(() => {
        const li = document.createElement('li');
        li.innerHTML = '<svg id="dyn-svg" width="60" height="60"><title>後から増えたsvg</title><rect width="60" height="60"/></svg>';
        document.getElementById('dyn-list').append(li);
      });
      await waitFor(async () => (await stateOf('#dyn-svg')) !== null, { message: '追加した svg に評価ボックスが挿入されません' });
      const s = await stateOf('#dyn-svg');
      assert.equal(s.category, 'named');
      assert.equal(s.line, '名前：後から増えたsvg（title要素から）');
    });

    test('オンにした後で追加した role="img" の要素に評価ボックスが挿入される', async () => {
      await page.evaluate(() => {
        const li = document.createElement('li');
        li.innerHTML = '<span id="dyn-ri" role="img" aria-label="後から増えた絵" class="ri"></span>';
        document.getElementById('dyn-list').append(li);
      });
      await waitFor(async () => (await stateOf('#dyn-ri')) !== null, { message: '追加した role="img" の要素に評価ボックスが挿入されません' });
      assert.equal((await stateOf('#dyn-ri')).line, '名前：後から増えた絵（aria-labelから）');
    });

    test('svg の aria-label を変えると、評価ボックスの1行目が変わる', async () => {
      await page.evaluate(() => document.getElementById('svg-mutable').setAttribute('aria-label', '変わった後'));
      await waitFor(async () => (await stateOf('#svg-mutable'))?.line === '名前：変わった後（aria-labelから）', {
        message: '1行目が変わりません',
      }).catch(async (e) => {
        throw new Error(`${e.message}（実際：${JSON.stringify(await stateOf('#svg-mutable'))}）`);
      });
    });

    test('svg の title 要素の文字を変えると、評価ボックスの1行目が変わる', async () => {
      await page.evaluate(() => {
        document.querySelector('#svg-big > title').textContent = '新しい図';
      });
      await waitFor(async () => (await stateOf('#svg-big'))?.line === '名前：新しい図（title要素から）', {
        message: '1行目が変わりません',
      }).catch(async (e) => {
        throw new Error(`${e.message}（実際：${JSON.stringify(await stateOf('#svg-big'))}）`);
      });
    });

    test('変更の後も、評価ボックスは対象の要素1つにつき1つ', async () => {
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ boxes: window.__t.boxes().length, targets: window.__t.targetImages().length }));
      assert.equal(r.boxes, EXPECTED.length + 2);
      assert.equal(r.targets, EXPECTED.length + 2);
    });
  });
});
