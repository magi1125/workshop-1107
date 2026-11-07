// 契約「svg要素、role="img"の要素、input type="image"」：svg の title 要素や aria-label の HTML を文字のまま扱うことのテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, waitForBoxCount, waitFor, sleep } from './helpers/extension.mjs';

const P1 = '<img src=x onerror="window.__pwned=1">';
const P2 = '"><script>window.__pwned=2</script>';
const P3 = '<img src=x onerror="window.__pwned=3">';
const P4 = '<svg onload="window.__pwned=4"></svg>';
const P5 = '<iframe srcdoc="<script>parent.__pwned=5</script>"></iframe>';

// [id, 1行目, 名前, element]
const EXPECTED = [
  ['xss-svg-title', `名前：${P1}（title要素から）`, P1, 'svg'],
  ['xss-svg-label', `名前：${P2}（aria-labelから）`, P2, 'svg'],
  ['xss-ri', `名前：${P3}（aria-labelから）`, P3, 'role-img'],
  ['xss-ii', `名前：${P4}（altから）`, P4, 'input-image'],
  ['xss-svg-hidden', `スクリーンリーダーに伝わらない画像（aria-hidden）。名前：${P5}`, P5, 'svg'],
];

describe('svg要素・role="img"・input type="image" の文字列の扱い（安全性）', { timeout: 120000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    page = await h.openFixture('svg-security.html');
    await h.enable(page, { announce: true });
    await waitForBoxCount(page, EXPECTED.length).catch(() => {});
  });

  after(async () => {
    await h?.close();
  });

  const stateOf = (id) =>
    page.evaluate((id) => {
      const el = document.getElementById(id);
      const box = el && window.__t.boxFor(el);
      return box ? { ...window.__t.state(box), index: window.__t.boxes().indexOf(box) } : null;
    }, id);

  test('svg の title 要素・aria-label、role="img" の aria-label、input の alt の HTML は、1行目に文字のまま表示される', async () => {
    for (const [id, line] of EXPECTED) {
      const s = await stateOf(id);
      assert.ok(s, `#${id} の評価ボックスがありません`);
      assert.equal(s.line, line, `#${id} の1行目`);
    }
  });

  test('評価ボックスの中に、ページの文字列から作られた要素が無い', async () => {
    const found = await page.evaluate(() =>
      window.__t
        .boxes()
        .flatMap((b) => Array.from(b.shadowRoot.querySelectorAll('img, script, iframe, svg[onload], [onerror], [onload], [srcdoc]')))
        .map((e) => e.outerHTML),
    );
    assert.deepEqual(found, []);
  });

  test('評価すると、文字列がそのまま保存され、ページのスクリプトは実行されない', async () => {
    for (const [id, , name, element] of EXPECTED) {
      const s = await stateOf(id);
      assert.ok(s, `#${id} の評価ボックスがありません`);
      await page.locator('alt-eval-box[data-alt-eval="box"]').nth(s.index).locator('button[data-rating="poor"]').click();
      const rec = await waitFor(
        async () => Object.values(await h.storageAll()).find((v) => v && v.name === name && v.element === element),
        { message: `#${id} の評価が保存されません` },
      );
      assert.equal(rec.rating, 'poor');
    }
    await sleep(1000);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'ページの文字列のスクリプトが実行されました');
  });

  test('読み上げ用の領域にもページの文字列から作られた要素が無い', async () => {
    const n = await page.evaluate(() => {
      const host = document.querySelector('alt-eval-live');
      return host?.shadowRoot ? host.shadowRoot.querySelectorAll('img, script, iframe, svg').length : 0;
    });
    assert.equal(n, 0);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
  });
});
