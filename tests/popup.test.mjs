// ポップアップ（popup.html?tabId=…）のテスト
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchExtension, clickRating, waitForBoxCount, waitFor, AXE_PATH } from './helpers/extension.mjs';

describe('ポップアップ', { timeout: 120000 }, () => {
  let h;
  let target;
  let tabId;
  let popup;

  before(async () => {
    h = await launchExtension();
    await h.clearStorage();
    target = await h.openFixture('simple.html');
    tabId = await h.tabIdFor(target);
    // 1枚だけ評価しておき、オフに戻す
    await h.enable(target);
    await waitForBoxCount(target, 3);
    await clickRating(target, 'img1', 'good');
    await waitFor(async () => Object.keys(await h.storageAll()).some((k) => k.startsWith('r:')), { message: '保存されません' });
    await h.disable(target);
    await waitForBoxCount(target, 0);
  });

  after(async () => {
    await h?.close();
  });

  async function openPopup() {
    const p = await h.context.newPage();
    await p.goto(`chrome-extension://${h.extensionId}/src/popup/popup.html?tabId=${tabId}`, { waitUntil: 'load' });
    await p.waitForTimeout(300);
    return p;
  }

  const toggleButton = (p) => p.getByRole('button', { name: /評価モード/ }).first();
  const statusText = (p) =>
    p.evaluate(() =>
      Array.from(document.querySelectorAll('[role="status"], [aria-live]'))
        .map((e) => e.textContent.replace(/\s+/g, ' ').trim())
        .join(' '),
    );
  const bodyText = (p) => p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));

  test('html に lang があり、評価モードを切り替えるボタンがある', async () => {
    popup = await openPopup();
    const lang = await popup.evaluate(() => document.documentElement.getAttribute('lang'));
    assert.ok(lang && lang.trim() !== '', 'html の lang がありません');
    assert.equal(await toggleButton(popup).count(), 1, '名前に「評価モード」を含むボタンがありません');
  });

  test('オフの時は、評価モードがオフであることを表示する', async () => {
    const text = await bodyText(popup);
    assert.match(text, /オフ/, `ポップアップの文字：${text}`);
  });

  test('ボタンで評価モードをオンにすると、対象のタブに評価ボックスが挿入され、件数を表示する', async () => {
    const before = await statusText(popup);
    await toggleButton(popup).click();
    await waitFor(async () => (await h.getState(target)).enabled === true, { message: '対象のタブで評価モードがオンになりません' });
    await waitForBoxCount(target, 3);
    await waitFor(async () => /3/.test(await bodyText(popup)) && /1/.test(await bodyText(popup)), {
      message: 'ポップアップに画像の数（3）と評価済みの数（1）が表示されません',
    }).catch(async (e) => {
      throw new Error(`${e.message}：${await bodyText(popup)}`);
    });
    const text = await bodyText(popup);
    assert.match(text, /オン/, `ポップアップの文字：${text}`);
    const after = await statusText(popup);
    assert.ok(after !== '' && after !== before, `状態を伝える領域（role="status" か aria-live）の文字が変わりません：「${before}」→「${after}」`);
  });

  test('もう一度開いたポップアップも、オンの状態と件数を表示する', async () => {
    await popup.close();
    popup = await openPopup();
    const text = await bodyText(popup);
    assert.match(text, /オン/, `ポップアップの文字：${text}`);
    assert.match(text, /3/);
    assert.match(text, /1/);
  });

  test('ボタンでオフにすると、対象のタブの評価ボックスが消える', async () => {
    const before = await statusText(popup);
    await toggleButton(popup).click();
    await waitFor(async () => (await h.getState(target)).enabled === false, { message: '対象のタブで評価モードがオフになりません' });
    await waitForBoxCount(target, 0);
    await waitFor(async () => /オフ/.test(await bodyText(popup)), { message: 'ポップアップにオフが表示されません' });
    const after = await statusText(popup);
    assert.ok(after !== '' && after !== before, `状態を伝える領域の文字が変わりません：「${before}」→「${after}」`);
  });

  test('キーボードだけで評価モードを切り替えられる', async () => {
    await toggleButton(popup).focus();
    await popup.keyboard.press('Enter');
    await waitFor(async () => (await h.getState(target)).enabled === true, { message: 'Enter キーでオンになりません' });
    await toggleButton(popup).focus();
    await popup.keyboard.press('Space');
    await waitFor(async () => (await h.getState(target)).enabled === false, { message: 'Space キーでオフになりません' });
  });

  test('ポップアップに axe-core の違反が無い', async () => {
    // 拡張機能のページの CSP はインラインのスクリプトを禁止するため、CDP で直接評価する
    const cdp = await popup.context().newCDPSession(popup);
    await cdp.send('Runtime.evaluate', { expression: fs.readFileSync(AXE_PATH, 'utf8') });
    await cdp.detach().catch(() => {});
    const has = await popup.evaluate(() => typeof window.axe === 'object');
    assert.ok(has, 'axe-core をポップアップに読み込めませんでした（CSP の可能性）');
    const violations = await popup.evaluate(async () => {
      const r = await window.axe.run(document, {
        resultTypes: ['violations'],
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      });
      return r.violations.map((v) => `${v.id}：${v.nodes.map((n) => JSON.stringify(n.target)).join(', ')}`);
    });
    assert.deepEqual(violations, []);
  });
});
