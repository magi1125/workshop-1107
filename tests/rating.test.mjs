// 評価ボタンと chrome.storage.local への保存のテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, boxState, clickRating, waitForBoxCount, waitFor, storageKey } from './helpers/extension.mjs';

const RECORD_KEYS = [
  'pageUrl',
  'pageTitle',
  'imageUrl',
  'embedded',
  'category',
  'name',
  'nameSource',
  'altState',
  'alt',
  'linkUrl',
  'rating',
  'ratedAt',
  'element',
].sort();

const ratingRecords = (all) => Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('r:')));

describe('評価と保存', { timeout: 180000 }, () => {
  let h;
  let page;
  let pageUrl;
  const TITLE = '評価の保存のテスト';

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    pageUrl = h.url('rating.html');
    // # 以降は pageUrl に含めない
    page = await h.openFixture('rating.html', { hash: '#section' });
    await h.enable(page);
    await waitForBoxCount(page, 5);
  });

  after(async () => {
    await h?.close();
  });

  async function waitRecord(key, pred = (v) => v !== undefined, message) {
    return waitFor(
      async () => {
        const all = await h.storageAll();
        return pred(all[key]) ? { value: all[key], all } : null;
      },
      { message: message || `保存の結果を待ちましたが、条件を満たしません：${key}` },
    ).catch(async (e) => {
      const all = await h.storageAll();
      throw new Error(`${e.message}\n保存されているキー：${JSON.stringify(Object.keys(all))}`);
    });
  }

  test('「良い」を押すと、そのボタンだけが aria-pressed="true" になる', async () => {
    await clickRating(page, 'linked', 'good');
    await waitFor(async () => (await boxState(page, 'linked')).pressed.good === 'true', { message: '良い が押した状態になりません' });
    const s = await boxState(page, 'linked');
    assert.deepEqual(s.pressed, { good: 'true', poor: 'false' });
  });

  test('評価は契約の形式のキーと値で保存される', async () => {
    const t0 = Date.now();
    const imageUrl = h.url('img/linked.png?v=1');
    const key = storageKey(pageUrl, imageUrl, '次の記事へ');
    const { value, all } = await waitRecord(key);
    assert.deepEqual(Object.keys(ratingRecords(all)), [key], '評価の記録は1件だけ');
    assert.deepEqual(Object.keys(value).sort(), RECORD_KEYS, '記録の項目');
    const { ratedAt, ...rest } = value;
    assert.deepEqual(rest, {
      pageUrl,
      pageTitle: TITLE,
      imageUrl,
      embedded: false,
      category: 'named',
      name: '次の記事へ',
      nameSource: 'alt',
      altState: 'present',
      alt: '次の記事へ',
      linkUrl: 'https://example.com/next',
      rating: 'good',
      element: 'img',
    });
    assert.equal(typeof ratedAt, 'string');
    assert.match(ratedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, 'ratedAt は ISO 8601');
    assert.ok(Math.abs(Date.parse(ratedAt) - t0) < 60000, 'ratedAt が保存した日時ではありません');
  });

  test('ほかの評価を押すと、押した状態と保存が切り替わる', async () => {
    await clickRating(page, 'linked', 'poor');
    await waitFor(async () => (await boxState(page, 'linked')).pressed.poor === 'true', { message: '悪い が押した状態になりません' });
    assert.deepEqual((await boxState(page, 'linked')).pressed, { good: 'false', poor: 'true' });
    const key = storageKey(pageUrl, h.url('img/linked.png?v=1'), '次の記事へ');
    const { value } = await waitRecord(key, (v) => v && v.rating === 'poor');
    assert.equal(value.rating, 'poor');
  });

  test('押した評価をもう一度押すと取り消され、キーが削除される', async () => {
    await clickRating(page, 'linked', 'poor');
    await waitFor(async () => (await boxState(page, 'linked')).pressed.poor === 'false', { message: '取り消されません' });
    assert.deepEqual((await boxState(page, 'linked')).pressed, { good: 'false', poor: 'false' });
    const key = storageKey(pageUrl, h.url('img/linked.png?v=1'), '次の記事へ');
    await waitRecord(key, (v) => v === undefined, 'キーが削除されません');
  });

  test('data: の画像は imageKey が "embedded" で、imageUrl を記録しない', async () => {
    await clickRating(page, 'embedded', 'poor');
    const key = storageKey(pageUrl, 'embedded', '');
    const { value } = await waitRecord(key);
    assert.equal(value.imageUrl, null);
    assert.equal(value.embedded, true);
    assert.equal(value.category, 'empty');
    assert.equal(value.name, '');
    assert.equal(value.altState, 'empty');
    assert.equal(value.alt, '');
    assert.equal(value.linkUrl, null);
    assert.equal(value.rating, 'poor');
    assert.ok(!JSON.stringify(value).includes('data:image'), '画像のデータが記録されています');
  });

  test('alt属性の無い画像の記録', async () => {
    await clickRating(page, 'noalt', 'good');
    const key = storageKey(pageUrl, h.url('img/noalt.png'), '');
    const { value } = await waitRecord(key);
    assert.equal(value.category, 'none');
    assert.equal(value.nameSource, 'none');
    assert.equal(value.altState, 'missing');
    assert.equal(value.alt, null);
    assert.equal(value.rating, 'good');
  });

  test('同じキーの評価ボックスが2つある時は、押した状態がそろう', async () => {
    await clickRating(page, 'dup-1', 'good');
    await waitFor(async () => (await boxState(page, 'dup-2')).pressed.good === 'true', {
      message: 'もう一方の評価ボックスが押した状態になりません',
    });
    assert.deepEqual((await boxState(page, 'dup-1')).pressed, { good: 'true', poor: 'false' });
    assert.deepEqual((await boxState(page, 'dup-2')).pressed, { good: 'true', poor: 'false' });
    const key = storageKey(pageUrl, h.url('img/dup.png'), '同じ画像');
    await waitRecord(key, (v) => v && v.rating === 'good');
    // もう一方で変更しても、そろう
    await clickRating(page, 'dup-2', 'poor');
    await waitFor(async () => (await boxState(page, 'dup-1')).pressed.poor === 'true', {
      message: 'もう一方の評価ボックスの変更がそろいません',
    });
    assert.deepEqual((await boxState(page, 'dup-1')).pressed, { good: 'false', poor: 'true' });
    await waitRecord(key, (v) => v && v.rating === 'poor');
  });

  test('getState の total と rated（rated は評価済みの評価ボックスの数）', async () => {
    // 評価済み：embedded、noalt、dup-1、dup-2
    const state = await h.getState(page);
    assert.deepEqual(state, { enabled: true, total: 5, rated: 4 });
  });

  test('ページを読み込み直してオンにすると、保存した評価が押した状態で表示される（# の違いは無視）', async () => {
    await page.goto(pageUrl, { waitUntil: 'load' });
    await h.enable(page);
    await waitForBoxCount(page, 5);
    const expect = {
      linked: { good: 'false', poor: 'false' },
      embedded: { good: 'false', poor: 'true' },
      'dup-1': { good: 'false', poor: 'true' },
      'dup-2': { good: 'false', poor: 'true' },
      noalt: { good: 'true', poor: 'false' },
    };
    await waitFor(async () => (await boxState(page, 'noalt')).pressed.good === 'true', {
      message: '保存した評価が表示されません',
    });
    for (const [id, pressed] of Object.entries(expect)) {
      assert.deepEqual((await boxState(page, id)).pressed, pressed, `#${id}`);
    }
    assert.deepEqual(await h.getState(page), { enabled: true, total: 5, rated: 4 });
  });

  test('名前が変わった画像には、古い名前への評価を表示しない', async () => {
    await h.disable(page);
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => {
      document.getElementById('dup-1').setAttribute('alt', '名前が変わった画像');
    });
    await h.enable(page);
    await waitForBoxCount(page, 5);
    await waitFor(async () => (await boxState(page, 'dup-2')).pressed.poor === 'true', { message: '保存した評価が表示されません' });
    assert.deepEqual((await boxState(page, 'dup-1')).pressed, { good: 'false', poor: 'false' });
  });

  test('評価ボタンの名前は、押した後も「良い」「悪い」のまま', async () => {
    const idx = await page.evaluate(() => window.__t.boxes().indexOf(window.__t.boxFor(document.getElementById('dup-2'))));
    const box = page.locator('alt-eval-box[data-alt-eval="box"]').nth(idx);
    assert.equal(await box.getByRole('button', { name: '悪い', exact: true, pressed: true }).count(), 1);
    assert.equal(await box.getByRole('button', { name: '良い', exact: true, pressed: false }).count(), 1);
    assert.equal(await box.getByRole('button').count(), 2, 'ボタンは2つだけ');
  });
});
