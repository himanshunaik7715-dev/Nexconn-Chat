import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { formatNexconnMessageTime, nexconnCalendarDateLabel, nexconnCalendarDayChanged, nexconnMessageStatusIcon } from './nexconn-calendar-date.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packageJson = require(resolve(root, 'node_modules/@nexconn/chatui/package.json'));
if (packageJson.version !== '26.2.0') {
  throw new Error(`Expected @nexconn/chatui 26.2.0, found ${packageJson.version}`);
}

const bundlePath = resolve(root, 'node_modules/@nexconn/chatui/dist/index.esm.js');
let bundle = await readFile(bundlePath, 'utf8');

// Keep the SDK's single-pane navigation in sync with the app's 820px mobile
// breakpoint. Without this, tablet widths show mobile controls over a split
// desktop conversation view.
const sdkDesktopBreakpoint = 'window.innerWidth <= 768';
const appMobileBreakpoint = 'window.innerWidth <= 820';
if (!bundle.includes(appMobileBreakpoint)) {
  if (bundle.split(sdkDesktopBreakpoint).length !== 2) {
    throw new Error('Expected one Nexconn Chat UI 26.2.0 viewport breakpoint.');
  }
  bundle = bundle.replace(sdkDesktopBreakpoint, appMobileBreakpoint);
}

// SDK composer and attachment SVGs include a filled square canvas. Remove it
// from the emoji, Image, File, and Photo icons so their strokes can be themed
// without rendering a tile behind each icon.
const attachmentIconBackground = '<rect width="30" height="30" rx="8" fill="#F3F5FA"/>';
for (const iconName of ['Wi', 'qi', 'Qi', 'Xi']) {
  const iconStart = bundle.indexOf(`${iconName} = \``);
  const iconEnd = bundle.indexOf('</svg>', iconStart);
  if (iconStart < 0 || iconEnd < 0) {
    throw new Error(`Could not locate the ${iconName} attachment icon in Nexconn Chat UI 26.2.0.`);
  }
  const backgroundStart = bundle.indexOf(attachmentIconBackground, iconStart);
  if (backgroundStart >= 0 && backgroundStart < iconEnd) {
    bundle = bundle.slice(0, backgroundStart) + bundle.slice(backgroundStart + attachmentIconBackground.length);
  }
  if (iconName === 'Wi') {
    const fullEmojiViewBox = 'viewBox="0 0 30 30"';
    const croppedEmojiViewBox = 'viewBox="4 4 22 22"';
    const previousEmojiViewBoxes = ['viewBox="0 0 30 30"', 'viewBox="6 6 18 18"', 'viewBox="5 5 20 20"'];
    const viewBoxStart = previousEmojiViewBoxes
      .map((viewBox) => ({ viewBox, start: bundle.indexOf(viewBox, iconStart) }))
      .find(({ start }) => start >= 0 && start < iconEnd);
    if (viewBoxStart) {
      bundle = bundle.slice(0, viewBoxStart.start) + croppedEmojiViewBox + bundle.slice(viewBoxStart.start + viewBoxStart.viewBox.length);
    } else if (bundle.indexOf(croppedEmojiViewBox, iconStart) < 0 || bundle.indexOf(croppedEmojiViewBox, iconStart) > iconEnd) {
      throw new Error('Could not locate the emoji icon viewBox in Nexconn Chat UI 26.2.0.');
    }
  }
}

const marker = '/* Nexconn calendar-date and timestamp patch v2 */';
const helper = `${marker}\n${nexconnCalendarDateLabel.toString()}\n${nexconnCalendarDayChanged.toString()}\n${formatNexconnMessageTime.toString()}\n${nexconnMessageStatusIcon.toString()}\n`;
const oldMarker = '/* Nexconn calendar-day separator fix */';
if (bundle.includes(marker)) {
  bundle = bundle.replace(/\/\* Nexconn calendar-date and timestamp patch v2 \*\/[\s\S]*?(?=class ye \{)/, helper);
} else if (bundle.includes(oldMarker)) {
  bundle = bundle.replace(/\/\* Nexconn calendar-day separator fix \*\/[\s\S]*?(?=class ye \{)/, helper);
} else if (!bundle.includes(marker)) {
  const insertionPoint = 'class ye {';
  if (bundle.split(insertionPoint).length !== 2) {
    throw new Error('Unexpected Nexconn Chat UI bundle layout; patch was not applied.');
  }
  bundle = bundle.replace(insertionPoint, `${helper}${insertionPoint}`);
}

function replaceOnce(from, to, label) {
  if (to ? bundle.includes(to) : !bundle.includes(from)) return;
  if (bundle.split(from).length !== 2) {
    throw new Error(`Expected exactly one ${label} implementation in Nexconn Chat UI 26.2.0.`);
  }
  bundle = bundle.replace(from, to);
}

// Give the SDK's generated controls stable form names/IDs as well. This keeps
// browser autofill and form-field audits useful for the composer and forward UI.
replaceOnce(
  `<input class="search-input" .value=\u0024{this.search} type="text"`,
  `<input class="search-input" id="forward-channel-search" name="forwardChannelSearch" .value=\u0024{this.search} type="text"`,
  'forward-channel search field identifier',
);
replaceOnce(
  `<input type="checkbox"\n                        .checked=\u0024{this.isChannelChecked(t)}`,
  `<input type="checkbox" name="forwardChannel"\n                        .checked=\u0024{this.isChannelChecked(t)}`,
  'forward-channel checkbox name',
);
replaceOnce(
  `<textarea class="textarea"`,
  `<textarea class="textarea" id="chat-message-composer" name="message"`,
  'message composer field identifier',
);

const timestampMarkup = '<span class="time">' + String.fromCharCode(36) + '{e}</span>';
const timestampFooter = '<div class="nexconn-message-meta">' + timestampMarkup + '</div>';
if (!bundle.includes(timestampFooter)) {
  const bubbleClassStart = bundle.indexOf('class fe extends T');
  const timestampIndex = bundle.indexOf(timestampMarkup, bubbleClassStart);
  const bubbleStylesIndex = bundle.indexOf('l(fe, "styles"', bubbleClassStart);
  if (bubbleClassStart < 0 || timestampIndex < 0 || timestampIndex > bubbleStylesIndex) throw new Error('Message bubble timestamp insertion point not found.');
  bundle = bundle.slice(0, timestampIndex) + bundle.slice(timestampIndex + timestampMarkup.length);
  const bodyStart = bundle.indexOf('<div class="message-body-wrapper" style=', bubbleClassStart);
  const slotMarkup = '<slot></slot>';
  const slotIndex = bundle.indexOf(slotMarkup, bodyStart);
  if (bodyStart < 0 || slotIndex < 0) throw new Error('Message bubble timestamp insertion point not found.');
  const footerMarkup = slotMarkup + '\n            ' + timestampFooter;
  bundle = bundle.slice(0, slotIndex) + footerMarkup + bundle.slice(slotIndex + slotMarkup.length);
}

const engineFileTypeImport = 'import { FileType as NexconnFileType } from "@nexconn/engine";';
if (!bundle.includes(engineFileTypeImport)) {
  const chatImport = 'import { SendMessageParams as Te';
  if (!bundle.includes(chatImport)) throw new Error('Unexpected SDK import layout for FileType fix.');
  bundle = bundle.replace(chatImport, engineFileTypeImport + '\n' + chatImport);
}
const chatUploaderImport = 'import { FileUploader as NexconnFileUploader, SendMessageParams as Te';
const chatApiImport = 'import { SendMessageParams as Te';
if (!bundle.includes('FileUploader as NexconnFileUploader')) {
  if (!bundle.includes(chatApiImport)) throw new Error('Unexpected Nexconn Chat API import layout for FileUploader fix.');
  bundle = bundle.replace(chatApiImport, chatUploaderImport);
}
replaceOnce('le.FileUploader.create(h)', 'NexconnFileUploader.create(h)', 'Nexconn Chat UI file upload');
for (const [sdkFileType, engineFileType] of [
  ['le.FileType.IMAGE', 'NexconnFileType.IMAGE'],
  ['le.FileType.SHORT_VIDEO', 'NexconnFileType.SIGHT'],
  ['le.FileType.FILE', 'NexconnFileType.FILE'],
]) {
  if (bundle.includes(sdkFileType) && !bundle.includes(engineFileType)) replaceOnce(sdkFileType, engineFileType, 'Nexconn SDK file upload type');
}
replaceOnce(
  'contentDisposition: "attachment"',
  'contentDisposition: a.type === "application/pdf" || a.name.toLowerCase().endsWith(".pdf") ? "inline" : "attachment"',
  'PDF inline preview disposition',
);
// The 26.2.0 bundle contains temporary console output, including a raw
// received-message object. Keep SDK events and progress state intact while
// removing those production-console leaks/noise.
for (const [from, to, label] of [
  ['console.log(">>>> pickFile >>>> pickFile >>>>");', '', 'file picker console output'],
  ['console.log(">>>> pickFile >>>> onchange >>>>"), ', '', 'file selection console output'],
  ['console.log(">>>> pickFile >>>> cancel >>>>"), ', '', 'file picker cancellation console output'],
  ['console.log(">>>> pickFileOnSafari >>>> pickFileOnSafari >>>>");', '', 'Safari file picker console output'],
  ['console.log(">>>> pickFileOnSafari >>>> finalizeSuccess >>>>"), ', '', 'Safari file selection console output'],
  ['console.log(">>>> pickFileOnSafari >>>> finalizeCancel >>>>"), ', '', 'Safari file picker cancellation console output'],
  ['console.log("message====", r), ', '', 'raw message console output'],
  ['console.log(`>>>> _handle >>>> onProgress >>>> ${y} update progress`, Y), ', '', 'upload progress console output'],
  ['console.warn(`>>>> _sendMultiMediaMessage >>>> message not found in cached: ${M.transactionId}`);', '', 'upload transaction console output'],
  ['console.log(" >>> handle message -> messageId:", e.messageId, "channel:", [e.channelIdentifier.channelId, e.channelIdentifier.channelType].join("_"), "isCounted:", e.isCounted);\n    ', '', 'message metadata console output'],
  [', console.log(" >>> handle message result -> messageId:", e.messageId, "unreadCount:", u.unreadCount)', '', 'message state console output'],
  ['}), console.log(" >>> recalculate position ->", t.map((n) => ({\n      order: n.order,\n      channelId: n.model.channelIdentifier.channelId,\n      channelType: n.model.channelIdentifier.channelType\n    }))), this.ctx.dispatchEvent', '}), this.ctx.dispatchEvent', 'channel ordering console output'],
  ['h.length && (console.log(" >>> dispatch channels item change ->", h.map((d) => ({\n        channelId: d.channelIdentifier.channelId,\n        channelType: d.channelIdentifier.channelType\n      }))), this.ctx.dispatchEvent', 'h.length && (this.ctx.dispatchEvent', 'channel identifiers console output'],
  ['s = this._handleNotifiedUIMessaages(s), s.length && (console.log("received new messages ->", s.map((n) => ({\n      messageId: n.messageId,\n      channelId: n.channelIdentifier.channelId,\n      channelType: n.channelIdentifier.channelType\n    }))), this.ctx.dispatchEvent(new v(_.RECV_NEW_MESSAGES, s)))', 's = this._handleNotifiedUIMessaages(s), s.length && this.ctx.dispatchEvent(new v(_.RECV_NEW_MESSAGES, s))', 'received message identifiers console output'],
]) replaceOnce(from, to, label);
const statusRenderFrom = 'render() {\n    if (!this.message || !this.isSupportReadReceiptVersion)\n      return p\u0060\u0060;\n    const e = this.size / 2, t = Math.min(1, Math.max(0, this.readPercentage))';
const statusRenderTo = 'render() {\n    if (!this.message)\n      return p\u0060\u0060;\n    const e = this.size / 2, t = Math.min(1, Math.max(0, this.readPercentage))';
if (!bundle.includes(statusRenderTo)) {
  if (bundle.split(statusRenderFrom).length !== 2) throw new Error("Expected one read-status renderer in SDK bundle.");
  bundle = bundle.replace(statusRenderFrom, statusRenderTo);
}

replaceOnce(
  `handleTimeFilter(e) {\n    const { year: t, month: s, day: n, weekDay: a } = tt(e), o = (Date.now() - e) / 1e3 / 60 / 60 / 24;\n    let c = this.i18n.t("time.format.full", t, s, n);\n    return (/* @__PURE__ */ new Date()).toDateString() === new Date(e).toDateString() ? c = this.i18n.t("time.format.today") : (/* @__PURE__ */ new Date()).toDateString() !== new Date(e).toDateString() && o < 1 || 1 <= o && o < 2 ? c = this.i18n.t("time.format.yesterday") : 2 <= o && o < 7 && (c = this.i18n.t(this.weeklist[a])), c;\n  }`,
  `handleTimeFilter(e) {\n    const { year: t, month: s, day: n } = tt(e);\n    return nexconnCalendarDateLabel(e, new Date(), this.i18n.t("time.format.today"), this.i18n.t("time.format.yesterday"), this.i18n.t("time.format.full", t, s, n));\n  }`,
  'combined-message date filter',
);
replaceOnce(
  `handleTimeFilter(e) {\n    const { year: t, month: s, day: n, weekDay: a } = tt(e), o = (Date.now() - e) / 1e3 / 60 / 60 / 24;\n    let c = this.$tt("time.format.full", t, s, n);\n    return (/* @__PURE__ */ new Date()).toDateString() === new Date(e).toDateString() ? c = this.$tt("time.format.today") : (/* @__PURE__ */ new Date()).toDateString() !== new Date(e).toDateString() && o < 1 || 1 <= o && o < 2 ? c = this.$tt("time.format.yesterday") : 2 <= o && o < 7 && (c = this.$tt(this.weeklist[a])), c;\n  }`,
  `handleTimeFilter(e) {\n    const { year: t, month: s, day: n } = tt(e);\n    return nexconnCalendarDateLabel(e, new Date(), this.$tt("time.format.today"), this.$tt("time.format.yesterday"), this.$tt("time.format.full", t, s, n));\n  }`,
  'message-list date filter',
);

const dayBoundaryCheck = 'new Date(n.sentTime).toDateString() !== new Date(a.sentTime).toDateString()';
const patchedDayBoundaryCheck = 'nexconnCalendarDayChanged(n.sentTime, a.sentTime)';
if (!bundle.includes(patchedDayBoundaryCheck)) {
  const matches = bundle.split(dayBoundaryCheck).length - 1;
  if (matches !== 2) throw new Error(`Expected two SDK message calendar grouping checks, found ${matches}.`);
  bundle = bundle.replaceAll(dayBoundaryCheck, patchedDayBoundaryCheck);
}

replaceOnce(
  `timeController(e) {\n    const { year: t, month: s, day: n, hour: a, minute: o, weekDay: c } = tt(e), h = /* @__PURE__ */ new Date(), d = new Date(e);\n    if (h.toDateString() === d.toDateString())\n      return \`${'${a}:${o}'}\`;\n    const w = new Date(h);\n    if (w.setDate(w.getDate() - 1), w.toDateString() === d.toDateString())\n      return \`${'${this.i18n.t("time.format.yesterday")} ${a}:${o}'}\`;\n    if (h.getFullYear() === d.getFullYear()) {\n      const R = new Date(h);\n      return R.setDate(R.getDate() - 7), d > R ? \`${'${this.i18n.t(rl[c])} ${a}:${o}'}\` : \`${'${s}/${n} ${a}:${o}'}\`;\n    }\n    return \`${'${t}/${s}/${n}'}\`;\n  }`,
  `timeController(e) {\n    return formatNexconnMessageTime(e);\n  }`,
  'message bubble timestamp formatter',
);
replaceOnce(
  `timeController(e) {\n    const { hour: t, minute: s } = tt(e);\n    return \`${'${t}:${s}'}\`;\n  }`,
  `timeController(e) {\n    return formatNexconnMessageTime(e);\n  }`,
  'combined-message timestamp formatter',
);

replaceOnce(
  `<img class="extension-icon" .src=\u0024{n.icon} .key=\u0024{n.id} alt="Extension Icon" @click=\u0024{() => this.handleExtension(n)}>` ,
  `<button class="extension-button" type="button" aria-label=\u0024{n.id === "nexconn-search-messages" ? "Search messages" : "Conversation menu"} @click=\u0024{() => this.handleExtension(n)}><img class="extension-icon" .src=\u0024{n.icon} alt=""></button>`,
  'accessible SDK channel header extension controls',
);

replaceOnce(
  `<button\n              class="nc-input-send-button \u0024{this.hasContent ? "" : "disabled"}"\n              ?disabled=\u0024{!this.hasContent}\n              @click=\u0024{() => this.handleSendClick()}>\n              <img .src=\u0024{this.hasContent ? go : po} alt="send" />\n              \u0024{this.isH5 ? k : p\`<span>\u0024{t}</span>\`}\n            </button>`,
  `\u0024{this.hasContent ? p\`<button class="nc-input-send-button" @click=\u0024{() => this.handleSendClick()}><img .src=\u0024{go} alt="send" /></button>\` : p\`<button class="nexconn-voice-button" type="button" aria-label="Record a voice message" aria-pressed="false" @click=\u0024{() => this.dispatchEvent(new CustomEvent("nexconn-voice-toggle", { bubbles: true, composed: true, detail: { channelIdentifier: this.model.channelIdentifier } }))}><img src="/icons/microphone.svg" alt="" /></button>\`}`,
  'SDK composer send/microphone controls',
);

replaceOnce(
  `\u0024{this.isH5 ? "" : p\`\n            <div class="hover-menu-icon`,
  `\u0024{p\`\n            <button type="button" aria-label="Message actions" class="hover-menu-icon`,
  'mobile message actions control',
);
replaceOnce(
  `<img width="16" height="16" src=\u0024{s || this.isHovering ? rn : an} alt="HOVER_MENU_ICON">\n            </div>\n          \`}`,
  `<img width="16" height="16" src=\u0024{s || this.isHovering ? rn : an} alt="">\n            </button>\n          \`}`,
  'accessible message action button',
);

const statusMapping = `case O.SENT:\n        return nexconnMessageStatusIcon(O.SENT) || (this.type ? pi : Ro);\n      case O.READ:\n        return nexconnMessageStatusIcon(O.READ) || Mo;`;
const previousStatusMapping = `case O.SENT:\n        return "/icons/message-sent.svg";\n      case O.READ:\n        return "/icons/message-read.svg";`;
const originalStatusMapping = `case O.SENT:\n        return this.type ? pi : Ro;\n      case O.READ:\n        return Mo;`;
if (!bundle.includes(statusMapping)) {
  if (bundle.includes(previousStatusMapping)) bundle = bundle.replace(previousStatusMapping, statusMapping);
  else replaceOnce(originalStatusMapping, statusMapping, 'SDK sent/read status icon mapping');
}

await writeFile(bundlePath, bundle);
console.log('Applied the Nexconn Chat UI 26.2.0 mobile, date, timestamp, and read-status patches.');
