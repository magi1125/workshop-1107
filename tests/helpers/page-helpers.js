// テストのページに読み込む補助関数（addInitScript でメインワールドに読み込む）。
// 評価ボックスと画像の対応は、契約の「挿入する位置」の規則でテスト側が独自に求める。
(() => {
  const CONTROL_SELECTOR = 'a[href], button, summary, label, [role="button"], [role="link"]';

  /** 評価ボックスのホスト要素（document の順） */
  function boxes() {
    return Array.from(document.querySelectorAll('alt-eval-box[data-alt-eval="box"]'));
  }

  /** 契約の規則で、評価ボックスを挿入する基準の要素を求める */
  function anchorFor(img) {
    let anchor = img;
    if (img.localName === 'img' && img.parentElement && img.parentElement.localName === 'picture') anchor = img.parentElement;
    let outerControl = null;
    for (let el = anchor.parentElement; el; el = el.parentElement) {
      if (el.matches(CONTROL_SELECTOR)) outerControl = el;
    }
    if (outerControl) anchor = outerControl;
    // 契約：summary の中の画像は、details の直後に入れる
    if (anchor.localName === 'summary' && anchor.parentElement && anchor.parentElement.localName === 'details') {
      anchor = anchor.parentElement;
    }
    let outerHidden = null;
    for (let el = anchor; el; el = el.parentElement) {
      if (el.getAttribute('aria-hidden') === 'true') outerHidden = el;
    }
    if (outerHidden) anchor = outerHidden;
    return anchor;
  }

  /** role の最初の値（小文字） */
  function firstRole(el) {
    return (el.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
  }

  /**
   * 契約「svg要素、role="img"の要素、input type="image"」の種類（element）。対象でなければ null。
   * テスト側で独自に求める（実装の isCandidate は使わない）
   */
  function elementKind(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.closest('alt-eval-box')) return null;
    let kind = null;
    if (el.localName === 'img' && el.namespaceURI === 'http://www.w3.org/1999/xhtml') kind = 'img';
    else if (el.localName === 'svg' && el.namespaceURI === 'http://www.w3.org/2000/svg') {
      const role = (el.getAttribute('role') || '').trim().toLowerCase();
      if (role === '' || ['img', 'graphics-document', 'presentation', 'none'].includes(role)) kind = 'svg';
    } else if (el.localName === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'image') kind = 'input-image';
    else if (firstRole(el) === 'img') kind = 'role-img';
    if (!kind) return null;
    for (let p = el.parentElement; p; p = p.parentElement) {
      // ほかの svg の中の svg
      if (kind === 'svg' && p.localName === 'svg' && p.namespaceURI === 'http://www.w3.org/2000/svg') return null;
      // role="img" の要素の中にある要素
      if (firstRole(p) === 'img') return null;
    }
    return kind;
  }

  /** 評価の対象になる要素（表示されている、メインの document の img・svg・role="img"・input type="image"） */
  function targetImages() {
    return Array.from(document.querySelectorAll('img, svg, [role], input')).filter(
      (el) => elementKind(el) && el.getClientRects().length > 0,
    );
  }

  /** 画像に対応する評価ボックス。基準の要素の直後に、同じ基準の画像の順で並ぶ */
  function boxFor(img) {
    const anchor = anchorFor(img);
    const peers = targetImages().filter((i) => anchorFor(i) === anchor);
    const idx = peers.indexOf(img);
    if (idx < 0) return null;
    const list = [];
    for (let el = anchor.nextElementSibling; el && el.localName === 'alt-eval-box'; el = el.nextElementSibling) {
      list.push(el);
    }
    return list[idx] || null;
  }

  function norm(s) {
    return (s ?? '').replace(/\s+/g, ' ').trim();
  }

  /** 評価ボックスの状態をまとめる */
  function state(box) {
    const root = box.shadowRoot;
    const line = root && root.querySelector('p.line');
    const group = root && root.querySelector('[role="group"]');
    const pressed = {};
    for (const r of ['good', 'poor']) {
      const b = root && root.querySelector(`button[data-rating="${r}"]`);
      pressed[r] = b ? b.getAttribute('aria-pressed') : null;
    }
    return {
      hasShadow: !!root,
      category: box.getAttribute('data-category'),
      mode: box.getAttribute('data-mode'),
      line: line ? norm(line.textContent) : null,
      lineAriaHidden: line ? line.getAttribute('aria-hidden') : null,
      groupLabel: group ? group.getAttribute('aria-label') : null,
      pressed,
    };
  }

  /** 親をたどる（シャドウルートの中からホスト要素へも出る） */
  function parentOf(e) {
    if (e.parentElement) return e.parentElement;
    if (e.parentNode instanceof ShadowRoot) return e.parentNode.host;
    return null;
  }

  function intersect(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }

  /** 要素のパディングの矩形（overflow で切り取る範囲） */
  function paddingRect(el) {
    const r = el.getBoundingClientRect();
    const left = r.left + el.clientLeft;
    const top = r.top + el.clientTop;
    return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
  }

  /**
   * 矩形が画面の上で実際に見えるか。祖先（シャドウルートの外まで）の overflow・clip・clip-path と、
   * 画面の範囲で切り取った後に、幅と高さが 2px 以上残るかを調べる
   */
  function rectShown(rect, fromEl) {
    if (rect.width < 2 || rect.height < 2) return false;
    let r = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    r = intersect(r, { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    if (r.width < 2 || r.height < 2) return false;
    for (let e = fromEl; e; e = parentOf(e)) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none') return false;
      if (cs.clipPath && cs.clipPath !== 'none') return false;
      if (cs.clip && cs.clip !== 'auto' && (cs.position === 'absolute' || cs.position === 'fixed')) return false;
      if (e !== fromEl && /hidden|clip|scroll|auto/.test(cs.overflowX + ' ' + cs.overflowY)) {
        r = intersect(r, paddingRect(e));
        if (r.width < 2 || r.height < 2) return false;
      }
      // popover（最前面）のホスト要素より外の祖先には切り取られない
      if (e.localName === 'alt-eval-box' && e.matches(':popover-open')) break;
    }
    return true;
  }

  /** 要素が視覚的に見えているか（display・visibility・opacity・大きさ・切り取り） */
  function visuallyShown(el) {
    if (!el || !el.isConnected) return false;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    return rectShown(el.getBoundingClientRect(), el);
  }

  /** 文字のノードが視覚的に見えているか */
  function textShown(node) {
    const el = node.parentElement;
    if (!el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    if (parseFloat(getComputedStyle(el).fontSize) < 4) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    return rectShown(range.getBoundingClientRect(), el);
  }

  /** 要素の中で、文字（空白を除く）が text に一致するテキストノード */
  function textNodes(root, text) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (norm(n.data) === text) out.push(n);
    return out;
  }

  /** 画像の実際に見えている部分：画像の矩形と、overflow が hidden か clip の祖先の矩形の重なり */
  function visibleRectOf(img) {
    let r = img.getBoundingClientRect();
    r = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let e = img.parentElement; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/hidden|clip/.test(cs.overflowX + ' ' + cs.overflowY)) r = intersect(r, paddingRect(e));
    }
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  /** シャドウルートの中まで辿った、フォーカスのある要素 */
  function deepActive() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  /** フォーカスのある要素を、テストで比べやすい形で説明する */
  function describeActive() {
    const el = deepActive();
    if (!el) return null;
    const root = el.getRootNode();
    if (root instanceof ShadowRoot && root.host.localName === 'alt-eval-box') {
      return {
        kind: 'box',
        boxIndex: boxes().indexOf(root.host),
        rating: el.getAttribute('data-rating'),
      };
    }
    return { kind: 'page', id: el.id || null, tag: el.localName };
  }

  /** 評価モードの記録を除いた、ページの元の HTML（読み上げ用の領域を除く） */
  function cleanHTML() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('alt-eval-live').forEach((n) => n.remove());
    return clone.outerHTML;
  }

  /** 読み上げ用の領域の文字 */
  function liveText() {
    const host = document.querySelector('alt-eval-live[data-alt-eval="live"]');
    const status = host && host.shadowRoot && host.shadowRoot.querySelector('[role="status"]');
    return status ? norm(status.textContent) : null;
  }

  /** 要素の文字色と、実際に見える背景色（祖先の背景を重ねたもの）からコントラスト比を求める */
  function contrast(el) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const chain = [];
  for (let e = el; e; ) {
    chain.push(e);
    if (e.parentElement) e = e.parentElement;
    else if (e.parentNode instanceof ShadowRoot) e = e.parentNode.host;
    else e = null;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1, 1);
  for (const e of chain.reverse()) {
    const bg = getComputedStyle(e).backgroundColor;
    ctx.fillStyle = '#ffffff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1, 1);
  }
  const bgPx = Array.from(ctx.getImageData(0, 0, 1, 1).data);
  ctx.fillStyle = getComputedStyle(el).color;
  ctx.fillRect(0, 0, 1, 1);
  const fgPx = Array.from(ctx.getImageData(0, 0, 1, 1).data);
  const lum = ([r, g, b]) => {
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [l1, l2] = [lum(fgPx), lum(bgPx)].sort((a, b) => b - a);
  return { ratio: (l1 + 0.05) / (l2 + 0.05), fg: fgPx.slice(0, 3), bg: bgPx.slice(0, 3) };
}

  window.__t = {
    boxes, anchorFor, boxFor, targetImages, elementKind, state, deepActive, describeActive, cleanHTML, liveText, norm, contrast,
    visuallyShown, textShown, textNodes, visibleRectOf,
  };
})();
