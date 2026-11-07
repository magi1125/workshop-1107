// テスト用のハーネス。
// - 拡張機能を一時フォルダにコピーし、コピーの manifest.json にだけ host_permissions を加える
// - Chromium に拡張機能を読み込んで起動し、service worker を待つ
// - tests/fixtures を配信する HTTP サーバーを起動する
// - service worker の globalThis.altEval を通して評価モードを操作する
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
export const FIXTURES_DIR = path.join(REPO_ROOT, 'tests', 'fixtures');
export const PAGE_HELPERS_PATH = path.join(here, 'page-helpers.js');
export const AXE_PATH = path.join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js');
export const ACCESSIBLE_NAME_PATH = path.join(REPO_ROOT, 'src', 'content', 'accessible-name.js');

// 1×1 の PNG。/img/ 以下のどのパスにもこれを返す
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

/** 指定の時間だけ待つ */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 条件が真になるまで待つ。時間切れの時は message を含むエラーを投げる */
export async function waitFor(fn, { timeout = 5000, interval = 50, message = '条件を満たしませんでした' } = {}) {
  const start = Date.now();
  let last;
  let lastError;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() - start > timeout) {
      const detail = lastError ? `（最後のエラー：${lastError.message}）` : '';
      throw new Error(`${message}（${timeout}ms 待ちました）${detail}`);
    }
    await sleep(interval);
  }
}

/** tests/fixtures を配信する HTTP サーバーを起動する */
export async function startServer() {
  // 受けたリクエストのパス（? 以降を含む）。画像を操作した時だけ読み込むかの確認に使う
  const requests = [];
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      requests.push(url.pathname + url.search);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/img/')) {
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(PNG_1PX);
        return;
      }
      if (pathname === '/submitted') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html lang="ja"><title>送信されました</title><p>送信されました</p></html>');
        return;
      }
      const file = path.normalize(path.join(FIXTURES_DIR, pathname));
      if (!file.startsWith(FIXTURES_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    server,
    requests,
    origin: `http://127.0.0.1:${port}`,
    url: (p) => `http://127.0.0.1:${port}/${p.replace(/^\//, '')}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** 拡張機能を一時フォルダにコピーし、コピーの manifest.json にだけ host_permissions を加える */
export function prepareExtensionCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-eval-ext-'));
  for (const name of ['manifest.json', '_locales', 'src', 'icons']) {
    const from = path.join(REPO_ROOT, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, name), { recursive: true });
  }
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const hosts = new Set(manifest.host_permissions || []);
  hosts.add('<all_urls>');
  manifest.host_permissions = [...hosts];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

/**
 * 拡張機能を読み込んだ Chromium と、フィクスチャのサーバーを起動する。
 * 戻り値の close() は、ブラウザ・サーバー・一時フォルダをすべて片付ける。
 */
export async function launchExtension({ timeout = 20000 } = {}) {
  const extDir = prepareExtensionCopy();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-eval-profile-'));
  let context;
  let server;
  const cleanup = async () => {
    try {
      await context?.close();
    } catch {}
    try {
      await server?.close();
    } catch {}
    for (const d of [extDir, userDataDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {}
    }
  };
  try {
    server = await startServer();
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      locale: 'ja-JP',
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    });
    context.setDefaultTimeout(10000);
    const sw = await findServiceWorker(context, timeout);
    const extensionId = new URL(sw.url()).host;
    const h = new ExtensionHarness(context, server, extensionId, cleanup);
    await h.waitForAltEval(timeout);
    return h;
  } catch (e) {
    await cleanup();
    throw e;
  }
}

async function findServiceWorker(context, timeout) {
  const pick = () => context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  let sw = pick();
  if (sw) return sw;
  try {
    sw = await context.waitForEvent('serviceworker', {
      timeout,
      predicate: (w) => w.url().startsWith('chrome-extension://'),
    });
  } catch {
    sw = pick();
  }
  if (!sw) throw new Error('拡張機能の service worker が起動しませんでした（manifest.json か background.js を確認してください）');
  return sw;
}

export class ExtensionHarness {
  constructor(context, server, extensionId, cleanup) {
    this.context = context;
    this.server = server;
    this.extensionId = extensionId;
    this._cleanup = cleanup;
  }

  async close() {
    await this._cleanup();
  }

  /** フィクスチャの URL */
  url(p) {
    return this.server.url(p);
  }

  /** 現在の service worker（停止して再起動した場合にも対応） */
  async sw() {
    return findServiceWorker(this.context, 10000);
  }

  /** service worker の中で関数を実行する */
  async swEval(fn, arg) {
    let lastError;
    for (let i = 0; i < 3; i++) {
      try {
        const sw = await this.sw();
        return await sw.evaluate(fn, arg);
      } catch (e) {
        lastError = e;
        // service worker が入れ替わった直後は、もう一度試す
        if (!/Target closed|has been closed|destroyed|detached/i.test(String(e?.message))) throw e;
        await sleep(200);
      }
    }
    throw lastError;
  }

  async waitForAltEval(timeout = 20000) {
    await waitFor(
      () =>
        this.swEval(
          () =>
            typeof globalThis.altEval === 'object' &&
            typeof globalThis.altEval?.setEnabled === 'function' &&
            typeof globalThis.altEval?.getState === 'function',
        ),
      { timeout, message: 'service worker に globalThis.altEval（getState と setEnabled）が定義されませんでした' },
    );
  }

  /** フィクスチャのページを新しいタブで開く。ページ用の補助関数（window.__t）も読み込む */
  async openFixture(name, { hash = '' } = {}) {
    const page = await this.context.newPage();
    await page.addInitScript({ path: PAGE_HELPERS_PATH });
    await page.goto(this.url(name) + hash, { waitUntil: 'load' });
    // 画像の読み込みとレイアウトを待つ
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return page;
  }

  /** ページのタブの id を chrome.tabs.query で探す */
  async tabIdFor(page) {
    const url = page.url();
    const id = await waitFor(
      () =>
        this.swEval(async (u) => {
          const tabs = await chrome.tabs.query({});
          const found = tabs.filter((t) => t.url === u || t.pendingUrl === u);
          return found.length === 1 ? found[0].id : null;
        }, url),
      { timeout: 5000, message: `タブが1つに決まりませんでした：${url}` },
    );
    return id;
  }

  async setEnabled(page, enabled, { announce = false } = {}) {
    const tabId = await this.tabIdFor(page);
    return this.swEval(
      ({ tabId, enabled, announce }) => globalThis.altEval.setEnabled(tabId, enabled, { announce }),
      { tabId, enabled, announce },
    );
  }

  async enable(page, opts) {
    const state = await this.setEnabled(page, true, opts);
    // 挿入の完了を少し待つ
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return state;
  }

  async disable(page, opts) {
    return this.setEnabled(page, false, opts);
  }

  async getState(page) {
    const tabId = await this.tabIdFor(page);
    return this.swEval((tabId) => globalThis.altEval.getState(tabId), tabId);
  }

  async storageAll() {
    return this.swEval(() => chrome.storage.local.get(null));
  }

  async clearStorage() {
    return this.swEval(() => chrome.storage.local.clear());
  }

  /** 開いているページ（拡張機能のページを除く）をすべて閉じる */
  async closePages() {
    for (const p of this.context.pages()) {
      try {
        await p.close();
      } catch {}
    }
  }
}

/** 拡張機能を読み込まない Chromium（accessible-name.js の単体のテスト用） */
export async function launchPlain() {
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
  } catch (e) {
    await server.close();
    throw e;
  }
  return {
    browser,
    server,
    url: server.url,
    async close() {
      try {
        await browser.close();
      } catch {}
      await server.close();
    },
  };
}

// ---- ページの評価ボックスを操作する補助関数（Node 側） ----

/** 画像の id から、対応する評価ボックスの番号（document の順）を返す。無ければ -1 */
export async function boxIndexOf(page, imgId) {
  return page.evaluate((id) => {
    const img = document.getElementById(id);
    const box = img && window.__t.boxFor(img);
    return box ? window.__t.boxes().indexOf(box) : -1;
  }, imgId);
}

/** 画像の id から評価ボックスの Locator を返す（無ければエラー） */
export async function boxLocator(page, imgId) {
  const idx = await boxIndexOf(page, imgId);
  if (idx < 0) throw new Error(`画像 #${imgId} の評価ボックスが見つかりません`);
  return page.locator('alt-eval-box[data-alt-eval="box"]').nth(idx);
}

/** 画像の id から評価ボックスの状態を返す */
export async function boxState(page, imgId) {
  return page.evaluate((id) => {
    const img = document.getElementById(id);
    const box = img && window.__t.boxFor(img);
    return box ? window.__t.state(box) : null;
  }, imgId);
}

/**
 * 印（data-mode="badge"）の評価ボックスなら、印にマウスを重ねて開き、開くまで待つ。
 * それ以外の評価ボックスでは何もしない
 */
export async function openIfBadge(page, box) {
  if ((await box.getAttribute('data-mode')) !== 'badge') return;
  const expanded = () => box.evaluate((b) => !!b.shadowRoot?.querySelector('.wrapper')?.classList.contains('expanded'));
  if (await expanded()) return;
  const r = await box.evaluate((b) => {
    const badge = b.shadowRoot?.querySelector('div.badge');
    const rect = (badge || b).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(r.x, r.y);
  await waitFor(expanded, { timeout: 3000, message: '印にマウスを重ねても評価ボックスが開きません（wrapper に expanded が付きません）' });
}

/** 評価ボックス（Locator）の評価ボタンを押す。印なら、先に開く */
export async function clickRatingInBox(page, box, rating) {
  await openIfBadge(page, box);
  await box.locator(`button[data-rating="${rating}"]`).click();
}

/** 評価ボタンを押す */
export async function clickRating(page, imgId, rating) {
  const box = await boxLocator(page, imgId);
  await clickRatingInBox(page, box, rating);
}

/** すべての評価ボックスの数を待つ */
export async function waitForBoxCount(page, n, timeout = 5000) {
  await waitFor(() => page.evaluate((n) => window.__t.boxes().length === n, n), {
    timeout,
    message: `評価ボックスの数が ${n} になりませんでした`,
  }).catch(async (e) => {
    const actual = await page.evaluate(() => window.__t.boxes().length);
    throw new Error(`${e.message}（実際は ${actual}）`);
  });
}

/** 保存のキーを作る（契約の形式） */
export function storageKey(pageUrl, imageKey, name) {
  return 'r:' + JSON.stringify([pageUrl, imageKey, name]);
}
