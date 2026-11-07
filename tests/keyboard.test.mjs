// キーボードの操作（Tab キーの順番、Enter と Space）のテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, boxLocator, boxState, waitForBoxCount, waitFor } from './helpers/extension.mjs';

describe('キーボードの操作', { timeout: 120000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    page = await h.openFixture('simple.html');
    await h.enable(page);
    await waitForBoxCount(page, 3);
  });

  after(async () => {
    await h?.close();
  });

  const label = (a) => (a == null ? 'null' : a.kind === 'box' ? `box:${a.boxIndex}` : `page:${a.id || a.tag}`);

  async function collectTabOrder(key, stopId, max = 40) {
    const seq = [];
    for (let i = 0; i < max; i++) {
      await page.keyboard.press(key);
      const a = await page.evaluate(() => window.__t.describeActive());
      seq.push(label(a));
      if (a && a.kind === 'page' && a.id === stopId) break;
    }
    // 同じ評価ボックスの中のボタンを1つにまとめる
    return seq.filter((x, i) => i === 0 || x !== seq[i - 1]);
  }

  test('Tab キーで、評価ボックスが画像と同じ順番で、画像のすぐ後ろに来る', async () => {
    // 評価ボックスの番号と画像の対応（テスト側の規則）を確かめておく
    const idx = await page.evaluate(() =>
      ['img1', 'img2', 'img3'].map((id) => window.__t.boxes().indexOf(window.__t.boxFor(document.getElementById(id)))),
    );
    assert.deepEqual(idx, [0, 1, 2]);
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo(0, 0);
    });
    await page.locator('h1').click(); // フォーカスの起点をページの先頭にする
    const seq = await collectTabOrder('Tab', 'foot');
    assert.deepEqual(seq, ['page:a1', 'box:0', 'box:1', 'page:b-mid', 'page:a3', 'box:2', 'page:foot']);
  });

  test('評価ボックスの中では、良い・普通・悪いの順に Tab キーで移動できる', async () => {
    await page.locator('#a1').focus();
    const ratings = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      ratings.push(await page.evaluate(() => window.__t.describeActive()?.rating ?? null));
    }
    assert.deepEqual(ratings, ['good', 'fair', 'poor']);
  });

  test('Shift+Tab で逆の順番に移動できる', async () => {
    await page.locator('#foot').focus();
    const seq = await collectTabOrder('Shift+Tab', 'a1');
    assert.deepEqual(seq, ['box:2', 'page:a3', 'page:b-mid', 'box:1', 'box:0', 'page:a1']);
  });

  test('Space キーで評価し、もう一度押すと取り消す', async () => {
    const box = await boxLocator(page, 'img1');
    await box.locator('button[data-rating="good"]').focus();
    await page.keyboard.press('Space');
    await waitFor(async () => (await boxState(page, 'img1')).pressed.good === 'true', { message: 'Space で評価できません' });
    // フォーカスはボタンに残る
    assert.equal(await page.evaluate(() => window.__t.describeActive()?.rating), 'good');
    await page.keyboard.press('Space');
    await waitFor(async () => (await boxState(page, 'img1')).pressed.good === 'false', { message: 'Space で取り消せません' });
  });

  test('Enter キーで評価できる', async () => {
    const box = await boxLocator(page, 'img3');
    await box.locator('button[data-rating="poor"]').focus();
    await page.keyboard.press('Enter');
    await waitFor(async () => (await boxState(page, 'img3')).pressed.poor === 'true', { message: 'Enter で評価できません' });
    assert.deepEqual((await boxState(page, 'img3')).pressed, { good: 'false', fair: 'false', poor: 'true' });
  });

  test('評価ボタンで矢印キーを押しても、評価は変わらない（ラジオボタンのように動かない）', async () => {
    const box = await boxLocator(page, 'img3');
    await box.locator('button[data-rating="poor"]').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);
    assert.deepEqual((await boxState(page, 'img3')).pressed, { good: 'false', fair: 'false', poor: 'true' });
  });
});
