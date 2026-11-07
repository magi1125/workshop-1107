// 後から増えた画像と、属性が変わった画像のテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, boxState, waitForBoxCount, waitFor } from './helpers/extension.mjs';

describe('後から増えた画像と、変わった画像', { timeout: 120000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    page = await h.openFixture('simple.html');
    await h.enable(page);
    await waitForBoxCount(page, 3);
  });

  after(async () => {
    await h?.close();
  });

  test('オンにした後で追加した画像に、評価ボックスが挿入される', async () => {
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.innerHTML = '<img id="added" src="/img/added.png" alt="後から増えた画像" width="120" height="90">';
      document.getElementById('list').append(li);
    });
    await waitForBoxCount(page, 4);
    await waitFor(async () => (await boxState(page, 'added'))?.line === '名前：後から増えた画像（altから）', {
      message: '追加した画像の評価ボックスがありません',
    });
    const s = await boxState(page, 'added');
    assert.equal(s.category, 'named');
    assert.equal(s.lineAriaHidden, 'true');
  });

  test('オンにした後で追加したリンクの中の画像は、リンクの直後に評価ボックスが挿入される', async () => {
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.innerHTML = '<a id="added-link" href="https://example.com/x"><img id="added-in-link" src="/img/added-in-link.png" alt="追加したリンクの画像" width="120" height="90"></a>';
      document.getElementById('list').append(li);
    });
    await waitForBoxCount(page, 5);
    const r = await page.evaluate(() => {
      const n = document.getElementById('added-link').nextElementSibling;
      return n && n.localName === 'alt-eval-box' ? window.__t.state(n).line : null;
    });
    assert.equal(r, '名前：追加したリンクの画像（altから）');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#added-link alt-eval-box').length), 0);
  });

  test('画像の alt を変えると、評価ボックスの1行目が変わる', async () => {
    await page.evaluate(() => document.getElementById('img1').setAttribute('alt', '変更後の名前'));
    await waitFor(async () => (await boxState(page, 'img1'))?.line === '名前：変更後の名前（altから）', {
      message: 'alt の変更が評価ボックスに反映されません',
    });
  });

  test('空の alt に文字を入れると、分類が empty から named に変わる', async () => {
    assert.equal((await boxState(page, 'img2')).category, 'empty');
    await page.evaluate(() => document.getElementById('img2').setAttribute('alt', '段落の画像'));
    await waitFor(async () => (await boxState(page, 'img2'))?.category === 'named', { message: '分類が変わりません' });
    const s = await boxState(page, 'img2');
    assert.equal(s.line, '名前：段落の画像（altから）');
    assert.equal(s.lineAriaHidden, 'true');
  });

  test('aria-label を付けると、名前の出どころが aria-label になる', async () => {
    await page.evaluate(() => document.getElementById('img3').setAttribute('aria-label', 'ラベルを付けた画像'));
    await waitFor(async () => (await boxState(page, 'img3'))?.line === '名前：ラベルを付けた画像（aria-labelから）', {
      message: 'aria-label の追加が反映されません',
    });
  });

  test('変更の後も、評価ボックスは画像1枚につき1つ', async () => {
    await page.waitForTimeout(300);
    const state = await h.getState(page);
    assert.equal(state.total, 5);
    assert.equal(await page.evaluate(() => window.__t.boxes().length), 5);
  });
});
