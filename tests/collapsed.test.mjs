// 小さい画像と、切り取られる評価ボックスの折りたたみのテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, boxLocator, waitForBoxCount, waitFor } from './helpers/extension.mjs';

describe('折りたたんだ評価ボックス', { timeout: 180000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    page = await h.openFixture('collapsed.html');
    await h.enable(page);
    await waitForBoxCount(page, 4);
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

  for (const [id, why] of [
    ['small', '幅と高さが48px未満'],
    ['narrow', '幅だけが48px未満'],
    ['clipped', 'overflow:hidden の固定の大きさの祖先に切り取られる'],
  ]) {
    test(`#${id}（${why}）は折りたたまれ、popover="manual" で最前面に表示される`, async () => {
      const m = await modeOf(id);
      assert.ok(m, `#${id} の評価ボックスがありません`);
      assert.equal(m.mode, 'collapsed', 'data-mode');
      assert.equal(m.popover, 'manual', 'popover 属性');
      assert.equal(m.open, true, ':popover-open');
    });
  }

  test('大きい画像（#big）は通常表示で、popover を使わない', async () => {
    const m = await modeOf('big');
    assert.equal(m.mode, 'inline');
    assert.equal(m.open, false);
  });

  test('折りたたんだ評価ボックスは、リンクの直後に挿入され、画像の下に表示される', async () => {
    const r = await page.evaluate(() => {
      const link = document.getElementById('icon-link');
      const box = link.nextElementSibling;
      const img = document.getElementById('small').getBoundingClientRect();
      const b = box && box.getBoundingClientRect();
      return { isBox: !!box && box.localName === 'alt-eval-box', imgBottom: img.bottom, boxTop: b && b.top, w: b && b.width, hgt: b && b.height };
    });
    assert.ok(r.isBox, 'リンクの直後に評価ボックスがありません');
    assert.ok(r.boxTop >= r.imgBottom - 1, `画像の下に表示されていません（画像の下端 ${r.imgBottom}、評価ボックスの上端 ${r.boxTop}）`);
    assert.ok(r.w > 0 && r.hgt > 0, '評価ボックスの大きさが0です');
  });

  test('折りたたんだ時は「評価」ボタン（aria-expanded="false"）だけが見え、1行目とグループは隠れている', async () => {
    const box = await boxLocator(page, 'small');
    const toggle = box.locator('button.toggle');
    assert.equal(await toggle.count(), 1, 'button.toggle がありません');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal((await toggle.textContent()).replace(/\s+/g, ' ').trim(), '評価');
    assert.equal(await toggle.isVisible(), true, 'button.toggle が見えません');
    assert.equal(await box.locator('[role="group"]').isVisible(), false, 'グループが見えています');
    assert.equal(await box.locator('p.line').isVisible(), false, '1行目が見えています');
  });

  test('切り取られる画像の「評価」ボタンが、画面の上で見えて押せる', async () => {
    const box = await boxLocator(page, 'clipped');
    const toggle = box.locator('button.toggle');
    assert.equal(await toggle.isVisible(), true);
    // 実際にクリックできる（ほかの要素に隠れていない）ことを確かめる
    await toggle.click({ trial: true, timeout: 3000 });
  });

  test('「評価」ボタンを押すと aria-expanded が true になり、1行目とグループが表示される', async () => {
    const box = await boxLocator(page, 'small');
    const toggle = box.locator('button.toggle');
    await toggle.click();
    await waitFor(async () => (await toggle.getAttribute('aria-expanded')) === 'true', { message: 'aria-expanded が true になりません' });
    assert.equal(await box.locator('[role="group"]').isVisible(), true, 'グループが表示されません');
    assert.equal(await box.locator('p.line').isVisible(), true, '1行目が表示されません');
    for (const r of ['good', 'fair', 'poor']) {
      assert.equal(await box.locator(`button[data-rating="${r}"]`).isVisible(), true, `${r} のボタンが表示されません`);
    }
  });

  test('グループの中で Esc キーを押すと閉じて、フォーカスが「評価」ボタンに戻る', async () => {
    const box = await boxLocator(page, 'small');
    const toggle = box.locator('button.toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await box.locator('button[data-rating="fair"]').focus();
    await page.keyboard.press('Escape');
    await waitFor(async () => (await toggle.getAttribute('aria-expanded')) === 'false', { message: 'Esc で閉じません' });
    assert.equal(await box.locator('[role="group"]').isVisible(), false, '閉じた後もグループが見えています');
    const active = await page.evaluate(() => {
      const el = window.__t.deepActive();
      return el ? { toggle: el.classList.contains('toggle'), host: el.getRootNode().host?.localName ?? null } : null;
    });
    assert.deepEqual(active, { toggle: true, host: 'alt-eval-box' }, 'フォーカスが「評価」ボタンに戻っていません');
  });

  test('評価すると「評価」ボタンの文字が「評価：良い」になる', async () => {
    const box = await boxLocator(page, 'small');
    const toggle = box.locator('button.toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await box.locator('button[data-rating="good"]').click();
    await waitFor(async () => (await box.locator('button[data-rating="good"]').getAttribute('aria-pressed')) === 'true', {
      message: '良い が押した状態になりません',
    });
    await waitFor(async () => (await toggle.textContent()).replace(/\s+/g, ' ').trim() === '評価：良い', {
      message: `「評価」ボタンの文字が「評価：良い」になりません（実際：${(await toggle.textContent()).trim()}）`,
    });
  });

  test('Tab キーの順番：リンクの次に、その画像の「評価」ボタンへ移る', async () => {
    await page.locator('#icon-link').focus();
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => window.__t.describeActive());
    const idx = await page.evaluate(() => window.__t.boxes().indexOf(window.__t.boxFor(document.getElementById('small'))));
    assert.equal(active?.kind, 'box', `フォーカスが評価ボックスにありません：${JSON.stringify(active)}`);
    assert.equal(active.boxIndex, idx, 'ほかの画像の評価ボックスにフォーカスが移りました');
    assert.equal(active.toggle, true, '「評価」ボタンではありません');
  });
});
