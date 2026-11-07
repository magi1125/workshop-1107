// CLAUDE.md で禁止したコードが、拡張機能のファイルに無いかを調べる
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARGETS = ['src'];
const RULES = [
  { pattern: /\beval\s*\(/, reason: 'eval() は使わない（外部から取得したコードの実行につながる）' },
  { pattern: /\bnew\s+Function\s*\(/, reason: 'new Function() は使わない' },
  { pattern: /\b(setTimeout|setInterval)\s*\(\s*['"`]/, reason: '文字列を setTimeout・setInterval に渡さない' },
  { pattern: /\.(innerHTML|outerHTML)\s*\+?=|\.(innerHTML|outerHTML)\s*$/, reason: 'innerHTML・outerHTML に代入しない（文字列がHTMLとして解釈される）' },
  { pattern: /insertAdjacentHTML\s*\(/, reason: 'insertAdjacentHTML() は使わない' },
  { pattern: /document\.write\s*\(/, reason: 'document.write() は使わない' },
  { pattern: /<script[^>]+src\s*=\s*["']?https?:/i, reason: '外部のスクリプトを読み込まない' },
  { pattern: /\bimport\s*\(\s*['"`]https?:/, reason: '外部のモジュールを読み込まない' },
  { pattern: /<script(?![^>]*\bsrc=)[^>]*>\s*\S/i, reason: 'HTMLの中にスクリプトを直接書かない' },
];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (/\.(js|mjs|html)$/.test(name)) {
      files.push(path);
    }
  }
};
TARGETS.forEach((t) => walk(join(ROOT, t)));

const problems = [];
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        problems.push(`${relative(ROOT, file)}:${i + 1}  ${rule.reason}`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\n禁止したコードが ${problems.length} 件あります`);
  process.exit(1);
}
console.log(`検査したファイル：${files.length} 件。禁止したコードはありません`);
