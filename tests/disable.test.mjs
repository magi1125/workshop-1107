// 評価モードのオフと、オン・オフの読み上げのテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, clickRating, waitForBoxCount, waitFor, storageKey, sleep } from './helpers/extension.mjs';

describe('評価モードのオフと読み上げ', { timeout: 120000 }, () => {
  let h;
  let page;
  let originalHTML;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
  });

  after(async () => {
    await h?.close();
  });

  test('announce が false の時は、オンにしても読み上げない', async () => {
    const p = await h.openFixture('simple.html');
    await h.enable(p, { announce: false });
    await waitForBoxCount(p, 3);
    await sleep(500);
    const text = await p.evaluate(() => window.__t.liveText());
    assert.ok(text === null || text === '', `読み上げの文字があります：${text}`);
    await p.close();
  });

  test('オンにすると「評価モードをオンにしました。画像は3枚です」と読み上げる', async () => {
    page = await h.openFixture('simple.html');
    originalHTML = await page.evaluate(() => window.__t.cleanHTML());
    const state = await h.enable(page, { announce: true });
    assert.equal(state.total, 3);
    await waitForBoxCount(page, 3);
    await waitFor(async () => (await page.evaluate(() => window.__t.liveText())) === '評価モードをオンにしました。画像は3枚です', {
      timeout: 5000,
      message: '読み上げの文字が契約どおりになりません',
    }).catch(async (e) => {
      throw new Error(`${e.message}（実際：${await page.evaluate(() => window.__t.liveText())}）`);
    });
    const live = await page.evaluate(() => {
      const hosts = document.querySelectorAll('alt-eval-live[data-alt-eval="live"]');
      const host = hosts[0];
      return {
        count: hosts.length,
        lastInBody: host ? document.body.lastElementChild === host : false,
        open: host ? !!host.shadowRoot : false,
        statusCount: host?.shadowRoot ? host.shadowRoot.querySelectorAll('[role="status"]').length : 0,
      };
    });
    assert.deepEqual(live, { count: 1, lastInBody: true, open: true, statusCount: 1 });
  });

  test('評価しても、オフにすると評価ボックスがすべて消え、ページが元の HTML に戻る', async () => {
    // 評価した状態を作っておく
    await clickRating(page, 'img1', 'good');
    await waitFor(async () => Object.keys(await h.storageAll()).some((k) => k.startsWith('r:')), { message: '保存されません' });
    const state = await h.disable(page, { announce: true });
    assert.equal(state.enabled, false);
    await waitForBoxCount(page, 0);
    assert.equal(await page.evaluate(() => document.querySelectorAll('alt-eval-box').length), 0);
    // 読み上げ用の領域は少しの間残ってよいので、それを除いて比べる
    const now = await page.evaluate(() => window.__t.cleanHTML());
    assert.equal(now, originalHTML, 'オフにした後のページの HTML が元と違います');
  });

  test('オフにすると「評価モードをオフにしました」と読み上げる', async () => {
    // 読み上げを確実にするため、文字を少し遅れて入れる実装もありうるので、しばらく待つ
    let last;
    await waitFor(
      async () => {
        last = await page.evaluate(() => window.__t.liveText());
        return last === '評価モードをオフにしました';
      },
      { timeout: 5000, message: '読み上げの文字が「評価モードをオフにしました」になりません' },
    ).catch((e) => {
      throw new Error(
        last === null
          ? `${e.message}（読み上げ用の領域が、オフの読み上げの前に無くなっています）`
          : `${e.message}（実際：「${last}」）`,
      );
    });
  });

  test('オフにした後の getState は enabled: false で、評価ボックスは0', async () => {
    assert.deepEqual(await h.getState(page), { enabled: false, total: 0, rated: 0 });
  });

  test('オフにしても、保存した評価は消えない', async () => {
    const key = storageKey(h.url('simple.html'), h.url('img/img1.png'), '最初の写真');
    const all = await h.storageAll();
    assert.ok(all[key], `評価が消えています。保存されているキー：${JSON.stringify(Object.keys(all))}`);
  });

  test('オフにした後で画像を追加しても、評価ボックスは挿入されない', async () => {
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.innerHTML = '<img id="late" src="/img/late.png" alt="オフの後の画像" width="120" height="90">';
      document.getElementById('list').append(li);
    });
    await sleep(800);
    assert.equal(await page.evaluate(() => document.querySelectorAll('alt-eval-box').length), 0);
  });

  test('オフにした後、読み上げ用の領域のほかに拡張機能の要素が残らない', async () => {
    await sleep(500);
    const leftovers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-alt-eval]'))
        .map((e) => e.localName)
        .filter((n) => n !== 'alt-eval-live'),
    );
    assert.deepEqual(leftovers, []);
  });
});
