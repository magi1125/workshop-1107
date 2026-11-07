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
    if (img.parentElement && img.parentElement.localName === 'picture') anchor = img.parentElement;
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

  /** 評価の対象になる画像（表示されている、メインの document の img） */
  function targetImages() {
    return Array.from(document.querySelectorAll('img')).filter((img) => img.getClientRects().length > 0);
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
    for (const r of ['good', 'fair', 'poor']) {
      const b = root && root.querySelector(`button[data-rating="${r}"]`);
      pressed[r] = b ? b.getAttribute('aria-pressed') : null;
    }
    const toggle = root && root.querySelector('button.toggle');
    return {
      hasShadow: !!root,
      category: box.getAttribute('data-category'),
      mode: box.getAttribute('data-mode'),
      line: line ? norm(line.textContent) : null,
      lineAriaHidden: line ? line.getAttribute('aria-hidden') : null,
      groupLabel: group ? group.getAttribute('aria-label') : null,
      pressed,
      toggleText: toggle ? norm(toggle.textContent) : null,
      toggleExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
    };
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
        toggle: el.classList.contains('toggle'),
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

  window.__t = { boxes, anchorFor, boxFor, targetImages, state, deepActive, describeActive, cleanHTML, liveText, norm, contrast };
})();
