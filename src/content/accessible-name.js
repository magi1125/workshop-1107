// 画像のアクセシブルネームの計算と、伝わり方の分類（docs/contract.md の「globalThis.AltEvalName」）
'use strict';

(() => {
  // ページの要素の id（<div id="AltEvalName"> など）と取り違えないよう、自分で定義したかどうかを確かめる
  if (Object.hasOwn(globalThis, 'AltEvalName')) {
    return;
  }

  // 連続する空白を1つにまとめ、前後の空白を削る
  const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

  const firstRole = (img) => normalize(img.getAttribute('role')).toLowerCase().split(' ')[0];

  // aria-labelledby が指す要素の文字列。各要素の aria-label、無ければ textContent を使う
  const labelledByText = (img) => {
    const ids = normalize(img.getAttribute('aria-labelledby'));
    if (!ids) {
      return '';
    }
    const doc = img.ownerDocument;
    return ids
      .split(' ')
      .map((id) => doc.getElementById(id))
      .filter(Boolean)
      .map((el) => normalize(el.getAttribute('aria-label')) || normalize(el.textContent))
      .filter(Boolean)
      .join(' ');
  };

  const computeName = (img) => {
    const labelledBy = labelledByText(img);
    if (labelledBy) {
      return { name: labelledBy, source: 'aria-labelledby', presentational: false };
    }
    const label = normalize(img.getAttribute('aria-label'));
    if (label) {
      return { name: label, source: 'aria-label', presentational: false };
    }
    const role = firstRole(img);
    if (role === 'presentation' || role === 'none') {
      return { name: '', source: 'none', presentational: true };
    }
    if (img.hasAttribute('alt')) {
      const alt = normalize(img.getAttribute('alt'));
      return alt
        ? { name: alt, source: 'alt', presentational: false }
        : { name: '', source: 'none', presentational: false };
    }
    const title = normalize(img.getAttribute('title'));
    if (title) {
      return { name: title, source: 'title', presentational: false };
    }
    return { name: '', source: 'none', presentational: false };
  };

  // aria-hidden="true" が付いた、いちばん外側の祖先（自分自身を含む）
  const outermostHidden = (el) => {
    let found = null;
    for (let node = el; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      if (node.getAttribute('aria-hidden') === 'true') {
        found = node;
      }
    }
    return found;
  };

  const describe = (img) => {
    const { name, source, presentational } = computeName(img);
    const hasAlt = img.hasAttribute('alt');
    const alt = hasAlt ? img.getAttribute('alt') : null;
    let altState = 'missing';
    if (hasAlt) {
      altState = normalize(alt) ? 'present' : 'empty';
    }

    let category;
    if (outermostHidden(img)) {
      category = 'hidden';
    } else if (name) {
      category = 'named';
    } else if (hasAlt || presentational) {
      category = 'empty';
    } else {
      category = 'none';
    }

    const src = img.currentSrc || img.getAttribute('src') || '';
    const embedded = /^(data|blob):/i.test(src);
    const link = img.closest('a[href]');

    return {
      category,
      name,
      nameSource: source,
      presentational,
      altState,
      alt,
      role: firstRole(img),
      imageUrl: embedded ? null : (img.currentSrc || img.src || ''),
      embedded,
      linkUrl: link ? link.href : null,
    };
  };

  globalThis.AltEvalName = Object.freeze({ computeName, describe, outermostHidden });
})();
