// 設定画面の記録の一覧（表、並び順、絞り込み、画像の表示、削除）のテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, waitFor, sleep } from './helpers/extension.mjs';
import {
  makeRecord,
  ownKey,
  importedKey,
  seedStorage,
  openOptions,
  reloadOptions,
  tableRows,
  captionText,
  statusText,
  clearStatus,
  waitStatus,
} from './helpers/options.mjs';

const COLUMNS = ['評価', '名前', 'ページ', '画像', '評価した人', '日時', '操作'];
const C = Object.fromEntries(COLUMNS.map((c, i) => [c, i]));

describe('設定画面の記録の一覧', { timeout: 180000 }, () => {
  let h;
  let page;
  let data;

  before(async () => {
    h = await launchExtension();
    const img = (n) => h.url(`img/${n}`);
    // 日時：own3（11/05）> imp1（11/04）> own2（11/03）> imp2（11/02）> own1（11/01）
    const own1 = makeRecord({
      pageUrl: 'https://a.example/page?q=1',
      pageTitle: 'Aのトップ',
      imageUrl: img('own1.png?v=1'),
      name: '会社のロゴ',
      alt: '会社のロゴ',
      rating: 'good',
      ratedAt: '2026-11-01T10:00:00.000Z',
    });
    const own2 = makeRecord({
      pageUrl: 'https://a.example/other',
      pageTitle: 'Aの別のページ',
      imageUrl: img('own2.png'),
      category: 'none',
      name: '',
      nameSource: 'none',
      altState: 'missing',
      alt: null,
      rating: 'poor',
      ratedAt: '2026-11-03T10:00:00.000Z',
    });
    const own3 = makeRecord({
      pageUrl: 'https://b.example/',
      pageTitle: 'Bのトップ',
      imageUrl: null,
      embedded: true,
      category: 'empty',
      name: '',
      nameSource: 'alt',
      altState: 'empty',
      alt: '',
      rating: 'good',
      ratedAt: '2026-11-05T10:00:00.000Z',
    });
    const imp1 = {
      ...makeRecord({
        pageUrl: 'https://b.example/news',
        pageTitle: 'Bのお知らせ',
        imageUrl: img('imp1.png'),
        name: '青い空',
        nameSource: 'aria-label',
        alt: null,
        altState: 'missing',
        rating: 'good',
        ratedAt: '2026-11-04T10:00:00.000Z',
      }),
      evaluator: '山田',
      importedAt: '2026-11-04T10:00:00.000Z',
    };
    const imp2 = {
      ...makeRecord({
        pageUrl: 'https://a.example/flowers',
        pageTitle: 'Aの花',
        imageUrl: img('imp2.png'),
        name: '赤い花',
        alt: '赤い花',
        rating: 'poor',
        ratedAt: '2026-11-02T10:00:00.000Z',
      }),
      evaluator: '',
      importedAt: '2026-11-02T10:00:00.000Z',
    };
    data = {
      own1: [ownKey(own1), own1],
      own2: [ownKey(own2), own2],
      own3: [ownKey(own3), own3],
      imp1: [importedKey('山田', imp1), imp1],
      imp2: [importedKey('', imp2), imp2],
    };
    await seedStorage(h, Object.fromEntries(Object.values(data)));
    page = await openOptions(h);
  });

  after(async () => {
    await h?.close();
  });

  const rowFor = (rows, nameText) => rows.find((r) => r[C['名前']] === nameText);

  test('caption に件数（「5件の記録」）を入れる', async () => {
    assert.equal(await captionText(page), '5件の記録');
  });

  test('列の見出しは th scope="col" で、評価・名前・ページ・画像・評価した人・日時・操作の順', async () => {
    const heads = await page.evaluate(() =>
      Array.from(document.querySelectorAll('table#records-table th[scope="col"]')).map((th) => th.textContent.replace(/\s+/g, ' ').trim()),
    );
    assert.deepEqual(heads, COLUMNS);
    const otherTh = await page.evaluate(() =>
      Array.from(document.querySelectorAll('table#records-table thead th')).filter((th) => th.getAttribute('scope') !== 'col').length,
    );
    assert.equal(otherTh, 0, 'thead に scope="col" の無い th があります');
  });

  test('行は日時の新しい順に並ぶ', async () => {
    const rows = await tableRows(page);
    assert.equal(rows.length, 5);
    assert.deepEqual(
      rows.map((r) => r[C['名前']]),
      [
        '読み上げられない画像（空のalt）',
        '名前：青い空（aria-labelから）',
        '名前なし（ファイル名が読み上げられる場合があります）',
        '名前：赤い花（altから）',
        '名前：会社のロゴ（altから）',
      ],
    );
  });

  test('評価は「○ 良い」「× 悪い」と文字でも表示する', async () => {
    const rows = await tableRows(page);
    const rating = (n) => rowFor(rows, n)[C['評価']].replace(/\s+/g, '');
    assert.equal(rating('名前：会社のロゴ（altから）'), '○良い');
    assert.equal(rating('名前：赤い花（altから）'), '×悪い');
    assert.equal(rating('名前なし（ファイル名が読み上げられる場合があります）'), '×悪い');
  });

  test('ページの列にタイトルと URL を表示し、http(s) の URL をリンクにする', async () => {
    const rows = await tableRows(page);
    const cell = rowFor(rows, '名前：会社のロゴ（altから）')[C['ページ']];
    assert.ok(cell.includes('Aのトップ'), `ページの列：${cell}`);
    assert.ok(cell.includes('https://a.example/page?q=1'), `ページの列：${cell}`);
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('table#records-table a[href]')).map((a) => a.getAttribute('href')),
    );
    assert.ok(hrefs.includes('https://a.example/page?q=1'), `リンク：${JSON.stringify(hrefs)}`);
  });

  test('評価した人は、自分の記録は「自分」、取り込んだ記録は evaluator（空なら「名前なし」）', async () => {
    const rows = await tableRows(page);
    assert.equal(rowFor(rows, '名前：会社のロゴ（altから）')[C['評価した人']], '自分');
    assert.equal(rowFor(rows, '読み上げられない画像（空のalt）')[C['評価した人']], '自分');
    assert.equal(rowFor(rows, '名前：青い空（aria-labelから）')[C['評価した人']], '山田');
    assert.equal(rowFor(rows, '名前：赤い花（altから）')[C['評価した人']], '名前なし');
  });

  test('埋め込みの画像は「埋め込みの画像」と表示し、「画像を表示」ボタンを置かない', async () => {
    const r = await page.evaluate(() => {
      const table = document.querySelector('table#records-table');
      const tr = Array.from(table.querySelectorAll('tr')).find((tr) => /読み上げられない画像（空のalt）/.test(tr.textContent));
      const cell = tr.cells[3];
      return {
        text: cell.textContent.replace(/\s+/g, ' ').trim(),
        buttons: cell.querySelectorAll('button').length,
      };
    });
    assert.equal(r.text, '埋め込みの画像');
    assert.equal(r.buttons, 0);
  });

  test('画像は最初は読み込まず、「画像を表示」を押した行だけ読み込む', async () => {
    const reqs = h.server.requests;
    const imgRequests = () => reqs.filter((p) => p.startsWith('/img/'));
    assert.deepEqual(imgRequests(), [], `押す前に画像を読み込みました：${JSON.stringify(imgRequests())}`);
    const imgCount = await page.evaluate(() => document.querySelectorAll('table#records-table img').length);
    assert.equal(imgCount, 0, '押す前に表に img があります');
    const showButtons = page.locator('table#records-table').getByRole('button', { name: '画像を表示', exact: true });
    assert.equal(await showButtons.count(), 4, '「画像を表示」ボタンが、埋め込みでない記録の数（4）だけありません');

    const row = page.locator('table#records-table tr').filter({ hasText: '名前：青い空（aria-labelから）' });
    await row.getByRole('button', { name: '画像を表示', exact: true }).click();
    await waitFor(() => imgRequests().includes('/img/imp1.png'), { message: '押した行の画像が読み込まれません' });
    await waitFor(() => row.locator('img').count().then((n) => n === 1), { message: '押した行に img が表示されません' });
    const src = await row.locator('img').getAttribute('src');
    assert.equal(src, h.url('img/imp1.png'));
    await sleep(300);
    assert.deepEqual(imgRequests(), ['/img/imp1.png'], 'ほかの行の画像まで読み込みました');
    assert.equal(await page.evaluate(() => document.querySelectorAll('table#records-table img').length), 1);
  });

  describe('絞り込み', () => {
    const names = async () => (await tableRows(page)).map((r) => r[C['名前']]);
    async function setFilters({ rating = 'all', site = 'all', source = 'all' }) {
      await page.selectOption('#filter-rating', rating);
      await page.selectOption('#filter-site', site);
      await page.selectOption('#filter-source', source);
      await sleep(200);
    }

    after(async () => {
      await setFilters({});
    });

    test('select の値が契約どおり', async () => {
      const values = await page.evaluate(() => {
        const v = (id) => Array.from(document.querySelectorAll(`select#${id} option`)).map((o) => o.value);
        return { rating: v('filter-rating'), site: v('filter-site'), source: v('filter-source') };
      });
      assert.deepEqual(values.rating, ['all', 'good', 'poor']);
      assert.deepEqual(values.source, ['all', 'own', 'imported']);
      assert.equal(values.site[0], 'all');
      assert.deepEqual([...values.site.slice(1)].sort(), ['a.example', 'b.example']);
    });

    test('評価で絞り込むと、行と caption の件数が変わる', async () => {
      await setFilters({ rating: 'good' });
      assert.deepEqual(await names(), ['読み上げられない画像（空のalt）', '名前：青い空（aria-labelから）', '名前：会社のロゴ（altから）']);
      assert.equal(await captionText(page), '3件の記録');
      await setFilters({ rating: 'poor' });
      assert.deepEqual(await names(), ['名前なし（ファイル名が読み上げられる場合があります）', '名前：赤い花（altから）']);
      assert.equal(await captionText(page), '2件の記録');
    });

    test('サイト（ホスト名）で絞り込める', async () => {
      await setFilters({ site: 'a.example' });
      assert.deepEqual(await names(), [
        '名前なし（ファイル名が読み上げられる場合があります）',
        '名前：赤い花（altから）',
        '名前：会社のロゴ（altから）',
      ]);
      assert.equal(await captionText(page), '3件の記録');
      await setFilters({ site: 'b.example' });
      assert.equal(await captionText(page), '2件の記録');
    });

    test('自分の記録と取り込んだ記録で絞り込める', async () => {
      await setFilters({ source: 'own' });
      assert.deepEqual(await names(), [
        '読み上げられない画像（空のalt）',
        '名前なし（ファイル名が読み上げられる場合があります）',
        '名前：会社のロゴ（altから）',
      ]);
      await setFilters({ source: 'imported' });
      assert.deepEqual(await names(), ['名前：青い空（aria-labelから）', '名前：赤い花（altから）']);
      assert.equal(await captionText(page), '2件の記録');
    });

    test('絞り込みを組み合わせられる', async () => {
      await setFilters({ rating: 'poor', site: 'a.example', source: 'imported' });
      assert.deepEqual(await names(), ['名前：赤い花（altから）']);
      assert.equal(await captionText(page), '1件の記録');
    });
  });

  describe('削除', () => {
    test('削除ボタンのアクセシブルネームに、行の名前を含める', async () => {
      const names = await page.evaluate(() =>
        Array.from(document.querySelectorAll('table#records-table button')).map((b) => ({
          text: b.textContent.replace(/\s+/g, ' ').trim(),
          label: b.getAttribute('aria-label'),
        })),
      );
      assert.equal(await page.getByRole('button', { name: /^削除：会社のロゴ/ }).count(), 1, `ボタン：${JSON.stringify(names)}`);
      assert.equal(await page.getByRole('button', { name: /^削除：青い空/ }).count(), 1, `ボタン：${JSON.stringify(names)}`);
      assert.equal(await page.getByRole('button', { name: /^削除：赤い花/ }).count(), 1, `ボタン：${JSON.stringify(names)}`);
    });

    test('取り込んだ記録を削除すると、i: のキーが消え、表と caption が更新され、#status に表示する', async () => {
      assert.equal(await page.locator('#status').getAttribute('role'), 'status');
      await clearStatus(page);
      await page.getByRole('button', { name: /^削除：青い空/ }).click();
      await waitFor(async () => !(data.imp1[0] in (await h.storageAll())), { message: 'i: のキーが消えません' });
      await waitFor(async () => (await captionText(page)) === '4件の記録', { message: 'caption が「4件の記録」になりません' });
      const rows = await tableRows(page);
      assert.equal(rows.find((r) => r[C['名前']] === '名前：青い空（aria-labelから）'), undefined);
      await waitStatus(page, (s) => s !== '', '#status に削除の結果が表示されません');
      // ほかの記録は消えない
      const all = await h.storageAll();
      for (const k of ['own1', 'own2', 'own3', 'imp2']) assert.ok(data[k][0] in all, `${k} が消えました`);
    });

    test('自分の記録を削除すると、r: のキーが消える', async () => {
      await page.getByRole('button', { name: /^削除：会社のロゴ/ }).click();
      await waitFor(async () => !(data.own1[0] in (await h.storageAll())), { message: 'r: のキーが消えません' });
      await waitFor(async () => (await captionText(page)) === '3件の記録', { message: 'caption が「3件の記録」になりません' });
    });

    test('記録がすべて無くなると、表の代わりに「記録はまだありません」と表示する', async () => {
      await h.swEval(async () => {
        const all = await chrome.storage.local.get(null);
        await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('r:') || k.startsWith('i:')));
      });
      await reloadOptions(page);
      const r = await page.evaluate(() => {
        const t = document.querySelector('table#records-table');
        return {
          text: document.querySelector('section#records')?.innerText || '',
          tableShown: !!t && t.checkVisibility(),
        };
      });
      assert.match(r.text, /記録はまだありません/);
      assert.equal(r.tableShown, false, '記録が無いのに表が表示されています');
    });
  });
});

describe('設定画面の記録の一覧：リンクと文字の扱い', { timeout: 120000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    const own = makeRecord({
      pageUrl: 'file:///home/user/secret.html',
      pageTitle: 'ローカルのファイル',
      imageUrl: 'file:///home/user/a.png',
      name: 'ローカルの画像',
      ratedAt: '2026-11-02T00:00:00.000Z',
    });
    const evil = {
      ...makeRecord({
        pageUrl: 'javascript:window.__pwned=1',
        pageTitle: '<img src=x onerror="window.__pwned=1">タイトル',
        imageUrl: 'javascript:window.__pwned=2',
        linkUrl: 'javascript:window.__pwned=3',
        name: '<script>window.__pwned=4</script>名前',
        alt: '<b>太字</b>',
        ratedAt: '2026-11-03T00:00:00.000Z',
      }),
      evaluator: '<i onmouseover="window.__pwned=5">悪い人</i>',
      importedAt: '2026-11-03T00:00:00.000Z',
    };
    await seedStorage(h, {
      [ownKey(own)]: own,
      [importedKey(evil.evaluator, evil)]: evil,
    });
    page = await openOptions(h);
  });

  after(async () => {
    await h?.close();
  });

  test('http: と https: 以外の URL はリンクにしない（file:、javascript:）', async () => {
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')));
    const bad = hrefs.filter((h) => /^\s*(javascript|file|data):/i.test(h));
    assert.deepEqual(bad, [], `リンクになっています：${JSON.stringify(bad)}`);
    const text = await page.evaluate(() => document.querySelector('table#records-table').textContent);
    assert.ok(text.includes('file:///home/user/secret.html'), 'URL が文字として表示されていません');
  });

  test('タイトル・名前・評価した人の HTML は文字として表示し、実行しない', async () => {
    const rows = await tableRows(page);
    const evilRow = rows.find((r) => r.join(' ').includes('名前'));
    assert.ok(evilRow, `行：${JSON.stringify(rows)}`);
    const all = rows.flat().join('\n');
    assert.ok(all.includes('<img src=x onerror="window.__pwned=1">タイトル'), `タイトルが文字として表示されません：${all}`);
    assert.ok(all.includes('<script>window.__pwned=4</script>名前'), `名前が文字として表示されません：${all}`);
    assert.ok(all.includes('<i onmouseover="window.__pwned=5">悪い人</i>'), `評価した人が文字として表示されません：${all}`);
    const injected = await page.evaluate(() => ({
      img: document.querySelectorAll('table#records-table img').length,
      script: document.querySelectorAll('table#records-table script').length,
      i: document.querySelectorAll('table#records-table i[onmouseover]').length,
    }));
    assert.deepEqual(injected, { img: 0, script: 0, i: 0 });
    // マウスを重ね、画像を表示しても実行されない
    await page.locator('table#records-table').hover();
    const buttons = page.locator('table#records-table').getByRole('button', { name: '画像を表示', exact: true });
    for (let i = 0; i < (await buttons.count()); i++) await buttons.nth(i).click().catch(() => {});
    await sleep(500);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'ページの文字が実行されました');
  });

  test('javascript: の画像 URL を img に読み込まない', async () => {
    const srcs = await page.evaluate(() => Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src')));
    assert.deepEqual(
      srcs.filter((s) => /^\s*javascript:/i.test(s || '')),
      [],
    );
  });
});
