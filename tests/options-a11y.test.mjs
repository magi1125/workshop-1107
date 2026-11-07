// 設定画面とポップアップのアクセシビリティのテスト
// (a) lang と見出しの構造、(b) フォームの部品のラベル、(c) axe-core、(d) キーボードとフォーカスの見え方、(e) コントラスト比
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, waitForBoxCount } from './helpers/extension.mjs';
import {
  makeRecord,
  ownKey,
  importedKey,
  seedStorage,
  openOptions,
  openPopup,
  injectPageHelpers,
  axeViolations,
} from './helpers/options.mjs';

/** フォーカスできる部品（表示されていて、無効でないもの）に番号を振り、その説明を返す */
function markFocusables(page) {
  return page.evaluate(() => {
    const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const list = Array.from(document.querySelectorAll(sel)).filter(
      (el) => !el.disabled && el.getClientRects().length > 0 && el.checkVisibility({ visibilityProperty: true }) && el.tabIndex >= 0,
    );
    list.forEach((el, i) => el.setAttribute('data-test-focus', String(i)));
    return list.map((el) => `${el.localName}${el.id ? '#' + el.id : ''}「${(el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 30)}」`);
  });
}

/** Tab キーで1周し、フォーカスが来た部品の番号と、その時のフォーカスの見え方を集める */
async function tabAround(page, count) {
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.getSelection()?.removeAllRanges();
  });
  await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
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
function lowContrast(page) {
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
      // 視覚的に隠した文字（1px の切り取りなど）は対象にしない
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

describe('設定画面のアクセシビリティ', { timeout: 180000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    const own = makeRecord({ pageUrl: 'https://a.example/', imageUrl: h.url('img/a11y.png'), name: '会社のロゴ', ratedAt: '2026-11-01T00:00:00.000Z' });
    const own2 = makeRecord({ pageUrl: 'https://b.example/', imageUrl: null, embedded: true, category: 'empty', name: '', altState: 'empty', alt: '', rating: 'poor', ratedAt: '2026-11-02T00:00:00.000Z' });
    const imp = { ...makeRecord({ pageUrl: 'https://c.example/', name: '青い空', ratedAt: '2026-11-03T00:00:00.000Z' }), evaluator: '山田', importedAt: '2026-11-03T00:00:00.000Z' };
    await seedStorage(h, {
      [ownKey(own)]: own,
      [ownKey(own2)]: own2,
      [importedKey('山田', imp)]: imp,
      settings: { defaultOn: false, excludedSites: ['x.example'], exportedSites: ['a.example'] },
    });
    page = await openOptions(h);
  });

  after(async () => {
    await h?.close();
  });

  test('html の lang が ja', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('lang')), 'ja');
  });

  test('h1 は「alt通信簿の記録と設定」の1つだけ', async () => {
    const h1 = await page.evaluate(() => Array.from(document.querySelectorAll('h1')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(h1, ['alt通信簿の記録と設定']);
  });

  test('節は records・export・import・settings・excluded の順で、それぞれ最初の見出しが h2', async () => {
    const r = await page.evaluate(() =>
      Array.from(document.querySelectorAll('section')).map((s) => ({
        id: s.id,
        heading: s.querySelector('h1, h2, h3, h4, h5, h6')?.localName ?? null,
        text: s.querySelector('h1, h2, h3, h4, h5, h6')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      })),
    );
    const main = r.filter((s) => ['records', 'export', 'import', 'settings', 'excluded'].includes(s.id));
    assert.deepEqual(
      main.map((s) => s.id),
      ['records', 'export', 'import', 'settings', 'excluded'],
    );
    assert.deepEqual(
      main.map((s) => s.heading),
      ['h2', 'h2', 'h2', 'h2', 'h2'],
    );
  });

  test('h2 の文字は 記録・書き出し・取り込み・評価モードの設定・使わないサイト の順', async () => {
    const h2 = await page.evaluate(() => Array.from(document.querySelectorAll('h2')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(h2, ['記録', '書き出し', '取り込み', '評価モードの設定', '使わないサイト']);
  });

  test('見出しのレベルが飛ばない（h1 の次に h3 などが来ない）', async () => {
    const levels = await page.evaluate(() => Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((e) => Number(e.localName[1])));
    assert.equal(levels[0], 1, `最初の見出しが h1 ではありません：${JSON.stringify(levels)}`);
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i] <= levels[i - 1] + 1, `見出しのレベルが飛んでいます：${JSON.stringify(levels)}`);
    }
  });

  test('#status は role="status"', async () => {
    assert.equal(await page.locator('#status').getAttribute('role'), 'status');
  });

  test('すべてのフォームの部品にラベル（アクセシブルネーム）がある', async () => {
    const missing = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input, select, textarea'))
        .filter((el) => el.type !== 'hidden')
        .filter((el) => {
          const labelText = Array.from(el.labels || [])
            .map((l) => l.textContent)
            .join('')
            .trim();
          const aria = (el.getAttribute('aria-label') || '').trim();
          const by = (el.getAttribute('aria-labelledby') || '')
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent || '')
            .join('')
            .trim();
          return !labelText && !aria && !by;
        })
        .map((el) => `${el.localName}${el.id ? '#' + el.id : ''}[type=${el.type}]`),
    );
    assert.deepEqual(missing, []);
  });

  test('契約のラベルで部品が見つかる', async () => {
    for (const [label, id] of [
      ['評価モードを既定でオンにする', 'default-on'],
      ['URLの ? 以降と # 以降を削る', 'strip-query'],
      ['評価した人の名前（任意）', 'evaluator'],
      ['書き出したファイルを選ぶ', 'import-file'],
    ]) {
      const l = page.getByLabel(label, { exact: true });
      assert.equal(await l.count(), 1, `ラベル「${label}」の部品がありません`);
      assert.equal(await l.getAttribute('id'), id);
    }
    for (const id of ['filter-rating', 'filter-site', 'filter-source']) {
      assert.equal(await page.locator(`select#${id}`).count(), 1, `select#${id} がありません`);
    }
  });

  test('ボタンにアクセシブルネームがある', async () => {
    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((b) => !(b.getAttribute('aria-label') || b.textContent || '').trim() && !b.getAttribute('aria-labelledby'))
        .map((b) => b.outerHTML.slice(0, 80)),
    );
    assert.deepEqual(unnamed, []);
  });

  test('axe-core の違反が無い', async () => {
    assert.deepEqual(await axeViolations(page), []);
  });

  test('画像を表示した後も axe-core の違反が無い', async () => {
    const show = page.getByRole('button', { name: '画像を表示', exact: true });
    if ((await show.count()) > 0) await show.first().click();
    await page.waitForTimeout(300);
    assert.deepEqual(await axeViolations(page), []);
  });

  test('すべての操作できる部品に Tab キーで届き、フォーカスが見える', async () => {
    const all = await markFocusables(page);
    assert.ok(all.length >= 10, `部品が少なすぎます：${JSON.stringify(all)}`);
    const seen = await tabAround(page, all.length * 2 + 10);
    const missed = all.filter((_, i) => !seen.has(String(i)));
    assert.deepEqual(missed, [], 'Tab キーで届かない部品があります');
    const invisible = [...seen.values()]
      .filter((s) => !s.focusVisible || ((s.outlineStyle === 'none' || s.outlineWidth === 0) && (!s.boxShadow || s.boxShadow === 'none')))
      .map((s) => `${s.desc}：${JSON.stringify(s)}`);
    assert.deepEqual(invisible, [], 'フォーカスが見えない部品があります');
  });

  test('キーボードで絞り込みを変えられる', async () => {
    await page.locator('#filter-rating').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    const v = await page.locator('#filter-rating').inputValue();
    assert.equal(v, 'good', 'ArrowDown で「良い」が選ばれません');
    await page.selectOption('#filter-rating', 'all');
  });

  test('文字と背景のコントラスト比が 4.5 以上（大きい文字は 3 以上）', async () => {
    await injectPageHelpers(page);
    assert.deepEqual(await lowContrast(page), []);
  });
});

describe('ポップアップのアクセシビリティ（使わないサイトのボタン）', { timeout: 120000 }, () => {
  let h;
  let target;
  let tabId;
  let popup;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    target = await h.openFixture('simple.html');
    tabId = await h.tabIdFor(target);
    await h.enable(target);
    await waitForBoxCount(target, 3);
    popup = await openPopup(h, tabId);
  });

  after(async () => {
    await h?.close();
  });

  test('html の lang が ja', async () => {
    assert.equal(await popup.evaluate(() => document.documentElement.getAttribute('lang')), 'ja');
  });

  test('#exclude と #open-options はボタンとして名前が伝わる', async () => {
    assert.equal(await popup.getByRole('button', { name: 'このサイトでは評価モードを使わない', exact: true }).count(), 1);
    assert.equal(await popup.getByRole('button', { name: '記録と設定を開く', exact: true }).count(), 1);
  });

  test('すべての操作できる部品に Tab キーで届き、フォーカスが見える', async () => {
    const all = await markFocusables(popup);
    const seen = await tabAround(popup, all.length * 2 + 6);
    const missed = all.filter((_, i) => !seen.has(String(i)));
    assert.deepEqual(missed, [], 'Tab キーで届かない部品があります');
    const invisible = [...seen.values()]
      .filter((s) => !s.focusVisible || ((s.outlineStyle === 'none' || s.outlineWidth === 0) && (!s.boxShadow || s.boxShadow === 'none')))
      .map((s) => `${s.desc}：${JSON.stringify(s)}`);
    assert.deepEqual(invisible, []);
  });

  test('axe-core の違反が無い（登録前と登録後）', async () => {
    assert.deepEqual(await axeViolations(popup), []);
    await popup.locator('#exclude').click();
    await popup.waitForTimeout(500);
    assert.deepEqual(await axeViolations(popup), []);
  });

  test('文字と背景のコントラスト比が 4.5 以上（大きい文字は 3 以上）', async () => {
    await injectPageHelpers(popup);
    assert.deepEqual(await lowContrast(popup), []);
  });
});
