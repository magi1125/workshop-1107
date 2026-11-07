// ページの文字列をHTMLとして解釈しないこと、ページのフォームやクリックの処理に影響しないことのテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, boxLocator, boxState, clickRating, waitForBoxCount, waitFor, storageKey, sleep } from './helpers/extension.mjs';

const P_IMG = '<img src=x onerror="window.__pwned=1">';
const P_SCRIPT = '"><script>window.__pwned=1</script>';
const P_SVG = '<svg onload="window.__pwned=1"></svg>';
const P_IFRAME = '<iframe srcdoc="<script>parent.__pwned=1</script>"></iframe>';
const TITLE = `${P_IMG}${P_SCRIPT}`;

const EXPECTED = [
  ['xss-alt', `名前：${P_IMG}（altから）`, P_IMG, 'alt'],
  ['xss-label', `名前：${P_SCRIPT}（aria-labelから）`, P_SCRIPT, 'aria-label'],
  ['xss-title', `名前：${P_SVG}（titleから）`, P_SVG, 'title'],
  ['xss-hidden', `スクリーンリーダーに伝わらない画像（aria-hidden）。alt：${P_IFRAME}`, P_IFRAME, 'alt'],
  ['xss-ref-img', `名前：${P_IMG}（aria-labelledbyから）`, P_IMG, 'aria-labelledby'],
];

describe('安全性', { timeout: 120000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    page = await h.openFixture('security.html');
    await h.enable(page, { announce: true });
    await waitForBoxCount(page, 7);
  });

  after(async () => {
    await h?.close();
  });

  test('alt・aria-label・title の HTML は、1行目に文字のまま表示される', async () => {
    for (const [id, line] of EXPECTED) {
      const s = await boxState(page, id);
      assert.ok(s, `#${id} の評価ボックスがありません`);
      assert.equal(s.line, line, `#${id} の1行目`);
    }
  });

  test('評価ボックスの中に、ページの文字列から作られた要素が無い', async () => {
    const found = await page.evaluate(() =>
      window.__t
        .boxes()
        .flatMap((b) => Array.from(b.shadowRoot.querySelectorAll('img, script, iframe, [onerror], [onload], [srcdoc]')))
        .map((e) => e.outerHTML),
    );
    assert.deepEqual(found, []);
  });

  test('評価すると、文字列がそのまま保存され、ページのスクリプトは実行されない', async () => {
    const pageUrl = h.url('security.html');
    for (const [id, , name] of EXPECTED) {
      await clickRating(page, id, 'poor');
      const key = storageKey(pageUrl, h.url(`img/${id}.png`), name);
      const rec = await waitFor(async () => (await h.storageAll())[key], { message: `#${id} の評価が保存されません` });
      assert.equal(rec.name, name, `#${id} の name`);
      assert.equal(rec.pageTitle, TITLE, `#${id} の pageTitle`);
    }
    await sleep(1000);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'ページの文字列のスクリプトが実行されました');
  });

  test('読み上げ用の領域にもページの文字列から作られた要素が無く、スクリプトが実行されない', async () => {
    const r = await page.evaluate(() => {
      const host = document.querySelector('alt-eval-live');
      return host?.shadowRoot ? host.shadowRoot.querySelectorAll('img, script, iframe, svg').length : 0;
    });
    assert.equal(r, 0);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
  });

  test('フォームの中の画像の評価ボタンを押しても、フォームは送信されない', async () => {
    const before = page.url();
    await page.evaluate(() => (window.__submitted = 0));
    for (const r of ['good', 'good']) {
      await clickRating(page, 'in-form', r);
      await sleep(300);
    }
    const box = await boxLocator(page, 'in-form');
    await box.locator('button[data-rating="poor"]').focus();
    await page.keyboard.press('Enter');
    await sleep(800);
    assert.equal(page.url(), before, 'ページが移動しました');
    assert.equal(await page.evaluate(() => window.__submitted), 0, 'submit イベントが発生しました');
    assert.equal((await boxState(page, 'in-form')).pressed.poor, 'true');
  });

  test('評価ボタンのクリックは、ページの document やクリックを拾う祖先のリスナーに届かない', async () => {
    await page.evaluate(() => {
      window.__docClicks = 0;
      window.__divClicks = 0;
    });
    await clickRating(page, 'in-clickable', 'good');
    await waitFor(async () => (await boxState(page, 'in-clickable')).pressed.good === 'true', { message: '評価できません' });
    await clickRating(page, 'in-clickable', 'poor');
    await sleep(300);
    const r = await page.evaluate(() => ({ doc: window.__docClicks, div: window.__divClicks }));
    assert.deepEqual(r, { doc: 0, div: 0 });
  });

  test('評価ボックスはページの CSS の影響を受けない（シャドウDOMの中で見た目を作る）', async () => {
    // ページが button・p・div と、評価ボックスを含む段落に極端なスタイルを付けても、評価ボックスの中は変わらない
    const read = () =>
      page.evaluate(() => {
        const root = window.__t.boxFor(document.getElementById('xss-alt')).shadowRoot;
        const pick = (el) => {
          const cs = getComputedStyle(el);
          return { display: cs.display, color: cs.color, fontSize: cs.fontSize, lineHeight: cs.lineHeight, backgroundColor: cs.backgroundColor, borderTopWidth: cs.borderTopWidth, paddingTop: cs.paddingTop };
        };
        return { button: pick(root.querySelector('button[data-rating="good"]')), line: pick(root.querySelector('p.line')) };
      });
    const beforeStyle = await read();
    await page.addStyleTag({
      content:
        'main, main p { color: rgb(1, 2, 3) !important; font-size: 3px !important; line-height: 1px !important; background: rgb(250, 250, 250) !important; } ' +
        'button, p, div { color: rgb(1, 2, 3) !important; background: rgb(0, 0, 0) !important; border: 0 !important; padding: 0 !important; }',
    });
    const afterStyle = await read();
    assert.deepEqual(afterStyle, beforeStyle);
  });
});
