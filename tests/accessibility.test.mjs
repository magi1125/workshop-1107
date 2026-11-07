// 評価ボックスのアクセシビリティのテスト
// (a) Chromium のアクセシビリティツリー、(b) axe-core、(c) フォーカスの見え方、
// (d) forced-colors、(e) コントラスト比
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, boxLocator, waitForBoxCount, waitFor, AXE_PATH } from './helpers/extension.mjs';

// ---- アクセシビリティツリー ----

/** CDP の getFullAXTree を、読み上げの順（木の深さ優先）に並べる。無視されたノードは除く */
async function linearAXTree(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const root = nodes.find((n) => !n.parentId) || nodes[0];
    const out = [];
    const walk = (n) => {
      if (!n) return;
      if (!n.ignored) out.push({ role: n.role?.value ?? '', name: (n.name?.value ?? '').replace(/\s+/g, ' ').trim() });
      for (const id of n.childIds || []) walk(byId.get(id));
    };
    walk(root);
    return out;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** 読み上げられる文字（StaticText）をつなげたもの */
const spokenText = (ax) =>
  ax
    .filter((n) => n.role === 'StaticText')
    .map((n) => n.name)
    .join('\n');

// ---- axe-core ----

async function runAxe(page) {
  const has = await page.evaluate(() => typeof window.axe === 'object');
  if (!has) await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, {
      iframes: false,
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    }));
  });
}

const flatten = (violations) =>
  violations.flatMap((v) => v.nodes.map((n) => ({ id: v.id, target: JSON.stringify(n.target), summary: n.summary, help: v.help })));

/** 拡張機能を入れた後で新しく出た違反 */
function newViolations(baseline, after) {
  const seen = new Set(flatten(baseline).map((x) => `${x.id} ${x.target}`));
  return flatten(after).filter((x) => !seen.has(`${x.id} ${x.target}`));
}

describe('評価ボックスのアクセシビリティ', { timeout: 240000 }, () => {
  let h;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
  });

  after(async () => {
    await h?.close();
  });

  describe('アクセシビリティツリー', () => {
    let page;
    let ax;
    before(async () => {
      page = await h.openFixture('boxes.html');
      await h.enable(page);
      await waitForBoxCount(page, 17);
      ax = await linearAXTree(page);
    });
    after(async () => page?.close());

    test('名前ありの画像の名前は、画像からだけ伝わり、評価ボックスから2回目が読まれない', () => {
      const images = ax.filter((n) => n.role === 'image' && n.name === '青い空と白い雲');
      assert.equal(images.length, 1, '画像のノードが見つかりません');
      const spoken = spokenText(ax);
      assert.ok(!spoken.includes('青い空と白い雲'), '評価ボックスの中で画像の名前が読み上げられます');
      assert.ok(!spoken.includes('名前：'), '名前ありの1行目（名前：…）が読み上げられます');
    });

    test('名前ありの画像の直後には、「直前の画像の評価」のグループが来る', () => {
      const i = ax.findIndex((n) => n.role === 'image' && n.name === '青い空と白い雲');
      const next = ax.slice(i + 1).find((n) => n.name !== '' && n.role !== 'generic' && n.role !== 'none');
      assert.deepEqual(next && { role: next.role, name: next.name }, { role: 'group', name: '直前の画像の評価' });
    });

    test('空の名前・名前なし・伝わらない画像では、1行目が読み上げられる', () => {
      const spoken = spokenText(ax);
      for (const text of [
        '読み上げられない画像（空のalt）',
        '読み上げられない画像（role="presentation"）',
        '名前なし（ファイル名が読み上げられる場合があります）',
        'スクリーンリーダーに伝わらない画像（aria-hidden）。alt：隠れた装飾',
        'スクリーンリーダーに伝わらない画像（aria-hidden）。空のalt',
        'スクリーンリーダーに伝わらない画像（aria-hidden）。alt属性なし',
      ]) {
        assert.ok(spoken.replace(/\n/g, '').includes(text), `読み上げられません：${text}`);
      }
    });

    test('グループと「良い」「悪い」のボタンが、評価ボックスの数だけツリーにある', () => {
      // 閉じた details の summary の中の画像の評価ボックスも、details の直後に入るためツリーにある
      const count = (role, name) => ax.filter((n) => n.role === role && n.name === name).length;
      assert.equal(count('group', '直前の画像の評価'), 17);
      assert.equal(count('button', '良い'), 17);
      assert.equal(count('button', '悪い'), 17);
      assert.equal(ax.filter((n) => n.role === 'button' && n.name === '普通').length, 0, '「普通」のボタンがあります');
    });

    test('記号「○」「×」は読み上げられない（aria-hidden）', () => {
      const symbols = ax.filter((n) => /[○×]/.test(n.name));
      assert.deepEqual(symbols, [], '記号を含むノードがツリーにあります');
    });

    test('閉じた details の summary の中の画像でも、評価ボックスが表示され、Tab キーで届く', async () => {
      // 企画書：評価ボックスは、読み上げ順と Tab キーの移動順で画像のすぐ後ろに来る。
      // 契約の「summary の直後」に入れると、閉じた details の中になり、見えず、フォーカスもできない
      const r = await page.evaluate(() => {
        const box = window.__t.boxFor(document.getElementById('in-summary'));
        const good = box && box.shadowRoot.querySelector('button[data-rating="good"]');
        return {
          exists: !!box,
          rendered: !!good && good.getClientRects().length > 0 && box.checkVisibility(),
        };
      });
      assert.equal(r.exists, true, '評価ボックスがありません');
      await page.locator('#sum').focus();
      await page.keyboard.press('Tab');
      const a = await page.evaluate(() => window.__t.describeActive());
      const idx = await page.evaluate(() => window.__t.boxes().indexOf(window.__t.boxFor(document.getElementById('in-summary'))));
      assert.ok(
        r.rendered && a?.kind === 'box' && a.boxIndex === idx,
        `閉じた details の中にあるため、評価ボックスが表示されず Tab キーでも届きません（表示：${r.rendered}、summary の次のフォーカス：${JSON.stringify(a)}）`,
      );
    });
  });

  describe('axe-core', () => {
    for (const fixture of ['boxes.html', 'simple.html', 'compact.html']) {
      test(`${fixture}：評価ボックスを入れても、axe-core の違反が増えない`, async (t) => {
        const page = await h.openFixture(fixture);
        try {
          const baseline = await runAxe(page);
          await h.enable(page, { announce: true });
          await waitFor(() => page.evaluate(() => window.__t.boxes().length > 0), { message: '評価ボックスが挿入されません' });
          await page.waitForTimeout(300);
          const afterViolations = await runAxe(page);
          const added = newViolations(baseline, afterViolations);
          for (const v of added) t.diagnostic(`${v.id}：${v.target}：${v.help}`);
          assert.deepEqual(
            added.map((v) => `${v.id} ${v.target}`),
            [],
            `拡張機能による axe-core の違反：\n${added.map((v) => `${v.id} ${v.target}\n  ${v.summary}`).join('\n')}`,
          );
          // 評価ボックスの中の違反が無いことも、ホストを含む target で確かめる
          const inside = flatten(afterViolations).filter((v) => /alt-eval/.test(v.target));
          assert.deepEqual(inside.map((v) => `${v.id} ${v.target}`), []);
        } finally {
          await page.close();
        }
      });
    }

    test('compact.html：1行目を表示した状態（マウスとフォーカス）でも、axe-core の違反が増えない', async () => {
      const page = await h.openFixture('compact.html');
      try {
        const baseline = await runAxe(page);
        await h.enable(page);
        await waitForBoxCount(page, 8);
        const small = await boxLocator(page, 'small');
        await small.locator('button[data-rating="good"]').focus();
        const card = await boxLocator(page, 'card-img');
        await card.locator('button[data-rating="good"]').hover();
        await page.waitForTimeout(300);
        const added = newViolations(baseline, await runAxe(page));
        assert.deepEqual(
          added.map((v) => `${v.id} ${v.target}`),
          [],
          `拡張機能による axe-core の違反：\n${added.map((v) => `${v.id} ${v.target}\n  ${v.summary}`).join('\n')}`,
        );
      } finally {
        await page.close();
      }
    });
  });

  describe('小さい表示のアクセシビリティツリー', () => {
    let page;
    let ax;
    let modes;
    before(async () => {
      page = await h.openFixture('compact.html');
      await h.enable(page);
      await waitForBoxCount(page, 8);
      await page.mouse.move(1270, 890);
      modes = await page.evaluate(() => window.__t.boxes().map((b) => b.getAttribute('data-mode')));
      ax = await linearAXTree(page);
    });
    after(async () => page?.close());

    test('前提：大きい画像の1つを除いて、小さい表示になっている', () => {
      assert.deepEqual(modes.filter((m) => m === 'compact').length, 7, `data-mode：${JSON.stringify(modes)}`);
    });

    test('グループと「良い」「悪い」の2つのボタンが、評価ボックスの数だけツリーにある', () => {
      const count = (role, name) => ax.filter((n) => n.role === role && n.name === name).length;
      assert.equal(count('group', '直前の画像の評価'), 8);
      assert.equal(count('button', '良い'), 8);
      assert.equal(count('button', '悪い'), 8);
      assert.equal(ax.filter((n) => n.role === 'button' && /^(良い|悪い)$/.test(n.name)).length, 16);
      assert.deepEqual(ax.filter((n) => /[○×]/.test(n.name)), [], '記号を含むノードがツリーにあります');
      assert.equal(ax.filter((n) => n.role === 'button' && /^評価/.test(n.name)).length, 0, '「評価」ボタンがあります');
    });

    test('1行目を視覚的に隠していても、空の名前・名前なしの画像の1行目は読み上げられる', () => {
      const spoken = spokenText(ax).replace(/\n/g, '');
      for (const text of ['読み上げられない画像（空のalt）', '名前なし（ファイル名が読み上げられる場合があります）']) {
        assert.ok(spoken.includes(text), `読み上げられません：${text}`);
      }
    });

    test('名前ありの画像の1行目（名前：…）は、小さい表示でも読み上げられない', () => {
      const spoken = spokenText(ax);
      assert.ok(!spoken.includes('名前：'), '名前ありの1行目が読み上げられます');
    });

    test('名前なしの画像の直後に、1行目、「直前の画像の評価」のグループの順に来る', async () => {
      const i = ax.findIndex((n) => n.role === 'StaticText' && n.name.includes('名前なし（ファイル名が読み上げられる場合があります）'));
      assert.ok(i >= 0, '1行目がツリーにありません');
      const next = ax.slice(i + 1).find((n) => n.name !== '' && n.role !== 'generic' && n.role !== 'none' && n.role !== 'InlineTextBox');
      assert.deepEqual(next && { role: next.role, name: next.name }, { role: 'group', name: '直前の画像の評価' });
    });
  });

  describe('見た目', () => {
    let page;
    before(async () => {
      page = await h.openFixture('simple.html');
      await h.enable(page);
      await waitForBoxCount(page, 3);
    });
    after(async () => page?.close());

    async function focusFirstRatingButtonByKeyboard() {
      await page.locator('#a1').focus();
      await page.keyboard.press('Tab');
      const a = await page.evaluate(() => window.__t.describeActive());
      assert.equal(a?.rating, 'good', `Tab キーで評価ボタンに移れません：${JSON.stringify(a)}`);
    }

    const focusStyle = () =>
      page.evaluate(() => {
        const el = window.__t.deepActive();
        const cs = getComputedStyle(el);
        return {
          outlineStyle: cs.outlineStyle,
          outlineWidth: parseFloat(cs.outlineWidth) || 0,
          boxShadow: cs.boxShadow,
          focusVisible: el.matches(':focus-visible'),
        };
      });

    test('(c) キーボードでフォーカスした評価ボタンに、outline か box-shadow がある', async () => {
      await focusFirstRatingButtonByKeyboard();
      const s = await focusStyle();
      assert.ok(s.focusVisible, ':focus-visible になっていません');
      assert.ok(
        (s.outlineStyle !== 'none' && s.outlineWidth > 0) || (s.boxShadow && s.boxShadow !== 'none'),
        `フォーカスが見えません：${JSON.stringify(s)}`,
      );
    });

    test('(e) 評価ボタンの文字と背景のコントラスト比が 4.5 以上（押していない時・押した時）', async () => {
      await page.evaluate(() => window.__t.deepActive()?.blur());
      await page.mouse.move(0, 0);
      const measure = () =>
        page.evaluate(() => {
          const contrast = window.__t.contrast;
          const box = window.__t.boxFor(document.getElementById('img1'));
          const root = box.shadowRoot;
          const out = {};
          for (const b of root.querySelectorAll('button[data-rating]')) out[b.dataset.rating] = contrast(b);
          out.line = contrast(root.querySelector('p.line'));
          return out;
        });
      const normal = await measure();
      for (const [k, v] of Object.entries(normal)) {
        assert.ok(v.ratio >= 4.5, `${k}（押していない時）：${v.ratio.toFixed(2)}（文字 ${v.fg}、背景 ${v.bg}）`);
      }
      const box = await boxLocator(page, 'img1');
      for (const r of ['good', 'poor']) {
        await box.locator(`button[data-rating="${r}"]`).click();
        await waitFor(async () => (await box.locator(`button[data-rating="${r}"]`).getAttribute('aria-pressed')) === 'true');
        await page.evaluate(() => window.__t.deepActive()?.blur());
        await page.mouse.move(0, 0);
        const pressed = (await measure())[r];
        assert.ok(pressed.ratio >= 4.5, `${r}（押した時）：${pressed.ratio.toFixed(2)}（文字 ${pressed.fg}、背景 ${pressed.bg}）`);
      }
      // 後片付け：取り消す
      await box.locator('button[data-rating="poor"]').click();
    });

    test('(d) forced-colors でも、評価ボタンと評価ボックスに枠線があり、フォーカスが outline で見える', async () => {
      await page.emulateMedia({ forcedColors: 'active' });
      try {
        const r = await page.evaluate(() => {
          const box = window.__t.boxFor(document.getElementById('img1'));
          const root = box.shadowRoot;
          const sides = ['Top', 'Right', 'Bottom', 'Left'];
          const hasBorder = (el) => {
            const cs = getComputedStyle(el);
            return sides.every((s) => cs[`border${s}Style`] !== 'none' && cs[`border${s}Style`] !== 'hidden' && parseFloat(cs[`border${s}Width`]) > 0);
          };
          const buttons = Array.from(root.querySelectorAll('button[data-rating]')).map((b) => ({ rating: b.dataset.rating, border: hasBorder(b) }));
          // 評価ボックスの枠：ホスト要素か、シャドウルートの中のボタン以外の要素のどれかに、四辺の枠線がある
          const frame = hasBorder(box) || Array.from(root.querySelectorAll('*')).some((el) => el.localName !== 'button' && hasBorder(el));
          return { forced: matchMedia('(forced-colors: active)').matches, buttons, frame };
        });
        assert.equal(r.forced, true, 'forced-colors のエミュレーションが効いていません');
        for (const b of r.buttons) assert.ok(b.border, `${b.rating} のボタンに枠線がありません`);
        assert.ok(r.frame, '評価ボックスに枠線がありません');
        await focusFirstRatingButtonByKeyboard();
        const s = await focusStyle();
        assert.ok(s.outlineStyle !== 'none' && s.outlineWidth > 0, `forced-colors でフォーカスの outline がありません（box-shadow は消えます）：${JSON.stringify(s)}`);
      } finally {
        await page.emulateMedia({ forcedColors: 'none' });
      }
    });
  });
});
