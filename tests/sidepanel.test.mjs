// 契約「サイドパネル」の画面（sidepanel.html?tabId=…）と、ポップアップの「サイドパネルを開く」ボタンのテスト
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
import { openPopup, injectPageHelpers, axeViolations } from './helpers/options.mjs';
import {
  sendToTab,
  listItems,
  domItems,
  itemForImage,
  openSidePanel,
  panelState,
  waitPanel,
} from './helpers/sidepanel.mjs';

const HOST = '127.0.0.1';
const TITLE = 'サイドパネルのテスト';
const SP_BOXES = 7;
const OFF_SUMMARY = '評価モードをオンにすると、画像の一覧を表示します';
const EMPTY_SUMMARY = 'このページに評価できる画像はありません';
const UNSUPPORTED = 'このページでは評価モードを使えません';
const SUFFIX = { svg: '（svg要素）', 'role-img': '（role="img"の要素）', 'input-image': '（input type="image"）' };
// 「（svg要素）」などの前に空白を入れる実装も許す
const normLine = (s) => (s ?? '').replace(/\s+(?=（(svg要素|role="img"の要素|input type="image")）$)/, '');

const summaryText = (n, g, p) => `画像 ${n}枚（良い ${g}、悪い ${p}、未評価 ${n - g - p}）`;
const STATE_TEXT = { good: '○ 良い', poor: '× 悪い', null: '未評価' };

/** パネルの #status を空にする */
async function clearPanelStatus(p) {
  await p.evaluate(() => {
    const s = document.querySelector('#status');
    if (s) s.textContent = '';
  });
}

/** フォーカスできる部品（表示されていて、無効でないもの）に番号を振り、その説明を返す */
function markFocusables(page) {
  return page.evaluate(() => {
    const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const list = Array.from(document.querySelectorAll(sel)).filter(
      (el) => !el.disabled && el.getClientRects().length > 0 && el.checkVisibility({ visibilityProperty: true }) && el.tabIndex >= 0,
    );
    list.forEach((el, i) => el.setAttribute('data-test-focus', String(i)));
    return list.map((el) => `${el.localName}${el.id ? '#' + el.id : ''}「${(el.textContent || el.value || '').trim().slice(0, 30)}」`);
  });
}

/** Tab キーで1周し、フォーカスが来た部品の番号と、その時のフォーカスの見え方を集める */
async function tabAround(page, count) {
  await page.evaluate(() => document.activeElement?.blur());
  const seen = new Map();
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        idx: el.getAttribute('data-test-focus'),
        desc: `${el.localName}${el.id ? '#' + el.id : ''}`,
        focusVisible: el.matches(':focus-visible'),
        outlineStyle: cs.outlineStyle,
        outlineWidth: parseFloat(cs.outlineWidth) || 0,
        boxShadow: cs.boxShadow,
      };
    });
    if (info && info.idx !== null && !seen.has(info.idx)) seen.set(info.idx, info);
  }
  return seen;
}

/** 表示されている文字のコントラスト比が足りない要素 */
async function lowContrast(page) {
  await injectPageHelpers(page);
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const checked = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim()) continue;
      const el = n.parentElement;
      if (!el || checked.has(el)) continue;
      checked.add(el);
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const tr = range.getBoundingClientRect();
      if (tr.width < 2 || tr.height < 2) continue;
      if (el.closest('[disabled]')) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const need = large ? 3 : 4.5;
      const c = window.__t.contrast(el);
      if (c.ratio < need) out.push(`${el.localName}${el.id ? '#' + el.id : ''}「${n.data.trim().slice(0, 20)}」：${c.ratio.toFixed(2)}（必要：${need}、文字 ${c.fg}、背景 ${c.bg}）`);
    }
    return out;
  });
}

/** パネルの一覧の n 番目の li のボタン */
const liButton = (panel, n, cls) => panel.locator('ol#items > li').nth(n).locator(`button.${cls}`);

describe('サイドパネルの画面', { timeout: 300000 }, () => {
  let h;
  let page;
  let tabId;
  let panel;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    page = await h.openFixture('sidepanel.html');
    tabId = await h.tabIdFor(page);
    panel = await openSidePanel(h, tabId);
  });

  after(async () => {
    await h?.close();
  });

  test('html の lang は ja で、h1 は「このページの画像」', async () => {
    assert.equal(await panel.evaluate(() => document.documentElement.getAttribute('lang')), 'ja');
    const h1 = await panel.locator('h1').allTextContents();
    assert.deepEqual(h1.map((s) => s.replace(/\s+/g, ' ').trim()), ['このページの画像']);
  });

  test('#page に、ページのタイトルとホスト名を表示する', async () => {
    const st = await waitPanel(panel, (s) => s.page.includes(TITLE), '#page にページのタイトルが表示されません');
    assert.ok(st.page.includes(HOST), `#page にホスト名がありません：「${st.page}」`);
  });

  test('評価モードがオフの時：#mode「評価モード：オフ」、#toggle「評価モードをオンにする」、#summary の案内。#filter と #items は表示しない', async () => {
    const st = await waitPanel(panel, (s) => s.mode === '評価モード：オフ', '#mode に「評価モード：オフ」が表示されません');
    assert.equal(st.toggle, '評価モードをオンにする');
    assert.equal(st.toggleShown, true, '#toggle が表示されていません');
    assert.equal(await panel.locator('#toggle').evaluate((e) => e.localName), 'button');
    assert.equal(st.summary, OFF_SUMMARY);
    assert.equal(st.filterShown, false, 'オフの時に #filter が表示されています');
    assert.equal(st.itemsShown, false, 'オフの時に #items が表示されています');
  });

  test('部品は h1、#page、#mode、#summary、#filter、#items、#status の順に並ぶ', async () => {
    const order = await panel.evaluate(() => {
      const sels = ['h1', '#page', '#mode', '#summary', 'select#filter', 'ol#items', '#status'];
      const els = sels.map((s) => document.querySelector(s));
      const missing = sels.filter((_, i) => !els[i]);
      if (missing.length) return { missing };
      const bad = [];
      for (let i = 1; i < els.length; i++) {
        if (!(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) bad.push(`${sels[i - 1]} → ${sels[i]}`);
      }
      return { missing, bad, toggleAfterMode: !!document.querySelector('#toggle') && (document.querySelector('#mode').compareDocumentPosition(document.querySelector('#toggle')) & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) !== 0 };
    });
    assert.deepEqual(order.missing, [], `部品がありません：${order.missing}`);
    assert.deepEqual(order.bad, [], '並び順が違います');
    assert.equal(order.toggleAfterMode, true, '#toggle が #mode の後（か中）にありません');
  });

  test('#status は role="status"', async () => {
    assert.equal(await panel.locator('#status').getAttribute('role'), 'status');
  });

  test('#toggle を押すと、対象のタブの評価モードをオンにし、表示を切り替える', async () => {
    await panel.locator('#toggle').click();
    await waitFor(async () => (await h.getState(page)).enabled === true, { message: '#toggle で対象のタブの評価モードがオンになりません' });
    await waitForBoxCount(page, SP_BOXES);
    const st = await waitPanel(
      panel,
      (s) => s.mode === '評価モード：オン' && s.items.length === SP_BOXES,
      'オンにしても、#mode が「評価モード：オン」にならないか、一覧の数が評価ボックスの数になりません',
    );
    assert.equal(st.toggle, '評価モードをオフにする');
    assert.equal(st.filterShown, true, 'オンの時に #filter が表示されていません');
    assert.equal(st.itemsShown, true, 'オンの時に #items が表示されていません');
  });

  test('#summary は「画像 N枚（良い a、悪い b、未評価 c）」', async () => {
    const st = await waitPanel(panel, (s) => s.summary === summaryText(SP_BOXES, 0, 0), '#summary の文字が違います');
    assert.equal(st.summary, summaryText(SP_BOXES, 0, 0));
  });

  test('一覧の li は評価ボックスの順で、p.line は1行目の文字（img 以外は「（svg要素）」などを加える）', async () => {
    const st = await panelState(panel);
    const { items } = await listItems(h, tabId);
    const dom = await domItems(page);
    assert.equal(st.items.length, dom.length);
    for (let i = 0; i < dom.length; i++) {
      const expected = dom[i].line + (SUFFIX[items[i].element] || '');
      assert.equal(normLine(st.items[i].line), expected, `${i} 番目（#${dom[i].imgId}）の p.line が違います`);
    }
    // 代表的なものを直接確かめる
    const byImg = Object.fromEntries(dom.map((d, i) => [d.imgId, st.items[i]]));
    assert.equal(byImg['sp-photo'].line, '名前：山の写真（altから）');
    assert.equal(normLine(byImg['sp-svg'].line), '名前：グラフ（title要素から）（svg要素）');
    assert.equal(normLine(byImg['sp-ri'].line), '名前：星3つ（aria-labelから）（role="img"の要素）');
    assert.equal(normLine(byImg['sp-ii'].line), '名前：検索（altから）（input type="image"）');
  });

  test('各 li に p.state「未評価」、button.rate-good「○ 良い」、button.rate-poor「× 悪い」（aria-pressed 付き）、button.reveal「ページの画像へ移動」がある', async () => {
    const st = await panelState(panel);
    for (const [i, it] of st.items.entries()) {
      assert.equal(it.state, '未評価', `${i} 番目の p.state`);
      assert.deepEqual(
        [it.good?.tag, it.good?.text, it.good?.pressed],
        ['button', '○ 良い', 'false'],
        `${i} 番目の button.rate-good`,
      );
      assert.deepEqual(
        [it.poor?.tag, it.poor?.text, it.poor?.pressed],
        ['button', '× 悪い', 'false'],
        `${i} 番目の button.rate-poor`,
      );
      assert.deepEqual([it.reveal?.tag, it.reveal?.text], ['button', 'ページの画像へ移動'], `${i} 番目の button.reveal`);
    }
  });

  test('3つのボタンの aria-describedby が、同じ li の p.line を指す', async () => {
    const bad = await panel.evaluate(() => {
      const out = [];
      document.querySelectorAll('ol#items > li').forEach((li, i) => {
        const line = li.querySelector('p.line');
        for (const cls of ['rate-good', 'rate-poor', 'reveal']) {
          const b = li.querySelector(`button.${cls}`);
          const ids = (b?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
          const ok = line && line.id && ids.includes(line.id) && document.getElementById(line.id) === line;
          if (!ok) out.push(`${i} 番目の button.${cls}：aria-describedby="${b?.getAttribute('aria-describedby')}"、p.line の id="${line?.id}"`);
        }
      });
      return out;
    });
    assert.deepEqual(bad, []);
    // id が li ごとに違う
    const ids = (await panelState(panel)).items.map((i) => i.lineId);
    assert.equal(new Set(ids).size, ids.length, `p.line の id が重なっています：${ids}`);
  });

  test('select#filter のラベルは「表示する画像」で、値は all・unrated・good・poor', async () => {
    const f = panel.getByLabel('表示する画像', { exact: true });
    assert.equal(await f.count(), 1, 'ラベル「表示する画像」の部品がありません');
    assert.equal(await f.evaluate((e) => e.localName + '#' + e.id), 'select#filter');
    const values = await panel.locator('select#filter option').evaluateAll((os) => os.map((o) => o.value));
    assert.deepEqual(values, ['all', 'unrated', 'good', 'poor']);
    assert.equal(await panel.locator('select#filter').inputValue(), 'all');
  });

  test('パネルで「○ 良い」を押すと、ページの評価ボックスと保存とパネルの表示がそろい、#status に結果を表示する', async () => {
    await clearPanelStatus(panel);
    await liButton(panel, 0, 'rate-good').click();
    const key = storageKey(h.url('sidepanel.html'), h.url('img/sp-photo.png'), '山の写真');
    await waitFor(async () => (await h.storageAll())[key]?.rating === 'good', { message: 'パネルで評価しても保存されません' });
    const box = await boxLocator(page, 'sp-photo');
    await waitFor(async () => (await box.locator('button[data-rating="good"]').getAttribute('aria-pressed')) === 'true', {
      message: 'ページの評価ボックスの押した状態がそろいません',
    });
    const st = await waitPanel(
      panel,
      (s) => s.items[0].state === STATE_TEXT.good && s.items[0].good.pressed === 'true' && s.items[0].poor.pressed === 'false',
      'パネルの p.state と aria-pressed が「良い」になりません',
    );
    assert.equal(st.summary, summaryText(SP_BOXES, 1, 0));
    const status = await waitPanel(panel, (s) => !!s.status, '#status に結果が表示されません');
    assert.ok(status.status.length > 0);
  });

  test('押した状態のボタンをもう一度押すと取り消す', async () => {
    await clearPanelStatus(panel);
    await liButton(panel, 0, 'rate-good').click();
    const key = storageKey(h.url('sidepanel.html'), h.url('img/sp-photo.png'), '山の写真');
    await waitFor(async () => !(key in (await h.storageAll())), { message: 'もう一度押しても評価が取り消されません' });
    const st = await waitPanel(
      panel,
      (s) => s.items[0].state === STATE_TEXT.null && s.items[0].good.pressed === 'false' && s.summary === summaryText(SP_BOXES, 0, 0),
      'パネルが未評価に戻りません',
    );
    assert.equal(st.items[0].poor.pressed, 'false');
    await waitPanel(panel, (s) => !!s.status, '取り消した後、#status に結果が表示されません');
    const box = await boxLocator(page, 'sp-photo');
    assert.equal(await box.locator('button[data-rating="good"]').getAttribute('aria-pressed'), 'false');
  });

  test('「× 悪い」を押すと「× 悪い」になり、続けて「○ 良い」を押すと切り替わる', async () => {
    await liButton(panel, 1, 'rate-poor').click();
    await waitPanel(panel, (s) => s.items[1].state === STATE_TEXT.poor && s.items[1].poor.pressed === 'true', '「× 悪い」になりません');
    await liButton(panel, 1, 'rate-good').click();
    const st = await waitPanel(
      panel,
      (s) => s.items[1].state === STATE_TEXT.good && s.items[1].good.pressed === 'true' && s.items[1].poor.pressed === 'false',
      '「○ 良い」に切り替わりません',
    );
    assert.equal(st.summary, summaryText(SP_BOXES, 1, 0));
    await liButton(panel, 1, 'rate-good').click();
    await waitPanel(panel, (s) => s.items[1].state === STATE_TEXT.null, '取り消せません');
  });

  test('ページで評価すると、通知でパネルの表示が更新される', async () => {
    await clickRating(page, 'sp-noalt', 'poor');
    const idx = (await domItems(page)).findIndex((d) => d.imgId === 'sp-noalt');
    const st = await waitPanel(
      panel,
      (s) => s.items[idx].state === STATE_TEXT.poor && s.items[idx].poor.pressed === 'true',
      'ページで評価しても、パネルの表示が更新されません',
    );
    assert.equal(st.summary, summaryText(SP_BOXES, 0, 1));
  });

  test('ページに画像を加えると、パネルの一覧が増える', async () => {
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.innerHTML = '<img id="dyn-panel" src="/img/dyn-panel.png" alt="加えた写真" width="120" height="90">';
      document.getElementById('dyn-list').append(li);
    });
    await waitForBoxCount(page, SP_BOXES + 1);
    const st = await waitPanel(panel, (s) => s.items.length === SP_BOXES + 1, 'パネルの一覧が増えません');
    assert.equal(st.items[SP_BOXES].line, '名前：加えた写真（altから）');
    assert.equal(st.summary, summaryText(SP_BOXES + 1, 0, 1));
    await page.evaluate(() => document.getElementById('dyn-list').replaceChildren());
    await waitForBoxCount(page, SP_BOXES);
    await waitPanel(panel, (s) => s.items.length === SP_BOXES, 'パネルの一覧が減りません');
  });

  test('#filter で一覧を絞り込める（#summary はページ全体の数のまま）', async () => {
    // 0 番目を良い、sp-noalt（1 番目）は悪い、残りは未評価
    await liButton(panel, 0, 'rate-good').click();
    await waitPanel(panel, (s) => s.summary === summaryText(SP_BOXES, 1, 1), '準備の評価ができません');
    const shownLines = async () => (await panelState(panel)).items.filter((i) => i.shown).map((i) => i.line);
    const all = (await panelState(panel)).items.map((i) => i.line);
    const check = async (value, expected) => {
      await panel.selectOption('select#filter', value);
      let got;
      await waitFor(
        async () => {
          got = await shownLines();
          return JSON.stringify(got) === JSON.stringify(expected);
        },
        { timeout: 3000 },
      ).catch(() => {
        throw new Error(`絞り込み「${value}」の表示が違います：${JSON.stringify(got)}（期待：${JSON.stringify(expected)}）`);
      });
      assert.equal((await panelState(panel)).summary, summaryText(SP_BOXES, 1, 1), `絞り込み「${value}」で #summary が変わりました`);
    };
    await check('good', [all[0]]);
    await check('poor', [all[1]]);
    await check('unrated', all.slice(2));
    await check('all', all);
  });

  test('絞り込み中に評価が変わると、絞り込みを保ったまま一覧を更新する', async () => {
    await panel.selectOption('select#filter', 'unrated');
    await waitPanel(panel, (s) => s.items.filter((i) => i.shown).length === SP_BOXES - 2, '未評価に絞り込めません');
    const it = await itemForImage(h, page, tabId, 'sp-svg');
    await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: 'good' });
    await waitPanel(panel, (s) => s.items.filter((i) => i.shown).length === SP_BOXES - 3, '評価した画像が「未評価」の絞り込みから消えません');
    assert.equal(await panel.locator('select#filter').inputValue(), 'unrated');
    await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: null });
    await panel.selectOption('select#filter', 'all');
    await waitPanel(panel, (s) => s.items.filter((i) => i.shown).length === SP_BOXES, '「すべて」に戻せません');
  });

  test('「ページの画像へ移動」を押すと、ページの画像が中央に来て、評価ボックスに data-revealed が付く', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const idx = (await domItems(page)).findIndex((d) => d.imgId === 'sp-far');
    await liButton(panel, idx, 'reveal').click();
    await waitFor(
      () =>
        page.evaluate(() => {
          const box = window.__t.boxFor(document.getElementById('sp-far'));
          return box && box.hasAttribute('data-revealed');
        }),
      { timeout: 2000, message: '評価ボックスに data-revealed が付きません' },
    );
    let off;
    await waitFor(
      async () => {
        off = await page.evaluate(() => {
          const r = document.getElementById('sp-far').getBoundingClientRect();
          return r.top + r.height / 2 - innerHeight / 2;
        });
        return Math.abs(off) <= 60;
      },
      { timeout: 3000, message: '画像が縦の中央に来ません' },
    ).catch((e) => {
      throw new Error(`${e.message}（ずれ：${off}px）`);
    });
    const active = await page.evaluate(() => window.__t.describeActive());
    assert.deepEqual(active, { kind: 'box', boxIndex: idx, rating: 'good' }, `ページのフォーカスの位置：${JSON.stringify(active)}`);
  });

  test('一覧を作り直しても、一覧の中のフォーカスは同じ画像の同じボタンに戻る', async () => {
    const st0 = await panelState(panel);
    const svgIdx = (await domItems(page)).findIndex((d) => d.imgId === 'sp-svg');
    const svgLine = st0.items[svgIdx].line;
    await liButton(panel, svgIdx, 'rate-poor').focus();
    const focused = () =>
      panel.evaluate(() => {
        const el = document.activeElement;
        const li = el?.closest('ol#items > li');
        return {
          cls: el ? el.className : null,
          line: li ? li.querySelector('p.line')?.textContent.replace(/\s+/g, ' ').trim() : null,
          index: li ? Array.from(li.parentElement.children).indexOf(li) : -1,
        };
      });
    assert.equal((await focused()).line, svgLine);
    // ページ側で別の画像を評価して、一覧を更新させる
    const it = await itemForImage(h, page, tabId, 'sp-photo');
    const before = (await panelState(panel)).items[0].state;
    const next = before === STATE_TEXT.good ? 'poor' : 'good';
    await sendToTab(h, tabId, { type: 'altEval:rate', id: it.id, rating: next });
    await waitPanel(panel, (s) => s.items[0].state === STATE_TEXT[next], 'ページの評価でパネルが更新されません');
    await sleep(300);
    let f = await focused();
    assert.equal(f.line, svgLine, `フォーカスが同じ画像に戻りません：${JSON.stringify(f)}`);
    assert.match(f.cls, /\brate-poor\b/, `フォーカスが同じボタン（rate-poor）に戻りません：${JSON.stringify(f)}`);

    // 前に画像が加わって、一覧の順番がずれても、同じ画像のボタンに戻る
    await page.evaluate(() => {
      document.getElementById('dyn-top').innerHTML = '<p><img id="dyn-top-img" src="/img/dyn-top.png" alt="先頭に加えた写真" width="120" height="90"></p>';
    });
    await waitForBoxCount(page, SP_BOXES + 1);
    await waitPanel(panel, (s) => s.items.length === SP_BOXES + 1, 'パネルの一覧が増えません');
    await sleep(300);
    f = await focused();
    assert.equal(f.line, svgLine, `一覧の順番がずれた後、フォーカスが同じ画像に戻りません：${JSON.stringify(f)}`);
    assert.equal(f.index, svgIdx + 1);
    assert.match(f.cls, /\brate-poor\b/);
    await page.evaluate(() => document.getElementById('dyn-top').replaceChildren());
    await waitForBoxCount(page, SP_BOXES);
    await waitPanel(panel, (s) => s.items.length === SP_BOXES, 'パネルの一覧が減りません');
  });

  test('キーボードで評価できる（Enter で評価、Space で取り消し）', async () => {
    const idx = (await domItems(page)).findIndex((d) => d.imgId === 'sp-ri');
    await liButton(panel, idx, 'rate-good').focus();
    await panel.keyboard.press('Enter');
    await waitPanel(panel, (s) => s.items[idx].state === STATE_TEXT.good, 'Enter キーで評価できません');
    // 作り直した後もフォーカスが同じボタンにある前提で、Space を押す
    await liButton(panel, idx, 'rate-good').focus();
    await panel.keyboard.press('Space');
    await waitPanel(panel, (s) => s.items[idx].state === STATE_TEXT.null, 'Space キーで取り消せません');
  });

  test('?tabId で開いた時は、ほかのタブに切り替えても対象のタブのまま', async () => {
    const other = await h.openFixture('simple.html');
    try {
      await other.bringToFront();
      await sleep(800);
      const st = await panelState(panel);
      assert.ok(st.page.includes(TITLE), `ほかのタブに切り替えると #page が変わりました：「${st.page}」`);
      assert.equal(st.items.length, SP_BOXES);
    } finally {
      await other.close();
    }
  });

  test('#toggle でオフにすると、オフの表示に戻る', async () => {
    await panel.locator('#toggle').click();
    await waitFor(async () => (await h.getState(page)).enabled === false, { message: '#toggle で評価モードがオフになりません' });
    await waitForBoxCount(page, 0);
    const st = await waitPanel(panel, (s) => s.mode === '評価モード：オフ' && s.summary === OFF_SUMMARY, 'オフの表示になりません');
    assert.equal(st.toggle, '評価モードをオンにする');
    assert.equal(st.filterShown, false);
    assert.equal(st.itemsShown, false);
  });

  test('ページで評価モードをオンにすると（通知で）パネルもオンの表示になる', async () => {
    await h.enable(page);
    await waitForBoxCount(page, SP_BOXES);
    await waitPanel(panel, (s) => s.mode === '評価モード：オン' && s.items.length === SP_BOXES, 'パネルがオンの表示になりません');
  });

  test('サイドパネルでエラーが起きていない', async () => {
    assert.deepEqual(panel.__errors, []);
  });
});

describe('サイドパネルの、画像が無いページと使えないページ', { timeout: 120000 }, () => {
  let h;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
  });

  after(async () => {
    await h?.close();
  });

  test('評価モードがオンで画像が無い時は「このページに評価できる画像はありません」', async () => {
    const page = await h.openFixture('submitted');
    const tabId = await h.tabIdFor(page);
    await h.enable(page);
    const panel = await openSidePanel(h, tabId);
    try {
      const st = await waitPanel(panel, (s) => s.summary === EMPTY_SUMMARY, `#summary に「${EMPTY_SUMMARY}」が表示されません`);
      assert.equal(st.mode, '評価モード：オン');
      assert.equal(st.items.length, 0);
    } finally {
      await panel.close();
      await page.close();
    }
  });

  test('chrome:// のページでは「このページでは評価モードを使えません」と表示し、ほかの部品を表示しない', async () => {
    // chrome:// のタブの URL は拡張機能から読めないため、service worker でタブを作って id を受け取る
    const tabId = await h.swEval(async () => (await chrome.tabs.create({ url: 'chrome://version/', active: true })).id);
    await sleep(500);
    const page = { close: () => h.swEval((id) => chrome.tabs.remove(id), tabId).catch(() => {}) };
    const panel = await openSidePanel(h, tabId);
    try {
      const st = await waitPanel(panel, (s) => s.mode === UNSUPPORTED, `#mode に「${UNSUPPORTED}」が表示されません`);
      assert.equal(st.toggleShown, false, '#toggle が表示されています');
      assert.equal(st.summaryShown, false, '#summary が表示されています');
      assert.equal(st.filterShown, false, '#filter が表示されています');
      assert.equal(st.itemsShown, false, '#items が表示されています');
      assert.deepEqual(panel.__errors, []);
      assert.deepEqual(await axeViolations(panel), []);
    } finally {
      await panel.close();
      await page.close();
    }
  });
});

describe('サイドパネルのアクセシビリティ', { timeout: 180000 }, () => {
  let h;
  let page;
  let tabId;
  let panel;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    page = await h.openFixture('sidepanel.html');
    tabId = await h.tabIdFor(page);
    panel = await openSidePanel(h, tabId);
    await waitPanel(panel, (s) => s.mode === '評価モード：オフ', 'オフの表示になりません');
  });

  after(async () => {
    await h?.close();
  });

  test('オフの時に axe-core の違反が無い', async () => {
    assert.deepEqual(await axeViolations(panel), []);
  });

  test('オフの時の文字のコントラスト比が 4.5 以上（大きい文字は 3 以上）', async () => {
    assert.deepEqual(await lowContrast(panel), []);
  });

  test('オンにして評価した後に axe-core の違反が無い', async () => {
    await h.enable(page);
    await waitForBoxCount(page, SP_BOXES);
    await waitPanel(panel, (s) => s.items.length === SP_BOXES, '一覧が表示されません');
    await liButton(panel, 0, 'rate-good').click();
    await liButton(panel, 1, 'rate-poor').click();
    await waitPanel(panel, (s) => s.summary === summaryText(SP_BOXES, 1, 1), '評価がパネルに反映されません');
    assert.deepEqual(await axeViolations(panel), []);
  });

  test('オンの時の文字のコントラスト比が 4.5 以上（押した状態のボタンを含む）', async () => {
    assert.deepEqual(await lowContrast(panel), []);
  });

  test('すべての部品に Tab キーで届き、フォーカスが見える', async () => {
    await panel.bringToFront();
    const all = await markFocusables(panel);
    assert.ok(all.length >= 1 + 1 + SP_BOXES * 3, `部品が少なすぎます：${JSON.stringify(all)}`);
    const seen = await tabAround(panel, all.length * 2 + 10);
    const missed = all.filter((_, i) => !seen.has(String(i)));
    assert.deepEqual(missed, [], 'Tab キーで届かない部品があります');
    const invisible = [...seen.values()]
      .filter((s) => !s.focusVisible || ((s.outlineStyle === 'none' || s.outlineWidth === 0) && (!s.boxShadow || s.boxShadow === 'none')))
      .map((s) => `${s.desc}：${JSON.stringify(s)}`);
    assert.deepEqual(invisible, [], 'フォーカスが見えない部品があります');
  });

  test('キーボードで絞り込みを変えられる', async () => {
    await panel.locator('#filter').focus();
    await panel.keyboard.press('ArrowDown');
    await waitFor(async () => (await panel.locator('#filter').inputValue()) === 'unrated', {
      timeout: 2000,
      message: 'ArrowDown で「未評価」が選ばれません',
    });
    await waitPanel(panel, (s) => s.items.filter((i) => i.shown).length === SP_BOXES - 2, '絞り込みが一覧に反映されません');
    await panel.selectOption('#filter', 'all');
  });

  test('「ページの画像へ移動」をキーボードで押せる', async () => {
    const idx = (await domItems(page)).findIndex((d) => d.imgId === 'sp-far');
    await liButton(panel, idx, 'reveal').focus();
    await panel.keyboard.press('Enter');
    await waitFor(
      () =>
        page.evaluate(() => {
          const box = window.__t.boxFor(document.getElementById('sp-far'));
          return box && box.hasAttribute('data-revealed');
        }),
      { timeout: 2000, message: 'Enter キーで「ページの画像へ移動」が働きません' },
    );
  });
});

describe('ポップアップの「サイドパネルを開く」ボタン', { timeout: 120000 }, () => {
  let h;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
  });

  after(async () => {
    await h?.close();
  });

  test('#open-sidepanel は「サイドパネルを開く」という名前のボタンで、押してもエラーにならない', async () => {
    const page = await h.openFixture('simple.html');
    const tabId = await h.tabIdFor(page);
    const popup = await openPopup(h, tabId);
    const errors = [];
    popup.on('pageerror', (e) => errors.push(String(e?.message || e)));
    try {
      const b = popup.locator('#open-sidepanel');
      assert.equal(await b.count(), 1, '#open-sidepanel がありません');
      assert.equal(await b.evaluate((e) => e.localName), 'button');
      assert.equal(await popup.getByRole('button', { name: 'サイドパネルを開く', exact: true }).count(), 1);
      // chrome.sidePanel.open はユーザーの操作が必要なため、開いたかは確かめず、エラーが出ないことだけを確かめる
      await b.click().catch(() => {});
      await sleep(800);
      assert.deepEqual(errors, []);
    } finally {
      await popup.close().catch(() => {});
      await page.close();
    }
  });

  test('ボタンを加えた後も、ポップアップに axe-core の違反が無い', async () => {
    const page = await h.openFixture('simple.html');
    const tabId = await h.tabIdFor(page);
    const popup = await openPopup(h, tabId);
    try {
      assert.deepEqual(await axeViolations(popup), []);
    } finally {
      await popup.close();
      await page.close();
    }
  });
});
