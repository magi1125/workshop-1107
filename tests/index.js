// `node --test tests/` の入り口。
// Node.js 22 の `node --test` は、ディレクトリを指定するとファイルとして読み込もうとするため、
// ディレクトリの index.js として、このフォルダの *.test.mjs をすべて読み込む。
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const files = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort();
  for (const f of files) {
    await import(pathToFileURL(path.join(__dirname, f)).href);
  }
})();
