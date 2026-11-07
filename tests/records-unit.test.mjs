// src/lib/records.js の buildExport と validateImport の単体のテスト
// records.js は chrome.* に依存しない純粋な ES モジュールの想定なので、まず Node で import する。
// Node で読み込めない場合（chrome のグローバルに依存するなど）は、拡張機能の設定画面の中で import して呼び出す。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, launchExtension } from './helpers/extension.mjs';
import { RECORD_FIELDS, makeRecord, pickRecord, optionsUrl } from './helpers/options.mjs';

describe('records.js（buildExport・validateImport）', { timeout: 120000 }, () => {
  let mode;
  let mod;
  let h;
  let page;

  before(async () => {
    try {
      mod = await import(pathToFileURL(path.join(REPO_ROOT, 'src', 'lib', 'records.js')).href);
      if (typeof mod.buildExport !== 'function' || typeof mod.validateImport !== 'function') throw new Error('export がありません');
      mode = 'node';
    } catch {
      h = await launchExtension();
      page = await h.context.newPage();
      await page.goto(optionsUrl(h), { waitUntil: 'load' });
      mode = 'page';
    }
  });

  after(async () => {
    await h?.close();
  });

  /**
   * buildExport を呼ぶ。now は ISO の文字列で渡し、呼ぶ側で Date にする。
   * 契約は records の要素の形を決めていない。実装は一覧の取得（listRecords）の結果の形、
   * つまり記録の値に source: 'own' | 'imported' を加えたものを受け取るため、自分の記録として source: 'own' を加えて渡す。
   */
  async function buildExport(records, { sites, stripQuery, evaluator, now }) {
    records = records.map((r) => ('source' in r ? r : { ...r, source: 'own' }));
    if (mode === 'node') return JSON.parse(JSON.stringify(mod.buildExport(records, { sites, stripQuery, evaluator, now: new Date(now) })));
    return page.evaluate(
      async ({ records, sites, stripQuery, evaluator, now }) => {
        const m = await import('/src/lib/records.js');
        return JSON.parse(JSON.stringify(await m.buildExport(records, { sites, stripQuery, evaluator, now: new Date(now) })));
      },
      { records, sites, stripQuery, evaluator, now },
    );
  }

  async function validateImport(data) {
    if (mode === 'node') return JSON.parse(JSON.stringify(mod.validateImport(data)));
    return page.evaluate(async (data) => {
      const m = await import('/src/lib/records.js');
      return JSON.parse(JSON.stringify(await m.validateImport(data)));
    }, data);
  }

  describe('buildExport', () => {
    const NOW = '2026-11-07T09:00:00.000Z';
    const a1 = makeRecord({
      pageUrl: 'https://a.example/page?q=secret#top',
      imageUrl: 'https://a.example/img.png?sig=1#f',
      linkUrl: 'https://a.example/link#frag',
      name: 'A1',
    });
    const a2 = makeRecord({ pageUrl: 'https://a.example/x', imageUrl: null, embedded: true, linkUrl: null, name: '' });
    const b1 = makeRecord({ pageUrl: 'http://b.example/p?id=3', imageUrl: 'https://cdn.example/b.png', name: 'B1' });
    const sub = makeRecord({ pageUrl: 'https://docs.a.example/', name: 'サブドメイン' });

    test('契約の形のオブジェクトを返す（format・version・exportedAt・evaluator・records）', async () => {
      const r = await buildExport([a1], { sites: ['a.example'], stripQuery: true, evaluator: '山田', now: NOW });
      assert.deepEqual(Object.keys(r).sort(), ['evaluator', 'exportedAt', 'format', 'records', 'version']);
      assert.equal(r.format, 'alt-tsushinbo');
      assert.equal(r.version, 1);
      assert.equal(r.exportedAt, NOW);
      assert.equal(r.evaluator, '山田');
      assert.equal(r.records.length, 1);
      assert.deepEqual(Object.keys(r.records[0]).sort(), [...RECORD_FIELDS].sort());
    });

    test('sites のホスト名のサイトの記録だけを入れる（サブドメインは別のサイト）', async () => {
      const r = await buildExport([a1, a2, b1, sub], { sites: ['a.example'], stripQuery: false, evaluator: '', now: NOW });
      assert.deepEqual(r.records.map((x) => x.name).sort(), ['', 'A1']);
      const r2 = await buildExport([a1, a2, b1, sub], { sites: ['b.example', 'docs.a.example'], stripQuery: false, evaluator: '', now: NOW });
      assert.deepEqual(r2.records.map((x) => x.name).sort(), ['B1', 'サブドメイン']);
      const r3 = await buildExport([a1, b1], { sites: [], stripQuery: false, evaluator: '', now: NOW });
      assert.deepEqual(r3.records, []);
    });

    test('stripQuery が true なら、pageUrl・imageUrl・linkUrl の ? 以降と # 以降を削る', async () => {
      const r = await buildExport([a1, a2, b1], { sites: ['a.example', 'b.example'], stripQuery: true, evaluator: '', now: NOW });
      const by = Object.fromEntries(r.records.map((x) => [x.name, x]));
      assert.deepEqual(by.A1, {
        ...pickRecord(a1),
        pageUrl: 'https://a.example/page',
        imageUrl: 'https://a.example/img.png',
        linkUrl: 'https://a.example/link',
      });
      assert.deepEqual(by[''], pickRecord(a2), 'null の imageUrl・linkUrl が null のままではありません');
      assert.equal(by.B1.pageUrl, 'http://b.example/p');
    });

    test('stripQuery が false なら、URL をそのまま入れる', async () => {
      const r = await buildExport([a1, b1], { sites: ['a.example', 'b.example'], stripQuery: false, evaluator: '', now: NOW });
      const by = Object.fromEntries(r.records.map((x) => [x.name, x]));
      assert.deepEqual(by.A1, pickRecord(a1));
      assert.deepEqual(by.B1, pickRecord(b1));
    });

    test('記録に余分な項目があっても、決めた項目だけを入れる', async () => {
      const extra = { ...a1, source: 'own', secret: 'x', key: 'r:x' };
      const r = await buildExport([extra], { sites: ['a.example'], stripQuery: false, evaluator: '', now: NOW });
      assert.deepEqual(Object.keys(r.records[0]).sort(), [...RECORD_FIELDS].sort());
    });

    test('取り込んだ記録（source: "imported"）は入れない', async () => {
      const imp = { ...b1, name: '取り込み', evaluator: '他の人', importedAt: NOW, source: 'imported' };
      const r = await buildExport([a1, imp], { sites: ['a.example', 'b.example'], stripQuery: false, evaluator: '', now: NOW });
      assert.deepEqual(r.records.map((x) => x.name), ['A1']);
    });

    test('element（svg・role-img・input-image）をそのまま書き出す', async () => {
      const svg = makeRecord({
        pageUrl: 'https://a.example/icons',
        element: 'svg',
        imageUrl: null,
        embedded: true,
        name: '検索',
        nameSource: 'svg-title',
        alt: null,
        altState: 'missing',
      });
      const ri = makeRecord({ pageUrl: 'https://a.example/icons', element: 'role-img', imageUrl: null, embedded: true, name: '星', nameSource: 'title', alt: null, altState: 'missing' });
      const ii = makeRecord({ pageUrl: 'https://a.example/icons', element: 'input-image', name: '送信', alt: '送信' });
      const r = await buildExport([svg, ri, ii], { sites: ['a.example'], stripQuery: false, evaluator: '', now: NOW });
      assert.equal(r.records.length, 3);
      for (const x of r.records) assert.deepEqual(Object.keys(x).sort(), [...RECORD_FIELDS].sort());
      assert.deepEqual(r.records.map((x) => x.element).sort(), ['input-image', 'role-img', 'svg']);
      assert.equal(r.version, 1, 'version は1のまま');
    });

    test('元の記録を書き換えない', async () => {
      if (mode !== 'node') return;
      const copy = { ...structuredClone(a1), source: 'own' };
      const orig = structuredClone(copy);
      mod.buildExport([copy], { sites: ['a.example'], stripQuery: true, evaluator: '', now: new Date(NOW) });
      assert.deepEqual(copy, orig);
    });
  });

  describe('validateImport', () => {
    const file = (records, extra = {}) => ({
      format: 'alt-tsushinbo',
      version: 1,
      exportedAt: '2026-11-07T09:00:00.000Z',
      evaluator: '',
      records,
      ...extra,
    });
    const ok = () => makeRecord({ pageUrl: 'https://z.example/p', name: '正しい' });

    test('正しいファイルは ok: true で、すべての記録を返し、rejected は 0', async () => {
      const r1 = ok();
      const r2 = makeRecord({ pageUrl: 'http://z.example/q', imageUrl: null, embedded: true, linkUrl: null, alt: null, name: '' });
      const r = await validateImport(file([r1, r2]));
      assert.equal(r.ok, true);
      assert.equal(r.rejected, 0);
      assert.equal(r.records.length, 2);
      assert.deepEqual(pickRecord(r.records[0]), r1);
      assert.deepEqual(pickRecord(r.records[1]), r2);
    });

    test('records が空の配列でも ok: true', async () => {
      const r = await validateImport(file([]));
      assert.equal(r.ok, true);
      assert.deepEqual(r.records, []);
      assert.equal(r.rejected, 0);
    });

    const fileCases = [
      ['null', null],
      ['文字列', 'alt-tsushinbo'],
      ['配列', [ok()]],
      ['format が違う', file([ok()], { format: 'alt-tsuushinbo' })],
      ['version が 2', file([ok()], { version: 2 })],
      ['version が "1"', file([ok()], { version: '1' })],
      ['records が配列でない', file({ 0: ok() })],
      ['records が無い', { format: 'alt-tsushinbo', version: 1 }],
    ];
    for (const [label, data] of fileCases) {
      test(`ファイル全体の形式が合わない：${label} → ok: false`, async () => {
        const r = await validateImport(data);
        assert.equal(r.ok, false, JSON.stringify(r));
        assert.equal((r.records || []).length, 0, '形式が合わないのに記録を返しました');
      });
    }

    const long = (prefix, n) => prefix + 'a'.repeat(n - prefix.length);
    const recordCases = [
      // [説明, 変更, 取り込めるか]
      ['pageUrl が https: で2,000文字', { pageUrl: long('https://z.example/', 2000) }, true],
      ['pageUrl が2,001文字', { pageUrl: long('https://z.example/', 2001) }, false],
      ['pageUrl が javascript:', { pageUrl: 'javascript:alert(1)' }, false],
      ['pageUrl が大文字の JAVASCRIPT:', { pageUrl: 'JAVASCRIPT:alert(1)' }, false],
      ['pageUrl が data:', { pageUrl: 'data:text/html,x' }, false],
      ['pageUrl が file:', { pageUrl: 'file:///etc/passwd' }, false],
      ['pageUrl が null', { pageUrl: null }, false],
      ['pageUrl が無い', { pageUrl: undefined }, false],
      ['imageUrl が null', { imageUrl: null }, true],
      ['imageUrl が http: で2,000文字', { imageUrl: long('http://z.example/', 2000) }, true],
      ['imageUrl が2,001文字', { imageUrl: long('http://z.example/', 2001) }, false],
      ['imageUrl が javascript:', { imageUrl: 'javascript:alert(1)' }, false],
      ['imageUrl が data:', { imageUrl: 'data:image/png;base64,AAAA' }, false],
      ['imageUrl が数値', { imageUrl: 3 }, false],
      ['linkUrl が null', { linkUrl: null }, true],
      ['linkUrl が javascript:', { linkUrl: 'javascript:alert(1)' }, false],
      ['linkUrl が2,001文字', { linkUrl: long('https://z.example/', 2001) }, false],
      ['pageTitle が1,000文字', { pageTitle: 'あ'.repeat(1000) }, true],
      ['pageTitle が1,001文字', { pageTitle: 'あ'.repeat(1001) }, false],
      ['pageTitle が null', { pageTitle: null }, false],
      ['name が空文字列', { name: '' }, true],
      ['name が1,000文字', { name: 'い'.repeat(1000) }, true],
      ['name が1,001文字', { name: 'い'.repeat(1001) }, false],
      ['name が配列', { name: ['a'] }, false],
      ['alt が null', { alt: null }, true],
      ['alt が5,000文字', { alt: 'う'.repeat(5000) }, true],
      ['alt が5,001文字', { alt: 'う'.repeat(5001) }, false],
      ['alt が数値', { alt: 1 }, false],
      ['embedded が true', { embedded: true, imageUrl: null }, true],
      ['embedded が "true"', { embedded: 'true' }, false],
      ['embedded が 0', { embedded: 0 }, false],
      ['category が hidden', { category: 'hidden' }, true],
      ['category が不明', { category: 'decorative' }, false],
      ['nameSource が aria-labelledby', { nameSource: 'aria-labelledby' }, true],
      ['nameSource が不明', { nameSource: 'figcaption' }, false],
      // 契約「svg要素、role="img"の要素、input type="image"」
      ['nameSource が svg-title', { nameSource: 'svg-title', element: 'svg' }, true],
      ['element が svg', { element: 'svg', imageUrl: null, embedded: true, alt: null, altState: 'missing' }, true],
      ['element が role-img', { element: 'role-img', imageUrl: null, embedded: true, alt: null, altState: 'missing' }, true],
      ['element が input-image', { element: 'input-image' }, true],
      ['element が無い（img とみなす）', { element: undefined }, true],
      ['element が不明な値（canvas）', { element: 'canvas' }, false],
      ['element が大文字の SVG', { element: 'SVG' }, false],
      ['element が数値', { element: 1 }, false],
      ['element が空文字列', { element: '' }, false],
      ['altState が missing', { altState: 'missing' }, true],
      ['altState が不明', { altState: 'blank' }, false],
      ['rating が poor', { rating: 'poor' }, true],
      ['rating が fair', { rating: 'fair' }, false],
      ['rating が null', { rating: null }, false],
      ['ratedAt が50文字', { ratedAt: '2'.repeat(50) }, true],
      ['ratedAt が51文字', { ratedAt: '2'.repeat(51) }, false],
      ['ratedAt が数値', { ratedAt: 1730970000000 }, false],
    ];
    for (const [label, over, accepted] of recordCases) {
      test(`${label} → ${accepted ? '取り込む' : '取り込まない'}`, async () => {
        const rec = { ...ok(), ...over };
        for (const [k, v] of Object.entries(over)) if (v === undefined) delete rec[k];
        const r = await validateImport(file([ok(), rec]));
        assert.equal(r.ok, true);
        assert.equal(r.records.length, accepted ? 2 : 1, JSON.stringify(r).slice(0, 300));
        assert.equal(r.rejected, accepted ? 0 : 1);
      });
    }

    test('element が無い記録は、element: "img" として返す（13項目）', async () => {
      const rec = ok();
      delete rec.element;
      const r = await validateImport(file([rec]));
      assert.equal(r.ok, true);
      assert.equal(r.records.length, 1);
      assert.equal(r.records[0].element, 'img', `element：${JSON.stringify(r.records[0])}`);
      assert.deepEqual(Object.keys(r.records[0]).sort(), [...RECORD_FIELDS].sort());
    });

    test('svg・role-img・input-image の記録は element をそのまま返す', async () => {
      const svg = makeRecord({
        pageUrl: 'https://z.example/p',
        element: 'svg',
        imageUrl: null,
        embedded: true,
        name: '家のアイコン',
        nameSource: 'svg-title',
        alt: null,
        altState: 'missing',
      });
      const ri = makeRecord({
        pageUrl: 'https://z.example/p',
        element: 'role-img',
        imageUrl: null,
        embedded: true,
        category: 'none',
        name: '',
        nameSource: 'none',
        alt: null,
        altState: 'missing',
      });
      const ii = makeRecord({ pageUrl: 'https://z.example/p', element: 'input-image', name: '送信', alt: '送信' });
      const r = await validateImport(file([svg, ri, ii]));
      assert.equal(r.rejected, 0);
      assert.deepEqual(r.records.map(pickRecord), [svg, ri, ii]);
    });

    test('記録がオブジェクトでない（null・文字列・数値）なら取り込まず、数に入れる', async () => {
      const r = await validateImport(file([ok(), null, 'x', 1]));
      assert.equal(r.ok, true);
      assert.equal(r.records.length, 1);
      assert.equal(r.rejected, 3);
    });

    test('取り込む記録の値の中に、HTML の文字はそのまま文字列として残る（変換しない）', async () => {
      const rec = { ...ok(), name: '<script>alert(1)</script>', pageTitle: '<b>x</b>' };
      const r = await validateImport(file([rec]));
      assert.equal(r.records[0].name, '<script>alert(1)</script>');
      assert.equal(r.records[0].pageTitle, '<b>x</b>');
    });
  });
});
