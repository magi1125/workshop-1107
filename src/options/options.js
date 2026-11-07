// 設定画面：記録の一覧、書き出し、取り込み、評価モードの設定、使わないサイト（docs/contract.md）
import {
  listRecords, countBySite, buildExport, exportFileName, validateImport, importedKey,
  hostOf, isWebUrl, lineText, elementSuffix, MAX_IMPORT_BYTES,
} from '../lib/records.js';
import {
  getSettings, updateSettings, setExcluded, enableDefaultOn, disableDefaultOn,
} from '../lib/settings.js';

const $ = (selector) => document.querySelector(selector);
const statusEl = $('#status');
const RATING_TEXT = { good: '○ 良い', poor: '× 悪い' };

// ページの文字（タイトル、名前、alt、URL）は、すべて textContent で入れる
const el = (tag, text, props = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) {
    node.textContent = text;
  }
  Object.assign(node, props);
  return node;
};

const announce = (text) => {
  // 同じ文字が続いても読み上げられるよう、一度空にしてから入れる
  statusEl.textContent = '';
  setTimeout(() => {
    statusEl.textContent = text;
  }, 50);
};

let allRecords = [];

const formatDate = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString('ja-JP');
};

// ---- 記録 ----

const renderSiteFilter = () => {
  const select = $('#filter-site');
  const current = select.value;
  const hosts = [...new Set(allRecords.map((r) => hostOf(r.pageUrl)))].sort();
  select.replaceChildren(el('option', 'すべて', { value: 'all' }), ...hosts.map((h) => el('option', h, { value: h })));
  select.value = hosts.includes(current) ? current : 'all';
};

const pageCell = (record) => {
  const cell = el('td');
  cell.append(el('span', record.pageTitle || '（タイトルなし）'));
  cell.append(el('br'));
  if (isWebUrl(record.pageUrl)) {
    cell.append(el('a', record.pageUrl, { href: record.pageUrl, target: '_blank', rel: 'noopener noreferrer' }));
  } else {
    cell.append(el('span', record.pageUrl));
  }
  return cell;
};

// 画像は、利用者が押した時だけ読み込む（画像を置いているサーバーに、勝手にアクセスしないため）
const imageCell = (record) => {
  const cell = el('td');
  if (record.element === 'svg' || record.element === 'role-img') {
    cell.append(el('span', '画像のURLはありません'));
    return cell;
  }
  if (record.embedded) {
    cell.append(el('span', '埋め込みの画像'));
    return cell;
  }
  if (!isWebUrl(record.imageUrl)) {
    cell.append(el('span', '画像のURLなし'));
    return cell;
  }
  const button = el('button', '画像を表示', { type: 'button' });
  button.addEventListener('click', () => {
    const img = el('img', null, { src: record.imageUrl, alt: `${record.name || '名前のない画像'}の画像` });
    button.replaceWith(img);
    img.setAttribute('tabindex', '-1');
    img.focus();
  });
  cell.append(button);
  return cell;
};

const deleteCell = (record) => {
  const cell = el('td');
  const button = el('button', '削除', { type: 'button' });
  button.setAttribute('aria-label', `削除：${record.name || lineText(record)}`);
  button.addEventListener('click', async () => {
    // 消した行のボタンは無くなるため、先にフォーカスを見出しに移す。表は storage.onChanged で作り直す
    $('#records-heading').setAttribute('tabindex', '-1');
    $('#records-heading').focus();
    await chrome.storage.local.remove(record.key);
    announce(`「${record.name || lineText(record)}」の記録を削除しました`);
  });
  cell.append(button);
  return cell;
};

const renderRecords = () => {
  const rating = $('#filter-rating').value;
  const site = $('#filter-site').value;
  const source = $('#filter-source').value;
  const shown = allRecords.filter((r) =>
    (rating === 'all' || r.rating === rating) &&
    (site === 'all' || hostOf(r.pageUrl) === site) &&
    (source === 'all' || r.source === source));

  const table = $('#records-table');
  $('#records-empty').hidden = allRecords.length > 0;
  table.hidden = allRecords.length === 0;
  table.querySelector('caption').textContent = `${shown.length}件の記録`;
  table.querySelector('tbody').replaceChildren(...shown.map((record) => {
    const row = el('tr');
    row.append(
      el('td', RATING_TEXT[record.rating] || record.rating),
      el('td', lineText(record) + elementSuffix(record)),
      pageCell(record),
      imageCell(record),
      el('td', record.source === 'own' ? '自分' : (record.evaluator || '名前なし')),
      el('td', formatDate(record.ratedAt)),
      deleteCell(record),
    );
    return row;
  }));
};

// ---- 書き出し ----

const renderExportSites = async () => {
  const { exportedSites } = await getSettings();
  const fieldset = $('#export-sites');
  const counts = countBySite(allRecords);
  // 選んでいる途中で記録が増えても、選んだ状態を残す
  const previous = new Map([...fieldset.querySelectorAll('input')].map((input) => [input.value, input.checked]));
  fieldset.querySelectorAll('label').forEach((label) => label.remove());
  $('#export-sites-empty').hidden = counts.length > 0;
  for (const [host, count] of counts) {
    const input = el('input', null, { type: 'checkbox', value: host, checked: previous.has(host) ? previous.get(host) : exportedSites.includes(host) });
    const label = el('label');
    label.append(input, `${host}（${count}件）`);
    fieldset.append(label);
  }
};

const download = (fileName, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = el('a', null, { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

const onExport = async () => {
  const sites = [...$('#export-sites').querySelectorAll('input:checked')].map((input) => input.value);
  if (sites.length === 0) {
    announce('書き出すサイトを選んでください');
    return;
  }
  const now = new Date();
  const data = buildExport(allRecords, {
    sites,
    stripQuery: $('#strip-query').checked,
    evaluator: $('#evaluator').value.trim().slice(0, 100),
    now,
  });
  download(exportFileName(now), JSON.stringify(data, null, 2));
  await updateSettings({ exportedSites: sites });
  announce(`${sites.length}サイト、${data.records.length}件の記録を書き出しました`);
};

// ---- 取り込み ----

const onImport = async (event) => {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) {
    return;
  }
  let data = null;
  if (file.size <= MAX_IMPORT_BYTES) {
    try {
      data = JSON.parse(await file.text());
    } catch {
      data = null;
    }
  }
  const result = validateImport(data);
  if (!result.ok) {
    announce('このファイルは取り込めません');
    input.value = '';
    return;
  }
  const importedAt = new Date().toISOString();
  const items = {};
  for (const record of result.records) {
    items[importedKey(result.evaluator, record)] = { ...record, evaluator: result.evaluator, importedAt };
  }
  input.value = '';
  try {
    await chrome.storage.local.set(items);
  } catch {
    announce('記録を保存できなかったため、取り込めませんでした');
    return;
  }
  announce(`${result.records.length}件を取り込みました。${result.rejected}件は形式が合わないため取り込みませんでした`);
};

// ---- 評価モードの設定 ----

const onDefaultOnChange = async (event) => {
  const checkbox = event.target;
  const statusText = $('#default-on-status');
  statusText.textContent = '';
  if (checkbox.checked) {
    const granted = await enableDefaultOn().catch(() => false);
    if (!granted) {
      checkbox.checked = false;
      statusText.textContent = 'すべてのサイトへのアクセスが許可されなかったため、既定でオンにできませんでした';
      return;
    }
    announce('評価モードを既定でオンにしました');
  } else {
    await disableDefaultOn();
    announce('評価モードを既定でオフにしました');
  }
};

// ---- 使わないサイト ----

const renderExcluded = async () => {
  const { excludedSites } = await getSettings();
  $('#excluded-empty').hidden = excludedSites.length > 0;
  $('#excluded-list').replaceChildren(...excludedSites.map((host) => {
    const item = el('li');
    const button = el('button', '登録を外す', { type: 'button' });
    button.setAttribute('aria-label', `登録を外す：${host}`);
    button.addEventListener('click', async () => {
      $('#excluded-heading').setAttribute('tabindex', '-1');
      $('#excluded-heading').focus();
      await setExcluded(host, false);
      announce(`${host} の登録を外しました`);
    });
    item.append(el('span', host), button);
    return item;
  }));
};

// ---- 全体 ----

async function refresh() {
  allRecords = listRecords(await chrome.storage.local.get(null));
  renderSiteFilter();
  renderRecords();
  await renderExportSites();
}

async function main() {
  for (const id of ['#filter-rating', '#filter-site', '#filter-source']) {
    $(id).addEventListener('change', renderRecords);
  }
  $('#export-button').addEventListener('click', onExport);
  $('#import-file').addEventListener('change', onImport);
  $('#default-on').addEventListener('change', onDefaultOnChange);
  $('#default-on').checked = (await getSettings()).defaultOn;
  await refresh();
  await renderExcluded();
  // 評価や設定が変わったら、表示を更新する。
  // ただし、作り直す範囲にフォーカスがある時は、フォーカスが外れるまで待つ（フォーカスが失われないように）
  const whenNotFocused = (container, task) => {
    if (!container.contains(document.activeElement)) {
      task();
      return;
    }
    container.addEventListener('focusout', () => setTimeout(() => whenNotFocused(container, task), 0), { once: true });
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    if (changes.settings) {
      whenNotFocused($('#excluded-list'), renderExcluded);
      $('#default-on').checked = Boolean(changes.settings.newValue && changes.settings.newValue.defaultOn);
    }
    if (Object.keys(changes).some((key) => key.startsWith('r:') || key.startsWith('i:'))) {
      whenNotFocused($('#records-table'), refresh);
    }
  });
}

main();
