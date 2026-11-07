// 使わないサイト（ポップアップでの登録・解除、評価モードと保存の抑止、設定画面の一覧）のテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, clickRating, waitForBoxCount, waitFor, sleep } from './helpers/extension.mjs';
import { openPopup, openOptions, reloadOptions, readSettings, waitStatus } from './helpers/options.mjs';

const HOST = '127.0.0.1';
const EXCLUDE_TEXT = 'このサイトでは評価モードを使わない';
const INCLUDE_TEXT = 'このサイトで評価モードを使えるようにする';
const EXCLUDED_ANNOUNCE = 'このサイトは、評価モードを使わないサイトに登録されています';

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('使わないサイト', { timeout: 180000 }, () => {
  let h;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
  });

  after(async () => {
    await h?.close();
  });

  async function setExcluded(list) {
    await h.swEval(async (list) => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { defaultOn: false, exportedSites: [], ...settings, excludedSites: list } });
    }, list);
  }

  describe('ポップアップ', () => {
    let target;
    let tabId;
    let popup;

    before(async () => {
      await h.clearStorage();
      target = await h.openFixture('simple.html');
      tabId = await h.tabIdFor(target);
      await h.enable(target);
      await waitForBoxCount(target, 3);
      popup = await openPopup(h, tabId);
    });

    after(async () => {
      await popup?.close();
      await target?.close();
    });

    test('表示中のタブのホスト名（#site）と、#exclude ボタンを表示する', async () => {
      const site = norm(await popup.locator('#site').textContent());
      assert.ok(site.includes(HOST), `#site の文字にホスト名がありません：「${site}」`);
      const ex = popup.locator('#exclude');
      assert.equal(await ex.count(), 1, '#exclude がありません');
      assert.equal(await ex.evaluate((e) => e.localName), 'button', '#exclude が button 要素ではありません');
      assert.equal(await ex.isVisible(), true, '#exclude が表示されていません');
      assert.equal(norm(await ex.textContent()), EXCLUDE_TEXT);
    });

    test('「記録と設定を開く」ボタン（#open-options）がある', async () => {
      const b = popup.locator('#open-options');
      assert.equal(await b.count(), 1, '#open-options がありません');
      assert.equal(await b.evaluate((e) => e.localName), 'button');
      assert.equal(norm(await b.textContent()), '記録と設定を開く');
    });

    test('#exclude を押すと、ホスト名を settings.excludedSites に登録し、タブの評価モードをオフにする', async () => {
      await popup.locator('#exclude').click();
      await waitFor(async () => (await readSettings(h))?.excludedSites?.includes(HOST), {
        message: 'settings.excludedSites にホスト名が登録されません',
      }).catch(async (e) => {
        throw new Error(`${e.message}（settings：${JSON.stringify(await readSettings(h))}）`);
      });
      assert.deepEqual((await readSettings(h)).excludedSites, [HOST]);
      await waitFor(async () => (await h.getState(target)).enabled === false, { message: 'タブの評価モードがオフになりません' });
      await waitForBoxCount(target, 0);
    });

    test('登録済みのサイトでは、ボタンの文字が「このサイトで評価モードを使えるようにする」になる', async () => {
      await waitFor(async () => norm(await popup.locator('#exclude').textContent()) === INCLUDE_TEXT, {
        message: 'ボタンの文字が切り替わりません',
      }).catch(async (e) => {
        throw new Error(`${e.message}（実際：「${norm(await popup.locator('#exclude').textContent())}」）`);
      });
      // 開き直しても同じ
      await popup.close();
      popup = await openPopup(h, tabId);
      assert.equal(norm(await popup.locator('#exclude').textContent()), INCLUDE_TEXT);
    });

    test('もう一度押すと登録を外し、ボタンの文字が元に戻る', async () => {
      await popup.locator('#exclude').click();
      await waitFor(async () => !((await readSettings(h))?.excludedSites || []).includes(HOST), {
        message: '登録が外れません',
      });
      await waitFor(async () => norm(await popup.locator('#exclude').textContent()) === EXCLUDE_TEXT, {
        message: 'ボタンの文字が「このサイトでは評価モードを使わない」に戻りません',
      });
    });

    test('キーボード（Enter）でも登録と解除ができる', async () => {
      await popup.locator('#exclude').focus();
      await popup.keyboard.press('Enter');
      await waitFor(async () => ((await readSettings(h))?.excludedSites || []).includes(HOST), { message: 'Enter キーで登録されません' });
      await waitFor(async () => norm(await popup.locator('#exclude').textContent()) === INCLUDE_TEXT, { message: '文字が切り替わりません' });
      await popup.locator('#exclude').focus();
      await popup.keyboard.press('Enter');
      await waitFor(async () => !((await readSettings(h))?.excludedSites || []).includes(HOST), { message: 'Enter キーで解除されません' });
    });

    test('「記録と設定を開く」を押すと、設定画面がタブで開く', async () => {
      const opened = h.context.waitForEvent('page', {
        timeout: 5000,
        predicate: (p) => p.url().includes('/src/options/options.html'),
      });
      await popup.locator('#open-options').click();
      const p = await opened;
      assert.match(p.url(), new RegExp(`^chrome-extension://${h.extensionId}/src/options/options\\.html`));
      await p.close();
    });
  });

  describe('chrome:// のページ', () => {
    test('評価モードを使えないページでは、#exclude を表示しない', async () => {
      const tabId = await h.swEval(async () => {
        const t = await chrome.tabs.create({ url: 'chrome://version/', active: true });
        return t.id;
      });
      await sleep(500);
      const popup = await openPopup(h, tabId);
      try {
        const ex = popup.locator('#exclude');
        const visible = (await ex.count()) > 0 && (await ex.isVisible());
        assert.equal(visible, false, 'chrome:// のページで #exclude が表示されています');
      } finally {
        await popup.close();
        await h.swEval((id) => chrome.tabs.remove(id), tabId).catch(() => {});
      }
    });
  });

  describe('登録済みのサイトでの評価モード', () => {
    before(async () => {
      await h.clearStorage();
      await setExcluded([HOST]);
    });

    test('setEnabled(true) でもオンにならず、{ enabled: false, total: 0, rated: 0, excluded: true } を返す', async () => {
      const page = await h.openFixture('simple.html');
      try {
        const state = await h.enable(page, { announce: false });
        assert.deepEqual(state, { enabled: false, total: 0, rated: 0, excluded: true });
        await sleep(500);
        assert.equal(await page.evaluate(() => window.__t.boxes().length), 0, '評価ボックスが挿入されています');
        const st = await h.getState(page);
        assert.equal(st.enabled, false, `getState：${JSON.stringify(st)}`);
        assert.equal(st.total, 0, `getState：${JSON.stringify(st)}`);
      } finally {
        await page.close();
      }
    });

    test('announce が true の時は「このサイトは、評価モードを使わないサイトに登録されています」と読み上げる', async () => {
      const page = await h.openFixture('simple.html');
      try {
        const state = await h.enable(page, { announce: true });
        assert.equal(state.enabled, false);
        assert.equal(state.excluded, true);
        let last;
        await waitFor(
          async () => {
            last = await page.evaluate(() => window.__t.liveText());
            return last === EXCLUDED_ANNOUNCE;
          },
          { message: '登録済みのサイトの読み上げが契約どおりになりません' },
        ).catch((e) => {
          throw new Error(`${e.message}（実際：「${last}」）`);
        });
        assert.equal(await page.evaluate(() => window.__t.boxes().length), 0);
      } finally {
        await page.close();
      }
    });

    test('登録していないサイトの setEnabled の戻り値は、これまでどおり（excluded: true を含まない）', async () => {
      await setExcluded(['other.example']);
      const page = await h.openFixture('simple.html');
      try {
        const state = await h.enable(page);
        assert.equal(state.enabled, true);
        assert.equal(state.total, 3);
        assert.notEqual(state.excluded, true);
        await waitForBoxCount(page, 3);
      } finally {
        await page.close();
        await setExcluded([HOST]);
      }
    });

    test('オンにした後でサイトを登録すると、評価ボタンを押しても保存しない', async () => {
      await h.clearStorage();
      const page = await h.openFixture('simple.html');
      try {
        await h.enable(page);
        await waitForBoxCount(page, 3);
        await setExcluded([HOST]);
        await sleep(300);
        // 評価モードがオフになって評価ボックスが無くなる実装もありうる。その場合は押せないので保存もされない
        if ((await page.evaluate(() => window.__t.boxes().length)) > 0) {
          await clickRating(page, 'img1', 'good').catch(() => {});
        }
        await sleep(1000);
        const keys = Object.keys(await h.storageAll()).filter((k) => k.startsWith('r:'));
        assert.deepEqual(keys, [], '登録済みのサイトで評価が保存されました');
      } finally {
        await page.close();
      }
    });
  });

  describe('設定画面の「使わないサイト」', () => {
    let page;

    before(async () => {
      await h.clearStorage();
      await setExcluded(['a.example', 'b.example']);
      page = await openOptions(h);
    });

    after(async () => {
      await page?.close();
    });

    const listItems = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('section#excluded ul#excluded-list > li')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
      );

    test('登録したホスト名を ul#excluded-list に一覧表示する', async () => {
      const items = await listItems();
      assert.equal(items.length, 2, `一覧：${JSON.stringify(items)}`);
      assert.ok(items[0].includes('a.example') || items[1].includes('a.example'), `一覧：${JSON.stringify(items)}`);
      assert.ok(items.some((t) => t.includes('b.example')), `一覧：${JSON.stringify(items)}`);
    });

    test('ホスト名ごとに「登録を外す」ボタンがある', async () => {
      const buttons = page.locator('section#excluded ul#excluded-list > li').getByRole('button', { name: /登録を外す/ });
      assert.equal(await buttons.count(), 2);
    });

    test('「登録を外す」を押すと、そのホスト名だけ settings.excludedSites から外れ、一覧から消える', async () => {
      const li = page.locator('section#excluded ul#excluded-list > li').filter({ hasText: 'a.example' });
      await li.getByRole('button', { name: /登録を外す/ }).click();
      await waitFor(async () => {
        const s = await readSettings(h);
        return s && JSON.stringify(s.excludedSites) === JSON.stringify(['b.example']);
      }, { message: 'settings.excludedSites が ["b.example"] になりません' }).catch(async (e) => {
        throw new Error(`${e.message}（settings：${JSON.stringify(await readSettings(h))}）`);
      });
      await waitFor(async () => {
        const items = await listItems();
        return items.length === 1 && items[0].includes('b.example');
      }, { message: '一覧が更新されません' });
    });

    test('操作の結果を #status（role="status"）に表示する', async () => {
      assert.equal(await page.locator('#status').getAttribute('role'), 'status');
      // 読み上げを確実にするため、少し遅れて文字を入れる実装もありうるので待つ
      await waitStatus(page, (s) => s.includes('a.example'), '#status に「登録を外す」の結果（ホスト名を含む）が表示されません');
    });

    test('登録が無くなると「登録したサイトはありません」と表示する', async () => {
      const li = page.locator('section#excluded ul#excluded-list > li').filter({ hasText: 'b.example' });
      await li.getByRole('button', { name: /登録を外す/ }).click();
      await waitFor(async () => ((await readSettings(h))?.excludedSites || ['x']).length === 0, { message: '登録が外れません' });
      await waitFor(
        () => page.evaluate(() => /登録したサイトはありません/.test(document.querySelector('section#excluded')?.innerText || '')),
        { message: '「登録したサイトはありません」が表示されません' },
      );
      assert.equal((await listItems()).length, 0);
    });

    test('ポップアップで登録したサイトが、設定画面を開き直すと一覧に出る', async () => {
      await setExcluded(['c.example']);
      await reloadOptions(page);
      const items = await listItems();
      assert.equal(items.length, 1);
      assert.ok(items[0].includes('c.example'));
    });
  });
});
