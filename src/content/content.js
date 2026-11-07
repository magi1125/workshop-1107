// 評価モードと評価ボックス（docs/proposal.md の「評価ボックス」「評価モード」、docs/contract.md）
'use strict';

(() => {
  // ページの要素の id と取り違えないよう、自分で定義したかどうかを確かめる
  if (Object.hasOwn(globalThis, '__altEvalContent')) {
    return;
  }
  const { describe, outermostHidden, isCandidate, kindOf } = globalThis.AltEvalName;

  // 評価の対象の候補を集める（img、svg、role="img" の要素、input type="image"）
  const CANDIDATE_SELECTOR = 'img, svg, input[type="image" i], [role~="img" i]';
  const candidatesIn = (root) => {
    const found = [];
    if (root.nodeType === Node.ELEMENT_NODE && isCandidate(root)) {
      found.push(root);
    }
    for (const el of root.querySelectorAll(CANDIDATE_SELECTOR)) {
      if (isCandidate(el)) {
        found.push(el);
      }
    }
    return found;
  };

  const BOX_TAG = 'alt-eval-box';
  const LIVE_TAG = 'alt-eval-live';
  const SMALL_SIZE = 48;
  const RATINGS = [
    { value: 'good', label: '良い', symbol: '○' },
    { value: 'poor', label: '悪い', symbol: '×' },
  ];
  const INTERACTIVE = 'a[href], button, summary, label, [role="button"], [role="link"]';
  const WATCHED_ATTRIBUTES = ['alt', 'aria-label', 'aria-labelledby', 'title', 'role', 'src', 'srcset', 'type'];
  // 表示の切り替え（タブ、アコーディオン、details など）で変わる属性
  const DISPLAY_ATTRIBUTES = ['class', 'style', 'hidden', 'open', 'aria-hidden', 'inert'];
  const RECHECK_DELAY = 200;
  const NEAR_MARGIN = '300px';
  // ページのイベント処理が評価ボックスの操作に反応しないよう、ここで伝わるのを止める
  const STOPPED_EVENTS = [
    'click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
    'touchstart', 'touchend', 'keydown', 'keyup', 'keypress', 'focusin', 'focusout', 'input', 'submit',
  ];

  const STYLE = `
    .box {
      box-sizing: border-box;
      max-width: 100%;
      padding: 8px;
      border: 2px solid #1a1a1a;
      border-radius: 4px;
      box-shadow: 0 0 0 2px #ffffff;
      background: #ffffff;
      color: #1a1a1a;
      font: 16px/1.5 system-ui, sans-serif;
      text-align: start;
      white-space: normal;
    }
    .compact .box {
      padding: 2px;
    }
    /* サイドパネルの「ページの画像へ移動」で移動した評価ボックスを、しばらく強調する */
    :host([data-revealed]) .box,
    :host([data-revealed]) .badge {
      outline: 4px solid #0b57d0;
      outline-offset: 2px;
    }
    .line {
      margin: 0 0 8px;
      overflow-wrap: anywhere;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .compact .buttons {
      gap: 2px;
    }
    /* 画面からは隠し、読み上げには残す。ボタンの文字（良い・悪い）は、画面では記号（○・×）だけを見せる */
    .label,
    .compact:not(.show-line) .line {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    /* マウスを重ねた時にボタンの位置がずれないよう、1行目はボタンの下に表示する（読み上げの順番は変えない） */
    .compact .panel {
      display: flex;
      flex-direction: column;
    }
    .compact .line {
      order: 1;
    }
    .compact.show-line .line {
      max-width: 20em;
      margin: 6px 4px 4px;
    }
    /* 小さい画像の印（バッジ）。閉じている間は印だけを見せ、ボタンと1行目は読み上げとTabキーの対象に残す */
    .badge {
      display: none;
    }
    .badge-mode .badge {
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 20px;
      height: 20px;
      border: 2px solid #1a1a1a;
      border-radius: 50%;
      box-shadow: 0 0 0 2px #ffffff;
      background: #ffffff;
      color: #1a1a1a;
      font: 700 13px/1 system-ui, sans-serif;
    }
    /* 評価済みの印は、黒い背景に白い記号にして、未評価の白い丸と見分けられるようにする */
    .badge-mode .badge.rated {
      background: #1a1a1a;
      color: #ffffff;
    }
    .badge-mode.expanded .badge {
      display: none;
    }
    .badge-mode:not(.expanded) .box {
      padding: 0;
      border: 0;
      box-shadow: none;
      background: transparent;
    }
    .badge-mode:not(.expanded) .panel {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    button {
      box-sizing: border-box;
      min-width: 44px;
      min-height: 44px;
      margin: 0;
      padding: 4px 12px;
      border: 2px solid #1a1a1a;
      border-radius: 4px;
      background: #ffffff;
      color: #1a1a1a;
      font: inherit;
      cursor: pointer;
    }
    .compact button {
      min-width: 28px;
      min-height: 28px;
      padding: 0;
      font-size: 18px;
      line-height: 1;
    }
    button:hover {
      background: #e6e6e6;
    }
    button[aria-pressed="true"] {
      background: #1a1a1a;
      color: #ffffff;
    }
    button:focus-visible {
      outline: 3px solid #1a1a1a;
      outline-offset: 2px;
    }
    button[aria-pressed="true"]:focus-visible {
      outline-color: #1a1a1a;
    }
    .mark {
      display: inline-block;
      min-width: 1em;
      font-size: 22px;
      font-weight: 700;
      line-height: 1;
    }
    @media (forced-colors: active) {
      .box,
      button,
      .badge-mode .badge {
        border-color: CanvasText;
      }
      button[aria-pressed="true"] {
        forced-color-adjust: none;
        border-color: Highlight;
        background: Highlight;
        color: HighlightText;
      }
      button:focus-visible {
        outline-color: Highlight;
      }
    }
  `;

  const state = {
    enabled: false,
    boxes: new Map(), // img -> box
    hostToBox: new WeakMap(),
    loadWatched: new WeakSet(),
    pending: new Set(),
    flushScheduled: false,
    observer: null,
    live: null,
    liveRemoveTimer: 0,
    repositionScheduled: false,
    recheckRoots: new Set(),
    touchOpenBoxes: new Set(),
    nextId: 1,
    idOf: new WeakMap(), // 画像 -> 番号（評価ボックスを作り直しても変えない）
    notifyTimer: 0,
    recheckTimer: 0,
    near: new Set(), // 画面の近くにある、小さい表示の画像
    intersection: null,
    resize: null,
    lastUrl: '',
  };

  const pageUrl = () => location.href.split('#')[0];

  // FNV-1a（32ビット）を16進数8桁で返す
  const fnv1a = (text) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };

  // ハッシュを求める元の文字列。読み込みのたびに変わりやすい id・class・style 属性を除く
  const fingerprint = (el) => {
    const clone = el.cloneNode(true);
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      node.removeAttribute('id');
      node.removeAttribute('class');
      node.removeAttribute('style');
    }
    return clone.outerHTML.slice(0, 4000);
  };

  // svg と role="img" の要素には画像のURLが無いため、要素の中身の要約で区別する
  const imageKeyOf = (el, info) => {
    if (info.element === 'svg' || info.element === 'role-img') {
      return `${info.element}:${fnv1a(fingerprint(el))}`;
    }
    return info.embedded ? 'embedded' : info.imageUrl;
  };

  const storageKey = (el, info) => 'r:' + JSON.stringify([pageUrl(), imageKeyOf(el, info), info.name]);

  // ページのCSSの影響を受けないよう、ホスト要素の表示に関わる値を直接指定する
  const setHostStyle = (host, compact) => {
    const style = host.style;
    style.cssText = '';
    style.setProperty('all', 'initial', 'important');
    style.setProperty('display', 'block', 'important');
    style.setProperty('box-sizing', 'border-box', 'important');
    // 画像を含む要素が visibility: hidden になったら、評価ボックスも隠す
    style.setProperty('visibility', 'inherit', 'important');
    if (compact) {
      style.setProperty('position', 'fixed', 'important');
      style.setProperty('inset', 'auto', 'important');
      style.setProperty('margin', '0', 'important');
      style.setProperty('padding', '0', 'important');
      style.setProperty('border', '0', 'important');
      style.setProperty('background', 'transparent', 'important');
      style.setProperty('overflow', 'visible', 'important');
      style.setProperty('width', 'max-content', 'important');
      style.setProperty('max-width', 'min(22em, calc(100vw - 16px))', 'important');
    } else {
      // カード全体を覆う透明なリンクなど、ページの要素の下に隠れてクリックが貫通しないよう、手前に表示する
      style.setProperty('position', 'relative', 'important');
      style.setProperty('z-index', '2147483647', 'important');
      style.setProperty('width', 'fit-content', 'important');
      style.setProperty('margin', '4px 0', 'important');
      style.setProperty('max-width', '100%', 'important');
    }
  };

  const lineText = (info) => {
    switch (info.category) {
      case 'named':
        return `名前：${info.name}（${info.nameSource === 'svg-title' ? 'title要素' : info.nameSource}から）`;
      case 'empty':
        return info.presentational
          ? `読み上げられない画像（role="${info.role}"）`
          : '読み上げられない画像（空のalt）';
      case 'none':
        if (info.element === 'input-image') {
          return '名前なし（「送信」などの決まった名前で読み上げられる場合があります）';
        }
        return info.element === 'svg' || info.element === 'role-img'
          ? '名前なし（「画像」とだけ読み上げられるか、読み飛ばされる場合があります）'
          : '名前なし（ファイル名が読み上げられる場合があります）';
      default: {
        if (info.element === 'svg' || info.element === 'role-img') {
          return `スクリーンリーダーに伝わらない画像（aria-hidden）。${info.name ? `名前：${info.name}` : '名前なし'}`;
        }
        let altText = 'alt属性なし';
        if (info.altState === 'present') {
          altText = `alt：${info.alt}`;
        } else if (info.altState === 'empty') {
          altText = '空のalt';
        }
        return `スクリーンリーダーに伝わらない画像（aria-hidden）。${altText}`;
      }
    }
  };

  // 評価ボックスを挿入する基準の要素（docs/contract.md の「挿入する位置」）
  const insertionAnchor = (img) => {
    let anchor = img;
    if (anchor.parentElement && anchor.parentElement.localName === 'picture') {
      anchor = anchor.parentElement;
    }
    let interactive = null;
    for (let node = anchor.parentElement; node; node = node.parentElement) {
      if (node.matches(INTERACTIVE)) {
        interactive = node;
      }
    }
    if (interactive) {
      anchor = interactive;
    }
    // summary の直後は details の中になり、details が閉じている間は表示されないため、details の直後に挿入する
    if (anchor.localName === 'summary' && anchor.parentElement && anchor.parentElement.localName === 'details') {
      anchor = anchor.parentElement;
    }
    const hidden = outermostHidden(anchor);
    if (hidden) {
      anchor = hidden;
    }
    return anchor;
  };

  // ---- 読み上げ用の領域 ----

  const ensureLive = () => {
    clearTimeout(state.liveRemoveTimer);
    if (state.live && state.live.host.isConnected) {
      return state.live;
    }
    const host = document.createElement(LIVE_TAG);
    host.dataset.altEval = 'live';
    const style = host.style;
    style.setProperty('all', 'initial', 'important');
    style.setProperty('position', 'fixed', 'important');
    style.setProperty('width', '1px', 'important');
    style.setProperty('height', '1px', 'important');
    style.setProperty('overflow', 'hidden', 'important');
    style.setProperty('clip-path', 'inset(50%)', 'important');
    style.setProperty('white-space', 'nowrap', 'important');
    const root = host.attachShadow({ mode: 'open' });
    const region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.lang = 'ja';
    root.append(region);
    (document.body || document.documentElement).append(host);
    state.live = { host, region };
    return state.live;
  };

  // 読み上げ用の領域ができてから文字を入れないと読み上げられないため、少し待つ
  const announce = (text) => {
    const live = ensureLive();
    live.region.textContent = '';
    setTimeout(() => {
      live.region.textContent = text;
    }, 150);
  };

  // ---- 評価ボックス ----

  // 押した評価は、ボタンの押した状態（aria-pressed）と、色を反転した見た目で示す
  const applyRating = (box, rating) => {
    box.rating = rating;
    for (const button of box.ratingButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.rating === rating));
    }
    if (box.badgeEl) {
      // 印にも評価の結果を出し、どのアイコンを評価し終えたかを一目でわかるようにする
      box.badgeEl.textContent = rating ? RATINGS.find((r) => r.value === rating).symbol : '';
      box.badgeEl.classList.toggle('rated', Boolean(rating));
    }
  };

  // 小さい表示では、マウスを重ねるかフォーカスがある間だけ、1行目を画面に表示する
  // 印（バッジ）では、1行目と一緒にボタンも表示する（開く）
  const setLineShown = (box, shown) => {
    const show = shown && !box.lineDismissed;
    const wasShown = box.wrapper.classList.contains('show-line');
    box.wrapper.classList.toggle('show-line', show);
    if (box.badge) {
      box.wrapper.classList.toggle('expanded', show);
      // 開いた時は、隣の印より手前に表示し直す。フォーカスがある時は、表示し直した後にフォーカスを戻す
      if (show && !wasShown) {
        const focused = box.host.shadowRoot.activeElement;
        box.reordering = true;
        try {
          box.host.hidePopover();
          box.host.showPopover();
        } catch {
          // popover に対応していない場合は、そのままにする
        }
        if (focused) {
          focused.focus({ preventScroll: true });
        }
        box.reordering = false;
      }
      if (show !== wasShown) {
        // 開くと幅が変わるため、画面の右端からはみ出さないよう、この印の左右の位置だけを決め直す
        adjustExpanded(box);
      }
    }
  };

  const watchLine = (box) => {
    const { wrapper, host } = box;
    const update = () => {
      // フォーカスで開くのは、キーボードで移動した時（:focus-visible）だけにする。
      // マウスで押した後にフォーカスが残っても、マウスを離せば閉じるようにするため
      const focused = host.shadowRoot.activeElement;
      // タッチの後もブラウザは :hover のままにすることがあるため、タッチで開いた後はマウスで操作するまで :hover を見ない
      const hovered = !box.ignoreHover && wrapper.matches(':hover');
      // 印（バッジ）だけは、キーボードで移動したフォーカスの時だけ開く。小さい表示は、これまでどおりフォーカスがあれば表示する
      const focusOpens = Boolean(focused) && (!box.badge || focused.matches(':focus-visible'));
      const active = hovered || focusOpens || Boolean(box.touchOpen);
      if (!active) {
        box.lineDismissed = false;
      }
      setLineShown(box, active);
    };
    box.updateLine = update;
    const onPointer = (event) => {
      if (event.pointerType === 'mouse') {
        box.ignoreHover = false;
      }
      update();
    };
    wrapper.addEventListener('pointerenter', onPointer);
    wrapper.addEventListener('pointerleave', onPointer);
    wrapper.addEventListener('focusin', update);
    wrapper.addEventListener('focusout', () => {
      if (!box.reordering) {
        setTimeout(update, 0);
      }
    });
    // タッチ操作では、印をタッチすると開き、評価ボックスの外をタッチすると閉じる
    wrapper.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' && box.badge && !wrapper.classList.contains('expanded')) {
        event.preventDefault();
        box.touchOpen = true;
        box.ignoreHover = true;
        box.lineDismissed = false;
        // 開いた直後に、同じタッチのクリックが、開いた位置に現れたボタンに当たって評価されないようにする
        box.suppressPointerId = event.pointerId;
        // 同じタッチのクリックが届いたら、目印を消す。クリックがボタン以外に当たって届かない場合に備え、1秒後にも消す
        const clear = () => {
          if (box.suppressPointerId === event.pointerId) {
            box.suppressPointerId = undefined;
          }
        };
        addEventListener('click', clear, { once: true });
        setTimeout(clear, 1000);
        state.touchOpenBoxes.add(box);
        update();
      }
    });
  };

  const onOutsidePointer = (event) => {
    if (state.touchOpenBoxes.size === 0) {
      return;
    }
    const path = event.composedPath();
    for (const box of [...state.touchOpenBoxes]) {
      if (!path.includes(box.host)) {
        box.touchOpen = false;
        state.touchOpenBoxes.delete(box);
        box.updateLine();
      }
    }
  };

  // 1行目を表示している間は、フォーカスがどこにあってもEscキーで隠せるようにする（WCAG 1.4.13）
  const onEscape = (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    for (const box of state.boxes.values()) {
      if (box.compact && box.wrapper.classList.contains('show-line')) {
        event.preventDefault();
        box.lineDismissed = true;
        setLineShown(box, false);
      }
    }
  };

  const buildBox = (img) => {
    const info = describe(img);
    const host = document.createElement(BOX_TAG);
    host.dataset.altEval = 'box';
    host.dataset.category = info.category;
    host.dataset.mode = 'inline';
    if (!state.idOf.has(img)) {
      state.idOf.set(img, state.nextId);
      state.nextId += 1;
    }
    host.dataset.id = String(state.idOf.get(img));
    setHostStyle(host, false);
    for (const type of STOPPED_EVENTS) {
      host.addEventListener(type, (event) => event.stopPropagation());
    }
    // フォーカスがある間に画像が変わった場合は、フォーカスが外れてから作り直す
    host.addEventListener('focusout', () => {
      setTimeout(() => {
        const box = state.hostToBox.get(host);
        if (box && box.stale && !host.shadowRoot.activeElement && state.boxes.get(box.img) === box) {
          box.stale = false;
          schedule([box.img]);
        }
      }, 0);
    });

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const wrapper = document.createElement('div');
    wrapper.className = 'wrapper';
    // ページの言語によらず、評価ボックスの文字を日本語として読み上げる
    wrapper.lang = 'ja';
    const boxEl = document.createElement('div');
    boxEl.className = 'box';
    const panel = document.createElement('div');
    panel.className = 'panel';

    const line = document.createElement('p');
    line.className = 'line';
    line.textContent = lineText(info);
    if (info.category === 'named') {
      // 画像自体から名前が読み上げられるので、2回読まれないようにする
      line.setAttribute('aria-hidden', 'true');
    }

    const group = document.createElement('div');
    group.className = 'buttons';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '直前の画像の評価');

    const box = { img, host, info, key: storageKey(img, info), rating: null, compact: false, lineDismissed: false, ratingButtons: [] };

    for (const { value, label, symbol } of RATINGS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.rating = value;
      button.setAttribute('aria-pressed', 'false');
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = symbol;
      const text = document.createElement('span');
      text.className = 'label';
      text.textContent = label;
      button.append(mark, text);
      button.addEventListener('click', (event) => {
        // ページのスクリプトが作ったクリックと、印をタッチして開いた時と同じタッチのクリックでは評価しない
        const sameTouch = box.suppressPointerId !== undefined && event.pointerId === box.suppressPointerId;
        box.suppressPointerId = undefined;
        if (event.isTrusted && !sameTouch) {
          rate(box, value);
        }
      });
      box.ratingButtons.push(button);
      group.append(button);
    }

    panel.append(line, group);
    boxEl.append(panel);
    wrapper.append(boxEl);
    root.append(style, wrapper);
    box.wrapper = wrapper;
    box.boxEl = boxEl;
    return box;
  };

  // 小さい画像は、ふだんは小さな印（バッジ）にし、マウスを重ねるかフォーカスした時に開く
  const makeBadge = (box) => {
    box.badge = true;
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.setAttribute('aria-hidden', 'true');
    box.badgeEl = badge;
    box.boxEl.prepend(badge);
    box.wrapper.classList.add('badge-mode');
    makeCompact(box);
    box.host.dataset.mode = 'badge';
    applyRating(box, box.rating);
  };

  // 切り取られる評価ボックスと、覆われる評価ボックスは、小さい表示にして最前面で画像に重ねる
  const makeCompact = (box) => {
    const { host } = box;
    host.dataset.mode = 'compact';
    box.compact = true;
    // 画面の外にある画像の評価ボックスにフォーカスが移ったら、画像が見える位置までスクロールする
    host.addEventListener('focusin', () => {
      const rect = box.img.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) {
        scrollBy({ top: rect.top - innerHeight / 3 });
      }
      positionCompact([box]);
    });
    if (state.intersection) {
      state.intersection.observe(box.img);
    }
    box.wrapper.classList.add('compact');
    setHostStyle(host, true);
    watchLine(box);
    host.setAttribute('popover', 'manual');
    try {
      host.showPopover();
    } catch {
      // popover に対応していない場合は、通常の表示のまま残す
    }
  };

  // 画像の実際に見えている部分（overflow が hidden か clip の祖先で切り取られた後の矩形）
  const visibleRect = (img) => {
    const rect = img.getBoundingClientRect();
    let { top, left, bottom, right } = rect;
    for (let node = img.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      if (!clipsOverflow(getComputedStyle(node))) {
        continue;
      }
      const outer = node.getBoundingClientRect();
      top = Math.max(top, outer.top);
      left = Math.max(left, outer.left);
      bottom = Math.min(bottom, outer.bottom);
      right = Math.min(right, outer.right);
    }
    // 完全に切り取られている場合は、画像の矩形を使う
    return bottom > top && right > left
      ? { top, left, bottom, right }
      : { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
  };

  const BADGE_SIZE = 20;

  // 印を開いた・閉じた時は、その印の左右の位置だけを決め直す（ほかの印は動かさない）
  const adjustExpanded = (box) => {
    if (!box.badgePos) {
      positionCompact([box]);
      return;
    }
    const viewportWidth = document.documentElement.clientWidth;
    const expanded = box.wrapper.classList.contains('expanded');
    const left = expanded ? Math.min(box.badgePos.left, viewportWidth - box.host.offsetWidth - 4) : box.badgePos.left;
    box.host.style.setProperty('left', `${Math.round(Math.max(0, left))}px`, 'important');
  };
  const inDocumentOrder = (a, b) => (a.host.compareDocumentPosition(b.host) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

  // 印の位置。右上・右下・左下・左上の順に試し、先に置いた印と重ならない最初の角に置く
  const badgeCorners = (v) => [
    [v.right - 12, v.top - 8],
    [v.right - 12, v.bottom - 12],
    [v.left - 8, v.bottom - 12],
    [v.left - 8, v.top - 8],
  ];

  const overlapsAny = ([x, y], placed) =>
    placed.some(([px, py]) => x < px + BADGE_SIZE && px < x + BADGE_SIZE && y < py + BADGE_SIZE && py < y + BADGE_SIZE);

  // 位置は、すべての大きさを先に測ってから、まとめて書き込む（レイアウトの再計算を減らすため）
  const positionCompact = (boxes) => {
    const viewportWidth = document.documentElement.clientWidth;
    const placements = boxes.filter((box) => !box.badge).map((box) => {
      const visible = visibleRect(box.img);
      const maxLeft = Math.max(0, viewportWidth - box.host.offsetWidth - 4);
      return { box, top: Math.round(visible.top + 4), left: Math.round(Math.min(Math.max(0, visible.left + 4), maxLeft)) };
    });
    // 印は重なりを避けるため、画面の近くにある印をまとめて、DOMの順に置き直す
    if (boxes.some((box) => box.badge)) {
      const badges = [...new Set([...nearCompactBoxes().filter((box) => box.badge), ...boxes.filter((box) => box.badge)])]
        .sort(inDocumentOrder);
      const placed = [];
      for (const box of badges) {
        // 画面の左端と上端からはみ出さないよう先に寄せてから、重なりを判定する
        const corners = badgeCorners(visibleRect(box.img)).map(([x, y]) => [Math.max(0, x), Math.max(0, y)]);
        // スクロールで角が入れ替わらないよう、前に置いた角が空いていれば、その角を使い続ける
        const order = box.corner !== undefined ? [box.corner, 0, 1, 2, 3] : [0, 1, 2, 3];
        const index = order.find((i) => !overlapsAny(corners[i], placed));
        box.corner = index === undefined ? 0 : index;
        const [x, y] = corners[box.corner];
        placed.push([x, y]);
        box.badgePos = { left: Math.round(x), top: Math.round(y) };
        // 開いている時は、画面の右端からはみ出さないよう左にずらす
        const expanded = box.wrapper.classList.contains('expanded');
        const left = expanded ? Math.min(x, viewportWidth - box.host.offsetWidth - 4) : x;
        placements.push({ box, top: Math.round(y), left: Math.round(Math.max(0, left)) });
      }
    }
    for (const { box, top, left } of placements) {
      box.host.style.setProperty('top', `${top}px`, 'important');
      box.host.style.setProperty('left', `${left}px`, 'important');
    }
  };

  // 位置を更新するのは、画面の近くにある小さい表示だけにする（画像が多いページで遅くならないように）
  const nearCompactBoxes = () => [...state.near].map((img) => state.boxes.get(img)).filter((box) => box && box.compact);

  // 画面から離れた小さい表示は、画面の外に置く（古い位置のまま画面に残らないように）
  const parkOffscreen = (box) => {
    box.host.style.setProperty('top', '-10000px', 'important');
  };

  const onIntersection = (entries) => {
    const entered = [];
    for (const entry of entries) {
      const box = state.boxes.get(entry.target);
      if (entry.isIntersecting) {
        state.near.add(entry.target);
        if (box && box.compact) {
          entered.push(box);
        }
      } else {
        state.near.delete(entry.target);
        if (box && box.compact && !box.host.shadowRoot.activeElement) {
          parkOffscreen(box);
        }
      }
    }
    positionCompact(entered);
  };

  const repositionAll = () => {
    if (state.repositionScheduled) {
      return;
    }
    state.repositionScheduled = true;
    requestAnimationFrame(() => {
      state.repositionScheduled = false;
      positionCompact(nearCompactBoxes());
    });
  };

  const isSmall = (img) => {
    const rect = img.getBoundingClientRect();
    return rect.width < SMALL_SIZE || rect.height < SMALL_SIZE;
  };

  // overflow が hidden か clip の祖先に、評価ボックスが切り取られるか
  const isClipped = (host) => {
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return true;
    }
    for (let node = host.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const cs = getComputedStyle(node);
      const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (!clipX && !clipY) {
        continue;
      }
      const outer = node.getBoundingClientRect();
      if (clipX && (rect.left < outer.left - 1 || rect.right > outer.right + 1)) {
        return true;
      }
      if (clipY && (rect.top < outer.top - 1 || rect.bottom > outer.bottom + 1)) {
        return true;
      }
    }
    return false;
  };

  // 画面に見えている評価ボックスが、ページの要素に覆われているか。
  // 覆われていると、ボタンを押したつもりでページのリンクや広告をクリックしてしまう
  const isObscured = (host) => {
    const rect = host.getBoundingClientRect();
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + 4, rect.top + 4],
      [rect.right - 4, rect.bottom - 4],
    ];
    return points.some(([x, y]) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
        return false;
      }
      const hit = document.elementFromPoint(x, y);
      return hit !== null && hit !== host;
    });
  };

  const isOurs = (node) => node.localName === BOX_TAG || node.localName === LIVE_TAG;

  const clipsOverflow = (cs) => /hidden|clip/.test(cs.overflowX) || /hidden|clip/.test(cs.overflowY);

  // 親要素の overflow: hidden で、画像が完全に隠れているか
  const isClippedAway = (img) => {
    const rect = img.getBoundingClientRect();
    for (let node = img.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      if (!clipsOverflow(getComputedStyle(node))) {
        continue;
      }
      const outer = node.getBoundingClientRect();
      if (rect.right <= outer.left || rect.left >= outer.right || rect.bottom <= outer.top || rect.top >= outer.bottom) {
        return true;
      }
    }
    return false;
  };

  // 対象にするのは、画面に表示されているか、スクリーンリーダーに伝わる画像。
  // 誰にも伝わらない画像（display: none、visibility: hidden、aria-hidden かつ完全に隠れている画像）は対象にしない
  const isTarget = (img) => {
    if (!img.isConnected || !isCandidate(img) || img.getClientRects().length === 0) {
      return false;
    }
    const visibility = getComputedStyle(img).visibility;
    if (visibility === 'hidden' || visibility === 'collapse') {
      return false;
    }
    if (outermostHidden(img) && isClippedAway(img)) {
      return false;
    }
    return true;
  };

  const precedes = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  // 同じ基準の要素に複数の画像がある場合は、画像と同じ順番で評価ボックスを並べる
  const insertBox = (img) => {
    const box = buildBox(img);
    let ref = insertionAnchor(img);
    for (let next = ref.nextElementSibling; next && next.localName === BOX_TAG; next = next.nextElementSibling) {
      const other = state.hostToBox.get(next);
      if (!other || !precedes(other.img, img)) {
        break;
      }
      ref = next;
    }
    ref.after(box.host);
    state.hostToBox.set(box.host, box);
    state.boxes.set(img, box);
    if (!state.loadWatched.has(img)) {
      state.loadWatched.add(img);
      // 読み込み前は大きさが0のため、読み込み後に大きさを測り直して作り直す
      img.addEventListener('load', () => {
        if (state.enabled) {
          schedule([img]);
        }
      });
    }
    return box;
  };

  const removeBox = (img) => {
    const box = state.boxes.get(img);
    if (!box) {
      return;
    }
    if (box.compact && state.intersection) {
      state.intersection.unobserve(img);
      state.near.delete(img);
    }
    state.touchOpenBoxes.delete(box);
    clearTimeout(box.revealTimer);
    box.host.remove();
    state.boxes.delete(img);
  };

  const restoreRatings = async (boxes) => {
    if (boxes.length === 0) {
      return;
    }
    for (const box of boxes) {
      box.info = describe(box.img);
      box.key = storageKey(box.img, box.info);
    }
    let stored = {};
    try {
      stored = await chrome.storage.local.get(boxes.map((box) => box.key));
    } catch {
      return;
    }
    for (const box of boxes) {
      const rating = stored[box.key] && stored[box.key].rating;
      // 以前の版の「普通」など、今の選択肢に無い評価は表示しない
      applyRating(box, RATINGS.some((r) => r.value === rating) ? rating : null);
    }
  };

  // 追加・変更された画像の評価ボックスを、まとめて挿入する
  const flush = async () => {
    state.flushScheduled = false;
    const imgs = [...state.pending];
    state.pending.clear();
    if (!state.enabled) {
      return;
    }
    // 測る処理と書き換える処理を交互に行うと、そのたびにレイアウトが再計算されて遅くなるため、
    // 「対象を決める（測る）→ 挿入する（書く）→ 大きさを測る → 折りたたむ（書く）→ 位置を決める」の順にまとめる
    // 操作中（フォーカスがある）の評価ボックスは作り直さない。フォーカスが外れてから作り直す
    const rebuild = imgs.filter((img) => {
      const box = state.boxes.get(img);
      if (box && box.host.shadowRoot.activeElement) {
        box.stale = true;
        return false;
      }
      return true;
    });
    for (const img of rebuild) {
      removeBox(img);
    }
    const hadBox = new Set(rebuild.filter((img) => state.boxes.has(img)));
    const targets = rebuild.filter(isTarget);
    const added = targets.map(insertBox);
    // 先にすべて測ってから書き換える。小さい画像は印、切り取られる・覆われる評価ボックスは小さい表示にする
    const modes = added.map((box) => {
      if (isSmall(box.img)) {
        return 'badge';
      }
      return isClipped(box.host) || isObscured(box.host) ? 'compact' : 'inline';
    });
    const toCompact = added.filter((box, i) => modes[i] !== 'inline');
    added.forEach((box, i) => {
      if (modes[i] === 'badge') {
        makeBadge(box);
      } else if (modes[i] === 'compact') {
        makeCompact(box);
      }
    });
    positionCompact(toCompact);
    if (added.length > 0) {
      // 挿入した評価ボックスで後ろの内容がずれるため、ほかの小さい表示の位置も決め直す
      repositionAll();
    }
    await restoreRatings(added);
    // 作り直しただけの時は知らせない。新しく増えた・無くなった時だけ知らせる（カルーセルなどで知らせ続けないように）
    const appeared = added.some((box) => !hadBox.has(box.img));
    const vanished = [...hadBox].some((img) => !state.boxes.has(img));
    if (appeared || vanished) {
      notifyChanged();
    }
  };

  // 表示の切り替えがあった範囲の画像を調べ直す。
  // 新しく見えるようになった画像には評価ボックスを付け、見えなくなった画像からは外す
  const recheck = () => {
    state.recheckTimer = 0;
    if (!state.enabled) {
      state.recheckRoots.clear();
      return;
    }
    const imgs = new Set();
    for (const root of state.recheckRoots) {
      if (!root.isConnected) {
        continue;
      }
      for (const img of candidatesIn(root)) {
        imgs.add(img);
      }
      // role="img" を外した時など、対象でなくなった要素の評価ボックスも調べ直す
      for (const img of state.boxes.keys()) {
        if (root === img || root.contains(img)) {
          imgs.add(img);
        }
      }
    }
    state.recheckRoots.clear();
    const changed = [];
    for (const img of imgs) {
      const box = state.boxes.get(img);
      const target = isTarget(img);
      const hiddenNow = Boolean(outermostHidden(img));
      if (box ? !target || hiddenNow !== (box.info.category === 'hidden') : target) {
        changed.push(img);
      }
    }
    if (changed.length > 0) {
      schedule(changed);
    }
    repositionAll();
  };

  const scheduleRecheck = (root) => {
    state.recheckRoots.add(root);
    if (!state.recheckTimer) {
      state.recheckTimer = setTimeout(recheck, RECHECK_DELAY);
    }
  };

  // ページを移動せずにURLが変わった時（SPA）は、保存した評価を新しいURLで読み直す
  const onUrlChange = () => {
    if (!state.enabled || pageUrl() === state.lastUrl) {
      return;
    }
    state.lastUrl = pageUrl();
    restoreRatings([...state.boxes.values()]).then(notifyChanged);
  };

  const schedule = (imgs) => {
    for (const img of imgs) {
      state.pending.add(img);
    }
    if (!state.flushScheduled) {
      state.flushScheduled = true;
      queueMicrotask(flush);
    }
  };

  // 変化が svg の title 要素の中で起きていれば、その svg を返す
  const svgOfTitleChange = (mutation) => {
    const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
    if (!target) {
      return null;
    }
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    const touchesTitle = target.closest('title') || nodes.some((node) => node.localName === 'title');
    const svg = touchesTitle ? target.closest('svg') : null;
    return svg && isCandidate(svg) ? svg : null;
  };

  const onMutations = (mutations) => {
    const imgs = [];
    let removed = false;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const { target } = mutation;
        if (isOurs(target)) {
          continue;
        }
        if (kindOf(target) && WATCHED_ATTRIBUTES.includes(mutation.attributeName)) {
          imgs.push(target);
        } else {
          scheduleRecheck(target);
        }
        continue;
      }
      // svg の title 要素の文字が変わったら、その svg の評価ボックスを作り直す（ほかの子の変化では作り直さない）
      const titleSvg = svgOfTitleChange(mutation);
      if (titleSvg) {
        imgs.push(titleSvg);
      }
      if (mutation.type === 'characterData') {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE || isOurs(node)) {
          continue;
        }
        imgs.push(...candidatesIn(node));
      }
      for (const node of mutation.removedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && !isOurs(node)) {
          removed = true;
        }
      }
    }
    if (removed) {
      let count = 0;
      for (const img of [...state.boxes.keys()]) {
        if (!img.isConnected) {
          removeBox(img);
          count += 1;
        }
      }
      if (count > 0) {
        notifyChanged();
      }
    }
    if (imgs.length > 0) {
      schedule(imgs);
    }
  };

  // ---- 評価の保存 ----

  // 使わないサイトに登録されているか（docs/contract.md の「使わないサイト」）
  const readSettings = async () => {
    try {
      const stored = (await chrome.storage.local.get('settings')).settings || {};
      return {
        defaultOn: stored.defaultOn === true,
        excludedSites: Array.isArray(stored.excludedSites) ? stored.excludedSites : [],
      };
    } catch {
      return { defaultOn: false, excludedSites: [] };
    }
  };

  const isExcluded = async () => (await readSettings()).excludedSites.includes(location.hostname);

  // 押した評価をもう一度押すと取り消す
  const rate = (box, value) => rateTo(box, box.rating === value ? null : value);

  // 評価を next にする（null なら取り消す）。保存したら true を返す
  const rateTo = async (box, next) => {
    // 使わないサイトに登録されたサイトでは、評価を保存しない
    if (await isExcluded()) {
      return false;
    }
    const info = describe(box.img);
    const key = storageKey(box.img, info);
    try {
      if (next) {
        await chrome.storage.local.set({
          [key]: {
            element: info.element,
            pageUrl: pageUrl(),
            pageTitle: document.title,
            imageUrl: info.imageUrl,
            embedded: info.embedded,
            category: info.category,
            name: info.name,
            nameSource: info.nameSource,
            altState: info.altState,
            alt: info.alt,
            linkUrl: info.linkUrl,
            rating: next,
            ratedAt: new Date().toISOString(),
          },
        });
      } else {
        // 評価した後で名前が変わっていても、同じページの元の記録を消す。
        // 別のページ（SPAでURLが変わる前）の記録は消さない
        const keys = [key];
        if (box.key !== key && JSON.parse(box.key.slice(2))[0] === pageUrl()) {
          keys.push(box.key);
        }
        await chrome.storage.local.remove(keys);
      }
    } catch {
      announce('評価を保存できませんでした');
      return false;
    }
    box.info = info;
    box.key = key;
    for (const other of state.boxes.values()) {
      if (other.key === key) {
        applyRating(other, next);
      }
    }
    notifyChanged();
    return true;
  };

  // ---- サイドパネルとのやり取り（docs/contract.md の「サイドパネル」） ----

  // サイドパネルなどに、評価ボックスや評価が変わったことを知らせる。続けて変わった時は200ミリ秒に1回にまとめる
  const notifyChanged = () => {
    if (state.notifyTimer) {
      return;
    }
    state.notifyTimer = setTimeout(() => {
      state.notifyTimer = 0;
      try {
        chrome.runtime.sendMessage({ type: 'altEval:changed' }).catch(() => {});
      } catch {
        // 拡張機能を読み込み直した後などは、送れなくても何もしない
      }
    }, 200);
  };

  const itemOf = (box) => ({
    id: state.idOf.get(box.img),
    element: box.info.element,
    category: box.info.category,
    line: lineText(box.info),
    rating: box.rating,
    mode: box.host.dataset.mode,
  });

  const boxById = (id) => [...state.boxes.values()].find((box) => state.idOf.get(box.img) === id) || null;

  const listItems = () => [...state.boxes.values()].sort(inDocumentOrder).map(itemOf);

  // 画像までスクロールし、評価ボックスを開いて、最初のボタンにフォーカスを移す
  const reveal = (box) => {
    box.img.scrollIntoView({ block: 'center' });
    if (box.compact) {
      box.touchOpen = true;
      box.lineDismissed = false;
      state.touchOpenBoxes.add(box);
      box.updateLine();
    }
    box.ratingButtons[0].focus({ preventScroll: true });
    box.host.dataset.revealed = '';
    clearTimeout(box.revealTimer);
    box.revealTimer = setTimeout(() => {
      delete box.host.dataset.revealed;
    }, 2000);
  };

  // ---- 評価モードの切り替え ----

  const getState = () => {
    let rated = 0;
    for (const box of state.boxes.values()) {
      if (box.rating) {
        rated += 1;
      }
    }
    return { enabled: state.enabled, total: state.boxes.size, rated };
  };

  const enable = async (shouldAnnounce) => {
    if (state.enabled) {
      return true;
    }
    if (await isExcluded()) {
      if (shouldAnnounce) {
        announce('このサイトは、評価モードを使わないサイトに登録されています');
      }
      return false;
    }
    if (state.enabled) {
      return true;
    }
    state.enabled = true;
    state.observer = new MutationObserver(onMutations);
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...WATCHED_ATTRIBUTES, ...DISPLAY_ATTRIBUTES],
      characterData: true,
    });
    state.intersection = new IntersectionObserver(onIntersection, { rootMargin: NEAR_MARGIN });
    state.resize = new ResizeObserver(repositionAll);
    state.resize.observe(document.documentElement);
    state.lastUrl = pageUrl();
    addEventListener('popstate', onUrlChange);
    addEventListener('keydown', onEscape, true);
    addEventListener('pointerdown', onOutsidePointer, true);
    if (globalThis.navigation) {
      navigation.addEventListener('navigatesuccess', onUrlChange);
    }
    addEventListener('scroll', repositionAll, { capture: true, passive: true });
    addEventListener('resize', repositionAll, { passive: true });
    for (const img of candidatesIn(document.documentElement)) {
      state.pending.add(img);
    }
    await flush();
    notifyChanged();
    if (shouldAnnounce) {
      announce(`評価モードをオンにしました。画像は${state.boxes.size}枚です`);
    }
    return true;
  };

  const disable = (shouldAnnounce) => {
    if (!state.enabled) {
      return;
    }
    state.enabled = false;
    state.observer.disconnect();
    state.observer = null;
    state.pending.clear();
    clearTimeout(state.recheckTimer);
    state.recheckTimer = 0;
    state.recheckRoots.clear();
    state.intersection.disconnect();
    state.intersection = null;
    state.near.clear();
    state.resize.disconnect();
    state.resize = null;
    removeEventListener('popstate', onUrlChange);
    removeEventListener('keydown', onEscape, true);
    removeEventListener('pointerdown', onOutsidePointer, true);
    if (globalThis.navigation) {
      navigation.removeEventListener('navigatesuccess', onUrlChange);
    }
    removeEventListener('scroll', repositionAll, { capture: true });
    removeEventListener('resize', repositionAll);
    for (const img of [...state.boxes.keys()]) {
      removeBox(img);
    }
    state.touchOpenBoxes.clear();
    notifyChanged();
    if (shouldAnnounce) {
      announce('評価モードをオフにしました');
    }
    // 読み上げが終わるのを待ってから、読み上げ用の領域も取り除く
    const live = state.live;
    if (live) {
      clearTimeout(state.liveRemoveTimer);
      state.liveRemoveTimer = setTimeout(() => {
        if (!state.enabled) {
          live.host.remove();
          if (state.live === live) {
            state.live = null;
          }
        }
      }, 5000);
    }
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') {
      return false;
    }
    if (message.type === 'altEval:getState') {
      sendResponse(getState());
      return false;
    }
    if (message.type === 'altEval:list') {
      sendResponse({
        enabled: state.enabled,
        items: state.enabled ? listItems() : [],
        title: document.title,
        host: location.protocol === 'file:' ? '' : location.hostname,
      });
      return false;
    }
    if (message.type === 'altEval:rate') {
      const box = boxById(message.id);
      const rating = message.rating === 'good' || message.rating === 'poor' ? message.rating : null;
      if (!box) {
        sendResponse(null);
        return false;
      }
      rateTo(box, rating).catch(() => false).then(() => sendResponse(itemOf(box)));
      return true;
    }
    if (message.type === 'altEval:reveal') {
      const box = boxById(message.id);
      if (box) {
        reveal(box);
      }
      sendResponse(Boolean(box));
      return false;
    }
    if (message.type === 'altEval:setEnabled') {
      state.userToggled = true;
      if (message.enabled) {
        enable(Boolean(message.announce))
          .catch(() => true)
          .then((ok) => sendResponse(ok === false ? { ...getState(), excluded: true } : getState()));
      } else {
        disable(Boolean(message.announce));
        sendResponse(getState());
      }
      return true;
    }
    return false;
  });

  // 使わないサイトに登録されたら、評価モードをオフにする
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings || !state.enabled) {
      return;
    }
    const sites = (changes.settings.newValue && changes.settings.newValue.excludedSites) || [];
    if (sites.includes(location.hostname)) {
      disable(false);
    }
  });

  globalThis.__altEvalContent = true;

  // 既定でオンの設定なら、読み込まれた時に読み上げずに評価モードをオンにする。
  // ポップアップやショートカットで先に切り替えられていたら、その操作を優先する
  readSettings().then(({ defaultOn }) => {
    if (defaultOn && !state.userToggled) {
      enable(false).catch(() => {});
    }
  });
})();
