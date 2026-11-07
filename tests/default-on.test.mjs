// 評価モードを既定でオンにする（設定画面のチェックボックス、登録、content.js の自動のオン）のテスト
// テスト用のコピーには host_permissions <all_urls> があるため、permissions.contains と permissions.request は
// 許可済みとして扱われる（許可を求める画面は出ない）。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, waitForBoxCount, waitFor, sleep } from './helpers/extension.mjs';
import { openOptions, openPopup, readSettings } from './helpers/options.mjs';

const HOST = '127.0.0.1';
const SCRIPT_ID = 'altEvalAuto';
const JS = ['src/content/accessible-name.js', 'src/content/content.js'];

describe('評価モードを既定でオンにする', { timeout: 180000 }, () => {
  let h;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
  });

  after(async () => {
    await h?.close();
  });

  const registered = () => h.swEval(() => chrome.scripting.getRegisteredContentScripts());

  /** 設定を書き、契約の id・matches・js で登録する（設定画面の操作に頼らない準備） */
  async function turnOnDirectly({ excludedSites = [] } = {}) {
    await h.swEval(
      async ({ excludedSites, id, js }) => {
        await chrome.storage.local.set({ settings: { defaultOn: true, excludedSites, exportedSites: [] } });
        const list = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
        if (list.length === 0) {
          await chrome.scripting.registerContentScripts([{ id, matches: ['<all_urls>'], js, runAt: 'document_idle' }]);
        }
      },
      { excludedSites, id: SCRIPT_ID, js: JS },
    );
  }

  describe('設定画面の #default-on', () => {
    let page;

    before(async () => {
      page = await openOptions(h);
    });

    after(async () => {
      await page?.close();
    });

    test('ラベル「評価モードを既定でオンにする」のチェックボックスが section#settings にあり、最初はチェックが無い', async () => {
      const cb = page.locator('section#settings #default-on');
      assert.equal(await cb.count(), 1, 'section#settings の中に #default-on がありません');
      assert.equal(await cb.getAttribute('type'), 'checkbox');
      assert.equal(await page.getByLabel('評価モードを既定でオンにする', { exact: true }).count(), 1, 'ラベルで見つかりません');
      assert.equal(await cb.isChecked(), false);
    });

    test('チェックを付けると、settings.defaultOn が true になり、altEvalAuto が契約どおりに登録される', async () => {
      await page.locator('#default-on').check();
      await waitFor(async () => (await readSettings(h))?.defaultOn === true, { message: 'settings.defaultOn が true になりません' }).catch(
        async (e) => {
          const status = await page.locator('#default-on-status').textContent().catch(() => null);
          throw new Error(`${e.message}（#default-on-status：「${status}」、settings：${JSON.stringify(await readSettings(h))}）`);
        },
      );
      await waitFor(async () => (await registered()).some((s) => s.id === SCRIPT_ID), { message: 'altEvalAuto が登録されません' });
      const s = (await registered()).find((s) => s.id === SCRIPT_ID);
      assert.deepEqual(s.matches, ['<all_urls>']);
      assert.deepEqual(s.js, JS);
      assert.equal(s.runAt, 'document_idle');
      assert.equal(await page.locator('#default-on').isChecked(), true);
    });

    test('開き直しても、チェックが付いた状態で表示する', async () => {
      await page.reload({ waitUntil: 'load' });
      await waitFor(() => page.locator('#default-on').isChecked(), { message: 'チェックが付いた状態になりません' });
    });

    test('チェックを外すと、settings.defaultOn が false になり、登録が外れる', async () => {
      await page.locator('#default-on').uncheck();
      await waitFor(async () => (await readSettings(h))?.defaultOn === false, { message: 'settings.defaultOn が false になりません' });
      await waitFor(async () => !(await registered()).some((s) => s.id === SCRIPT_ID), { message: 'altEvalAuto の登録が外れません' });
    });
  });

  describe('既定でオンの時のページ', () => {
    before(async () => {
      await h.clearStorage();
      await turnOnDirectly();
    });

    test('新しく開いたページは、操作しなくても評価モードがオンになり、読み上げない', async () => {
      const page = await h.openFixture('simple.html');
      try {
        await waitForBoxCount(page, 3, 8000);
        const st = await h.getState(page);
        assert.equal(st.enabled, true);
        assert.equal(st.total, 3);
        await sleep(500);
        const live = await page.evaluate(() => window.__t.liveText());
        assert.ok(live === null || live === '', `読み上げの文字があります：「${live}」`);
      } finally {
        await page.close();
      }
    });

    test('ページを移動した先でもオンになる', async () => {
      const page = await h.openFixture('simple.html');
      try {
        await waitForBoxCount(page, 3, 8000);
        await page.goto(h.url('rating.html'), { waitUntil: 'load' });
        await waitFor(() => page.evaluate(() => window.__t.boxes().length > 0), { timeout: 8000, message: '移動した先でオンになりません' });
      } finally {
        await page.close();
      }
    });

    test('ポップアップでオフにすると、そのページだけオフになり、読み込み直すとまたオンになる', async () => {
      const page = await h.openFixture('simple.html');
      const other = await h.openFixture('rating.html');
      let popup;
      try {
        await waitForBoxCount(page, 3, 8000);
        await waitFor(() => other.evaluate(() => window.__t.boxes().length > 0), { timeout: 8000, message: '別のページでオンになりません' });
        const tabId = await h.tabIdFor(page);
        popup = await openPopup(h, tabId);
        await popup.getByRole('button', { name: /評価モード/ }).first().click();
        await waitFor(async () => (await h.getState(page)).enabled === false, { message: 'ポップアップでオフになりません' });
        await waitForBoxCount(page, 0);
        // ほかのページはオンのまま
        assert.equal((await h.getState(other)).enabled, true, '別のページまでオフになりました');
        // 設定は変わらない
        assert.equal((await readSettings(h)).defaultOn, true, 'settings.defaultOn が変わりました');
        await page.reload({ waitUntil: 'load' });
        await waitForBoxCount(page, 3, 8000);
      } finally {
        await popup?.close();
        await other.close();
        await page.close();
      }
    });

    test('使わないサイトに登録したホストでは、既定でオンでもオンにならない', async () => {
      await turnOnDirectly({ excludedSites: [HOST] });
      const page = await h.openFixture('simple.html');
      try {
        await sleep(1500);
        assert.equal(await page.evaluate(() => window.__t.boxes().length), 0, '評価ボックスが挿入されています');
        assert.equal((await h.getState(page)).enabled, false);
      } finally {
        await page.close();
        await turnOnDirectly();
      }
    });

    test('ほかのホストが登録されていても、このホストではオンになる', async () => {
      await turnOnDirectly({ excludedSites: ['other.example'] });
      const page = await h.openFixture('simple.html');
      try {
        await waitForBoxCount(page, 3, 8000);
      } finally {
        await page.close();
        await turnOnDirectly();
      }
    });

    test('settings.defaultOn が false なら、content.js が読み込まれてもオンにしない', async () => {
      // 登録は残したまま、設定だけ false にする
      await h.swEval(() => chrome.storage.local.set({ settings: { defaultOn: false, excludedSites: [], exportedSites: [] } }));
      const page = await h.openFixture('simple.html');
      try {
        await sleep(1500);
        assert.equal(await page.evaluate(() => window.__t.boxes().length), 0, '評価ボックスが挿入されています');
      } finally {
        await page.close();
        await h.swEval((id) => chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {}), SCRIPT_ID);
      }
    });
  });
});
