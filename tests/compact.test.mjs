// 小さい画像と、切り取られる評価ボックスの「小さい表示」（data-mode="compact"）のテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, boxLocator, boxState, waitForBoxCount, waitFor, sleep } from './helpers/extension.mjs';

// 小さい表示になる画像と、その理由
const COMPACT = [
  ['small', '幅と高さが48px未満（リンクの中）'],
  ['small-empty', '幅と高さが48px未満（空のalt）'],
  ['small-noalt', '幅と高さが48px未満（alt属性なし）'],
  ['narrow', '幅だけが48px未満'],
  ['clipped', 'overflow:hidden の固定の大きさの祖先に切り取られる'],
  ['card-img', '画像が overflow:hidden のカードより大きく、カードに切り取られる'],
  ['card2-img', '画像がカードの右下にずれていて、上だけ切り取られる'],
];
const BOX_COUNT = COMPACT.length + 1; // + 大きい画像（#big）

// 位置の許容誤差（px）
const TOLERANCE = 2;
// マウスを評価ボックスから離す場所（何も無い画面の右下）
const AWAY = { x: 1270, y: 890 };

describe('小さい表示の評価ボックス', { timeout: 240000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    page = await h.openFixture('compact.html');
    await h.enable(page);
    await waitForBoxCount(page, BOX_COUNT);
  });

  after(async () => {
    await h?.close();
  });

  const modeOf = (id) =>
    page.evaluate((id) => {
      const box = window.__t.boxFor(document.getElementById(id));
      if (!box) return null;
      return {
        mode: box.getAttribute('data-mode'),
        popover: box.getAttribute('popover'),
        open: box.matches(':popover-open'),
      };
    }, id);

  /** 1行目の表示の状態 */
  const lineOf = (id) =>
    page.evaluate((id) => {
      const box = window.__t.boxFor(document.getElementById(id));
      const line = box.shadowRoot.querySelector('p.line');
      return {
        display: getComputedStyle(line).display,
        shown: window.__t.visuallyShown(line),
      };
    }, id);

  const waitLine = (id, shown, message) =>
    waitFor(async () => (await lineOf(id)).shown === shown, { timeout: 3000, message });

  /** マウスを離し、フォーカスを評価ボックスの外（ページの先頭）に移す */
  async function reset() {
    await page.mouse.move(AWAY.x, AWAY.y);
    await page.evaluate(() => {
      const el = window.__t.deepActive();
      if (el && el !== document.body) el.blur();
    });
    await page.locator('h1').click();
    await page.mouse.move(AWAY.x, AWAY.y);
  }

  describe('小さい表示にする条件', () => {
    for (const [id, why] of COMPACT) {
      test(`#${id}（${why}）は data-mode="compact" で、popover="manual" で最前面に表示される`, async () => {
        const m = await modeOf(id);
        assert.ok(m, `#${id} の評価ボックスがありません`);
        assert.equal(m.mode, 'compact', 'data-mode');
        assert.equal(m.popover, 'manual', 'popover 属性');
        assert.equal(m.open, true, ':popover-open');
      });
    }

    test('大きい画像（#big）は通常表示（data-mode="inline"）で、popover で開いていない', async () => {
      const m = await modeOf('big');
      assert.equal(m.mode, 'inline');
      assert.equal(m.open, false);
    });

    test('評価ボックスに button.toggle は無い', async () => {
      const n = await page.evaluate(() =>
        window.__t.boxes().reduce((sum, b) => sum + b.shadowRoot.querySelectorAll('button.toggle, [aria-expanded]').length, 0),
      );
      assert.equal(n, 0, 'button.toggle か aria-expanded の要素があります');
    });
  });

  describe('位置', () => {
    before(reset);

    /** 評価ボックス（ホスト要素）の左上と、画像の見えている部分の左上 */
    const positionOf = (id) =>
      page.evaluate((id) => {
        const img = document.getElementById(id);
        const box = window.__t.boxFor(img);
        const b = box.getBoundingClientRect();
        return {
          box: { left: b.left, top: b.top, width: b.width, height: b.height },
          visible: window.__t.visibleRectOf(img),
          img: (({ left, top }) => ({ left, top }))(img.getBoundingClientRect()),
        };
      }, id);

    function assertPlaced(p, id) {
      const ex = { left: p.visible.left + 4, top: p.visible.top + 4 };
      const detail = `（評価ボックスの左上 ${p.box.left},${p.box.top}、期待 ${ex.left},${ex.top}、画像の左上 ${p.img.left},${p.img.top}）`;
      assert.ok(p.box.width > 0 && p.box.height > 0, `#${id}：評価ボックスの大きさが0です`);
      assert.ok(Math.abs(p.box.left - ex.left) <= TOLERANCE, `#${id}：左の位置が、見えている部分の左端 +4px ではありません${detail}`);
      assert.ok(Math.abs(p.box.top - ex.top) <= TOLERANCE, `#${id}：上の位置が、見えている部分の上端 +4px ではありません${detail}`);
    }

    test('小さいアイコン（#small）：画像の左上から右と下に4pxずらした位置に置く', async () => {
      assertPlaced(await positionOf('small'), 'small');
    });

    test('細い画像（#narrow）：画像の左上から右と下に4pxずらした位置に置く', async () => {
      assertPlaced(await positionOf('narrow'), 'narrow');
    });

    test('カードより大きい画像（#card-img）：画像ではなく、カードで切り取られた見えている部分の左上 +4px に置く', async () => {
      const p = await positionOf('card-img');
      const card = await page.evaluate(() => {
        const r = document.getElementById('card').getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      // フィクスチャの前提：画像の左上はカードの外にあり、見えている部分の左上はカードの左上
      assert.ok(p.img.left < card.left - 10 && p.img.top < card.top - 10, 'フィクスチャの前提が崩れています');
      assert.ok(Math.abs(p.visible.left - card.left) < 1 && Math.abs(p.visible.top - card.top) < 1, 'フィクスチャの前提が崩れています');
      assertPlaced(p, 'card-img');
    });

    test('上だけ切り取られる画像（#card2-img）：左は画像の左端、上はカードの上端を基準にする', async () => {
      const p = await positionOf('card2-img');
      const card = await page.evaluate(() => {
        const r = document.getElementById('card2').getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      assert.ok(p.img.left > card.left + 10 && p.img.top < card.top - 10, 'フィクスチャの前提が崩れています');
      assertPlaced(p, 'card2-img');
    });

    test('枠いっぱいの画像（#clipped）：画像の左上から右と下に4pxずらした位置に置く', async () => {
      assertPlaced(await positionOf('clipped'), 'clipped');
    });

    test('ホスト要素のDOMの位置は通常表示と同じ（基準の要素の直後）', async () => {
      const r = await page.evaluate(() => ({
        link: document.getElementById('icon-link').nextElementSibling?.localName ?? null,
        card: document.getElementById('card-img').nextElementSibling?.localName ?? null,
      }));
      assert.deepEqual(r, { link: 'alt-eval-box', card: 'alt-eval-box' });
    });
  });

  describe('ボタン', () => {
    before(reset);

    test('最初から「○」「×」の2つのボタンが見えていて、28×28px 以上', async () => {
      for (const [id] of COMPACT) {
        const r = await page.evaluate((id) => {
          const box = window.__t.boxFor(document.getElementById(id));
          return Array.from(box.shadowRoot.querySelectorAll('button')).map((b) => {
            const rect = b.getBoundingClientRect();
            return { rating: b.dataset.rating ?? null, w: rect.width, h: rect.height, shown: window.__t.visuallyShown(b) };
          });
        }, id);
        assert.deepEqual(r.map((b) => b.rating), ['good', 'poor'], `#${id}：ボタンは good と poor の2つだけ`);
        for (const b of r) {
          assert.equal(b.shown, true, `#${id}：${b.rating} のボタンが見えません`);
          assert.ok(b.w >= 28 && b.h >= 28, `#${id}：${b.rating} のボタンが 28×28px 未満です（${b.w}×${b.h}）`);
        }
      }
    });

    test('ボタンには記号「○」「×」が見え、記号は aria-hidden="true"。文字「良い」「悪い」は視覚的に隠れている', async () => {
      const r = await page.evaluate(() => {
        const box = window.__t.boxFor(document.getElementById('small'));
        const out = {};
        for (const [rating, symbol, text] of [
          ['good', '○', '良い'],
          ['poor', '×', '悪い'],
        ]) {
          const b = box.shadowRoot.querySelector(`button[data-rating="${rating}"]`);
          const sym = window.__t.textNodes(b, symbol);
          const txt = window.__t.textNodes(b, text);
          out[rating] = {
            symbolCount: sym.length,
            symbolHidden: sym.every((n) => !!n.parentElement.closest('[aria-hidden="true"]')),
            symbolShown: sym.some((n) => window.__t.textShown(n)),
            textCount: txt.length,
            textShown: txt.some((n) => window.__t.textShown(n)),
            textAriaHidden: txt.some((n) => !!n.parentElement.closest('[aria-hidden="true"]')),
          };
        }
        return out;
      });
      for (const [rating, s] of Object.entries(r)) {
        assert.equal(s.symbolCount, 1, `${rating}：記号がありません`);
        assert.equal(s.symbolHidden, true, `${rating}：記号が aria-hidden="true" の中にありません`);
        assert.equal(s.symbolShown, true, `${rating}：記号が見えません`);
        assert.equal(s.textCount, 1, `${rating}：ボタンの中に文字がありません（読み上げに残す）`);
        assert.equal(s.textAriaHidden, false, `${rating}：文字が aria-hidden です`);
        assert.equal(s.textShown, false, `${rating}：小さい表示で文字が見えています`);
      }
    });

    test('ボタンのアクセシブルネームは「良い」「悪い」で、グループの中にある', async () => {
      const box = await boxLocator(page, 'card-img');
      const group = box.getByRole('group', { name: '直前の画像の評価', exact: true });
      assert.equal(await group.count(), 1);
      assert.equal(await group.getByRole('button').count(), 2);
      for (const [rating, name] of [
        ['good', '良い'],
        ['poor', '悪い'],
      ]) {
        const btn = group.getByRole('button', { name, exact: true });
        assert.equal(await btn.count(), 1, `名前が「${name}」のボタン`);
        assert.equal(await btn.getAttribute('data-rating'), rating);
      }
    });

    test('切り取られる画像（#card-img、#clipped）のボタンが、画面の上で見えて押せる', async () => {
      for (const id of ['card-img', 'clipped', 'card2-img']) {
        const box = await boxLocator(page, id);
        for (const r of ['good', 'poor']) {
          // 実際にクリックできる（ほかの要素に隠れていない）ことを確かめる
          await box.locator(`button[data-rating="${r}"]`).click({ trial: true, timeout: 3000 });
        }
      }
    });

    test('小さい表示のボタンで評価し、もう一度押すと取り消せる', async () => {
      const box = await boxLocator(page, 'card-img');
      await box.locator('button[data-rating="good"]').click();
      await waitFor(async () => (await boxState(page, 'card-img')).pressed.good === 'true', { message: '良い が押した状態になりません' });
      assert.deepEqual((await boxState(page, 'card-img')).pressed, { good: 'true', poor: 'false' });
      await box.locator('button[data-rating="good"]').click();
      await waitFor(async () => (await boxState(page, 'card-img')).pressed.good === 'false', { message: '取り消せません' });
      await reset();
    });
  });

  describe('1行目の表示', () => {
    before(reset);

    test('最初は1行目が視覚的に隠れていて、display: none ではない', async () => {
      for (const [id] of COMPACT) {
        const l = await lineOf(id);
        assert.notEqual(l.display, 'none', `#${id}：1行目が display: none です（読み上げに残してください）`);
        assert.equal(l.shown, false, `#${id}：最初から1行目が見えています`);
      }
    });

    test('マウスを重ねると1行目が表示され、離すと隠れる', async () => {
      await reset();
      const box = await boxLocator(page, 'card-img');
      await box.locator('button[data-rating="good"]').hover();
      await waitLine('card-img', true, 'マウスを重ねても1行目が表示されません');
      await page.mouse.move(AWAY.x, AWAY.y);
      await waitLine('card-img', false, 'マウスを離しても1行目が隠れません');
    });

    test('評価ボックスの中にフォーカスがある間は1行目が表示され、外れると隠れる', async () => {
      await reset();
      await page.locator('#icon-link').focus();
      await page.keyboard.press('Tab');
      const a = await page.evaluate(() => window.__t.describeActive());
      assert.equal(a?.rating, 'good', `Tab キーで評価ボタンに移れません：${JSON.stringify(a)}`);
      await waitLine('small', true, 'フォーカスがあっても1行目が表示されません');
      // 評価ボックスの中でフォーカスを移しても、表示したまま
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => window.__t.describeActive()?.rating), 'poor');
      assert.equal((await lineOf('small')).shown, true, '評価ボックスの中でフォーカスを移すと1行目が隠れました');
      // 評価ボックスの外へ
      await page.keyboard.press('Tab');
      const out = await page.evaluate(() => window.__t.describeActive());
      assert.notEqual(out?.boxIndex, await page.evaluate(() => window.__t.boxes().indexOf(window.__t.boxFor(document.getElementById('small')))));
      await waitLine('small', false, 'フォーカスが外れても1行目が隠れません');
    });

    test('フォーカスで表示している間に Esc キーを押すと隠れ、フォーカスが外れるまで隠れたまま', async () => {
      await reset();
      const box = await boxLocator(page, 'small');
      await box.locator('button[data-rating="good"]').focus();
      await waitLine('small', true, 'フォーカスがあっても1行目が表示されません');
      await page.keyboard.press('Escape');
      await waitLine('small', false, 'Esc キーで1行目が隠れません');
      // フォーカスが評価ボックスの中にある間は、隠れたまま（中でボタンを移っても）
      await box.locator('button[data-rating="poor"]').focus();
      await sleep(300);
      assert.equal((await lineOf('small')).shown, false, 'フォーカスが評価ボックスの中にあるのに、Esc キーの後で1行目がまた表示されました');
      // フォーカスが外れてから戻ると、また表示される
      await page.locator('#after').focus();
      await waitLine('small', false, 'フォーカスが外れても1行目が隠れません');
      await box.locator('button[data-rating="good"]').focus();
      await waitLine('small', true, 'フォーカスが外れて戻った後に、1行目が表示されません');
      await reset();
    });

    test('マウスで表示している間に Esc キーを押すと隠れ、マウスが離れるまで隠れたまま', async () => {
      await reset();
      const box = await boxLocator(page, 'card-img');
      await box.locator('button[data-rating="poor"]').hover();
      await waitLine('card-img', true, 'マウスを重ねても1行目が表示されません');
      // フォーカスは評価ボックスの外（ページ）にある
      await page.keyboard.press('Escape');
      await waitLine('card-img', false, 'Esc キーで1行目が隠れません（フォーカスが評価ボックスの外にある時）');
      // マウスを重ねたまま動かしても、隠れたまま
      await box.locator('button[data-rating="good"]').hover();
      await sleep(300);
      assert.equal((await lineOf('card-img')).shown, false, 'マウスが離れていないのに、1行目がまた表示されました');
      // マウスが離れてから戻ると、また表示される
      await page.mouse.move(AWAY.x, AWAY.y);
      await sleep(100);
      await box.locator('button[data-rating="poor"]').hover();
      await waitLine('card-img', true, 'マウスが離れて戻った後に、1行目が表示されません');
      await reset();
    });

    test('マウスとフォーカスで表示した1行目の文字と背景のコントラスト比が 4.5 以上', async () => {
      await reset();
      const box = await boxLocator(page, 'small-noalt');
      await box.locator('button[data-rating="good"]').focus();
      await waitLine('small-noalt', true, 'フォーカスがあっても1行目が表示されません');
      const c = await page.evaluate(() => {
        const root = window.__t.boxFor(document.getElementById('small-noalt')).shadowRoot;
        return window.__t.contrast(root.querySelector('p.line'));
      });
      assert.ok(c.ratio >= 4.5, `1行目：${c.ratio.toFixed(2)}（文字 ${c.fg}、背景 ${c.bg}）`);
      await reset();
    });
  });

  describe('キーボード', () => {
    test('Tab キーの順番：リンクの次に、その画像の評価ボックスの「良い」ボタンへ移る', async () => {
      await reset();
      await page.locator('#icon-link').focus();
      await page.keyboard.press('Tab');
      const active = await page.evaluate(() => window.__t.describeActive());
      const idx = await page.evaluate(() => window.__t.boxes().indexOf(window.__t.boxFor(document.getElementById('small'))));
      assert.equal(active?.kind, 'box', `フォーカスが評価ボックスにありません：${JSON.stringify(active)}`);
      assert.equal(active.boxIndex, idx, 'ほかの画像の評価ボックスにフォーカスが移りました');
      assert.equal(active.rating, 'good', '「良い」ボタンではありません');
    });

    test('Tab キーの順番：カードの画像の評価ボックスの次は、次のカードの画像の評価ボックス', async () => {
      await reset();
      const box = await boxLocator(page, 'card-img');
      await box.locator('button[data-rating="poor"]').focus();
      await page.keyboard.press('Tab');
      const active = await page.evaluate(() => window.__t.describeActive());
      const idx = await page.evaluate(() => window.__t.boxes().indexOf(window.__t.boxFor(document.getElementById('card2-img'))));
      assert.deepEqual(active && { kind: active.kind, boxIndex: active.boxIndex, rating: active.rating }, { kind: 'box', boxIndex: idx, rating: 'good' });
      await reset();
    });
  });
});
