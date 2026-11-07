// 契約「サイドパネル」の、content.js へのメッセージ（altEval:list・altEval:rate・altEval:reveal）と、
// content.js からの通知（altEval:changed）のテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  launchExtension,
  clickRating,
  waitForBoxCount,
  waitFor,
  sleep,
  storageKey,
  boxLocator,
} from './helpers/extension.mjs';
import {
  sendToTab,
  listItems,
  domItems,
  itemForImage,
  installChangedListener,
  takeChanged,
} from './helpers/sidepanel.mjs';

const HOST = '127.0.0.1';
// sidepanel.html の評価ボックスの数（img 2、svg 1、role="img" 1、input type="image" 1、遠くの img 1、小さいアイコン 1）
const SP_BOXES = 7;

/** id が評価ボックスのどれとも重ならない値 */
function unknownId(items) {
  const nums = items.map((i) => Number(i.id)).filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return typeof items[0]?.id === 'string' ? String(max + 100000) : max + 100000;
}

/** 画像の id から評価ボックスのホスト要素の属性を読む */
function hostAttr(page, imgId, name) {
  return page.evaluate(
    ({ imgId, name }) => {
      const box = window.__t.boxFor(document.getElementById(imgId));
      return box ? box.getAttribute(name) : undefined;
    },
    { imgId, name },
  );
}

describe('content.js へのメッセージ', { timeout: 240000 }, () => {
  let h;
  let page;
  let tabId;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    page = await h.openFixture('sidepanel.html');
    tabId = await h.tabIdFor(page);
    await h.enable(page);
    await waitForBoxCount(page, SP_BOXES);
  });

  after(async () => {
    await h?.close();
  });

  describe('altEval:list', () => {
    test('enabled が true で、items は評価ボックスの DOM の順に並ぶ', async () => {
      const res = await listItems(h, tabId);
      assert.ok(res && typeof res === 'object', `返事がありません：${JSON.stringify(res)}`);
      assert.equal(res.enabled, true);
      assert.ok(Array.isArray(res.items), `items が配列ではありません：${JSON.stringify(res)}`);
      const dom = await domItems(page);
      assert.equal(res.items.length, dom.length, '評価ボックスの数と items の数が違います');
      for (let i = 0; i < dom.length; i++) {
        const it = res.items[i];
        const d = dom[i];
        assert.deepEqual(
          { element: it.element, category: it.category, line: (it.line ?? '').replace(/\s+/g, ' ').trim(), rating: it.rating, mode: it.mode },
          { element: d.element, category: d.category, line: d.line, rating: d.rating, mode: d.mode },
          `${i} 番目（#${d.imgId}）の要素が評価ボックスと一致しません`,
        );
      }
    });

    test('各要素の id は評価ボックスのホスト要素の data-id と同じで、重ならない', async () => {
      const res = await listItems(h, tabId);
      const dom = await domItems(page);
      const ids = res.items.map((i) => i.id);
      assert.equal(new Set(ids.map(String)).size, ids.length, `id が重なっています：${JSON.stringify(ids)}`);
      for (let i = 0; i < dom.length; i++) {
        assert.ok(dom[i].dataId !== null, `${i} 番目の評価ボックスに data-id がありません`);
        assert.equal(String(res.items[i].id), dom[i].dataId, `${i} 番目の id と data-id が違います`);
      }
    });

    test('種類（element）・分類・表示のしかたが、画像ごとに正しい', async () => {
      const res = await listItems(h, tabId);
      const dom = await domItems(page);
      const byImg = Object.fromEntries(dom.map((d, i) => [d.imgId, res.items[i]]));
      assert.equal(byImg['sp-photo'].element, 'img');
      assert.equal(byImg['sp-photo'].category, 'named');
      assert.equal(byImg['sp-photo'].line, '名前：山の写真（altから）');
      assert.equal(byImg['sp-photo'].mode, 'inline');
      assert.equal(byImg['sp-noalt'].category, 'none');
      assert.equal(byImg['sp-svg'].element, 'svg');
      assert.equal(byImg['sp-svg'].line, '名前：グラフ（title要素から）');
      assert.equal(byImg['sp-ri'].element, 'role-img');
      assert.equal(byImg['sp-ii'].element, 'input-image');
      assert.equal(byImg['sp-icon'].mode, 'badge');
      for (const it of res.items) assert.equal(it.rating, null, '最初はどれも未評価（null）のはず');
    });

    test('ページを読み込み直すまで、id は変わらない（評価の後も同じ）', async () => {
      const a = await listItems(h, tabId);
      await clickRating(page, 'sp-photo', 'good');
      await sleep(300);
      const b = await listItems(h, tabId);
      assert.deepEqual(b.items.map((i) => i.id), a.items.map((i) => i.id));
      // 元に戻す
      await sendToTab(h, tabId, { type: 'altEval:rate', id: (await itemForImage(h, page, tabId, 'sp-photo')).id, rating: null });
      await sleep(300);
    });

    test('ページで評価すると、rating に反映される', async () => {
      await clickRating(page, 'sp-noalt', 'poor');
      await sleep(300);
      const it = await itemForImage(h, page, tabId, 'sp-noalt');
      assert.equal(it.rating, 'poor');
      await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: null });
      await sleep(300);
    });
  });

  describe('altEval:rate', () => {
    const photoKey = () => storageKey(h.url('sidepanel.html'), h.url('img/sp-photo.png'), '山の写真');

    test('rating: good で評価を保存し、評価ボックスの押した状態をそろえ、更新後の要素を返す', async () => {
      await h.clearStorage();
      const it = await itemForImage(h, page, tabId, 'sp-photo');
      const res = await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: 'good' });
      assert.ok(res && typeof res === 'object', `返事がありません：${JSON.stringify(res)}`);
      assert.equal(String(res.id), String(it.id));
      assert.equal(res.rating, 'good');
      assert.equal(res.element, 'img');
      assert.equal(res.category, 'named');
      assert.equal(res.line, '名前：山の写真（altから）');
      assert.equal(res.mode, it.mode);
      await waitFor(async () => (await h.storageAll())[photoKey()]?.rating === 'good', {
        message: '評価が chrome.storage.local に保存されません',
      }).catch(async (e) => {
        throw new Error(`${e.message}（キー：${JSON.stringify(Object.keys(await h.storageAll()))}）`);
      });
      const rec = (await h.storageAll())[photoKey()];
      assert.equal(rec.pageUrl, h.url('sidepanel.html'));
      assert.equal(rec.pageTitle, 'サイドパネルのテスト');
      assert.equal(rec.name, '山の写真');
      assert.equal(rec.element, 'img');
      assert.ok(typeof rec.ratedAt === 'string' && !Number.isNaN(Date.parse(rec.ratedAt)), `ratedAt：${rec.ratedAt}`);
      const box = await boxLocator(page, 'sp-photo');
      assert.equal(await box.locator('button[data-rating="good"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await box.locator('button[data-rating="poor"]').getAttribute('aria-pressed'), 'false');
    });

    test('ボタンを押した時と同じ記録を保存する', async () => {
      // メッセージで保存した記録と、ボタンで保存した記録の項目（ratedAt を除く）を比べる
      const viaMsg = (await h.storageAll())[photoKey()];
      await h.clearStorage();
      await clickRating(page, 'sp-photo', 'poor');
      await clickRating(page, 'sp-photo', 'good');
      await waitFor(async () => (await h.storageAll())[photoKey()]?.rating === 'good', { message: 'ボタンで保存されません' });
      const viaBtn = (await h.storageAll())[photoKey()];
      const strip = ({ ratedAt, ...rest }) => rest;
      assert.deepEqual(strip(viaMsg), strip(viaBtn));
    });

    test('rating: poor で評価を変え、null で取り消す（キーを削除し、押した状態を戻す）', async () => {
      const it = await itemForImage(h, page, tabId, 'sp-photo');
      const r1 = await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: 'poor' });
      assert.equal(r1?.rating, 'poor');
      await waitFor(async () => (await h.storageAll())[photoKey()]?.rating === 'poor', { message: '悪いに変わりません' });
      const box = await boxLocator(page, 'sp-photo');
      assert.equal(await box.locator('button[data-rating="good"]').getAttribute('aria-pressed'), 'false');
      assert.equal(await box.locator('button[data-rating="poor"]').getAttribute('aria-pressed'), 'true');

      const r2 = await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: null });
      assert.ok(r2 && typeof r2 === 'object', `取り消しの返事がありません：${JSON.stringify(r2)}`);
      assert.equal(r2.rating, null);
      await waitFor(async () => !(photoKey() in (await h.storageAll())), { message: '取り消してもキーが削除されません' });
      assert.equal(await box.locator('button[data-rating="good"]').getAttribute('aria-pressed'), 'false');
      assert.equal(await box.locator('button[data-rating="poor"]').getAttribute('aria-pressed'), 'false');
    });

    test('svg 要素も、ボタンと同じように評価できる', async () => {
      const it = await itemForImage(h, page, tabId, 'sp-svg');
      const res = await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: 'good' });
      assert.equal(res?.rating, 'good');
      assert.equal(res?.element, 'svg');
      await waitFor(
        async () => Object.entries(await h.storageAll()).some(([k, v]) => k.startsWith('r:') && v.element === 'svg' && v.rating === 'good'),
        { message: 'svg の評価が保存されません' },
      );
      await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: null });
      await waitFor(
        async () => !Object.entries(await h.storageAll()).some(([k, v]) => k.startsWith('r:') && v.element === 'svg'),
        { message: 'svg の評価が取り消されません' },
      );
    });

    test('印（badge）の評価ボックスでは、印の記号もそろえる', async () => {
      const it = await itemForImage(h, page, tabId, 'sp-icon');
      assert.equal(it.mode, 'badge', 'sp-icon が印になっていません');
      const badgeText = () =>
        page.evaluate(() => window.__t.badgeInfo(window.__t.boxFor(document.getElementById('sp-icon'))).badgeText);
      await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: 'good' });
      await waitFor(async () => (await badgeText()) === '○', { message: '印に「○」が表示されません' });
      const box = await boxLocator(page, 'sp-icon');
      assert.equal(await box.locator('button[data-rating="good"]').getAttribute('aria-pressed'), 'true');
      await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: 'poor' });
      await waitFor(async () => (await badgeText()) === '×', { message: '印に「×」が表示されません' });
      await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: null });
      await waitFor(async () => (await badgeText()) === '', { message: '取り消しても印が空になりません' });
    });

    test('id が無ければ null を返し、何も保存しない', async () => {
      await h.clearStorage();
      const { items } = await listItems(h, tabId);
      const res = await sendToTab(h, tabId, { type: 'altEval:rate', id: unknownId(items), rating: 'good' });
      assert.equal(res, null);
      await sleep(300);
      assert.deepEqual(Object.keys(await h.storageAll()).filter((k) => k.startsWith('r:')), []);
    });

    test('同じキーの評価ボックスが複数ある時は、すべての押した状態をそろえる', async () => {
      const p2 = await h.openFixture('rating.html');
      try {
        const t2 = await h.tabIdFor(p2);
        await h.enable(p2);
        await waitForBoxCount(p2, 5);
        const it = await itemForImage(h, p2, t2, 'dup-1');
        await sendToTab(h, t2, { type: 'altEval:rate', id: it.id, rating: 'poor' });
        const other = await boxLocator(p2, 'dup-2');
        await waitFor(async () => (await other.locator('button[data-rating="poor"]').getAttribute('aria-pressed')) === 'true', {
          message: '同じキーのもう1つの評価ボックスの押した状態がそろいません',
        });
        const it2 = await itemForImage(h, p2, t2, 'dup-2');
        assert.equal(it2.rating, 'poor', 'altEval:list でも、同じキーの要素の rating がそろいません');
      } finally {
        await p2.close();
      }
    });
  });

  describe('altEval:reveal', () => {
    async function imageCenterOffset(imgId) {
      return page.evaluate((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return r.top + r.height / 2 - innerHeight / 2;
      }, imgId);
    }

    test('画像をページの縦の中央までスクロールし、最初のボタンにフォーカスを移し、true を返す', async () => {
      await page.bringToFront();
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(100);
      const it = await itemForImage(h, page, tabId, 'sp-far');
      const res = await sendToTab(h, tabId, { type: 'altEval:reveal', id: it.id });
      assert.equal(res, true);
      let off;
      await waitFor(
        async () => {
          off = await imageCenterOffset('sp-far');
          return Math.abs(off) <= 60;
        },
        { timeout: 3000, message: '画像がページの縦の中央に来ません' },
      ).catch((e) => {
        throw new Error(`${e.message}（中央からのずれ：${off}px）`);
      });
      const idx = (await domItems(page)).findIndex((d) => d.imgId === 'sp-far');
      const active = await page.evaluate(() => window.__t.describeActive());
      assert.deepEqual(active, { kind: 'box', boxIndex: idx, rating: 'good' }, `フォーカスの位置：${JSON.stringify(active)}`);
    });

    test('ホスト要素に data-revealed を付け、約2秒後に外す', async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      const it = await itemForImage(h, page, tabId, 'sp-photo');
      // 前のテストの data-revealed が消えるのを待つ
      await waitFor(async () => (await hostAttr(page, 'sp-photo', 'data-revealed')) === null, { timeout: 4000 }).catch(() => {});
      const start = Date.now();
      await sendToTab(h, tabId, { type: 'altEval:reveal', id: it.id });
      assert.notEqual(await hostAttr(page, 'sp-photo', 'data-revealed'), null, 'data-revealed が付きません');
      await sleep(Math.max(0, 1300 - (Date.now() - start)));
      assert.notEqual(await hostAttr(page, 'sp-photo', 'data-revealed'), null, '1.3秒後に data-revealed が消えています（2秒間付けるはず）');
      await waitFor(async () => (await hostAttr(page, 'sp-photo', 'data-revealed')) === null, {
        timeout: 4000,
        message: 'data-revealed が約2秒後に消えません',
      });
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 1500 && elapsed <= 4000, `data-revealed が付いていた時間：約${elapsed}ms`);
    });

    test('印の評価ボックスを開き、マウスが離れても開いたままにし、外を押すと閉じる', async () => {
      await page.bringToFront();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(5, 5);
      const info = () => page.evaluate(() => window.__t.badgeInfo(window.__t.boxFor(document.getElementById('sp-icon'))));
      assert.equal((await info()).expanded, false, '最初から印が開いています');
      const it = await itemForImage(h, page, tabId, 'sp-icon');
      const res = await sendToTab(h, tabId, { type: 'altEval:reveal', id: it.id });
      assert.equal(res, true);
      await waitFor(async () => (await info()).expanded === true, { timeout: 3000, message: '印の評価ボックスが開きません（expanded が付きません）' });
      const idx = (await domItems(page)).findIndex((d) => d.imgId === 'sp-icon');
      const active = await page.evaluate(() => window.__t.describeActive());
      assert.deepEqual(active, { kind: 'box', boxIndex: idx, rating: 'good' }, `フォーカスの位置：${JSON.stringify(active)}`);
      // マウスを印に重ねてから離しても、開いたまま
      const cur = await info();
      const r = cur.badgeRect && cur.badgeRect.width > 0 ? cur.badgeRect : cur.hostRect;
      await page.mouse.move(r.left + r.width / 2, r.top + r.height / 2);
      await sleep(200);
      await page.mouse.move(3, 3);
      await sleep(600);
      assert.equal((await info()).expanded, true, 'マウスが離れると閉じました（外を押すまで開いたままのはず）');
      // 評価ボックスの外を押すと閉じる
      await page.mouse.click(3, 3);
      await waitFor(async () => (await info()).expanded === false, { timeout: 3000, message: '評価ボックスの外を押しても閉じません' });
    });

    test('id が無ければ false を返す', async () => {
      const { items } = await listItems(h, tabId);
      const res = await sendToTab(h, tabId, { type: 'altEval:reveal', id: unknownId(items) });
      assert.equal(res, false);
    });
  });
});

describe('使わないサイトでの altEval:rate', { timeout: 120000 }, () => {
  let h;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
  });

  after(async () => {
    await h?.close();
  });

  test('オンにした後でサイトを登録すると、altEval:rate でも保存しない', async () => {
    const page = await h.openFixture('simple.html');
    try {
      const tabId = await h.tabIdFor(page);
      await h.enable(page);
      await waitForBoxCount(page, 3);
      const before = await listItems(h, tabId);
      await h.swEval(async (host) => {
        const { settings = {} } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { defaultOn: false, exportedSites: [], ...settings, excludedSites: [host] } });
      }, HOST);
      await sleep(300);
      // 評価モードがオフになって評価ボックスが無くなる実装もありうる。その場合も保存されなければよい
      await sendToTab(h, tabId, { type: 'altEval:rate', id: before.items[0].id, rating: 'good' }).catch(() => {});
      await sleep(1000);
      const keys = Object.keys(await h.storageAll()).filter((k) => k.startsWith('r:'));
      assert.deepEqual(keys, [], '登録済みのサイトで評価が保存されました');
    } finally {
      await page.close();
    }
  });
});

describe('content.js からの通知（altEval:changed）', { timeout: 180000 }, () => {
  let h;
  let page;
  let tabId;
  let listener;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    page = await h.openFixture('sidepanel.html');
    tabId = await h.tabIdFor(page);
    // 通知を受け取る拡張機能のページ（設定画面）に受信者を加える
    listener = await h.context.newPage();
    await listener.goto(`chrome-extension://${h.extensionId}/src/options/options.html`, { waitUntil: 'load' });
    await installChangedListener(listener);
  });

  after(async () => {
    await h?.close();
  });

  async function changedAfter(action, wait = 800) {
    await sleep(400);
    await takeChanged(listener);
    await action();
    await sleep(wait);
    return takeChanged(listener);
  }

  test('評価モードをオンにすると通知する（送り元はそのタブ）', async () => {
    const got = await changedAfter(async () => {
      await h.enable(page);
      await waitForBoxCount(page, SP_BOXES);
    });
    assert.ok(got.length >= 1, '評価モードをオンにしても altEval:changed が届きません');
    assert.ok(got.every((g) => g.tabId === tabId), `送り元のタブが違います：${JSON.stringify(got)}`);
  });

  test('ページで評価すると通知する', async () => {
    const got = await changedAfter(() => clickRating(page, 'sp-photo', 'good'));
    assert.ok(got.length >= 1, '評価しても altEval:changed が届きません');
  });

  test('altEval:rate で評価を変えても通知する', async () => {
    const it = await itemForImage(h, page, tabId, 'sp-photo');
    const got = await changedAfter(() => sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: null }));
    assert.ok(got.length >= 1, 'altEval:rate で取り消しても altEval:changed が届きません');
  });

  test('画像を加えて評価ボックスが増えると通知する', async () => {
    const got = await changedAfter(async () => {
      await page.evaluate(() => {
        const li = document.createElement('li');
        li.innerHTML = '<img id="dyn-1" src="/img/dyn-1.png" alt="加えた写真" width="120" height="90">';
        document.getElementById('dyn-list').append(li);
      });
      await waitForBoxCount(page, SP_BOXES + 1);
    });
    assert.ok(got.length >= 1, '評価ボックスが増えても altEval:changed が届きません');
  });

  test('画像を削除して評価ボックスが減ると通知する', async () => {
    const got = await changedAfter(async () => {
      await page.evaluate(() => document.getElementById('dyn-list').replaceChildren());
      await waitForBoxCount(page, SP_BOXES);
    });
    assert.ok(got.length >= 1, '評価ボックスが減っても altEval:changed が届きません');
  });

  test('続けて変化した時は、200ミリ秒に1回にまとめる', async () => {
    const got = await changedAfter(async () => {
      // 約200ミリ秒の間に、画像を10枚、1枚ずつ加える
      await page.evaluate(async () => {
        for (let i = 0; i < 10; i++) {
          const li = document.createElement('li');
          li.innerHTML = `<img src="/img/burst-${i}.png" alt="続けて加えた写真${i}" width="120" height="90">`;
          document.getElementById('dyn-list').append(li);
          await new Promise((r) => setTimeout(r, 20));
        }
      });
      await waitForBoxCount(page, SP_BOXES + 10);
    }, 1000);
    assert.ok(got.length >= 1, '通知が1つも届きません');
    assert.ok(got.length <= 3, `通知が多すぎます（${got.length}回。200ミリ秒に1回にまとめるはず）`);
    for (let i = 1; i < got.length; i++) {
      const gap = got[i].t - got[i - 1].t;
      assert.ok(gap >= 150, `通知の間隔が短すぎます：${gap}ms`);
    }
  });

  test('altEval:rate を続けて送っても、通知はまとめる', async () => {
    const { items } = await listItems(h, tabId);
    const got = await changedAfter(async () => {
      await h.swEval(
        async ({ tabId, ids }) => {
          for (const id of ids) {
            await chrome.tabs.sendMessage(tabId, { type: 'altEval:rate', id, rating: 'good' });
          }
        },
        { tabId, ids: items.slice(0, 6).map((i) => i.id) },
      );
    }, 1000);
    assert.ok(got.length >= 1, '通知が1つも届きません');
    assert.ok(got.length <= 3, `通知が多すぎます（${got.length}回）`);
  });

  test('評価モードをオフにすると通知する', async () => {
    const got = await changedAfter(async () => {
      await h.disable(page);
      await waitForBoxCount(page, 0);
    });
    assert.ok(got.length >= 1, '評価モードをオフにしても altEval:changed が届きません');
  });

  test('受け取る画面が無くても、ページにエラーを出さない', async () => {
    await listener.close();
    const errors = [];
    const onErr = (e) => errors.push(String(e?.message || e));
    const onConsole = (m) => {
      if (/Receiving end does not exist|Could not establish connection/i.test(m.text())) errors.push(m.text());
    };
    page.on('pageerror', onErr);
    page.on('console', onConsole);
    try {
      await h.enable(page);
      await waitForBoxCount(page, SP_BOXES + 10);
      await clickRating(page, 'sp-photo', 'poor');
      await sleep(800);
      // content.js は隔離された環境で動くため pageerror に出ないこともあるが、出た場合は失敗とする
      assert.deepEqual(errors, []);
      assert.equal((await h.getState(page)).enabled, true);
    } finally {
      page.off('pageerror', onErr);
      page.off('console', onConsole);
    }
  });
});
