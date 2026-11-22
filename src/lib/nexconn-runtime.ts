import { AreaCode, ChannelType, ConnectionStatus, ConnectionStatusHandler, DirectChannel, NCEngine, LogLevel } from '@nexconn/chat';
import { BubbleLayout, ChatUICommand, InputMenumID, NCChatUIApplication } from '@nexconn/chatui';
import { sdk } from './nexconn';
import { diagnostic } from './diagnostics';
import { SdkInitializationGuard } from './nexconn-lifecycle.mjs';
import { isFavoriteChannel } from './favorites';

const STATUS_HANDLER_ID = 'nexconn-status';
interface RuntimeLifecycle { initialization: SdkInitializationGuard }
declare global { interface Window { __nexconnRuntimeLifecycle?: RuntimeLifecycle } }
const lifecycle = window.__nexconnRuntimeLifecycle ??= { initialization: new SdkInitializationGuard() };

/** Create a fresh Chat UI context before its custom elements mount. */
export function prepareNexconn(appKey: string, areaCode: string) {
  const areaCodes: Record<string, AreaCode> = { BJ: AreaCode.BJ, SG: AreaCode.SG, NA: AreaCode.NA, SA: AreaCode.SA, OM: AreaCode.OM };
  const logLevel = LogLevel.ERROR;
  const sdkAreaCode = areaCodes[areaCode] ?? AreaCode.SG;
  const didInitialize = lifecycle.initialization.initializeOnce({ appKey, areaCode }, () => {
    NCEngine.initialize({ appKey, areaCode: sdkAreaCode, logLevel });
  });
  if (didInitialize) diagnostic('NEXCONN_SDK_INITIALIZED', { areaCode });
  // Refresh the stable handler ID so development hot reloads never leave a
  // stale listener or duplicate callbacks behind.
  NCEngine.removeConnectionStatusHandler(STATUS_HANDLER_ID);
  NCEngine.addConnectionStatusHandler(STATUS_HANDLER_ID, new ConnectionStatusHandler({
      onConnectionStatusChanged: ({ status, code }: { status: number; code?: number }) => {
      if (code === 31004 || code === 31020) {
        diagnostic('NEXCONN_DISCONNECTED', { code });
        return sdk.setConnectionFailure(code);
      }
      if (status === ConnectionStatus.CONNECTED) {
        sdk.clearConnectionError();
        // The initial SDK callback may precede connect()'s identity result.
        // Keep the UI pending until that result has been verified.
        return sdk.setStatus(sdk.getUserId() ? 'connected' : 'connecting', code ?? 0);
      }
      if (status === ConnectionStatus.DISCONNECTED) {
        diagnostic('NEXCONN_DISCONNECTED', { code });
        return sdk.setConnectionFailure(code);
      }
      if (status === ConnectionStatus.CONNECTING) return sdk.setStatus('connecting', code);
      // SUSPENDED is the SDK's automatic network-retry state.
      sdk.setStatus('connecting', code);
      },
  }));

  let app = sdk.getApp();
  if (!app) {
    app = NCChatUIApplication.initialize({ hooks: sdk.buildHooks(), language: 'en_US', logLevel, modalContainerId: 'nc-chat-modal-root' });
    if (!app) throw new Error('Could not initialize Nexconn Chat UI.');
    // Chat UI 26.2.0 initializes its connection-status panel without a status.
    // That undefined value is rendered with the error background. The app owns
    // a separately verified SDK status banner, so disable this stale UI copy.
    app.setCommandSwitch(ChatUICommand.SHOW_CONNECTION_STATUS_IN_CHANNEL_LIST, false);
    app.setCommandSwitch(ChatUICommand.SHOW_MESSAGE_STATE, true);
    app.setChannelBarTitle('Chats');
    app.setChannelDetailBackSwitch(true);
    const channelMenu = app.cloneChannelsMenu();
    channelMenu.push(
      { id: 'nexconn.channel.favorite.add', icon: '/icons/heart.svg', filter: (model) => (model.channelType === ChannelType.DIRECT || model.channelType === ChannelType.GROUP) && !isFavoriteChannel(model.channelType === ChannelType.DIRECT ? 'direct' : 'group', model.channelId) },
      { id: 'nexconn.channel.favorite.remove', icon: '/icons/heart-filled.svg', filter: (model) => (model.channelType === ChannelType.DIRECT || model.channelType === ChannelType.GROUP) && isFavoriteChannel(model.channelType === ChannelType.DIRECT ? 'direct' : 'group', model.channelId) },
    );
    app.setChannelsMenu(channelMenu);
    const englishEntries = app.cloneLanguageEntries('en_US');
    if (englishEntries) {
      englishEntries['nexconn.channel.favorite.add'] = 'Add to favorites';
      englishEntries['nexconn.channel.favorite.remove'] = 'Remove from favorites';
      app.registerLanguagePack('en_US', englishEntries);
    }
    app.setChannelPanelExtensions([
      { id: 'nexconn-search-messages', icon: '/icons/search.svg' },
      { id: 'nexconn-conversation-menu', icon: '/icons/more-vertical.svg' },
    ]);
    const inputMenu = app.cloneInputMenu();
    const emoji = inputMenu.items.find((item) => item.id === InputMenumID.EMOJI);
    const images = inputMenu.items.find((item) => item.id === InputMenumID.IMAGES);
    const files = inputMenu.items.find((item) => item.id === InputMenumID.FILES);
    const photo = inputMenu.items.find((item) => item.id === InputMenumID.PHOTO);
    if (emoji && images && files && photo) {
      app.setInputMenu({ items: [
        { ...emoji, order: 0 },
        { id: InputMenumID.PLUS, order: 1, icon: '/icons/attachment.svg', submenu: [images, files, photo].map((item, order) => ({ ...item, order })) },
      ] });
    }
    app.setMessageBubbleConfig({
      layout: BubbleLayout.LEFT_RIGHT,
      redius: 20,
      backgroundColorForMyself: 0x1769e8,
      backgroundColorForOthers: 0x172740,
      textColorForMyself: 0xffffff,
      textColorForOthers: 0xeaf1ff,
    });
    app.setChannelsItemConfig({
      radius: 18,
      portraitSize: 'large',
      activeBackgroundColor: 0x132746,
      hoverBackgroundColor: 0x10213a,
      topBackgroundColor: 0x132746,
    });
    diagnostic('CHATUI_CONNECTION_STATUS_INDICATOR_CONFIGURED', { chatUiConnectionStatusIndicatorEnabled: false });
    app.ready();
    sdk.setApp(app);
    window.dispatchEvent(new CustomEvent('nexconn-app-ready'));
  }
}

/** Connect only after the Chat UI has mounted against the prepared context. */
export async function connectNexconn(token: string, expectedUserId: string) {
  sdk.setConnection(token, expectedUserId);
  await sdk.connect(token, expectedUserId);
}
