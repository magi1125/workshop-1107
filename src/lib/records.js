// 記録の一覧、書き出しのデータの作成、取り込んだデータの検証（docs/contract.md の「書き出し」「取り込み」）
// chrome.* を使わない純粋な関数だけを置き、テストから直接読み込めるようにする

export const OWN_PREFIX = 'r:';
export const IMPORTED_PREFIX = 'i:';
export const EXPORT_FORMAT = 'alt-tsushinbo';
export const EXPORT_VERSION = 1;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const RECORD_FIELDS = [
  'element', 'pageUrl', 'pageTitle', 'imageUrl', 'embedded', 'category', 'name',
  'nameSource', 'altState', 'alt', 'linkUrl', 'rating', 'ratedAt',
];
const CATEGORIES = ['named', 'empty', 'none', 'hidden'];
const NAME_SOURCES = ['aria-labelledby', 'aria-label', 'alt', 'title', 'svg-title', 'none'];
const ELEMENTS = ['img', 'svg', 'role-img', 'input-image'];
const ELEMENT_SUFFIX = { svg: '（svg要素）', 'role-img': '（role="img"の要素）', 'input-image': '（input type="image"）' };

// 以前の版の記録には element が無いため、img とみなす
const elementOf = (record) => record.element || 'img';
const ALT_STATES = ['present', 'empty', 'missing'];
const RATINGS = ['good', 'poor'];

export const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

export const isWebUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

// URL の ? 以降と # 以降を削る
export const stripQuery = (url) => (typeof url === 'string' ? url.split(/[?#]/)[0] : url);

// chrome.storage.local の中身から、自分の記録と取り込んだ記録を取り出す。日時の新しい順に並べる
export const listRecords = (storage) => {
  const records = [];
  for (const [key, value] of Object.entries(storage || {})) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    if (key.startsWith(OWN_PREFIX)) {
      records.push({ ...value, key, source: 'own' });
    } else if (key.startsWith(IMPORTED_PREFIX)) {
      records.push({ ...value, key, source: 'imported' });
    }
  }
  records.sort((a, b) => String(b.ratedAt).localeCompare(String(a.ratedAt)));
  return records;
};

// 自分の記録だけを、サイトごとの件数にまとめる
export const countBySite = (records) => {
  const counts = new Map();
  for (const record of records) {
    // ローカルのファイルの記録は書き出さない（ファイルの場所が外に出てしまうため）
    if (record.source !== 'own' || !isWebUrl(record.pageUrl)) {
      continue;
    }
    const host = hostOf(record.pageUrl);
    counts.set(host, (counts.get(host) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};

const pad = (n) => String(n).padStart(2, '0');

export const exportFileName = (now) => `alt-tsushinbo-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;

// 書き出すデータを作る。自分の記録のうち、選んだサイトのものだけを入れる
export const buildExport = (records, { sites, stripQuery: strip, evaluator = '', now }) => {
  const selected = new Set(sites);
  const clean = (url) => (strip ? stripQuery(url) : url);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    evaluator: typeof evaluator === 'string' ? evaluator : '',
    records: records
      .filter((record) => record.source === 'own' && isWebUrl(record.pageUrl) && selected.has(hostOf(record.pageUrl)))
      .map((record) => {
        const out = {};
        for (const field of RECORD_FIELDS) {
          out[field] = record[field] === undefined ? null : record[field];
        }
        out.element = elementOf(record);
        out.pageUrl = clean(out.pageUrl);
        out.imageUrl = clean(out.imageUrl);
        out.linkUrl = clean(out.linkUrl);
        return out;
      }),
  };
};

const isString = (value, max) => typeof value === 'string' && value.length <= max;
const isUrlOrNull = (value) => value === null || (isWebUrl(value) && value.length <= 2000);

const isValidRecord = (r) =>
  r !== null && typeof r === 'object' && !Array.isArray(r) &&
  isWebUrl(r.pageUrl) && r.pageUrl.length <= 2000 &&
  isUrlOrNull(r.imageUrl) &&
  isUrlOrNull(r.linkUrl) &&
  isString(r.pageTitle, 1000) &&
  isString(r.name, 1000) &&
  (r.alt === null || isString(r.alt, 5000)) &&
  typeof r.embedded === 'boolean' &&
  CATEGORIES.includes(r.category) &&
  NAME_SOURCES.includes(r.nameSource) &&
  ALT_STATES.includes(r.altState) &&
  RATINGS.includes(r.rating) &&
  isString(r.ratedAt, 50) &&
  (r.element === undefined || ELEMENTS.includes(r.element));

// 取り込むデータを検証する。項目は決めたものだけを取り出し、それ以外は捨てる
export const validateImport = (data) => {
  const fail = { ok: false, records: [], rejected: 0, evaluator: '' };
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return fail;
  }
  if (data.format !== EXPORT_FORMAT || data.version !== EXPORT_VERSION || !Array.isArray(data.records)) {
    return fail;
  }
  const evaluator = isString(data.evaluator, 100) ? data.evaluator : '';
  const records = [];
  let rejected = 0;
  for (const r of data.records) {
    if (!isValidRecord(r)) {
      rejected += 1;
      continue;
    }
    const out = {};
    for (const field of RECORD_FIELDS) {
      out[field] = r[field];
    }
    out.element = elementOf(r);
    records.push(out);
  }
  return { ok: true, records, rejected, evaluator };
};

// 埋め込みの画像と svg・role="img" の記録には画像のURLが無いため、要素の種類と評価した日時で区別する
// （同じページの名前の無いアイコンの記録が、取り込んだ時に1件にまとまらないように）
export const importedKey = (evaluator, record) =>
  IMPORTED_PREFIX + JSON.stringify([
    evaluator,
    record.pageUrl,
    record.embedded ? `${elementOf(record)}:${record.ratedAt}` : record.imageUrl,
    record.name,
  ]);

// 評価ボックスの1行目と同じ文字（docs/contract.md の「1行目の文字」）
const isVector = (r) => elementOf(r) === 'svg' || elementOf(r) === 'role-img';

export const lineText = (r) => {
  switch (r.category) {
    case 'named':
      return `名前：${r.name}（${r.nameSource === 'svg-title' ? 'title要素' : r.nameSource}から）`;
    case 'empty':
      return isVector(r) ? '読み上げられない画像（role="presentation" か role="none"）' : '読み上げられない画像（空のalt）';
    case 'none':
      if (elementOf(r) === 'input-image') {
        return '名前なし（「送信」などの決まった名前で読み上げられる場合があります）';
      }
      return isVector(r)
        ? '名前なし（「画像」とだけ読み上げられるか、読み飛ばされる場合があります）'
        : '名前なし（ファイル名が読み上げられる場合があります）';
    default: {
      if (isVector(r)) {
        return `スクリーンリーダーに伝わらない画像（aria-hidden）。${r.name ? `名前：${r.name}` : '名前なし'}`;
      }
      let altText = 'alt属性なし';
      if (r.altState === 'present') {
        altText = `alt：${r.alt}`;
      } else if (r.altState === 'empty') {
        altText = '空のalt';
      }
      return `スクリーンリーダーに伝わらない画像（aria-hidden）。${altText}`;
    }
  }
};

// 設定画面の名前の列で、img 以外の要素の種類を示す
export const elementSuffix = (r) => ELEMENT_SUFFIX[elementOf(r)] || '';
