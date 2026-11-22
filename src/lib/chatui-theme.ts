const THEME_ID = 'nexconn-chatui-theme';

const CHAT_UI_STYLES = `
  :host { color: #edf3ff; color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
  * { scrollbar-color: #263a58 transparent; }
  .nc-chatui-app,
  .nc-chatui-app-wrapper-left,
  .nc-chatui-app-conv,
  .nc-channel-wrap,
  .nc-channel-list,
  .nc-chatui-app-wrapper-right,
  .nc-chatui-app-inner,
  .nc-chatui-msg-list,
  .nc-chatui-msg-list-scroll {
    background-color: #081426;
    color: #edf3ff;
  }
  .nc-chatui-app-inner,
  .nc-chatui-app-wrapper-right { min-width: 0; }
  .nc-chatui-app-wrapper-left::before {
    content: "Nexconn";
    display: flex;
    min-height: 64px;
    align-items: center;
    padding: 0 24px;
    border-bottom: 1px solid #1b2b43;
    color: #f4f7ff;
    font-size: 21px;
    font-weight: 650;
    letter-spacing: -.035em;
  }
  .list { border-right-color: #1b2b43; }
  .bar-content {
    height: 64px;
    padding: 0 8px;
    border-bottom: 1px solid #1b2b43;
    background: #0a172b;
  }
  .bar-title { color: #f4f7ff; font-size: 21px; font-weight: 650; }
  .nc-channel-wrap { padding: 6px 10px; }
  :host(nc-channel-list-container-provider) .nc-chatui-app-wrapper-left { width: clamp(300px, 34vw, 460px); min-width: clamp(300px, 34vw, 460px); }
  :host(nc-channel-list-provider) .nc-channel-wrap { min-height: 100%; padding-top: 112px; box-sizing: border-box; }
  :host(nc-channel-list-item[hidden]) { display: none !important; }
  .nc-channel-list-menu,
  .nc-chatui-msg-list-menu,
  .nc-message-list-menu,
  :host(nc-input-provider) .secondary-menu { border: 1px solid #294568; border-radius: 9px; background: #102039 !important; color: #eaf1ff; box-shadow: 0 12px 32px #0009; }
  .nc-message-list-menu { background: #102039 !important; }
  .nc-channel-list-item { border: 1px solid transparent; transition: background-color 140ms ease, border-color 140ms ease; }
  .nc-channel-list-item.active-selected,
  .nc-channel-list-item.active-top { border-color: #2f67b2; background-color: #132746 !important; }
  .nc-channel-list-item.active-right-clicked,
  .nc-channel-list-item:hover { background-color: #10213a !important; }
  :host(nc-channel-list-item) .nc-channel-list-item.active-right-clicked { box-sizing: border-box; max-width: 100%; min-width: 0; overflow: visible; border-color: #2f67b2; background: transparent !important; color: #edf3ff !important; box-shadow: 0 0 16px #1769e833, inset 0 0 0 1px #2f67b2; }
  .channel-info .info-block { color: #dce7f8; }
  :host(nc-channel-detail-bar-provider) .nc-channel-detail-bar {
    border-bottom: 1px solid #1b2b43;
    background: #0b192e;
  }
  :host(nc-channel-detail-bar-provider) .back-button { color: #d8e5f8; }
  :host(nc-channel-detail-bar-provider) .back-button:hover { color: #f4f7ff; }
  :host(nc-channel-detail-bar-provider) .icon { width: 45px; height: 45px; margin: 0 10px 0 20px; border-radius: 50%; object-fit: cover; }
  :host(nc-channel-detail-bar-provider) .name { color: #f4f7ff; font-weight: 600; }
  :host(nc-channel-detail-bar-provider) .member-count,
  :host(nc-channel-detail-bar-provider) .typing-content { color: #91a2bc; }
  :host(nc-channel-detail-bar-provider) .extension { display: flex; align-items: center; gap: 14px; padding: 0 0 0 10px; }
  :host(nc-channel-detail-bar-provider) .extension-button { display: grid; width: 36px; height: 36px; place-items: center; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
  :host(nc-channel-detail-bar-provider) .extension-button:hover { background: #172943; }
  :host(nc-channel-detail-bar-provider) .extension-button:focus-visible { outline: 2px solid #53bdeb; outline-offset: 2px; }
  :host(nc-channel-detail-bar-provider) .extension-icon { width: 21px; height: 21px; cursor: pointer; opacity: .9; }
  :host(nc-channel-detail-bar-provider) .extension-icon:hover { opacity: 1; }
  .nc-chatui-msg-list { background: #071222; }
  .nc-chatui-msg-list-scroll { background: transparent; }
  .nc-chatui-msg-list-item { box-sizing: border-box; padding-inline: 10px; }
  .nc-chatui-msg-avatar { display: none !important; }
  .nc-chatui-msg-list-item.nexconn-search-current { outline: 2px solid #53bdeb !important; outline-offset: 2px; border-radius: 10px; }
  .nc-chatui-msg-list-menu { box-shadow: 0 12px 32px #0008; }
  .nc-chatui-msg-list-menu button,
  .nc-channel-list-menu button { color: #e7eefb; }
  :host(nc-channel-list-menu-item) img { width: 18px; height: 18px; flex: 0 0 18px; object-fit: contain; }
  :host(nc-channel-list-menu-item) .content { color: #a7bad4; }
  :host(nc-channel-list-menu-item:hover) { background-color: #193354 !important; }
  :host(nc-channel-list-menu-item:hover) .content { color: #edf3ff; }
  :host(nc-channel-list-menu-item:hover) img { filter: brightness(0) invert(1); }
  :host(nc-message-list-menu-item) { color: #eaf1ff; }
  :host(nc-message-list-menu-item) .content { color: #eaf1ff; }
  :host(nc-message-list-menu-item:hover) { background-color: #193354 !important; }
  :host(nc-message-list-menu-item) img { filter: brightness(0) invert(1); opacity: .9; }
  .nc-chatui-msg-list-box .checkbox .custom { border-color: #7897c0 !important; background-color: #102039 !important; }
  .nc-chatui-msg-list-box .checkbox input[type="checkbox"]:checked + .custom { border-color: #1769e8 !important; background-color: #1769e8 !important; }
  :host(nc-input-provider) .nc-input-provider { background: #071222; }
  :host(nc-input-provider) .nc-input-provider {
    width: calc(100% - 28px);
    max-width: calc(100% - 28px);
    height: auto;
    min-height: 58px;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 0;
    margin: 0 14px 10px;
    box-sizing: border-box;
    padding: 0 8px;
    border: 1px solid #263a58;
    border-radius: 28px;
    background: #071222;
  }
  :host(nc-input-provider) .nc-input-top-buttons { width: max-content !important; min-width: max-content; flex: 0 0 max-content !important; gap: 10px; padding: 0 10px 0 5px; }
  :host(nc-input-provider) .nc-input-wrapper { width: 0 !important; max-width: none; min-width: 0 !important; flex: 1 1 0% !important; margin: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
  :host(nc-input-provider) .nc-input-inner-wrapper { width: 100%; min-width: 0; align-items: center; gap: 4px; padding: 2px; }
  :host(nc-input-provider) .input-text-container { width: 100%; min-width: 0; }
  :host(nc-input-provider) .nc-input-wrapper .textarea { display: block; width: 100%; min-width: 0; min-height: 40px; height: 40px; margin: 0; padding: 9px 8px; }
  :host(nc-input-provider) .nc-input-send-button,
  :host(nc-input-provider) .nexconn-voice-button { display: grid; width: 38px; height: 38px; min-width: 38px; flex: 0 0 auto; place-items: center; margin: 0; padding: 0; border: 0; border-radius: 50%; background: transparent; color: #dce8f7; }
  :host(nc-input-provider) .nc-input-send-button:hover,
  :host(nc-input-provider) .nexconn-voice-button:hover { background: #172943; }
  :host(nc-input-provider) .nc-input-send-button img,
  :host(nc-input-provider) .nexconn-voice-button img { width: 21px; height: 21px; }
  :host(nc-input-provider) .nc-input-send-button span { display: none; }
  :host(nc-input-provider) .nexconn-voice-button[aria-pressed="true"] { background: #7d2d3c; box-shadow: 0 0 0 3px #7d2d3c55; }
  :host(nc-input-provider) .secondary-menu { min-width: 130px; max-width: min(220px, calc(100vw - 24px)); padding: 5px; box-sizing: border-box; background: #102039 !important; background-color: #102039 !important; }
  :host(nc-input-provider) .secondary-menu-item { height: auto; min-height: 24px; padding: 2px 6px; border-radius: 4px; box-sizing: border-box; background: transparent !important; color: #eaf1ff; font-size: 12px; }
  :host(nc-input-provider) .secondary-menu-item:hover { background: #193354 !important; background-color: #193354 !important; color: #edf3ff; }
  :host(nc-input-provider) .secondary-menu-item img { width: 24px; height: 24px; flex: 0 0 24px; margin-right: 6px; padding: 0; border: 0; border-radius: 0; background: transparent !important; box-shadow: none; object-fit: contain; filter: brightness(0) invert(1); opacity: .9; }
  :host(nc-input-provider) .nc-input-menu-button {
    width: 21px;
    height: 21px;
    filter: brightness(0) invert(1);
    mix-blend-mode: normal;
    opacity: .9;
  }
  :host(nc-input-provider) .nc-input-wrapper {
    border: 1px solid #263a58;
    border-radius: 24px;
    background: #0b192e;
    box-shadow: 0 8px 26px #0002;
  }
  :host(nc-input-provider) .nc-input-inner-wrapper { color: #edf3ff; }
  :host(nc-input-provider) .nc-input-wrapper .textarea,
  :host(nc-input-provider) .nc-input-wrapper textarea { color: #edf3ff; caret-color: #4c8dff; }
  :host(nc-input-provider) .nc-input-wrapper .textarea::placeholder,
  :host(nc-input-provider) .nc-input-wrapper textarea::placeholder { color: #8494ad; }
  :host(nc-input-provider) .nc-input-send-button { border-radius: 12px; background: #1769e8; color: white; }
  :host(nc-input-provider) .nc-input-send-button:hover:not(.disabled) { background: #2c7cf4; }
  .nc-input-emoji-panel { border-color: #263a58; background: #0c1a30; }
  .nc-chatui-connection-status.is-error { background: #3b202b; }
  .nc-chatui-connection-status.is-warning { background: #152947; }
  .nc-chatui-connection-status-text { color: #edf3ff; }
  :host(nc-channel-label) { color: #eaf1ff; font-weight: 550; }
  :host(nc-channel-time) { color: #8ea0ba; }
  :host(nc-latest-message) { color: #94a5be; }
  :host(nc-channel-unread) .unread-box { background: #1769e8; }
  :host(nc-channel-unread) .unread-box.muted { background: #243751; color: #b9c6d9; }
  :host(nc-channel-empty) { background: #071222; color: #91a2bc; }
  :host(nc-message-time) span { border: 1px solid #263a58; background: #0d1b31; color: #b7c5db; }
  :host(nc-message-sent-status) img { width: 16px; height: 16px; object-fit: contain; }
  :host(nc-message-bubble) .nc-message-bubble-root > .name { display: none; }
  :host(nc-hd-voice-message) { display: block; width: 100%; max-width: 100%; min-width: 0; }
  :host(nc-hd-voice-message) .voice { width: 100%; max-width: 100%; min-width: 0; gap: 8px; padding: 10px 12px; box-sizing: border-box; }
  :host(nc-hd-voice-message) .control { width: 18px; height: 18px; flex: 0 0 18px; }
  :host(nc-hd-voice-message) .progress { min-width: 0; flex: 1 1 auto; justify-content: space-between; overflow: hidden; }
  :host(nc-hd-voice-message) .line { width: 2px; flex: 0 0 2px; margin-right: 0; }
  :host(nc-hd-voice-message) .time { flex: 0 0 auto; font-size: 12px; white-space: nowrap; }
  :host(nc-message-bubble) .message-body-wrapper { position: relative; display: flex; flex-direction: column; box-sizing: border-box; padding: 0 0 3px; }
  :host(nc-message-bubble) .nc-message-bubble-align-right .message-body-wrapper { min-width: 94px; }
  :host(nc-message-bubble) .nexconn-message-meta { position: static; display: flex; width: max-content; max-width: calc(100% - 8px); min-height: 12px; align-items: center; align-self: flex-end; gap: 3px; padding: 0 6px 4px 12px; border-radius: 0 0 8px 8px; box-sizing: border-box; color: #c1d0e5; font-size: 9px; line-height: 12px; white-space: nowrap; }
  :host(nc-message-bubble) .nc-message-bubble-align-right .nexconn-message-meta { margin-right: 26px; }
  :host(nc-message-bubble) .time { color: #a7b9d3; font-size: 9px; line-height: 12px; }
  .nc-chatui-msg-bubble-status-row { position: relative; }
  .nc-chatui-msg-sent-status { position: absolute !important; right: 8px; bottom: 10px !important; left: auto !important; z-index: 2; width: 18px; height: 16px; margin: 0; padding: 0 !important; }
  :host(nc-message-bubble) .name { color: #94a5be; }
  :host(nc-message-bubble) .time { color: #a7b9d3; }
  :host(nc-text-message) p { margin: 0; padding: 8px 16px 0; line-height: 20px; white-space: pre-wrap; }
  :host(nc-message-bubble) .hover-menu-icon { display: grid; width: 24px; height: 24px; flex: 0 0 24px; place-items: center; margin: 0 6px; padding: 0; border: 1px solid #2c405b; border-radius: 50%; background: #0c1b31; color: #c5d5eb; box-shadow: 0 4px 14px #0006; visibility: hidden; opacity: 0; transition: opacity 120ms ease, background-color 120ms ease; }
  :host(nc-message-bubble) .hover-menu-icon::after { width: 3px; height: 3px; border-radius: 50%; background: currentColor; box-shadow: -5px 0 currentColor, 5px 0 currentColor; content: ""; }
  :host(nc-message-bubble) .hover-menu-icon img { display: none; }
  :host(nc-message-bubble) .nc-message-bubble-root:hover .hover-menu-icon,
  :host(nc-message-bubble) .hover-menu-icon-active,
  :host(nc-message-bubble) .hover-menu-icon:focus-visible,
  :host(nc-message-bubble) .nc-message-bubble-root:focus-within .hover-menu-icon { visibility: visible; opacity: 1; }
  :host(nc-message-bubble) .hover-menu-icon:hover { border-color: #4773ad; background: #193354; color: #f4f7ff; }
  :host(nc-message-bubble) .hover-menu-icon:focus-visible { outline: 2px solid #64a6ff; outline-offset: 2px; }
  :host(nc-text-message) p { color: inherit; }
  :host(nc-text-message) a { color: #8ab8ff; }
  :host(nc-text-message) a:hover { color: #c0d8ff; }
  :host(nc-scrollbar-thumb-provider) .nc-chatui-scrollbar-thumb { background: #466183; }
  .nc-chatui-modal-provider { background: #020817b8; }
  .nc-chatui-modal-dialog-content { border: 1px solid #263a58; border-radius: 16px; background: #102039; color: #edf3ff; box-shadow: 0 24px 80px #000a; }
  .nc-chatui-modal-dialog-header { color: #f4f7ff; }
  .nc-chatui-modal-dialog-content input,
  .nc-chatui-modal-dialog-content textarea { border-color: #314865; background: #0b192e; color: #edf3ff; }
  .nc-chatui-modal-dialog-content button { color: #eaf1ff; }
  .nc-chatui-modal-dialog-content button:hover { background-color: #1a3355; }
  button:focus-visible, [role="button"]:focus-visible, textarea:focus-visible {
    outline: 2px solid #5b9cff;
    outline-offset: 2px;
  }
  @media (max-width: 768px) {
    .nc-chatui-app-wrapper-left { min-width: 0; width: 100%; }
    .nc-chatui-app-wrapper-left::before { display: none; }
    :host(nc-channel-list-provider) .nc-channel-wrap { padding-top: 24px; }
    .nc-channel-list-item { margin-top: 2px; }
    .nc-channel-detail-bar { height: 64px; }
  }
  @media (max-width: 820px) {
    :host(nc-channel-list-container-provider) .nc-chatui-app-wrapper-left { min-width: 0; width: 100%; }
    .nc-chatui-app-inner,
    .nc-chatui-app-wrapper-right.is-h5 .nc-chatui-app-inner { min-width: 0; width: 100%; }
    :host(nc-channel-detail-bar-provider) .nc-channel-detail-bar { position: relative; min-width: 0; overflow: hidden; }
    :host(nc-channel-detail-bar-provider) .back-button { width: 24px; min-width: 24px; margin: 0 4px; }
    :host(nc-channel-detail-bar-provider) .info { min-width: 0; flex: 1 1 auto; overflow: hidden; padding-right: 76px; }
    :host(nc-channel-detail-bar-provider) .icon { width: 45px; min-width: 45px; height: 45px; margin: 0 8px; }
    :host(nc-channel-detail-bar-provider) .name { min-width: 0; overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
    :host(nc-channel-detail-bar-provider) .typing-content { display: none; }
    :host(nc-channel-detail-bar-provider) .extension { position: absolute; top: 50%; right: 4px; display: flex; min-width: 0; width: 68px; flex: 0 0 68px; align-items: center; justify-content: space-between; gap: 0; margin: 0; padding: 0; transform: translateY(-50%); }
    :host(nc-channel-detail-bar-provider) .extension-button { width: 32px; height: 36px; flex: 0 0 32px; }
    :host(nc-channel-detail-bar-provider) .extension-icon { width: 19px; height: 19px; margin: 0; }
    :host(nc-input-provider) .nc-input-provider { width: calc(100% - 16px); max-width: calc(100% - 16px); margin: 0 8px max(8px, env(safe-area-inset-bottom)); }
  }
  @media (max-width: 360px) {
    :host(nc-channel-detail-bar-provider) .extension { display: none; }
    :host(nc-channel-detail-bar-provider) .back-button { width: 20px; min-width: 20px; margin-inline: 2px; }
    :host(nc-channel-detail-bar-provider) .icon { margin-inline: 4px; }
    :host(nc-channel-detail-bar-provider) .name { font-size: 13px; }
    :host(nc-channel-detail-bar-provider) .info { padding-right: 62px; }
    :host(nc-channel-detail-bar-provider) .extension { right: 2px; width: 60px; flex-basis: 60px; }
    :host(nc-channel-detail-bar-provider) .extension-button { width: 28px; height: 34px; flex-basis: 28px; }
    :host(nc-channel-detail-bar-provider) .extension-icon { width: 17px; height: 17px; }
  }
`;

/** Apply the branded palette inside the SDK's open Web Component roots. */
export function installChatUiTheme(): () => void {
  const observers: MutationObserver[] = [];
  const styledRoots = new WeakSet<ShadowRoot>();
  let channelListRootFound = false;

  const ensureThemeStyle = (root: ShadowRoot) => {
    let style = root.querySelector<HTMLStyleElement>(`style#${THEME_ID}`);
    if (!style) {
      style = document.createElement('style');
      style.id = THEME_ID;
      root.append(style);
    }
    if (style.textContent !== CHAT_UI_STYLES) style.textContent = CHAT_UI_STYLES;
  };

  const watchRoot = (root: ShadowRoot, hostName: string) => {
    if (hostName === 'nc-channel-list-provider') channelListRootFound = true;
    ensureThemeStyle(root);
    if (styledRoots.has(root)) return;
    styledRoots.add(root);

    const observer = new MutationObserver((records) => {
      ensureThemeStyle(root);
      for (const record of records) {
        for (const node of record.addedNodes) scan(node);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    observers.push(observer);
    scan(root);
  };

  const scan = (node: Node) => {
    if (node instanceof Element && node.shadowRoot) watchRoot(node.shadowRoot, node.localName);
    if ('querySelectorAll' in node) {
      for (const element of (node as ParentNode).querySelectorAll('*')) {
        if (element instanceof Element && element.shadowRoot) watchRoot(element.shadowRoot, element.localName);
      }
    }
  };

  const pageObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) scan(node);
    }
  });
  pageObserver.observe(document.body, { childList: true, subtree: true });
  scan(document);
  // SDK custom elements may be upgraded after their hosts are first inserted.
  // A short bounded rescan ensures their shadow roots receive the responsive styles.
  let scanAttempts = 0;
  const scanTimer = window.setInterval(() => {
    scan(document);
    scanAttempts += 1;
    if (channelListRootFound || scanAttempts >= 100) window.clearInterval(scanTimer);
  }, 50);
  void customElements.whenDefined('nc-channel-list-provider').then(() => {
    window.requestAnimationFrame(() => scan(document));
  });

  return () => {
    pageObserver.disconnect();
    window.clearInterval(scanTimer);
    observers.forEach((observer) => observer.disconnect());
  };
}
