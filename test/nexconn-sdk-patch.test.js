import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bundle = await readFile(new URL('../node_modules/@nexconn/chatui/dist/index.esm.js', import.meta.url), 'utf8');
const chatTypes = await readFile(new URL('../node_modules/@nexconn/chat/index.d.ts', import.meta.url), 'utf8');
const theme = await readFile(new URL('../src/lib/chatui-theme.ts', import.meta.url), 'utf8');
const chatPage = await readFile(new URL('../src/pages/ChatPage.tsx', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../src/lib/nexconn-runtime.ts', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const serverApp = await readFile(new URL('../server/app.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const loginPage = await readFile(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8');
const sdkWrapper = await readFile(new URL('../src/lib/nexconn.ts', import.meta.url), 'utf8');

test('Nexconn Chat UI 26.2.0 uploads use the exported engine FileType enum', () => {
  assert.ok(bundle.includes('import { FileType as NexconnFileType } from "@nexconn/engine";'));
  assert.ok(bundle.includes('FileUploader as NexconnFileUploader'));
  assert.ok(bundle.includes('NexconnFileUploader.create(h)'));
  assert.equal(bundle.includes('le.FileUploader.create(h)'), false);
  assert.ok(bundle.includes('return NexconnFileType.IMAGE;'));
  assert.ok(bundle.includes('return NexconnFileType.SIGHT;'));
  assert.ok(bundle.includes('return NexconnFileType.FILE;'));
  assert.equal(bundle.includes('le.FileType.IMAGE'), false);
});

test('installed SDK bundle does not emit raw message objects or debug console noise', async () => {
  for (const debugText of [
    'message====',
    'received new messages ->',
    'recalculate position ->',
    'dispatch channels item change ->',
    '>>>> pickFile >>>>',
    '>>>> pickFileOnSafari >>>>',
    'message not found in cached:',
  ]) assert.equal(bundle.includes(debugText), false, `Unexpected SDK console output: ${debugText}`);
  assert.match(await readFile(new URL('../scripts/patch-nexconn-chatui.js', import.meta.url), 'utf8'), /to \? bundle\.includes\(to\) : !bundle\.includes\(from\)/);
});

test('SDK generated composer and forwarding fields have stable form identifiers', () => {
  assert.match(bundle, /<textarea class="textarea" id="chat-message-composer" name="message"/);
  assert.match(bundle, /<input class="search-input" id="forward-channel-search" name="forwardChannelSearch"/);
  assert.match(bundle, /<input type="checkbox" name="forwardChannel"/);
  assert.match(chatPage, /id="conversation-list-search" name="conversationSearch"/);
  assert.match(chatPage, /id="message-search" name="messageSearch"/);
  assert.match(chatPage, /id="profile-display-name" name="displayName"/);
  assert.match(loginPage, /id="login-identifier" name="identifier"/);
});

test('production CSP keeps scripts self-hosted and the app entry script external', () => {
  assert.match(serverApp, /scriptSrc:\s*\["'self'"\]/);
  assert.doesNotMatch(serverApp, /scriptSrc:\s*\[[^\]]*unsafe-inline/);
  assert.match(indexHtml, /<script type="module" src="\/src\/main\.tsx"><\/script>/);
  assert.doesNotMatch(indexHtml, /<script(?:\s[^>]*)?>\s*[^<]/);
});

test('composer and attachment menu SVGs do not contain their SDK background tiles', () => {
  const backgroundTile = '<rect width="30" height="30" rx="8" fill="#F3F5FA"/>';
  for (const iconName of ['Wi', 'qi', 'Qi', 'Xi']) {
    const iconStart = bundle.indexOf(`${iconName} = \``);
    const iconEnd = bundle.indexOf('</svg>', iconStart);
    assert.ok(iconStart >= 0 && iconEnd > iconStart, `Expected ${iconName} attachment icon in patched bundle`);
    assert.equal(bundle.slice(iconStart, iconEnd).includes(backgroundTile), false);
  }
  const emojiStart = bundle.indexOf('Wi = `');
  const emojiEnd = bundle.indexOf('</svg>', emojiStart);
  assert.match(bundle.slice(emojiStart, emojiEnd), /viewBox="4 4 22 22"/);
});

test('recorded voice messages upload through the Nexconn media API before entering UI history', () => {
  assert.match(chatPage, /new DirectChannel\(channelIdentifier\.channelId\)\.sendMediaMessage\(params\.data\)/);
  assert.match(chatPage, /await app\.insertMessage\(result\.data\)/);
  assert.doesNotMatch(chatPage, /app\?\.sendMessage\(channelIdentifier, params\.data\)/);
});

test('direct message footer contains time and status icons follow genuine SDK states', () => {
  const timeMarkup = '<span class="time">' + String.fromCharCode(36) + '{e}</span>';
  assert.equal(bundle.split(timeMarkup).length - 1, 2);
  assert.ok(bundle.includes('<div class="nexconn-message-meta">' + timeMarkup + '</div>'));
  assert.equal(bundle.includes('if (!this.message || !this.isSupportReadReceiptVersion)'), false);
  assert.ok(bundle.includes('nexconnMessageStatusIcon(O.SENT)'));
  assert.ok(bundle.includes('nexconnMessageStatusIcon(O.READ)'));
});

test('mobile composer reserves usable width for typing and keeps SDK send controls reachable', () => {
  assert.match(theme, /\.nc-input-top-buttons \{ width: max-content !important; min-width: max-content; flex: 0 0 max-content !important;/);
  assert.match(theme, /:host\(nc-input-provider\) \.nc-input-provider \{\s*width: calc\(100% - 28px\);\s*max-width: calc\(100% - 28px\);/);
  assert.match(theme, /:host\(nc-input-provider\) \.nc-input-provider \{ width: calc\(100% - 16px\); max-width: calc\(100% - 16px\); margin: 0 8px max\(8px, env\(safe-area-inset-bottom\)\); \}/);
  assert.match(theme, /\.nc-input-wrapper \{ width: 0 !important; max-width: none; min-width: 0 !important; flex: 1 1 0% !important;/);
  assert.match(theme, /\.input-text-container \{ width: 100%; min-width: 0;/);
  assert.match(theme, /:host\(nc-input-provider\) \.nc-input-wrapper \{\s*border: 1px solid #263a58;\s*border-radius: 24px;/);
  assert.match(theme, /:host\(nc-input-provider\) \.secondary-menu \{ min-width: 130px; max-width: min\(220px, calc\(100vw - 24px\)\); padding: 5px; box-sizing: border-box; background: #102039 !important; background-color: #102039 !important; \}/);
  assert.match(theme, /:host\(nc-input-provider\) \.secondary-menu-item \{ height: auto; min-height: 24px; padding: 2px 6px; border-radius: 4px; box-sizing: border-box; background: transparent !important; color: #eaf1ff; font-size: 12px; \}/);
  assert.match(theme, /:host\(nc-input-provider\) \.secondary-menu-item:hover \{ background: #193354 !important; background-color: #193354 !important; color: #edf3ff; \}/);
  assert.match(theme, /:host\(nc-input-provider\) \.secondary-menu-item img \{ width: 24px; height: 24px; flex: 0 0 24px; margin-right: 6px; padding: 0; border: 0; border-radius: 0; background: transparent !important; box-shadow: none; object-fit: contain; filter: brightness\(0\) invert\(1\); opacity: \.9; \}/);
  assert.match(theme, /:host\(nc-input-provider\) \.nc-input-menu-button \{\s*width: 21px;\s*height: 21px;\s*filter: brightness\(0\) invert\(1\);\s*mix-blend-mode: normal;\s*opacity: \.9;\s*\}/);
});

test('sent status ticks sit inside the bubble footer beside the timestamp', () => {
  assert.match(theme, /\.nc-chatui-msg-sent-status \{[^}]*bottom: 10px !important;/);
  assert.match(theme, /\.nexconn-message-meta \{[^}]*white-space: nowrap;/);
  assert.match(theme, /:host\(nc-message-bubble\) \.message-body-wrapper \{ position: relative; display: flex; flex-direction: column; box-sizing: border-box; padding: 0 0 3px; \}/);
  assert.match(theme, /:host\(nc-message-bubble\) \.nexconn-message-meta \{ position: static;/);
  assert.match(theme, /:host\(nc-text-message\) p \{ margin: 0; padding: 8px 16px 0; line-height: 20px;/);
  assert.match(theme, /:host\(nc-message-bubble\) \.nexconn-message-meta \{[^}]*padding: 0 6px 4px 12px;[^}]*font-size: 9px; line-height: 12px;/);
  assert.match(theme, /:host\(nc-message-bubble\) \.time \{ color: #a7b9d3; font-size: 9px; line-height: 12px; \}/);
  assert.match(theme, /:host\(nc-text-message\) p \{ margin: 0; padding: 8px 16px 0;/);
});

test('message actions render as a visible horizontal three-dot control', () => {
  assert.match(theme, /:host\(nc-message-bubble\) \.hover-menu-icon::after \{[^}]*box-shadow: -5px 0 currentColor, 5px 0 currentColor;/);
  assert.match(theme, /:host\(nc-message-bubble\) \.hover-menu-icon img \{ display: none; \}/);
});

test('chat message bubbles hide per-message avatars while retaining a side gutter', () => {
  assert.match(theme, /\.nc-chatui-msg-avatar \{ display: none !important; \}/);
  assert.match(theme, /\.nc-chatui-msg-list-item \{ box-sizing: border-box; padding-inline: 10px; \}/);
});

test('message action menu and selection controls use readable Nexconn contrast', () => {
  assert.match(theme, /\.nc-message-list-menu \{[^}]*background: #102039 !important;/);
  assert.match(theme, /:host\(nc-message-list-menu-item\) \.content \{ color: #eaf1ff; \}/);
  assert.match(theme, /\.nc-chatui-msg-list-box \.checkbox \.custom \{ border-color: #7897c0 !important; background-color: #102039 !important; \}/);
});

test('right-clicked channel rows keep dark Nexconn contrast', () => {
  assert.match(theme, /:host\(nc-channel-list-item\) \.nc-channel-list-item\.active-right-clicked \{ box-sizing: border-box; max-width: 100%; min-width: 0; overflow: visible; border-color: #2f67b2; background: transparent !important; color: #edf3ff !important; box-shadow: 0 0 16px #1769e833, inset 0 0 0 1px #2f67b2; \}/);
});

test('conversation header actions sit closer to the right edge', () => {
  assert.match(theme, /:host\(nc-channel-detail-bar-provider\) \.extension \{ display: flex; align-items: center; gap: 14px; padding: 0 0 0 10px; \}/);
  assert.match(theme, /:host\(nc-channel-detail-bar-provider\) \.icon \{ width: 45px; height: 45px; margin: 0 10px 0 20px; border-radius: 50%; object-fit: cover; \}/);
});

test('mobile conversation back icon matches the other light header icons', () => {
  assert.match(theme, /:host\(nc-channel-detail-bar-provider\) \.back-button \{ color: #d8e5f8; \}/);
  assert.match(theme, /:host\(nc-channel-detail-bar-provider\) \.back-button:hover \{ color: #f4f7ff; \}/);
});

test('mobile conversation layout removes the SDK minimum width and fits header actions', () => {
  assert.ok(bundle.includes('window.innerWidth <= 820'), 'The SDK switches to its single-pane layout with the app at 820px.');
  assert.match(theme, /\.nc-chatui-app-wrapper-right\.is-h5 \.nc-chatui-app-inner \{ min-width: 0; width: 100%; \}/);
  assert.match(theme, /:host\(nc-channel-detail-bar-provider\) \.info \{ min-width: 0; flex: 1 1 auto; overflow: hidden; padding-right: 76px; \}/);
  assert.match(theme, /:host\(nc-channel-detail-bar-provider\) \.extension \{ position: absolute; top: 50%; right: 4px;/);
  assert.match(theme, /:host\(nc-channel-detail-bar-provider\) \.info \{ padding-right: 62px; \}/);
  assert.match(theme, /:host\(nc-channel-detail-bar-provider\) \.extension-button \{ width: 32px; height: 36px; flex: 0 0 32px; \}/);
  assert.match(theme, /@media \(max-width: 360px\)/);
  assert.match(chatPage, /mobile-conversation-actions/);
  assert.match(chatPage, /aria-label="Conversation menu"/);
});

test('mobile voice messages constrain the SDK waveform inside the message bubble', () => {
  assert.match(theme, /:host\(nc-hd-voice-message\) \.voice \{ width: 100%; max-width: 100%; min-width: 0; gap: 8px; padding: 10px 12px;/);
  assert.match(theme, /:host\(nc-hd-voice-message\) \.progress \{ min-width: 0; flex: 1 1 auto; justify-content: space-between; overflow: hidden; \}/);
  assert.match(theme, /:host\(nc-hd-voice-message\) \.line \{ width: 2px; flex: 0 0 2px; margin-right: 0; \}/);
});

test('logout reuses the page-lifetime Chat UI app and login connects before rendering conversations', () => {
  assert.match(appSource, /prepareNexconn\(payload\.nexconn\.appKey, payload\.nexconn\.areaCode\)[\s\S]*?await runtime\.connectNexconn\(payload\.nexconn\.token[\s\S]*?setAccount\(payload\.user\)/);
  assert.doesNotMatch(appSource, /nexconn-chatui-mounted|chatPageMounted/);
  assert.doesNotMatch(sdkWrapper, /this\.app\?\.destroy\(\)|this\.app = null/);
  assert.match(runtime, /export function prepareNexconn\(/);
  assert.match(runtime, /export async function connectNexconn\(token: string, expectedUserId: string\)/);
  assert.match(chatPage, /app\.addEventListener\('CHANNELS_LIST_RESET', onChannelListReset\)/);
  assert.match(chatPage, /diagnostic\('CHANNEL_LIST_RESET_RECEIVED', \{[\s\S]*?status: sdk\.getStatus\(\)/);
  assert.match(chatPage, /requestAnimationFrame\(\(\) => applySdkChannelFilters/);
  assert.match(bundle, /getMoreChannelList\(e\)/);
  assert.match(chatPage, /scrollProvider\.dispatchEvent\(new Event\('loading', \{ bubbles: true, composed: true \}\)\)/);
  assert.match(chatPage, /stopChannelPaging\(\)/);
});

test('direct and group conversations use persisted favorites with heart menu icons', async () => {
  assert.match(runtime, /const channelMenu = app\.cloneChannelsMenu\(\);/);
  assert.doesNotMatch(runtime, /cloneChannelsMenu\(\)\.filter/);
  assert.match(runtime, /id: 'nexconn\.channel\.favorite\.add', icon: '\/icons\/heart\.svg'/);
  assert.match(runtime, /id: 'nexconn\.channel\.favorite\.remove', icon: '\/icons\/heart-filled\.svg'/);
  assert.match(runtime, /model\.channelType === ChannelType\.GROUP/);
  assert.match(runtime, /isFavoriteChannel\(/);
  assert.match(chatPage, /id !== 'nexconn\.channel\.favorite\.add' && id !== 'nexconn\.channel\.favorite\.remove'/);
  assert.match(chatPage, /fetch\('\/api\/favorites'/);
  assert.match(chatPage, /method: adding \? 'POST' : 'DELETE'/);
  assert.match(chatPage, /updateFavoriteChannel\(channelType, channelId, adding\)/);
  assert.match(chatPage, /channelModel\.channelType === ChannelType\.DIRECT \? 'direct' : 'group'/);
  assert.match(chatPage, /seenChannels\.has\(channelKey\)/);
  assert.match(chatPage, /ChatUIEvents\.CHANNELS_MENU_ITEM_CLICK, onChannelMenuAction/);
  assert.match(await readFile(new URL('../public/icons/heart.svg', import.meta.url), 'utf8'), /fill="none" stroke="#41464F"/);
  assert.match(await readFile(new URL('../public/icons/heart-filled.svg', import.meta.url), 'utf8'), /fill="none" stroke="#41464F"/);
  assert.match(await readFile(new URL('../public/icons/heart.svg', import.meta.url), 'utf8'), /width="18" height="18"/);
  assert.match(theme, /:host\(nc-channel-list-menu-item\) img \{ width: 18px; height: 18px; flex: 0 0 18px; object-fit: contain; \}/);
  assert.match(theme, /:host\(nc-channel-list-menu-item\) \.content \{ color: #a7bad4; \}/);
  assert.match(theme, /:host\(nc-channel-list-menu-item:hover\) \{ background-color: #193354 !important; \}/);
  assert.match(theme, /:host\(nc-channel-list-menu-item:hover\) img \{ filter: brightness\(0\) invert\(1\); \}/);
});

test('attachment downloads use the SDK media opener and PDFs upload with inline disposition', async () => {
  assert.match(chatTypes, /downloadMedia\(\): Promise<RCResult>/);
  assert.match(bundle, /contentDisposition: a\.type === "application\/pdf" \|\| a\.name\.toLowerCase\(\)\.endsWith\("\.pdf"\) \? "inline" : "attachment"/);
  assert.match(chatPage, /app\.addEventListener\('DOWNLOAD_LINK_EVENT', onDownloadLink\)/);
  assert.match(chatPage, /message\.downloadMedia\(\)/);
  assert.match(chatPage, /app\.addEventListener\('FILE_SEND_FAILED_EVENT', onFileSendFailed\)/);
  assert.match(chatPage, /SentStatus\.FAILED/);
  assert.match(await readFile(new URL('../scripts/patch-nexconn-chatui.js', import.meta.url), 'utf8'), /PDF inline preview disposition/);
});
