// manifest.json と拡張機能のファイルの静的なテスト
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers/extension.mjs';

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

describe('manifest.json', () => {
  test('Manifest V3 である', () => {
    assert.equal(readManifest().manifest_version, 3);
  });

  test('permissions はちょうど activeTab・scripting・storage の3つ', () => {
    const m = readManifest();
    assert.deepEqual([...(m.permissions || [])].sort(), ['activeTab', 'scripting', 'storage']);
  });

  test('実際の manifest.json に host_permissions が無い（<all_urls> はテスト用のコピーにだけ加える）', () => {
    const m = readManifest();
    assert.ok(
      m.host_permissions === undefined || (Array.isArray(m.host_permissions) && m.host_permissions.length === 0),
      `host_permissions：${JSON.stringify(m.host_permissions)}`,
    );
  });

  test('options_ui は src/options/options.html を新しいタブで開く', () => {
    const m = readManifest();
    assert.deepEqual(m.options_ui, { page: 'src/options/options.html', open_in_tab: true });
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'src', 'options', 'options.html')), 'src/options/options.html がありません');
  });

  test('optional_host_permissions はちょうど ["<all_urls>"]（既定でオンにする時だけ許可を求める）', () => {
    const m = readManifest();
    assert.deepEqual(m.optional_host_permissions, ['<all_urls>']);
  });

  test('optional_permissions で権限を増やしていない', () => {
    const m = readManifest();
    assert.ok(
      m.optional_permissions === undefined || (Array.isArray(m.optional_permissions) && m.optional_permissions.length === 0),
      `optional_permissions：${JSON.stringify(m.optional_permissions)}`,
    );
  });

  test('content_security_policy にリモートの URL が無い', () => {
    const m = readManifest();
    const csp = m.content_security_policy;
    if (csp === undefined) return;
    const text = typeof csp === 'string' ? csp : Object.values(csp).join(' ');
    assert.doesNotMatch(text, /https?:|\/\/|\*/i, `content_security_policy：${text}`);
    assert.doesNotMatch(text, /unsafe-eval/i);
  });

  test('commands に toggle-evaluation がある', () => {
    const m = readManifest();
    assert.ok(m.commands && m.commands['toggle-evaluation'], 'commands["toggle-evaluation"] がありません');
  });

  test('バックグラウンドは src/background/background.js の ES モジュール', () => {
    const m = readManifest();
    assert.equal(m.background?.service_worker, 'src/background/background.js');
    assert.equal(m.background?.type, 'module');
  });

  test('content_scripts で全ページに常時挿入していない（activeTab の方針）', () => {
    const m = readManifest();
    assert.ok(!m.content_scripts || m.content_scripts.length === 0, '常時挿入する content_scripts があります');
  });
});

describe('外部のコードを実行しない（Manifest V3 のルール）', () => {
  const files = listFiles(path.join(REPO_ROOT, 'src'));

  test('src の HTML がリモートのスクリプトやスタイルを読み込まない', () => {
    const bad = [];
    for (const f of files.filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(f, 'utf8');
      for (const m of html.matchAll(/<(script|link)\b[^>]*(src|href)\s*=\s*["']?\s*(https?:)?\/\//gi)) {
        bad.push(`${path.relative(REPO_ROOT, f)}: ${m[0]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('src の JavaScript が eval() と new Function() を使わない', () => {
    const bad = [];
    for (const f of files.filter((f) => /\.m?js$/.test(f))) {
      const js = fs.readFileSync(f, 'utf8');
      if (/(^|[^.\w$])eval\s*\(/.test(js)) bad.push(`${path.relative(REPO_ROOT, f)}: eval(`);
      if (/new\s+Function\s*\(/.test(js)) bad.push(`${path.relative(REPO_ROOT, f)}: new Function(`);
      if (/import\s*\(\s*["'`]https?:/.test(js) || /importScripts\s*\(\s*["'`]https?:/.test(js)) {
        bad.push(`${path.relative(REPO_ROOT, f)}: リモートの import`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('chrome.storage.sync を使わない（記録を外に出さない）', () => {
    const bad = files
      .filter((f) => /\.m?js$/.test(f))
      .filter((f) => /storage\s*\.\s*sync/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(REPO_ROOT, f));
    assert.deepEqual(bad, []);
  });
});
