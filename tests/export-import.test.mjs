// 設定画面の書き出しと取り込みのテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchExtension, waitFor, sleep } from './helpers/extension.mjs';
import {
  RECORD_FIELDS,
  makeRecord,
  ownKey,
  importedKey,
  pickRecord,
  seedStorage,
  openOptions,
  reloadOptions,
  readSettings,
  clearStatus,
  waitStatus,
  tableRows,
} from './helpers/options.mjs';

const ymd = (d, utc) =>
  utc
    ? `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
    : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

const strip = (u) => (u == null ? u : u.replace(/[?#].*$/, ''));

describe('書き出し', { timeout: 180000 }, () => {
  let h;
  let page;
  const ownA1 = makeRecord({
    pageUrl: 'https://a.example/page?q=secret',
    pageTitle: 'Aのページ',
    imageUrl: 'https://a.example/img/1.png?sig=abc#x',
    linkUrl: 'https://a.example/link?x=1#y',
    name: 'Aの画像1',
    ratedAt: '2026-11-01T00:00:00.000Z',
  });
  const ownA2 = makeRecord({
    pageUrl: 'https://a.example/other',
    pageTitle: 'Aの別のページ',
    imageUrl: null,
    embedded: true,
    category: 'empty',
    name: '',
    nameSource: 'alt',
    altState: 'empty',
    alt: '',
    rating: 'poor',
    ratedAt: '2026-11-02T00:00:00.000Z',
  });
  const ownB1 = makeRecord({
    pageUrl: 'https://b.example/p?id=3',
    pageTitle: 'Bのページ',
    imageUrl: 'https://cdn.example/b.png#frag',
    name: 'Bの画像',
    ratedAt: '2026-11-03T00:00:00.000Z',
  });
  const impA = {
    ...makeRecord({ pageUrl: 'https://a.example/imported', name: '取り込んだ画像', ratedAt: '2026-11-04T00:00:00.000Z' }),
    evaluator: '山田',
    importedAt: '2026-11-04T00:00:00.000Z',
  };

  before(async () => {
    h = await launchExtension();
    await seedStorage(h, {
      [ownKey(ownA1)]: ownA1,
      [ownKey(ownA2)]: ownA2,
      [ownKey(ownB1)]: ownB1,
      [importedKey('山田', impA)]: impA,
      settings: { defaultOn: false, excludedSites: [], exportedSites: ['b.example'] },
    });
    page = await openOptions(h);
  });

  after(async () => {
    await h?.close();
  });

  const siteBoxes = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('section#export fieldset#export-sites input[type="checkbox"]')).map((cb) => ({
        value: cb.value,
        checked: cb.checked,
        label: Array.from(cb.labels || [])
          .map((l) => l.textContent)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      })),
    );

  async function setSites(values) {
    const boxes = await siteBoxes();
    for (const b of boxes) {
      const cb = page.locator(`fieldset#export-sites input[type="checkbox"][value="${b.value}"]`);
      if (values.includes(b.value)) await cb.check();
      else await cb.uncheck();
    }
  }

  async function doExport() {
    const started = new Date();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator('#export-button').click()]);
    const file = await download.path();
    const text = fs.readFileSync(file, 'utf8');
    return { download, json: JSON.parse(text), started, ended: new Date() };
  }

  test('fieldset#export-sites に legend「書き出すサイト」がある', async () => {
    const legend = await page.evaluate(() =>
      document.querySelector('section#export fieldset#export-sites > legend')?.textContent.replace(/\s+/g, ' ').trim(),
    );
    assert.equal(legend, '書き出すサイト');
  });

  test('サイトごとのチェックボックスのラベルは「ホスト名（N件）」で、件数は自分の記録だけを数える', async () => {
    const boxes = await siteBoxes();
    const a = boxes.find((b) => b.value === 'a.example');
    const b = boxes.find((b) => b.value === 'b.example');
    assert.ok(a && b, `チェックボックス：${JSON.stringify(boxes)}`);
    assert.equal(a.label, 'a.example（2件）');
    assert.equal(b.label, 'b.example（1件）');
    assert.equal(await page.getByRole('checkbox', { name: 'a.example（2件）', exact: true }).count(), 1);
  });

  test('settings.exportedSites にあるサイトだけ、最初からチェックが付いている', async () => {
    const boxes = await siteBoxes();
    assert.equal(boxes.find((b) => b.value === 'a.example').checked, false);
    assert.equal(boxes.find((b) => b.value === 'b.example').checked, true);
  });

  test('#strip-query（ラベル「URLの ? 以降と # 以降を削る」）は最初からチェックが付いている', async () => {
    const cb = page.getByLabel('URLの ? 以降と # 以降を削る', { exact: true });
    assert.equal(await cb.count(), 1, 'ラベルで見つかりません');
    assert.equal(await cb.getAttribute('id'), 'strip-query');
    assert.equal(await cb.isChecked(), true);
  });

  test('#evaluator（ラベル「評価した人の名前（任意）」）のテキスト入力と、「書き出す」ボタンがある', async () => {
    const input = page.getByLabel('評価した人の名前（任意）', { exact: true });
    assert.equal(await input.count(), 1);
    assert.equal(await input.getAttribute('id'), 'evaluator');
    const type = (await input.getAttribute('type')) || 'text';
    assert.equal(type, 'text');
    const button = page.locator('button#export-button');
    assert.equal(await button.count(), 1);
    assert.equal((await button.textContent()).trim(), '書き出す');
  });

  test('サイトを1つも選ばないと、ダウンロードせず「書き出すサイトを選んでください」と表示する', async () => {
    await setSites([]);
    await clearStatus(page);
    let downloaded = false;
    const onDownload = () => {
      downloaded = true;
    };
    page.on('download', onDownload);
    await page.locator('#export-button').click();
    await waitStatus(page, (s) => s.includes('書き出すサイトを選んでください'), '「書き出すサイトを選んでください」が表示されません');
    await sleep(1000);
    page.off('download', onDownload);
    assert.equal(downloaded, false, 'ダウンロードされました');
    assert.deepEqual((await readSettings(h)).exportedSites, ['b.example'], 'settings.exportedSites が変わりました');
  });

  test('チェックしたサイトの自分の記録だけを、契約の形式・ファイル名で書き出し、? 以降と # 以降を削る', async () => {
    await setSites(['a.example']);
    await page.locator('#evaluator').fill('テスト太郎');
    const { download, json, started, ended } = await doExport();
    const name = download.suggestedFilename();
    assert.match(name, /^alt-tsushinbo-\d{8}\.json$/);
    const dates = new Set([ymd(started), ymd(started, true), ymd(ended), ymd(ended, true)]);
    assert.ok(dates.has(name.slice(14, 22)), `ファイル名の日付が今日ではありません：${name}`);

    assert.deepEqual(Object.keys(json).sort(), ['evaluator', 'exportedAt', 'format', 'records', 'version']);
    assert.equal(json.format, 'alt-tsushinbo');
    assert.equal(json.version, 1);
    assert.equal(json.evaluator, 'テスト太郎');
    assert.equal(typeof json.exportedAt, 'string');
    assert.equal(new Date(json.exportedAt).toISOString(), json.exportedAt, 'exportedAt が ISO 8601 ではありません');
    const t = Date.parse(json.exportedAt);
    assert.ok(t >= started.getTime() - 1000 && t <= ended.getTime() + 1000, `exportedAt が書き出した時刻ではありません：${json.exportedAt}`);

    assert.ok(Array.isArray(json.records));
    assert.equal(json.records.length, 2, `記録：${JSON.stringify(json.records)}`);
    for (const r of json.records) assert.deepEqual(Object.keys(r).sort(), [...RECORD_FIELDS].sort());
    const byName = Object.fromEntries(json.records.map((r) => [r.name, r]));
    assert.deepEqual(byName['Aの画像1'], {
      ...pickRecord(ownA1),
      pageUrl: 'https://a.example/page',
      imageUrl: 'https://a.example/img/1.png',
      linkUrl: 'https://a.example/link',
    });
    assert.deepEqual(byName[''], pickRecord(ownA2));
    const text = JSON.stringify(json);
    assert.ok(!text.includes('取り込んだ画像'), '取り込んだ記録が書き出されました');
    assert.ok(!text.includes('b.example'), 'チェックしていないサイトが書き出されました');
    assert.ok(!text.includes('secret') && !text.includes('sig=abc'), '? 以降が残っています');
  });

  test('書き出したら、settings.exportedSites を今回チェックしたサイトにし、#status に表示する', async () => {
    await waitFor(async () => JSON.stringify((await readSettings(h))?.exportedSites) === JSON.stringify(['a.example']), {
      message: 'settings.exportedSites が ["a.example"] になりません',
    }).catch(async (e) => {
      throw new Error(`${e.message}（settings：${JSON.stringify(await readSettings(h))}）`);
    });
    await waitStatus(page, (s) => s !== '' && !s.includes('書き出すサイトを選んでください'), '#status に書き出しの結果が表示されません');
  });

  test('#strip-query のチェックを外すと、URL をそのまま書き出す', async () => {
    await setSites(['a.example', 'b.example']);
    await page.locator('#strip-query').uncheck();
    await page.locator('#evaluator').fill('');
    const { json } = await doExport();
    assert.equal(json.evaluator, '');
    assert.equal(json.records.length, 3);
    const byName = Object.fromEntries(json.records.map((r) => [r.name, r]));
    assert.deepEqual(byName['Aの画像1'], pickRecord(ownA1));
    assert.deepEqual(byName['Bの画像'], pickRecord(ownB1));
    await waitFor(async () => JSON.stringify([...((await readSettings(h))?.exportedSites || [])].sort()) === '["a.example","b.example"]', {
      message: 'settings.exportedSites が ["a.example","b.example"] になりません',
    });
  });

  test('開き直すと、前回書き出したサイトにチェックが付いている', async () => {
    await h.swEval(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, exportedSites: ['a.example'] } });
    });
    await reloadOptions(page);
    const boxes = await siteBoxes();
    assert.deepEqual(
      boxes.map((b) => [b.value, b.checked]).sort(),
      [
        ['a.example', true],
        ['b.example', false],
      ],
    );
    assert.equal(await page.locator('#strip-query').isChecked(), true, '開き直した時に #strip-query のチェックが付いていません');
  });
});

describe('取り込み', { timeout: 180000 }, () => {
  let h;
  let page;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    page = await openOptions(h);
  });

  after(async () => {
    await h?.close();
  });

  const imported = async () => Object.fromEntries(Object.entries(await h.storageAll()).filter(([k]) => k.startsWith('i:')));

  async function importFile(content, name = 'records.json') {
    await clearStatus(page);
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content));
    await page.locator('#import-file').setInputFiles({ name, mimeType: 'application/json', buffer });
    return waitStatus(page, (s) => s !== '', '#status に取り込みの結果が表示されません');
  }

  const fileOf = (records, extra = {}) => ({
    format: 'alt-tsushinbo',
    version: 1,
    exportedAt: '2026-11-07T09:00:00.000Z',
    evaluator: '佐藤',
    records,
    ...extra,
  });

  test('input#import-file は type="file"、accept=".json,application/json"、ラベル「書き出したファイルを選ぶ」', async () => {
    const input = page.getByLabel('書き出したファイルを選ぶ', { exact: true });
    assert.equal(await input.count(), 1, 'ラベルで見つかりません');
    assert.equal(await input.getAttribute('id'), 'import-file');
    assert.equal(await input.getAttribute('type'), 'file');
    assert.equal(await input.getAttribute('accept'), '.json,application/json');
    assert.equal(await page.locator('section#import #import-file').count(), 1, 'section#import の中にありません');
  });

  test('正しいファイルの記録を i: のキーで、evaluator と importedAt を加えて保存する', async () => {
    const r1 = makeRecord({ pageUrl: 'https://x.example/a', name: '取り込み1', ratedAt: '2026-10-01T00:00:00.000Z' });
    const r2 = makeRecord({
      pageUrl: 'https://x.example/b',
      imageUrl: null,
      embedded: true,
      category: 'none',
      name: '',
      nameSource: 'none',
      altState: 'missing',
      alt: null,
      rating: 'poor',
      ratedAt: '2026-10-02T00:00:00.000Z',
    });
    const before = Date.now();
    const status = await importFile(fileOf([r1, r2]));
    assert.match(status, /^2件を取り込みました/, `#status：${status}`);
    const all = await imported();
    const k1 = importedKey('佐藤', r1);
    const k2 = importedKey('佐藤', r2);
    assert.deepEqual(Object.keys(all).sort(), [k1, k2].sort());
    for (const [k, r] of [
      [k1, r1],
      [k2, r2],
    ]) {
      const v = all[k];
      assert.deepEqual(Object.keys(v).sort(), [...RECORD_FIELDS, 'evaluator', 'importedAt'].sort(), `値の項目：${JSON.stringify(v)}`);
      assert.deepEqual(pickRecord(v), pickRecord(r));
      assert.equal(v.evaluator, '佐藤');
      assert.equal(new Date(v.importedAt).toISOString(), v.importedAt, 'importedAt が ISO 8601 ではありません');
      assert.ok(Date.parse(v.importedAt) >= before - 1000);
    }
    // 自分の記録（r:）は作らない
    assert.deepEqual(Object.keys(await h.storageAll()).filter((k) => k.startsWith('r:')), []);
  });

  test('取り込んだ記録は表に表示され、評価した人は evaluator', async () => {
    await waitFor(async () => ((await tableRows(page)) || []).length === 2, { message: '表に取り込んだ記録が表示されません' }).catch(
      async () => {
        await reloadOptions(page);
      },
    );
    const rows = await tableRows(page);
    assert.equal(rows.length, 2);
    for (const r of rows) assert.equal(r[4], '佐藤');
  });

  test('形式が合わない記録は取り込まず、「N件を取り込みました。M件は形式が合わないため取り込みませんでした」と表示する', async () => {
    await h.clearStorage();
    const good = makeRecord({ pageUrl: 'https://y.example/ok', name: '正しい記録' });
    const bad1 = makeRecord({ pageUrl: 'javascript:alert(1)', name: '悪い1' });
    const bad2 = makeRecord({ pageUrl: 'https://y.example/r', rating: 'fair', name: '悪い2' });
    const bad3 = makeRecord({ pageUrl: 'https://y.example/t', name: 'あ'.repeat(1001) });
    const status = await importFile(fileOf([good, bad1, bad2, bad3]));
    assert.equal(status, '1件を取り込みました。3件は形式が合わないため取り込みませんでした');
    const all = await imported();
    assert.deepEqual(Object.keys(all), [importedKey('佐藤', good)]);
  });

  describe('1件ごとの検証（契約の表）', () => {
    const base = () => makeRecord({ pageUrl: 'https://z.example/p', name: '検証' });
    const cases = [
      ['pageUrl が javascript:', { pageUrl: 'javascript:window.__pwned=1' }],
      ['pageUrl が data:', { pageUrl: 'data:text/html,<p>x</p>' }],
      ['pageUrl が null', { pageUrl: null }],
      ['pageUrl が2,001文字', { pageUrl: 'https://z.example/' + 'a'.repeat(2001 - 18) }],
      ['imageUrl が javascript:', { imageUrl: 'javascript:window.__pwned=1' }],
      ['imageUrl が2,001文字', { imageUrl: 'https://z.example/' + 'a'.repeat(2001 - 18) }],
      ['imageUrl が数値', { imageUrl: 1 }],
      ['linkUrl が javascript:', { linkUrl: 'javascript:window.__pwned=1' }],
      ['linkUrl が ftp:', { linkUrl: 'ftp://z.example/' }],
      ['pageTitle が1,001文字', { pageTitle: 'あ'.repeat(1001) }],
      ['pageTitle が null', { pageTitle: null }],
      ['name が1,001文字', { name: 'あ'.repeat(1001) }],
      ['name が数値', { name: 1 }],
      ['alt が5,001文字', { alt: 'あ'.repeat(5001) }],
      ['alt が数値', { alt: 0 }],
      ['embedded が文字列', { embedded: 'false' }],
      ['category が不明', { category: 'decorative' }],
      ['nameSource が不明', { nameSource: 'figcaption' }],
      ['altState が不明', { altState: 'blank' }],
      ['rating が fair', { rating: 'fair' }],
      ['ratedAt が51文字', { ratedAt: '2'.repeat(51) }],
      ['ratedAt が数値', { ratedAt: 20261107 }],
    ];
    for (const [label, over] of cases) {
      test(`${label} の記録は取り込まない`, async () => {
        await h.clearStorage();
        const ok = base();
        const bad = { ...base(), name: '不正', ...over };
        const status = await importFile(fileOf([ok, bad]));
        assert.equal(status, '1件を取り込みました。1件は形式が合わないため取り込みませんでした');
        assert.equal(Object.keys(await imported()).length, 1);
      });
    }

    test('上限ちょうどの長さ、null の imageUrl・linkUrl・alt は取り込む', async () => {
      await h.clearStorage();
      const r = makeRecord({
        pageUrl: 'https://z.example/' + 'a'.repeat(2000 - 18),
        imageUrl: null,
        linkUrl: null,
        alt: null,
        pageTitle: 'あ'.repeat(1000),
        name: 'い'.repeat(1000),
        ratedAt: '2'.repeat(50),
      });
      const r2 = makeRecord({
        imageUrl: 'http://z.example/' + 'b'.repeat(2000 - 17),
        linkUrl: 'https://z.example/' + 'c'.repeat(2000 - 18),
        alt: 'う'.repeat(5000),
        name: '長いalt',
      });
      const status = await importFile(fileOf([r, r2]));
      assert.match(status, /^2件を取り込みました/);
      assert.equal(Object.keys(await imported()).length, 2);
    });
  });

  describe('ファイル全体の形式が合わない時', () => {
    const valid = () => [makeRecord({ pageUrl: 'https://w.example/', name: '入らない記録' })];
    const cases = [
      ['JSON でない', '{ これは JSON ではない'],
      ['format が違う', fileOf(valid(), { format: 'other' })],
      ['format が無い', (() => { const f = fileOf(valid()); delete f.format; return f; })()],
      ['version が 2', fileOf(valid(), { version: 2 })],
      ['version が文字列の "1"', fileOf(valid(), { version: '1' })],
      ['records が配列でない', fileOf({ 0: valid()[0] })],
      ['records が無い', (() => { const f = fileOf(valid()); delete f.records; return f; })()],
      ['JSON の配列', valid()],
      ['5MB を超える', null],
    ];
    for (const [label, content] of cases) {
      test(`${label}：何も保存せず「このファイルは取り込めません」と表示する`, async () => {
        await h.clearStorage();
        let c = content;
        if (c === null) {
          // 正しい形式のまま、空白で 5MB を超えさせる
          const json = JSON.stringify(fileOf(valid()));
          c = Buffer.from(json.slice(0, -1) + ' '.repeat(5 * 1024 * 1024 + 10) + '}');
        }
        const status = await importFile(c);
        assert.ok(status.includes('このファイルは取り込めません'), `#status：${status}`);
        assert.deepEqual(Object.keys(await h.storageAll()).filter((k) => k.startsWith('i:') || k.startsWith('r:')), []);
      });
    }
  });

  describe('ファイルの evaluator', () => {
    const rec = () => makeRecord({ pageUrl: 'https://v.example/', name: '評価者の確認' });
    const cases = [
      ['100文字なら使う', 'あ'.repeat(100), 'あ'.repeat(100)],
      ['101文字なら空文字列にする', 'あ'.repeat(101), ''],
      ['数値なら空文字列にする', 123, ''],
      ['無ければ空文字列にする', undefined, ''],
    ];
    for (const [label, value, expected] of cases) {
      test(label, async () => {
        await h.clearStorage();
        const f = fileOf([rec()], { evaluator: value });
        if (value === undefined) delete f.evaluator;
        await importFile(f);
        const all = await imported();
        assert.deepEqual(Object.keys(all), [importedKey(expected, rec())]);
        assert.equal(Object.values(all)[0].evaluator, expected);
      });
    }
  });

  describe('取り込んだ文字の安全な表示', () => {
    test('HTML やスクリプトを含む文字は、表に文字として表示し、実行しない', async () => {
      await h.clearStorage();
      await reloadOptions(page);
      const evil = makeRecord({
        pageUrl: 'https://evil.example/?q=<script>window.__pwned=1</script>',
        pageTitle: '<img src=x onerror="window.__pwned=2">タイトル',
        name: '<script>window.__pwned=3</script>名前',
        alt: '<svg onload="window.__pwned=4">',
        imageUrl: h.url('img/x.png') + '?" onerror="window.__pwned=5',
      });
      const bad = makeRecord({ pageUrl: 'javascript:window.__pwned=6', name: 'javascript の記録' });
      const status = await importFile(fileOf([evil, bad], { evaluator: '<b onclick="window.__pwned=7">悪い人</b>' }));
      assert.equal(status, '1件を取り込みました。1件は形式が合わないため取り込みませんでした');
      await waitFor(async () => ((await tableRows(page)) || []).length === 1, { message: '表に表示されません' }).catch(async () => {
        await reloadOptions(page);
      });
      const all = (await tableRows(page)).flat().join('\n');
      assert.ok(all.includes('<img src=x onerror="window.__pwned=2">タイトル'), `表の文字：${all}`);
      assert.ok(all.includes('<script>window.__pwned=3</script>名前'), `表の文字：${all}`);
      assert.ok(all.includes('<b onclick="window.__pwned=7">悪い人</b>'), `表の文字：${all}`);
      const show = page.locator('table#records-table').getByRole('button', { name: '画像を表示', exact: true });
      if ((await show.count()) > 0) await show.first().click();
      await page.locator('table#records-table').hover();
      await sleep(500);
      const r = await page.evaluate(() => ({
        pwned: window.__pwned,
        injected: document.querySelectorAll('table#records-table script, table#records-table svg[onload], table#records-table b[onclick], table#records-table img[onerror]').length,
        jsLinks: Array.from(document.querySelectorAll('a[href]')).filter((a) => /^\s*javascript:/i.test(a.getAttribute('href'))).length,
      }));
      assert.deepEqual(r, { pwned: undefined, injected: 0, jsLinks: 0 });
    });
  });
});
