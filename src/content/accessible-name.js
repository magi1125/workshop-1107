// 画像のアクセシブルネームの計算と、伝わり方の分類（docs/contract.md の「globalThis.AltEvalName」と「svg要素、role="img"の要素、input type="image"」）
'use strict';

(() => {
  // ページの要素の id（<div id="AltEvalName"> など）と取り違えないよう、自分で定義したかどうかを確かめる
  if (Object.hasOwn(globalThis, 'AltEvalName')) {
    return;
  }

  const SVG_ROLES = ['', 'img', 'graphics-document', 'presentation', 'none'];
  const BOX_TAG = 'alt-eval-box';

  // 連続する空白を1つにまとめ、前後の空白を削る
  const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

  const firstRole = (el) => normalize(el.getAttribute('role')).toLowerCase().split(' ')[0];

  // 要素の種類（img・svg・role-img・input-image）。対象でなければ null
  const kindOf = (el) => {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const name = el.localName;
    if (name === 'img') {
      return 'img';
    }
    if (name === 'svg') {
      return SVG_ROLES.includes(firstRole(el)) ? 'svg' : null;
    }
    if (name === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'image') {
      return 'input-image';
    }
    return firstRole(el) === 'img' ? 'role-img' : null;
  };

  // 対象の候補か。ほかの svg の中の svg、role="img" の中の要素、評価ボックスの中の要素は除く
  const isCandidate = (el) => {
    if (!kindOf(el)) {
      return false;
    }
    // 評価ボックスのシャドウDOMの中の要素は除く（closest はシャドウの境界を越えないため、ルートを確かめる）
    const root = el.getRootNode();
    if (root instanceof ShadowRoot && root.host.localName === BOX_TAG) {
      return false;
    }
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (node.localName === BOX_TAG) {
        return false;
      }
      if (node.localName === 'svg' && el.localName === 'svg') {
        return false;
      }
      if (firstRole(node) === 'img') {
        return false;
      }
    }
    return true;
  };

  // aria-labelledby が指す要素の文字列。各要素の aria-label、無ければ textContent を使う
  const labelledByText = (el) => {
    const ids = normalize(el.getAttribute('aria-labelledby'));
    if (!ids) {
      return '';
    }
    const doc = el.ownerDocument;
    return ids
      .split(' ')
      .map((id) => doc.getElementById(id))
      .filter(Boolean)
      .map((ref) => normalize(ref.getAttribute('aria-label')) || normalize(ref.textContent))
      .filter(Boolean)
      .join(' ');
  };

  const named = (name, source) => ({ name, source, presentational: false });
  const EMPTY = Object.freeze({ name: '', source: 'none', presentational: false });

  const computeName = (el) => {
    const labelledBy = labelledByText(el);
    if (labelledBy) {
      return named(labelledBy, 'aria-labelledby');
    }
    const label = normalize(el.getAttribute('aria-label'));
    if (label) {
      return named(label, 'aria-label');
    }
    const kind = kindOf(el);
    const role = firstRole(el);
    if ((kind === 'img' || kind === 'svg') && (role === 'presentation' || role === 'none')) {
      return { name: '', source: 'none', presentational: true };
    }
    if (kind === 'svg') {
      const title = [...el.children].find((child) => child.localName === 'title');
      const text = title ? normalize(title.textContent) : '';
      return text ? named(text, 'svg-title') : EMPTY;
    }
    if ((kind === 'img' || kind === 'input-image') && el.hasAttribute('alt')) {
      const alt = normalize(el.getAttribute('alt'));
      // img の空の alt は、title を見ずに名前を空にする
      if (alt || kind === 'img') {
        return alt ? named(alt, 'alt') : EMPTY;
      }
    }
    const title = normalize(el.getAttribute('title'));
    return title ? named(title, 'title') : EMPTY;
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

  const describe = (el) => {
    const element = kindOf(el) || 'img';
    const { name, source, presentational } = computeName(el);
    const hasAltAttribute = (element === 'img' || element === 'input-image') && el.hasAttribute('alt');
    const alt = hasAltAttribute ? el.getAttribute('alt') : null;
    let altState = 'missing';
    if (hasAltAttribute) {
      altState = normalize(alt) ? 'present' : 'empty';
    }

    let category;
    if (outermostHidden(el)) {
      category = 'hidden';
    } else if (name) {
      category = 'named';
    } else if (presentational || (element === 'img' && hasAltAttribute)) {
      category = 'empty';
    } else {
      category = 'none';
    }

    let imageUrl = null;
    let embedded = true;
    if (element === 'img' || element === 'input-image') {
      const raw = element === 'img' ? (el.currentSrc || el.getAttribute('src') || '') : (el.getAttribute('src') || '');
      embedded = /^(data|blob):/i.test(raw);
      if (!embedded) {
        imageUrl = element === 'img' ? (el.currentSrc || el.src || '') : (el.src || '');
      }
    }
    const link = el.closest('a[href]');

    return {
      element,
      category,
      name,
      nameSource: source,
      presentational,
      altState,
      alt,
      role: firstRole(el),
      imageUrl,
      embedded,
      linkUrl: link ? link.href : null,
    };
  };

  globalThis.AltEvalName = Object.freeze({ computeName, describe, outermostHidden, isCandidate, kindOf });
})();
