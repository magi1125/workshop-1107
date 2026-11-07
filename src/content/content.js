// 評価モードと評価ボックス（docs/proposal.md の「評価ボックス」「評価モード」、docs/contract.md）
'use strict';

(() => {
  // ページの要素の id と取り違えないよう、自分で定義したかどうかを確かめる
  if (Object.hasOwn(globalThis, '__altEvalContent')) {
    return;
  }
  const { describe, outermostHidden } = globalThis.AltEvalName;

  const BOX_TAG = 'alt-eval-box';
  const LIVE_TAG = 'alt-eval-live';
  const SMALL_SIZE = 48;
  const RATINGS = [
    { value: 'good', label: '良い' },
    { value: 'fair', label: '普通' },
    { value: 'poor', label: '悪い' },
  ];
  const RATING_LABEL = Object.fromEntries(RATINGS.map((r) => [r.value, r.label]));
  const INTERACTIVE = 'a[href], button, summary, label, [role="button"], [role="link"]';
  const WATCHED_ATTRIBUTES = ['alt', 'aria-label', 'aria-labelledby', 'title', 'role', 'src', 'srcset'];
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
    .collapsed .box {
      padding: 6px;
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
    .panel[hidden] {
      display: none;
    }
    .collapsed .panel {
      margin-top: 8px;
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
    button.toggle {
      min-width: 24px;
      min-height: 24px;
      padding: 0 8px;
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
    }
    @media (forced-colors: active) {
      .box,
      button {
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
  };

  const pageUrl = () => location.href.split('#')[0];

  const storageKey = (info) => 'r:' + JSON.stringify([pageUrl(), info.embedded ? 'embedded' : info.imageUrl, info.name]);

  // ページのCSSの影響を受けないよう、ホスト要素の表示に関わる値を直接指定する
  const setHostStyle = (host, collapsed) => {
    const style = host.style;
    style.cssText = '';
    style.setProperty('all', 'initial', 'important');
    style.setProperty('display', 'block', 'important');
    style.setProperty('box-sizing', 'border-box', 'important');
    if (collapsed) {
      style.setProperty('position', 'fixed', 'important');
      style.setProperty('inset', 'auto', 'important');
      style.setProperty('margin', '0', 'important');
      style.setProperty('padding', '0', 'important');
      style.setProperty('border', '0', 'important');
      style.setProperty('background', 'transparent', 'important');
      style.setProperty('overflow', 'visible', 'important');
      style.setProperty('width', 'max-content', 'important');
      style.setProperty('max-width', 'min(40em, calc(100vw - 16px))', 'important');
    } else {
      style.setProperty('width', 'fit-content', 'important');
      style.setProperty('margin', '4px 0', 'important');
      style.setProperty('max-width', '100%', 'important');
    }
  };

  const lineText = (info) => {
    switch (info.category) {
      case 'named':
        return `名前：${info.name}（${info.nameSource}から）`;
      case 'empty':
        return info.presentational
          ? `読み上げられない画像（role="${info.role}"）`
          : '読み上げられない画像（空のalt）';
      case 'none':
        return '名前なし（ファイル名が読み上げられる場合があります）';
      default: {
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

  const applyRating = (box, rating) => {
    box.rating = rating;
    for (const button of box.ratingButtons) {
      const pressed = button.dataset.rating === rating;
      button.setAttribute('aria-pressed', String(pressed));
      button.querySelector('.mark').textContent = pressed ? '✓' : '';
    }
    if (box.toggle) {
      box.toggle.textContent = rating ? `評価：${RATING_LABEL[rating]}` : '評価';
    }
  };

  const setExpanded = (box, expanded) => {
    if (!box.toggle) {
      return;
    }
    box.toggle.setAttribute('aria-expanded', String(expanded));
    box.panel.hidden = !expanded;
  };

  const buildBox = (img) => {
    const info = describe(img);
    const host = document.createElement(BOX_TAG);
    host.dataset.altEval = 'box';
    host.dataset.category = info.category;
    host.dataset.mode = 'inline';
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

    const box = { img, host, info, key: storageKey(info), rating: null, toggle: null, panel, ratingButtons: [] };

    for (const { value, label } of RATINGS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.rating = value;
      button.setAttribute('aria-pressed', 'false');
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.setAttribute('aria-hidden', 'true');
      button.append(mark, label);
      button.addEventListener('click', () => rate(box, value));
      box.ratingButtons.push(button);
      group.append(button);
    }

    group.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && box.toggle && box.toggle.getAttribute('aria-expanded') === 'true') {
        event.preventDefault();
        setExpanded(box, false);
        box.toggle.focus();
      }
    });

    panel.append(line, group);
    boxEl.append(panel);
    wrapper.append(boxEl);
    root.append(style, wrapper);
    box.wrapper = wrapper;
    box.boxEl = boxEl;
    return box;
  };

  // 小さい画像と、切り取られる評価ボックスは、折りたたんで最前面に表示する
  const collapse = (box) => {
    const { host, boxEl, panel } = box;
    host.dataset.mode = 'collapsed';
    box.wrapper.classList.add('collapsed');
    setHostStyle(host, true);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      setExpanded(box, toggle.getAttribute('aria-expanded') !== 'true');
    });
    boxEl.prepend(toggle);
    box.toggle = toggle;
    panel.hidden = true;
    applyRating(box, box.rating);
    host.setAttribute('popover', 'manual');
    try {
      host.showPopover();
    } catch {
      // popover に対応していない場合は、通常の表示のまま残す
    }
  };

  // 位置は、すべての大きさを先に測ってから、まとめて書き込む（レイアウトの再計算を減らすため）
  const positionCollapsed = (boxes) => {
    const viewportWidth = document.documentElement.clientWidth;
    const placements = boxes.map((box) => {
      const rect = box.img.getBoundingClientRect();
      const maxLeft = Math.max(0, viewportWidth - box.host.offsetWidth - 8);
      return { box, top: Math.round(rect.bottom + 2), left: Math.round(Math.min(Math.max(0, rect.left), maxLeft)) };
    });
    for (const { box, top, left } of placements) {
      box.host.style.setProperty('top', `${top}px`, 'important');
      box.host.style.setProperty('left', `${left}px`, 'important');
    }
  };

  const collapsedBoxes = () => [...state.boxes.values()].filter((box) => box.toggle);

  const repositionAll = () => {
    if (state.repositionScheduled) {
      return;
    }
    state.repositionScheduled = true;
    requestAnimationFrame(() => {
      state.repositionScheduled = false;
      positionCollapsed(collapsedBoxes());
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
    if (!img.isConnected || img.closest(BOX_TAG) || img.getClientRects().length === 0) {
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
    box.host.remove();
    state.boxes.delete(img);
  };

  const restoreRatings = async (boxes) => {
    if (boxes.length === 0) {
      return;
    }
    for (const box of boxes) {
      box.info = describe(box.img);
      box.key = storageKey(box.info);
    }
    let stored = {};
    try {
      stored = await chrome.storage.local.get(boxes.map((box) => box.key));
    } catch {
      return;
    }
    for (const box of boxes) {
      applyRating(box, stored[box.key] ? stored[box.key].rating : null);
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
    const targets = rebuild.filter(isTarget);
    const added = targets.map(insertBox);
    const toCollapse = added.filter((box) => isSmall(box.img) || isClipped(box.host));
    for (const box of toCollapse) {
      collapse(box);
    }
    positionCollapsed(toCollapse);
    await restoreRatings(added);
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

  const onMutations = (mutations) => {
    const imgs = [];
    let removed = false;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        if (mutation.target.localName === 'img') {
          imgs.push(mutation.target);
        }
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE || isOurs(node)) {
          continue;
        }
        if (node.localName === 'img') {
          imgs.push(node);
        }
        imgs.push(...node.querySelectorAll('img'));
      }
      for (const node of mutation.removedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && !isOurs(node)) {
          removed = true;
        }
      }
    }
    if (removed) {
      for (const img of [...state.boxes.keys()]) {
        if (!img.isConnected) {
          removeBox(img);
        }
      }
    }
    if (imgs.length > 0) {
      schedule(imgs);
    }
  };

  // ---- 評価の保存 ----

  const rate = async (box, value) => {
    const next = box.rating === value ? null : value;
    const info = describe(box.img);
    const key = storageKey(info);
    try {
      if (next) {
        await chrome.storage.local.set({
          [key]: {
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
        // 評価した後で名前やURLが変わっていても、元の記録を消す
        await chrome.storage.local.remove([...new Set([key, box.key])]);
      }
    } catch {
      announce('評価を保存できませんでした');
      return;
    }
    box.info = info;
    box.key = key;
    for (const other of state.boxes.values()) {
      if (other.key === key) {
        applyRating(other, next);
      }
    }
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
      return;
    }
    state.enabled = true;
    state.observer = new MutationObserver(onMutations);
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES,
    });
    addEventListener('scroll', repositionAll, { capture: true, passive: true });
    addEventListener('resize', repositionAll, { passive: true });
    for (const img of document.querySelectorAll('img')) {
      state.pending.add(img);
    }
    await flush();
    if (shouldAnnounce) {
      announce(`評価モードをオンにしました。画像は${state.boxes.size}枚です`);
    }
  };

  const disable = (shouldAnnounce) => {
    if (!state.enabled) {
      return;
    }
    state.enabled = false;
    state.observer.disconnect();
    state.observer = null;
    state.pending.clear();
    removeEventListener('scroll', repositionAll, { capture: true });
    removeEventListener('resize', repositionAll);
    for (const img of [...state.boxes.keys()]) {
      removeBox(img);
    }
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
    if (message.type === 'altEval:setEnabled') {
      const task = message.enabled ? enable(Boolean(message.announce)) : Promise.resolve(disable(Boolean(message.announce)));
      task.catch(() => {}).then(() => sendResponse(getState()));
      return true;
    }
    return false;
  });

  globalThis.__altEvalContent = true;
})();
