// 評価ボックスの挿入（位置・分類・1行目・ボタン）のテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, boxLocator, waitForBoxCount } from './helpers/extension.mjs';

// 画像の id → 挿入の基準になる要素の id、分類、1行目の文字
const EXPECTED = [
  ['plain', 'plain', 'named', '名前：青い空と白い雲（altから）'],
  ['in-picture', 'pic', 'named', '名前：山の写真（altから）'],
  ['in-link', 'link-1', 'named', '名前：次のページへ（altから）'],
  ['two-1', 'link-2', 'named', '名前：一枚目の画像（altから）'],
  ['two-2', 'link-2', 'empty', '読み上げられない画像（空のalt）'],
  ['in-button', 'btn', 'named', '名前：検索する（altから）'],
  ['in-label', 'lbl', 'named', '名前：同意の画像（altから）'],
  ['nested-control', 'outer-link', 'named', '名前：入れ子のコントロール（titleから）'],
  ['in-summary', 'det', 'named', '名前：詳細を開く（altから）'],
  ['in-hidden', 'hidden-outer', 'hidden', 'スクリーンリーダーに伝わらない画像（aria-hidden）。alt：隠れた装飾'],
  ['hidden-link-picture', 'hidden-link-outer', 'hidden', 'スクリーンリーダーに伝わらない画像（aria-hidden）。空のalt'],
  ['hidden-noalt', 'hidden-noalt-outer', 'hidden', 'スクリーンリーダーに伝わらない画像（aria-hidden）。alt属性なし'],
  ['empty', 'empty', 'empty', '読み上げられない画像（空のalt）'],
  ['no-alt', 'no-alt', 'none', '名前なし（ファイル名が読み上げられる場合があります）'],
  ['presentation', 'presentation', 'empty', '読み上げられない画像（role="presentation"）'],
  ['none-role', 'none-role', 'empty', '読み上げられない画像（role="none"）'],
  ['labelledby', 'labelledby', 'named', '名前：図1の説明（aria-labelledbyから）'],
];

describe('評価ボックスの挿入', { timeout: 180000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    page = await h.openFixture('boxes.html');
  });

  after(async () => {
    await h?.close();
  });

  test('評価モードを挿入していないタブの getState は { enabled: false, total: 0, rated: 0 }', async () => {
    const state = await h.getState(page);
    assert.deepEqual(state, { enabled: false, total: 0, rated: 0 });
  });

  test('オンにすると、表示されている画像1枚につき評価ボックスが1つ挿入される', async () => {
    const state = await h.enable(page);
    await waitForBoxCount(page, EXPECTED.length);
    assert.equal(state.enabled, true);
    assert.equal(state.total, EXPECTED.length, 'setEnabled の total');
    assert.equal(state.rated, 0);
  });

  test('テストの補助関数が求める基準の要素が、期待どおり（テスト自体の確認）', async () => {
    const anchors = await page.evaluate(
      (ids) => ids.map((id) => window.__t.anchorFor(document.getElementById(id)).id),
      EXPECTED.map((e) => e[0]),
    );
    assert.deepEqual(anchors, EXPECTED.map((e) => e[1]));
  });

  for (const [imgId, anchorId, category, line] of EXPECTED) {
    test(`#${imgId}：#${anchorId} の直後に、分類 ${category} の評価ボックスがある`, async () => {
      const info = await page.evaluate((id) => {
        const img = document.getElementById(id);
        const box = window.__t.boxFor(img);
        if (!box) return null;
        return {
          ...window.__t.state(box),
          dataAltEval: box.getAttribute('data-alt-eval'),
          insideAriaHidden: !!box.closest('[aria-hidden="true"]'),
          insideControl: !!box.parentElement.closest('a[href], button, summary, label, [role="button"], [role="link"]'),
          insidePicture: !!box.closest('picture'),
          shadowMode: box.shadowRoot ? box.shadowRoot.mode : null,
        };
      }, imgId);
      assert.ok(info, `#${imgId} の評価ボックスが #${anchorId} の直後にありません`);
      assert.equal(info.dataAltEval, 'box');
      assert.equal(info.shadowMode, 'open', 'シャドウルートは mode: open');
      assert.equal(info.category, category, 'data-category');
      assert.equal(info.mode, 'inline', 'data-mode');
      assert.equal(info.line, line, 'p.line の文字');
      if (category === 'named') assert.equal(info.lineAriaHidden, 'true', '名前ありの1行目は aria-hidden="true"');
      else assert.notEqual(info.lineAriaHidden, 'true', `${category} の1行目は読み上げる（aria-hidden を付けない）`);
      assert.equal(info.insideAriaHidden, false, '評価ボックスが aria-hidden="true" の中にあります');
      assert.equal(info.insideControl, false, '評価ボックスがリンクやボタンの中にあります');
      assert.equal(info.insidePicture, false, '評価ボックスが picture の中にあります');
    });
  }

  test('リンクの中の2枚の画像は、評価ボックスが画像と同じ順に並ぶ', async () => {
    const r = await page.evaluate(() => {
      const link = document.getElementById('link-2');
      const a = link.nextElementSibling;
      const b = a && a.nextElementSibling;
      return [a, b].map((x) => (x && x.localName === 'alt-eval-box' ? window.__t.state(x).line : null));
    });
    assert.deepEqual(r, ['名前：一枚目の画像（altから）', '読み上げられない画像（空のalt）']);
  });

  test('ボタンのグループと3つのボタンが契約どおり', async () => {
    for (const [imgId] of EXPECTED) {
      const info = await page.evaluate((id) => {
        const box = window.__t.boxFor(document.getElementById(id));
        const root = box.shadowRoot;
        const groups = root.querySelectorAll('div[role="group"][aria-label="直前の画像の評価"]');
        const buttons = Array.from(root.querySelectorAll('button[data-rating]'));
        return {
          groupCount: groups.length,
          inGroup: buttons.every((b) => groups[0] && groups[0].contains(b)),
          buttons: buttons.map((b) => ({
            rating: b.dataset.rating,
            type: b.getAttribute('type'),
            pressed: b.getAttribute('aria-pressed'),
          })),
          hasToggle: !!root.querySelector('button.toggle'),
        };
      }, imgId);
      assert.equal(info.groupCount, 1, `#${imgId}：role="group" で aria-label="直前の画像の評価" の要素が1つ`);
      assert.ok(info.inGroup, `#${imgId}：3つのボタンがグループの中にありません`);
      assert.deepEqual(
        info.buttons,
        [
          { rating: 'good', type: 'button', pressed: 'false' },
          { rating: 'fair', type: 'button', pressed: 'false' },
          { rating: 'poor', type: 'button', pressed: 'false' },
        ],
        `#${imgId} のボタン`,
      );
      assert.equal(info.hasToggle, false, `#${imgId}：通常表示に button.toggle があります`);
    }
  });

  test('ボタンのアクセシブルネームは「良い」「普通」「悪い」、グループの名前は「直前の画像の評価」', async () => {
    const box = await boxLocator(page, 'plain');
    const group = box.getByRole('group', { name: '直前の画像の評価', exact: true });
    assert.equal(await group.count(), 1);
    for (const [rating, name] of [
      ['good', '良い'],
      ['fair', '普通'],
      ['poor', '悪い'],
    ]) {
      const btn = group.getByRole('button', { name, exact: true });
      assert.equal(await btn.count(), 1, `名前が「${name}」のボタン`);
      assert.equal(await btn.getAttribute('data-rating'), rating);
    }
  });

  test('通常表示のボタンは 44×44px 以上', async () => {
    const sizes = await page.evaluate(() => {
      const box = window.__t.boxFor(document.getElementById('plain'));
      return Array.from(box.shadowRoot.querySelectorAll('button[data-rating]')).map((b) => {
        const r = b.getBoundingClientRect();
        return { rating: b.dataset.rating, w: r.width, h: r.height };
      });
    });
    for (const s of sizes) assert.ok(s.w >= 44 && s.h >= 44, `${s.rating}：${s.w}×${s.h}`);
  });

  test('表示されていない画像、ページのシャドウDOMと iframe の中の画像には評価ボックスが無い', async () => {
    const r = await page.evaluate(() => {
      const after = (id) => {
        const el = document.getElementById(id);
        const n = el.nextElementSibling;
        return n ? n.localName : null;
      };
      const frameDoc = document.getElementById('frame').contentDocument;
      return {
        displayNone: after('display-none'),
        parentNone: document.getElementById('parent-none').parentElement.querySelectorAll('alt-eval-box').length,
        pageShadow: document.getElementById('page-shadow-host').shadowRoot.querySelectorAll('alt-eval-box').length,
        iframe: frameDoc ? frameDoc.querySelectorAll('alt-eval-box').length : 0,
      };
    });
    assert.notEqual(r.displayNone, 'alt-eval-box', 'display:none の画像の後ろに評価ボックスがあります');
    assert.equal(r.parentNone, 0, '親が display:none の画像に評価ボックスがあります');
    assert.equal(r.pageShadow, 0, 'ページのシャドウDOMの中に評価ボックスがあります');
    assert.equal(r.iframe, 0, 'iframe の中に評価ボックスがあります');
  });

  test('もう一度オンにしても、評価ボックスは増えない（初期化をやり直さない）', async () => {
    const state = await h.enable(page);
    await page.waitForTimeout(300);
    const count = await page.evaluate(() => window.__t.boxes().length);
    assert.equal(count, EXPECTED.length);
    assert.equal(state.total, EXPECTED.length);
    assert.equal(state.enabled, true);
  });

  test('getState が評価ボックスの数を返す', async () => {
    assert.deepEqual(await h.getState(page), { enabled: true, total: EXPECTED.length, rated: 0 });
  });

  test('オフにしてからもう一度オンにすると、同じ数の評価ボックスが挿入される', async () => {
    const off = await h.disable(page);
    assert.equal(off.enabled, false);
    await waitForBoxCount(page, 0);
    const on = await h.enable(page);
    await waitForBoxCount(page, EXPECTED.length);
    assert.equal(on.total, EXPECTED.length);
  });
});
