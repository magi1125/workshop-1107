// 契約「小さい画像の印（バッジ）」のテスト
// 表示のしかたの種類、閉じている状態、開く・閉じる（マウス・フォーカス・Esc キー・タッチ）、印の位置、見た目
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, boxLocator, boxIndexOf, waitForBoxCount, waitFor, sleep, storageKey } from './helpers/extension.mjs';

// 印（data-mode="badge"）になる要素：幅か高さが48px未満
const BADGE_IDS = [
  'iso-img',
  'iso-svg',
  'row-a-0', 'row-a-1', 'row-a-2', 'row-a-3', 'row-a-4',
  'cl-a1', 'cl-a2', 'cl-b', 'cl-c1', 'cl-c2', 'cl-c3', 'cl-c', 'cl-d1', 'cl-d',
  'edge-img',
];
// 小さい表示（data-mode="compact"）になる、大きい画像
const COMPACT = [
  ['card-img', '画像が overflow:hidden のカードより大きく、通常表示の評価ボックスがカードに切り取られる'],
  ['obscured', '切り取りは無いが、通常表示の評価ボックスが透明なリンク（stretched link）の重なりに覆われる'],
];
// 通常表示（data-mode="inline"）
const INLINE = ['normal'];
const BOX_COUNT = BADGE_IDS.length + COMPACT.length + INLINE.length;

const ROW_IDS = ['row-a-0', 'row-a-1', 'row-a-2', 'row-a-3', 'row-a-4'];
const CLUSTER_IDS = ['cl-a1', 'cl-a2', 'cl-b', 'cl-c1', 'cl-c2', 'cl-c3', 'cl-c', 'cl-d1', 'cl-d'];
// フィクスチャの前提：集まりの印は、下の位置に置かれる（1：右上、2：右下、3：左下、4：左上）
const CLUSTER_CORNERS = [1, 1, 3, 1, 1, 1, 4, 1, 2];
const CORNER_NAMES = { 1: '右上', 2: '右下', 3: '左下', 4: '左上' };

// 印の大きさ（px）と、位置の許容誤差（px）
const BADGE_SIZE = 20;
const TOLERANCE = 2;
// マウスを評価ボックスから離す場所（何も無い画面の右下）
const AWAY = { x: 1270, y: 890 };
// タッチで「評価ボックスの外」をタッチする場所（何も無い所）
const BLANK = { x: 1000, y: 800 };

/** 契約「印の位置」の候補（1.右上、2.右下、3.左下、4.左上）の、印の左上 */
function cornerPositions(v) {
  return [
    { left: v.right - 12, top: v.top - 8 },
    { left: v.right - 12, top: v.bottom - 12 },
    { left: v.left - 8, top: v.bottom - 12 },
    { left: v.left - 8, top: v.top - 8 },
  ];
}

const overlaps = (a, b, size = BADGE_SIZE) =>
  Math.min(a.left + size, b.left + size) - Math.max(a.left, b.left) > 0 &&
  Math.min(a.top + size, b.top + size) - Math.max(a.top, b.top) > 0;

/**
 * 契約の規則をテスト側で計算する：DOM の順に、1.から4.の順で、先に置いた印と重ならない最初の位置。
 * どこでも重なる時は 1.
 */
function expectedPlacement(visibleRects) {
  const placed = [];
  return visibleRects.map((v) => {
    const cands = cornerPositions(v);
    let k = cands.findIndex((c) => placed.every((p) => !overlaps(c, p)));
    const corner = k < 0 ? 1 : k + 1;
    const pos = cands[corner - 1];
    placed.push(pos);
    return { corner, ...pos };
  });
}

/** CDP の getFullAXTree を、親をたどれる形で返す（無視されたノードも含む） */
async function axTree(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const parentOf = new Map();
    for (const n of nodes) for (const c of n.childIds || []) parentOf.set(c, n.nodeId);
    const simple = (n) => ({ role: n.role?.value ?? '', name: (n.name?.value ?? '').replace(/\s+/g, ' ').trim(), ignored: !!n.ignored });
    return { nodes, byId, parentOf, simple };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

describe('小さい画像の印（バッジ）', { timeout: 300000 }, () => {
  let h;
  let page;
  let pageUrl;
  let obscuredBefore; // 評価モードをオンにする前の、#obscured のカードの様子

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    pageUrl = h.url('badge.html');
    page = await h.openFixture('badge.html');
    obscuredBefore = await page.evaluate(() => {
      const img = document.getElementById('obscured').getBoundingClientRect();
      const cs = getComputedStyle(document.getElementById('ocard'));
      // 画像の上と、画像のすぐ下（通常表示の評価ボックスが入る所）
      const hits = [
        [img.left + 10, img.top + 10],
        [img.left + 10, img.bottom + 4],
      ].map(([x, y]) => !!document.elementFromPoint(x, y)?.closest('#ocard-link'));
      return { coveredByLink: hits.every(Boolean), overflow: cs.overflowX + ' ' + cs.overflowY };
    });
    await page.mouse.move(AWAY.x, AWAY.y);
    await h.enable(page);
    await waitForBoxCount(page, BOX_COUNT);
    await page.waitForTimeout(300);
  });

  after(async () => {
    await h?.close();
  });

  /** 画像の id から、評価ボックスの印の状態（window.__t.badgeInfo） */
  const info = (id, p = page) =>
    p.evaluate((id) => {
      const box = window.__t.boxFor(document.getElementById(id));
      return box ? window.__t.badgeInfo(box) : null;
    }, id);

  const waitExpanded = (id, expanded, message, p = page) =>
    waitFor(async () => (await info(id, p))?.expanded === expanded, { timeout: 3000, message }).catch(async (e) => {
      const i = await info(id, p);
      throw new Error(`${e.message}（wrapper：${i?.hasWrapper}、expanded：${i?.expanded}）`);
    });

  /** 印の中心 */
  async function badgeCenter(id, p = page) {
    const i = await info(id, p);
    assert.ok(i?.badgeRect, `#${id} の印（div.badge）がありません`);
    return { x: i.badgeRect.left + i.badgeRect.width / 2, y: i.badgeRect.top + i.badgeRect.height / 2 };
  }

  /** ボタンの中心 */
  async function buttonCenter(id, rating, p = page) {
    const i = await info(id, p);
    const b = i.buttons.find((b) => b.rating === rating);
    return { x: b.rect.left + b.rect.width / 2, y: b.rect.top + b.rect.height / 2, rect: b.rect };
  }

  /** マウスを離し、フォーカスを評価ボックスの外（ページの先頭）に移す。すべての印が閉じるまで待つ */
  async function reset() {
    await page.mouse.move(AWAY.x, AWAY.y);
    await page.evaluate(() => {
      const el = window.__t.deepActive();
      if (el && el !== document.body) el.blur();
    });
    await page.locator('h1').click();
    await page.mouse.move(AWAY.x, AWAY.y);
    await waitFor(
      () =>
        page.evaluate(() =>
          window.__t.boxes().filter((b) => b.getAttribute('data-mode') === 'badge').every((b) => !window.__t.badgeInfo(b).expanded),
        ),
      { timeout: 3000, message: 'マウスを離し、フォーカスを外しても、開いたままの印があります' },
    );
  }

  const activeBox = () => page.evaluate(() => window.__t.describeActive());

  describe('表示のしかたの種類', () => {
    for (const id of BADGE_IDS) {
      test(`#${id}（幅か高さが48px未満）は data-mode="badge" で、popover="manual" で最前面に表示される`, async () => {
        const i = await info(id);
        assert.ok(i, `#${id} の評価ボックスがありません`);
        assert.equal(i.mode, 'badge', 'data-mode');
        assert.equal(i.popover, 'manual', 'popover 属性');
        assert.equal(i.popoverOpen, true, ':popover-open');
      });
    }

    test('前提：透明なリンクの重なりが、#obscured の画像とそのすぐ下（通常表示の評価ボックスが入る所）を覆っている（オンにする前）', async () => {
      const r = obscuredBefore;
      assert.equal(r.coveredByLink, true, 'フィクスチャの前提が崩れています（リンクの重なりが無い）');
      assert.equal(r.overflow, 'visible visible', 'フィクスチャの前提が崩れています（切り取りがある）');
    });

    test('前提：#obscured の評価ボックスを通常表示で置いた場合、z-index に関係なく重なりの下になる（画像の枠が重なりの文脈を作る）', async () => {
      // 通常表示の評価ボックスと同じ場所（画像の直後）に、z-index の最大値の要素を置いて確かめる
      const r = await page.evaluate(() => {
        const img = document.getElementById('obscured');
        const probe = document.createElement('div');
        probe.style.cssText = 'position: relative; z-index: 2147483647; height: 40px; background: red;';
        img.after(probe);
        const pr = probe.getBoundingClientRect();
        const hit = document.elementFromPoint(pr.left + 10, pr.top + 10);
        const covered = !!hit?.closest('#ocard-link');
        probe.remove();
        return covered;
      });
      assert.equal(r, true, 'フィクスチャの前提が崩れています');
    });

    for (const [id, why] of COMPACT) {
      test(`大きい画像 #${id}（${why}）は data-mode="compact" で、popover="manual" で最前面に表示される`, async () => {
        const i = await info(id);
        assert.ok(i, `#${id} の評価ボックスがありません`);
        assert.equal(i.mode, 'compact', 'data-mode');
        assert.equal(i.popover, 'manual', 'popover 属性');
        assert.equal(i.popoverOpen, true, ':popover-open');
      });
    }

    test('覆われた画像（#obscured）の小さい表示は、見えている部分の左上 +4px に置かれ、ボタンが重なりの上で押せる', async () => {
      await reset();
      const r = await page.evaluate(() => {
        const img = document.getElementById('obscured');
        const box = window.__t.boxFor(img);
        const b = box.getBoundingClientRect();
        return { box: { left: b.left, top: b.top }, visible: window.__t.visibleRectOf(img) };
      });
      const detail = `（評価ボックスの左上 ${r.box.left},${r.box.top}、見えている部分の左上 ${r.visible.left},${r.visible.top}）`;
      assert.ok(Math.abs(r.box.left - (r.visible.left + 4)) <= TOLERANCE, `左の位置${detail}`);
      assert.ok(Math.abs(r.box.top - (r.visible.top + 4)) <= TOLERANCE, `上の位置${detail}`);
      const box = await boxLocator(page, 'obscured');
      for (const rating of ['good', 'poor']) {
        // 実際にクリックできる（リンクの重なりに隠れていない）ことを確かめる
        await box.locator(`button[data-rating="${rating}"]`).click({ trial: true, timeout: 3000 });
      }
    });

    for (const id of INLINE) {
      test(`通常の大きさで、切り取られも覆われもしない画像（#${id}）は data-mode="inline" で、popover で開いていない`, async () => {
        const i = await info(id);
        assert.equal(i.mode, 'inline');
        assert.equal(i.popoverOpen, false);
      });
    }

    test('ホスト要素のDOMの位置は、印でもこれまでどおり基準の要素の直後', async () => {
      const r = await page.evaluate(() => ({
        link: document.getElementById('row-a-link-0').nextElementSibling?.localName ?? null,
        img: document.getElementById('iso-img').nextElementSibling?.localName ?? null,
        svg: document.getElementById('iso-svg').nextElementSibling?.localName ?? null,
      }));
      assert.deepEqual(r, { link: 'alt-eval-box', img: 'alt-eval-box', svg: 'alt-eval-box' });
    });
  });

  describe('閉じている状態', () => {
    before(reset);

    for (const id of ['iso-img', 'iso-svg', 'row-a-0', 'cl-b', 'edge-img']) {
      test(`#${id}：wrapper に expanded が無く、印 div.badge（aria-hidden="true"、約20×20px）だけが見える`, async () => {
        const i = await info(id);
        assert.equal(i.hasWrapper, true, 'シャドウルートの中に wrapper（class="wrapper"）がありません');
        assert.equal(i.expanded, false, '閉じているのに wrapper に expanded があります');
        assert.equal(i.hasBadge, true, '印（div.badge）がありません');
        assert.equal(i.badgeAriaHidden, 'true', '印の aria-hidden');
        assert.equal(i.badgeShown, true, '印が見えません');
        assert.ok(
          Math.abs(i.badgeRect.width - BADGE_SIZE) <= 1 && Math.abs(i.badgeRect.height - BADGE_SIZE) <= 1,
          `印の大きさが20×20pxではありません（${i.badgeRect.width}×${i.badgeRect.height}）`,
        );
      });
    }

    test('未評価の印の中は空', async () => {
      const texts = await Promise.all(BADGE_IDS.map(async (id) => [id, (await info(id)).badgeText]));
      for (const [id, t] of texts) assert.equal(t, '', `#${id} の印の中が空ではありません`);
    });

    test('1行目とボタンのグループは画面から隠れているが、display: none ではない', async () => {
      for (const id of BADGE_IDS) {
        const i = await info(id);
        assert.equal(i.lineShown, false, `#${id}：閉じているのに1行目が見えます`);
        assert.equal(i.groupShown, false, `#${id}：閉じているのにボタンのグループが見えます`);
        assert.notEqual(i.lineDisplay, 'none', `#${id}：1行目が display: none です（読み上げに残してください）`);
        assert.notEqual(i.groupDisplay, 'none', `#${id}：ボタンのグループが display: none です（読み上げと Tab キーに残してください）`);
        assert.deepEqual(i.buttons.map((b) => b.rating), ['good', 'poor'], `#${id}：ボタンは good と poor の2つ`);
        for (const b of i.buttons) {
          assert.equal(b.shown, false, `#${id}：閉じているのに ${b.rating} のボタンが見えます`);
          assert.notEqual(b.display, 'none', `#${id}：${b.rating} のボタンが display: none です`);
        }
      }
    });

    test('アクセシビリティツリー（CDP）：閉じた印の評価ボックスごとに、「直前の画像の評価」のグループの中に「良い」「悪い」のボタンがある', async () => {
      const { nodes, byId, parentOf, simple } = await axTree(page);
      const groups = nodes.filter((n) => !n.ignored && simple(n).role === 'group' && simple(n).name === '直前の画像の評価');
      assert.equal(groups.length, BOX_COUNT, `グループの数（印 ${BADGE_IDS.length} を含む）`);
      // ボタンの親をたどって、グループの中にあるかを確かめる
      const groupOf = (n) => {
        for (let id = parentOf.get(n.nodeId); id; id = parentOf.get(id)) {
          const p = byId.get(id);
          if (!p.ignored && simple(p).role === 'group') return id;
        }
        return null;
      };
      const perGroup = new Map(groups.map((g) => [g.nodeId, []]));
      for (const n of nodes) {
        const s = simple(n);
        if (s.ignored || s.role !== 'button' || !['良い', '悪い'].includes(s.name)) continue;
        const g = groupOf(n);
        assert.ok(g && perGroup.has(g), `「${s.name}」のボタンが「直前の画像の評価」のグループの中にありません`);
        perGroup.get(g).push(s.name);
      }
      for (const names of perGroup.values()) assert.deepEqual(names, ['良い', '悪い']);
      const symbols = nodes.filter((n) => !n.ignored && /[○×]/.test(simple(n).name));
      assert.deepEqual(symbols.map(simple), [], '記号を含むノードがツリーにあります');
    });

    test('Tab キーで、すべての評価ボックスの「良い」「悪い」ボタンに、文書の順に届く', async () => {
      await reset();
      const seq = [];
      for (let i = 0; i < 120; i++) {
        await page.keyboard.press('Tab');
        const a = await activeBox();
        seq.push(a == null ? 'null' : a.kind === 'box' ? `box:${a.boxIndex}:${a.rating}` : `page:${a.id || a.tag}`);
        if (a && a.kind === 'page' && a.id === 'after-link') break;
      }
      const boxSeq = seq.filter((x) => x.startsWith('box:'));
      const expected = [];
      for (let i = 0; i < BOX_COUNT; i++) expected.push(`box:${i}:good`, `box:${i}:poor`);
      assert.deepEqual(boxSeq, expected, `Tab キーの順番：${seq.join(' → ')}`);
      // リンクの中のアイコンの評価ボックスは、リンクの直後
      const idx = await boxIndexOf(page, 'row-a-0');
      assert.equal(seq[seq.indexOf('page:row-a-link-0') + 1], `box:${idx}:good`, 'リンクの次が、その中のアイコンの評価ボックスではありません');
      await reset();
    });
  });

  describe('開く・閉じる', () => {
    before(reset);

    test('印にマウスを重ねると開き（wrapper に expanded）、ボタン（28×28px以上）と1行目が見え、印は隠れる', async () => {
      await reset();
      const c = await badgeCenter('iso-img');
      await page.mouse.move(c.x, c.y);
      await waitExpanded('iso-img', true, '印にマウスを重ねても開きません');
      const i = await info('iso-img');
      assert.equal(i.popoverOpen, true, '開いても :popover-open のまま');
      assert.equal(i.lineShown, true, '開いても1行目が見えません');
      assert.equal(i.groupShown, true, '開いてもボタンのグループが見えません');
      assert.equal(i.badgeShown, false, '開いても印が見えています');
      for (const b of i.buttons) {
        assert.equal(b.shown, true, `開いても ${b.rating} のボタンが見えません`);
        assert.ok(b.rect.width >= 28 && b.rect.height >= 28, `${b.rating} のボタンが 28×28px 未満です（${b.rect.width}×${b.rect.height}）`);
      }
      // 開いた後も、マウスの下は評価ボックスのまま（開いた評価ボックスがマウスの下から逃げると、閉じて開くを繰り返す）
      assert.equal(await page.evaluate(({ x, y }) => window.__t.boxAtPoint(window.__t.boxFor(document.getElementById('iso-img')), x, y), c), true,
        '開いた後、マウスの位置が評価ボックスの外になりました');
      await sleep(300);
      assert.equal((await info('iso-img')).expanded, true, 'マウスを重ねたままなのに閉じました');
    });

    test('マウスが離れ、フォーカスも外にあると閉じて、印がまた見える', async () => {
      // 前のテストの続き（開いている）
      if (!(await info('iso-img')).expanded) {
        const c = await badgeCenter('iso-img');
        await page.mouse.move(c.x, c.y);
        await waitExpanded('iso-img', true, '印にマウスを重ねても開きません');
      }
      await page.mouse.move(AWAY.x, AWAY.y);
      await waitExpanded('iso-img', false, 'マウスが離れても閉じません');
      const i = await info('iso-img');
      assert.equal(i.badgeShown, true, '閉じた後に印が見えません');
      assert.equal(i.lineShown, false, '閉じた後に1行目が見えます');
      assert.ok(i.buttons.every((b) => !b.shown), '閉じた後にボタンが見えます');
    });

    test('Tab キーで評価ボタンにフォーカスすると開き、評価ボックスの中を移る間は開いたまま、外へ出ると閉じる', async () => {
      await reset();
      await page.locator('#row-a-link-0').focus();
      await page.keyboard.press('Tab');
      const idx = await boxIndexOf(page, 'row-a-0');
      const a = await activeBox();
      assert.deepEqual(a && { boxIndex: a.boxIndex, rating: a.rating }, { boxIndex: idx, rating: 'good' }, `Tab キーで評価ボタンに移れません：${JSON.stringify(a)}`);
      await waitExpanded('row-a-0', true, 'フォーカスがあっても開きません');
      const i = await info('row-a-0');
      assert.ok(i.buttons.every((b) => b.shown), 'フォーカスで開いてもボタンが見えません');
      assert.equal(i.lineShown, true, 'フォーカスで開いても1行目が見えません');
      await page.keyboard.press('Tab');
      assert.equal((await activeBox())?.rating, 'poor');
      await sleep(200);
      assert.equal((await info('row-a-0')).expanded, true, '評価ボックスの中でフォーカスを移すと閉じました');
      await page.keyboard.press('Tab');
      assert.equal((await activeBox())?.id, 'row-a-link-1', '評価ボックスの次は、次のリンク');
      await waitExpanded('row-a-0', false, 'フォーカスが外れても閉じません');
      await reset();
    });

    test('フォーカスが評価ボックスの中にある間は、マウスが離れても開いたまま', async () => {
      await reset();
      const box = await boxLocator(page, 'iso-svg');
      await box.locator('button[data-rating="good"]').focus();
      await waitExpanded('iso-svg', true, 'フォーカスがあっても開きません');
      const c = await buttonCenter('iso-svg', 'good');
      await page.mouse.move(c.x, c.y);
      await page.mouse.move(AWAY.x, AWAY.y);
      await sleep(300);
      assert.equal((await info('iso-svg')).expanded, true, 'フォーカスが中にあるのに、マウスが離れると閉じました');
      await page.locator('#after-link').focus();
      await waitExpanded('iso-svg', false, 'フォーカスが外れても閉じません');
      await reset();
    });

    test('マウスで開いている間に Esc キーを押すと閉じ、マウスが離れるまで閉じたまま', async () => {
      await reset();
      const c = await badgeCenter('iso-img');
      await page.mouse.move(c.x, c.y);
      await waitExpanded('iso-img', true, '印にマウスを重ねても開きません');
      // フォーカスは評価ボックスの外（ページ）にある
      await page.keyboard.press('Escape');
      await waitExpanded('iso-img', false, 'Esc キーで閉じません（フォーカスが評価ボックスの外にある時）');
      assert.equal((await info('iso-img')).badgeShown, true, 'Esc キーで閉じた後に印が見えません');
      // マウスを印の上で動かしても、閉じたまま
      await page.mouse.move(c.x + 1, c.y + 1);
      await page.mouse.move(c.x - 1, c.y);
      await sleep(300);
      assert.equal((await info('iso-img')).expanded, false, 'マウスが離れていないのに、また開きました');
      // マウスが離れてから戻ると、また開く
      await page.mouse.move(AWAY.x, AWAY.y);
      await sleep(100);
      await page.mouse.move(c.x, c.y);
      await waitExpanded('iso-img', true, 'マウスが離れて戻った後に開きません');
      await reset();
    });

    test('フォーカスで開いている間に Esc キーを押すと閉じ、フォーカスが外れるまで閉じたまま', async () => {
      await reset();
      await page.locator('#row-a-link-0').focus();
      await page.keyboard.press('Tab');
      await waitExpanded('row-a-0', true, 'フォーカスがあっても開きません');
      await page.keyboard.press('Escape');
      await waitExpanded('row-a-0', false, 'Esc キーで閉じません');
      // 評価ボックスの中でフォーカスを移しても、閉じたまま
      await page.keyboard.press('Tab');
      assert.equal((await activeBox())?.rating, 'poor', 'Esc キーの後、Tab キーで「悪い」に移れません');
      await sleep(300);
      assert.equal((await info('row-a-0')).expanded, false, 'フォーカスが中にあるのに、Esc キーの後でまた開きました');
      // フォーカスが外れてから戻ると、また開く
      await page.keyboard.press('Tab');
      await waitExpanded('row-a-0', false, 'フォーカスが外れても閉じません');
      await page.keyboard.press('Shift+Tab');
      assert.equal((await activeBox())?.rating, 'poor');
      await waitExpanded('row-a-0', true, 'フォーカスが外れて戻った後に開きません');
      await reset();
    });

    test('マウスを重ねて開いた後、ボタンは動かず、「良い」を押すと評価が保存され、閉じると印に「○」が出る', async () => {
      await reset();
      const c = await badgeCenter('iso-img');
      await page.mouse.move(c.x, c.y);
      await waitExpanded('iso-img', true, '印にマウスを重ねても開きません');
      const b1 = await buttonCenter('iso-img', 'good');
      await sleep(300);
      const b2 = await buttonCenter('iso-img', 'good');
      assert.ok(Math.abs(b1.x - b2.x) <= 1 && Math.abs(b1.y - b2.y) <= 1, `開いた後にボタンが動きました（${b1.x},${b1.y} → ${b2.x},${b2.y}）`);
      // 印からボタンまで、マウスを少しずつ動かす（途中で閉じない）
      await page.mouse.move(b2.x, b2.y, { steps: 10 });
      assert.equal((await info('iso-img')).expanded, true, 'ボタンへマウスを動かす途中で閉じました');
      const b3 = await buttonCenter('iso-img', 'good');
      assert.ok(Math.abs(b3.x - b2.x) <= 1 && Math.abs(b3.y - b2.y) <= 1, 'マウスを動かすとボタンが動きました');
      await page.mouse.down();
      await page.mouse.up();
      await waitFor(
        () => page.evaluate(() => window.__t.state(window.__t.boxFor(document.getElementById('iso-img'))).pressed.good === 'true'),
        { message: '「良い」が押した状態になりません' },
      );
      const key = storageKey(pageUrl, h.url('img/iso-img.png'), '設定');
      await waitFor(async () => (await h.storageAll())[key]?.rating === 'good', { message: `評価が保存されません：${key}` });
      await page.mouse.move(AWAY.x, AWAY.y);
      await page.evaluate(() => window.__t.deepActive()?.blur());
      await waitExpanded('iso-img', false, '評価した後、マウスとフォーカスが離れても閉じません');
      const i = await info('iso-img');
      assert.equal(i.badgeText, '○', '「良い」と評価した印に「○」が出ません');
      assert.equal(i.badgeAriaHidden, 'true');
      const c2 = await page.evaluate(() => window.__t.contrast(window.__t.boxFor(document.getElementById('iso-img')).shadowRoot.querySelector('div.badge')));
      assert.ok(c2.ratio >= 4.5, `印の「○」の文字と背景のコントラスト比：${c2.ratio.toFixed(2)}（文字 ${c2.fg}、背景 ${c2.bg}）`);
    });

    test('「悪い」と評価すると印に「×」が出て、取り消すと空に戻る', async () => {
      await reset();
      const box = await boxLocator(page, 'iso-img');
      const open = async () => {
        const c = await badgeCenter('iso-img');
        await page.mouse.move(c.x, c.y);
        await waitExpanded('iso-img', true, '印にマウスを重ねても開きません');
      };
      await open();
      await box.locator('button[data-rating="poor"]').click();
      await waitFor(async () => (await box.locator('button[data-rating="poor"]').getAttribute('aria-pressed')) === 'true', { message: '「悪い」が押した状態になりません' });
      await reset();
      assert.equal((await info('iso-img')).badgeText, '×', '「悪い」と評価した印に「×」が出ません');
      await open();
      await box.locator('button[data-rating="poor"]').click();
      await waitFor(async () => (await box.locator('button[data-rating="poor"]').getAttribute('aria-pressed')) === 'false', { message: '取り消せません' });
      await reset();
      assert.equal((await info('iso-img')).badgeText, '', '取り消した後の印の中が空ではありません');
      const key = storageKey(pageUrl, h.url('img/iso-img.png'), '設定');
      await waitFor(async () => (await h.storageAll())[key] === undefined, { message: '取り消しても評価が削除されません' });
    });
  });

  describe('印の位置', () => {
    before(reset);

    /** 印の左上と、画像の見えている部分（DOM の順の、印の評価ボックスすべて） */
    const placements = () =>
      page.evaluate(() =>
        window.__t
          .targetImages()
          .map((img) => ({ img, box: window.__t.boxFor(img) }))
          .filter(({ box }) => box && box.getAttribute('data-mode') === 'badge')
          .map(({ img, box }) => {
            const badge = box.shadowRoot.querySelector('div.badge');
            const r = badge ? badge.getBoundingClientRect() : null;
            return { id: img.id, visible: window.__t.visibleRectOf(img), badge: r && { left: r.left, top: r.top, width: r.width, height: r.height } };
          }),
      );

    for (const id of ['iso-img', 'iso-svg']) {
      test(`ほかと離れたアイコン（#${id}）：印の左上は、見えている部分の右端から12px左、上端から8px上`, async () => {
        const all = await placements();
        const p = all.find((x) => x.id === id);
        assert.ok(p?.badge, `#${id} の印がありません`);
        const ex = { left: p.visible.right - 12, top: p.visible.top - 8 };
        const detail = `（印の左上 ${p.badge.left},${p.badge.top}、期待 ${ex.left},${ex.top}）`;
        assert.ok(Math.abs(p.badge.left - ex.left) <= TOLERANCE, `左の位置${detail}`);
        assert.ok(Math.abs(p.badge.top - ex.top) <= TOLERANCE, `上の位置${detail}`);
      });
    }

    test('前提：テスト側の計算で、集まりのアイコンの印が右上・右下・左下・左上のすべてを使う（テスト自体の確認）', async () => {
      const all = await placements();
      const exp = expectedPlacement(all.map((p) => p.visible));
      const corners = CLUSTER_IDS.map((id) => exp[all.findIndex((p) => p.id === id)].corner);
      assert.deepEqual(corners, CLUSTER_CORNERS);
      const rowCorners = ROW_IDS.map((id) => exp[all.findIndex((p) => p.id === id)].corner);
      assert.deepEqual(rowCorners, [1, 1, 1, 1, 1], '24px のアイコンを 4px の間隔で並べると、すべて右上に置ける');
    });

    for (const [label, ids] of [
      ['24px のアイコンを 4px の間隔で並べたメニュー', ROW_IDS],
      ['詰めて置いたアイコンの集まり', CLUSTER_IDS],
    ]) {
      test(`${label}：各印は、右上・右下・左下・左上の順で、先に置いた印と重ならない最初の位置に置かれる`, async () => {
        const all = await placements();
        const exp = expectedPlacement(all.map((p) => p.visible));
        const errors = [];
        for (const id of ids) {
          const i = all.findIndex((p) => p.id === id);
          const p = all[i];
          const e = exp[i];
          if (!p.badge) {
            errors.push(`#${id}：印がありません`);
            continue;
          }
          if (Math.abs(p.badge.left - e.left) > TOLERANCE || Math.abs(p.badge.top - e.top) > TOLERANCE) {
            const actualCorner = cornerPositions(p.visible).findIndex((c) => Math.abs(c.left - p.badge.left) <= TOLERANCE && Math.abs(c.top - p.badge.top) <= TOLERANCE);
            errors.push(
              `#${id}：期待は${CORNER_NAMES[e.corner]}（${e.left},${e.top}）、実際は${actualCorner >= 0 ? CORNER_NAMES[actualCorner + 1] : 'どの角でもない位置'}（${p.badge.left},${p.badge.top}）`,
            );
          }
        }
        assert.deepEqual(errors, []);
      });

      test(`${label}：印どうしが重ならない`, async () => {
        const all = (await placements()).filter((p) => ids.includes(p.id));
        const pairs = [];
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            const a = all[i].badge;
            const b = all[j].badge;
            if (!a || !b) continue;
            const ox = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
            const oy = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
            if (ox > 0.5 && oy > 0.5) pairs.push(`#${all[i].id} と #${all[j].id}（${ox.toFixed(1)}×${oy.toFixed(1)}px）`);
          }
        }
        assert.deepEqual(pairs, [], '重なっている印');
      });
    }

    test('画面の右端の近くの印を開いても、評価ボックスが画面の右端からはみ出さない', async () => {
      await reset();
      const c = await badgeCenter('edge-img');
      await page.mouse.move(c.x, c.y);
      await waitExpanded('edge-img', true, '印にマウスを重ねても開きません');
      await sleep(300);
      assert.equal((await info('edge-img')).expanded, true, '開いた後、マウスを重ねたままなのに閉じました（評価ボックスがマウスの下から外れた）');
      const r = await page.evaluate(() => {
        const box = window.__t.boxFor(document.getElementById('edge-img'));
        return { ext: window.__t.shownExtent(box), vw: document.documentElement.clientWidth, innerWidth };
      });
      assert.ok(r.ext.right <= r.vw + 0.5, `評価ボックスの右端 ${r.ext.right} が、画面の右端 ${r.vw} からはみ出しています`);
      assert.ok(r.ext.left >= 0, `評価ボックスの左端 ${r.ext.left} が、画面の左端からはみ出しています`);
      await reset();
    });
  });

  describe('印の見た目', () => {
    before(reset);

    const badgeStyle = (id) =>
      page.evaluate((id) => {
        const badge = window.__t.boxFor(document.getElementById(id)).shadowRoot.querySelector('div.badge');
        const cs = getComputedStyle(badge);
        const sides = ['Top', 'Right', 'Bottom', 'Left'];
        // 枠線の色と白のコントラスト比（暗い枠線か）
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = cs.borderTopColor;
        ctx.fillRect(0, 0, 1, 1);
        const px = Array.from(ctx.getImageData(0, 0, 1, 1).data);
        const f = (c) => {
          c /= 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const lum = 0.2126 * f(px[0]) + 0.7152 * f(px[1]) + 0.0722 * f(px[2]);
        return {
          forced: matchMedia('(forced-colors: active)').matches,
          shown: window.__t.visuallyShown(badge),
          borders: sides.map((s) => ({ side: s, style: cs[`border${s}Style`], width: parseFloat(cs[`border${s}Width`]) || 0 })),
          borderVsWhite: 1.05 / (lum + 0.05),
          borderColor: cs.borderTopColor,
          background: cs.backgroundColor,
          outlineStyle: cs.outlineStyle,
          outlineWidth: parseFloat(cs.outlineWidth) || 0,
          boxShadow: cs.boxShadow,
        };
      }, id);

    test('印に、2px以上の暗い枠線（四辺）と白い背景がある', async () => {
      const s = await badgeStyle('iso-img');
      for (const b of s.borders) {
        assert.ok(b.style !== 'none' && b.style !== 'hidden' && b.width >= 2, `${b.side} の枠線：${b.style} ${b.width}px`);
      }
      assert.ok(s.borderVsWhite >= 3, `枠線の色（${s.borderColor}）と白のコントラスト比が3未満です（${s.borderVsWhite.toFixed(2)}）`);
      assert.equal(s.background, 'rgb(255, 255, 255)', '印の背景が白ではありません');
    });

    test('枠線の外側に、白い線（outline か box-shadow）がある', async () => {
      const s = await badgeStyle('iso-img');
      assert.ok(
        (s.outlineStyle !== 'none' && s.outlineWidth >= 2) || (s.boxShadow && s.boxShadow !== 'none'),
        `外側の線がありません：outline ${s.outlineStyle} ${s.outlineWidth}px、box-shadow ${s.boxShadow}`,
      );
    });

    test('forced-colors（ハイコントラストモード）でも、印が見えて、四辺の枠線がある', async () => {
      await page.emulateMedia({ forcedColors: 'active' });
      try {
        const s = await badgeStyle('iso-img');
        assert.equal(s.forced, true, 'forced-colors のエミュレーションが効いていません');
        assert.equal(s.shown, true, 'forced-colors で印が見えません');
        for (const b of s.borders) {
          assert.ok(b.style !== 'none' && b.style !== 'hidden' && b.width > 0, `forced-colors で ${b.side} の枠線がありません：${b.style} ${b.width}px`);
        }
      } finally {
        await page.emulateMedia({ forcedColors: 'none' });
      }
    });
  });

  describe('タッチ', () => {
    let tp;
    let cdp;

    before(async () => {
      // 同じ URL のタブが2つあるとタブを区別できないため、# を付けて開く
      tp = await h.openFixture('badge.html', { hash: '#touch' });
      await tp.mouse.move(AWAY.x, AWAY.y);
      await h.enable(tp);
      await waitForBoxCount(tp, BOX_COUNT);
      cdp = await tp.context().newCDPSession(tp);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await tp.waitForTimeout(300);
    });

    after(async () => {
      await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
      await cdp?.detach().catch(() => {});
      await tp?.close().catch(() => {});
    });

    /** 画面の点をタッチする（pointerType が touch の pointerdown が起きる） */
    async function tap({ x, y }) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await tp.waitForTimeout(100);
    }

    test('印をタッチすると開き、評価ボックスの外をタッチすると閉じる', async () => {
      // 前提：タッチで pointerType が touch の pointerdown が起きる
      await tp.evaluate(() => {
        window.__pointerTypes = [];
        document.addEventListener('pointerdown', (e) => window.__pointerTypes.push(e.pointerType), true);
      });
      await tap(await badgeCenter('iso-svg', tp));
      assert.ok((await tp.evaluate(() => window.__pointerTypes)).includes('touch'), 'テストの前提：pointerType が touch の pointerdown が起きません');
      await waitExpanded('iso-svg', true, '印をタッチしても開きません', tp);
      await sleep(300);
      const i = await info('iso-svg', tp);
      assert.equal(i.expanded, true, 'タッチで開いた後、すぐに閉じました');
      assert.ok(i.buttons.every((b) => b.shown), 'タッチで開いてもボタンが見えません');
      assert.equal(i.lineShown, true, 'タッチで開いても1行目が見えません');
      await tap(BLANK);
      await waitExpanded('iso-svg', false, '評価ボックスの外をタッチしても閉じません', tp);
    });

    test('印をタッチして開くだけでは評価されない（開いた評価ボックスのボタンが、同じタッチのクリックを受けない）', async () => {
      await tap(await badgeCenter('cl-b', tp));
      await waitExpanded('cl-b', true, '印をタッチしても開きません', tp);
      await sleep(300);
      const pressed = await tp.evaluate(() => window.__t.state(window.__t.boxFor(document.getElementById('cl-b'))).pressed);
      assert.deepEqual(pressed, { good: 'false', poor: 'false' }, '印をタッチしただけで評価されました');
      const records = Object.entries(await h.storageAll()).filter(([k, v]) => k.startsWith('r:') && v?.name === 'B');
      assert.deepEqual(records.map(([k]) => k), [], '印をタッチしただけで評価が保存されました');
    });

    test('タッチで開いて「良い」をタッチすると評価され、外をタッチして閉じると印に「○」が出る', async () => {
      await tap(await badgeCenter('row-a-2', tp));
      await waitExpanded('row-a-2', true, '印をタッチしても開きません', tp);
      await sleep(200);
      await tap(await buttonCenter('row-a-2', 'good', tp));
      await waitFor(
        () => tp.evaluate(() => window.__t.state(window.__t.boxFor(document.getElementById('row-a-2'))).pressed.good === 'true'),
        { message: 'タッチで「良い」が押した状態になりません' },
      );
      await tp.evaluate(() => window.__t.deepActive()?.blur());
      await tap(BLANK);
      await waitExpanded('row-a-2', false, '評価ボックスの外をタッチしても閉じません', tp);
      assert.equal((await info('row-a-2', tp)).badgeText, '○');
    });
  });
});
