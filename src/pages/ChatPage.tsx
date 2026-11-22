import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Info, LogOut, MessageSquarePlus, MoreVertical, Plus, Search, Settings, X } from 'lucide-react';
import { ChatUIEvents, type ChatUIChannelModel } from '@nexconn/chatui';
import { ChannelType, DirectChannel, Helper, MessageType, SentStatus, type ChannelIdentifier } from '@nexconn/chat';
import { sdk } from '@/lib/nexconn';
import { diagnostic } from '@/lib/diagnostics';
import { readApiResponse } from '@/lib/api-response';
import { shouldShowConnectionWarning } from '@/lib/nexconn-lifecycle.mjs';
import { installChatUiTheme } from '@/lib/chatui-theme';
import { isFavoriteChannel, replaceFavoriteChannels, updateFavoriteChannel, type FavoriteChannel, type FavoriteChannelType } from '@/lib/favorites';
import { matchConversationMessages, nextConversationMatchIndex, normalizeConversationMessageText, type SearchableConversationMessage } from '@/lib/chat-search.mjs';
import type { AuthPayload } from '@/pages/LoginPage';

type Account = AuthPayload['user'];
interface Props { account: Account; onLogout: () => Promise<void>; onReconnect: () => Promise<void> }
interface Person { id: string; username: string; displayName: string; nexconnUserId: string }
interface MessageSearchMatch extends SearchableConversationMessage { element: HTMLElement }
type SidebarFilter = 'all' | 'unread' | 'favourites';

function findDeepElements(root: ParentNode, selector: string): Element[] {
  const results: Element[] = [];
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (element.matches(selector)) results.push(element);
    if (element.shadowRoot) results.push(...findDeepElements(element.shadowRoot, selector));
  }
  return results;
}

function collectRenderedMessages(): MessageSearchMatch[] {
  const items = findDeepElements(document, '.nc-chatui-msg-list-item[data-message-uid]');
  const seen = new Set<string>();
  const messages: MessageSearchMatch[] = [];
  for (const candidate of items) {
    if (!(candidate instanceof HTMLElement)) continue;
    const id = candidate.dataset.messageUid || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const senderElement = findDeepElements(candidate, '.nickname, .name').find((element) => !element.matches('.time'));
    const timeElement = findDeepElements(candidate, '.time').at(-1);
    const excluded = '.name, .time, .nc-chatui-message-sent-status, .nc-chatui-time-section, [data-nexconn-search-hit], style, script, button';
    const textParts: string[] = [];
    const visit = (node: Node) => {
      if (node instanceof Text) { textParts.push(node.data); return; }
      if (!(node instanceof Element) || node.matches(excluded)) return;
      if (node instanceof HTMLSlotElement) {
        const assigned = node.assignedNodes({ flatten: true });
        (assigned.length ? assigned : Array.from(node.childNodes)).forEach(visit);
        return;
      }
      if (node.shadowRoot) { node.shadowRoot.childNodes.forEach(visit); return; }
      node.childNodes.forEach(visit);
    };
    visit(candidate);
    const text = normalizeConversationMessageText(textParts);
    const timestamp = timeElement?.textContent?.trim();
    messages.push({
      id,
      text,
      sender: senderElement?.textContent?.replace(timestamp || '', '').replace(/\s+/g, ' ').trim(),
      timestamp,
      element: candidate,
    });
  }
  return messages;
}

function clearMessageHighlights() {
  for (const mark of findDeepElements(document, 'mark[data-nexconn-search-hit]')) {
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
  }
  for (const item of findDeepElements(document, '.nexconn-search-current')) item.classList.remove('nexconn-search-current');
}

function highlightMessageText(root: HTMLElement, query: string) {
  const textNodes: Text[] = [];
  const excluded = '.name, .time, .nc-chatui-message-sent-status, .nc-chatui-time-section, [data-nexconn-search-hit], style, script, button';
  const visit = (node: Node) => {
    if (node instanceof Text) { textNodes.push(node); return; }
    if (!(node instanceof Element) || node.matches(excluded)) return;
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true });
      (assigned.length ? assigned : Array.from(node.childNodes)).forEach(visit);
      return;
    }
    if (node.shadowRoot) { node.shadowRoot.childNodes.forEach(visit); return; }
    node.childNodes.forEach(visit);
  };
  visit(root);
  const normalizedQuery = query.toLocaleLowerCase();
  for (const textNode of textNodes) {
    const source = textNode.data;
    const lower = source.toLocaleLowerCase();
    let offset = lower.length;
    while (offset >= 0) {
      const index = lower.lastIndexOf(normalizedQuery, offset - 1);
      if (index < 0) break;
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + query.length);
      const mark = document.createElement('mark');
      mark.dataset.nexconnSearchHit = 'true';
      mark.style.cssText = 'background:#6b581c;color:#fff2c1;border-radius:3px;padding:0 1px';
      range.surroundContents(mark);
      offset = index;
    }
  }
}

function applySdkChannelFilters(filter: SidebarFilter, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  const seenChannels = new Set<string>();
  for (const item of findDeepElements(document, 'nc-channel-list-item') as Array<HTMLElement & { model?: ChatUIChannelModel }>) {
    const model = item.model;
    if (!model) continue;
    const latestContent = model.latestMessage?.content;
    const preview = latestContent && typeof latestContent === 'object'
      ? Object.values(latestContent).filter((value): value is string => typeof value === 'string').join(' ')
      : '';
    const channelType: FavoriteChannelType | null = model.channelType === ChannelType.DIRECT ? 'direct' : model.channelType === ChannelType.GROUP ? 'group' : null;
    const channelKey = `${model.channelType}:${model.channelId}`;
    const duplicate = seenChannels.has(channelKey);
    seenChannels.add(channelKey);
    const matchesFilter = channelType !== null
      && (filter === 'all' || (filter === 'unread' ? model.unreadCount > 0 : isFavoriteChannel(channelType, model.channelId)));
    const matchesQuery = !normalized || `${model.name} ${model.channelId} ${preview}`.toLocaleLowerCase().includes(normalized);
    item.hidden = duplicate || !matchesFilter || !matchesQuery;
  }
}

export function ChatPage({ account, onLogout, onReconnect }: Props) {
  const [dialog, setDialog] = useState<'search' | 'profile' | null>(null);
  const [query, setQuery] = useState('');
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [sidebarPeople, setSidebarPeople] = useState<Person[]>([]);
  const [sidebarSearching, setSidebarSearching] = useState(false);
  const [sidebarSearchError, setSidebarSearchError] = useState('');
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>('all');
  const [favoriteChannels, setFavoriteChannels] = useState<FavoriteChannel[]>([]);
  const [messageQuery, setMessageQuery] = useState('');
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageMatches, setMessageMatches] = useState<MessageSearchMatch[]>([]);
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(-1);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [conversationInfoOpen, setConversationInfoOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<ChatUIChannelModel | null>(() => sdk.getApp()?.getOpenedChannel() ?? null);
  const [copiedConversationId, setCopiedConversationId] = useState(false);
  const [conversationActionError, setConversationActionError] = useState('');
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceRecordingStarting, setVoiceRecordingStarting] = useState(false);
  const [voiceMessageNotice, setVoiceMessageNotice] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarSearchRef = useRef<HTMLInputElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceChannelRef = useRef<ChannelIdentifier | null>(null);
  const voiceStartingRef = useRef(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [profile, setProfile] = useState({ displayName: account.displayName || account.username, avatarUrl: account.avatarUrl || '' });
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(() => sdk.getConnectionError());
  const [error, setError] = useState('');
  const [status, setStatus] = useState(() => sdk.getStatus());
  const [hasOpenChannel, setHasOpenChannel] = useState(() => Boolean(sdk.getApp()?.getOpenedChannel()));
  const sidebarFilterRef = useRef({ filter: sidebarFilter, query: sidebarQuery });
  sidebarFilterRef.current = { filter: sidebarFilter, query: sidebarQuery };
  useEffect(() => installChatUiTheme(), []);
  useEffect(() => {
    let detachApp = () => undefined;
    const attachApp = (app: NonNullable<ReturnType<typeof sdk.getApp>>) => {
      detachApp();
      setSelectedChannel(app.getOpenedChannel());
      setHasOpenChannel(Boolean(app.getOpenedChannel()));
      const onChannelSelected = (event: { data: { model: ChatUIChannelModel | null } }) => {
        setHasOpenChannel(Boolean(event.data.model));
        setSelectedChannel(event.data.model);
        setMessageSearchOpen(false);
        setConversationMenuOpen(false);
        setConversationInfoOpen(false);
        clearMessageHighlights();
      };
      const onChannelMenuAction = async (event: { data: { id: string; channelModel: ChatUIChannelModel } }) => {
        const { id, channelModel } = event.data;
        if (id !== 'nexconn.channel.favorite.add' && id !== 'nexconn.channel.favorite.remove') return;
        const adding = id === 'nexconn.channel.favorite.add';
        const channelType: FavoriteChannelType = channelModel.channelType === ChannelType.DIRECT ? 'direct' : 'group';
        const channelId = channelModel.channelId;
        const wasFavorite = isFavoriteChannel(channelType, channelId);
        updateFavoriteChannel(channelType, channelId, adding);
        setFavoriteChannels((current) => {
          const next = current.filter((favorite) => favorite.channelType !== channelType || favorite.channelId !== channelId);
          return adding ? [...next, { channelType, channelId }] : next;
        });
        applySdkChannelFilters(sidebarFilterRef.current.filter, sidebarFilterRef.current.query);
        try {
          const response = await fetch('/api/favorites', {
            method: adding ? 'POST' : 'DELETE',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ channelType, channelId }),
          });
          if (!response.ok) {
            const failure = await readApiResponse<{ error?: string }>(response, 'Favorites update');
            throw new Error(failure.error || 'Could not update this favorite.');
          }
          setConversationActionError(adding ? 'Added to favorites.' : 'Removed from favorites.');
          window.setTimeout(() => setConversationActionError(''), 2200);
        } catch (cause) {
          updateFavoriteChannel(channelType, channelId, wasFavorite);
          setFavoriteChannels((current) => {
            const next = current.filter((favorite) => favorite.channelType !== channelType || favorite.channelId !== channelId);
            return wasFavorite ? [...next, { channelType, channelId }] : next;
          });
          applySdkChannelFilters(sidebarFilterRef.current.filter, sidebarFilterRef.current.query);
          setConversationActionError(cause instanceof Error ? cause.message : 'Could not update this favourite.');
        }
      };
      const onPanelExtension = (event: { data: { id: string; channelModel: ChatUIChannelModel } }) => {
        setSelectedChannel(event.data.channelModel);
        if (event.data.id === 'nexconn-search-messages') {
          setConversationMenuOpen(false);
          setMessageSearchOpen(true);
          window.requestAnimationFrame(() => searchInputRef.current?.focus());
        }
        if (event.data.id === 'nexconn-conversation-menu') {
          setConversationMenuOpen((open) => !open);
          setMessageSearchOpen(false);
        }
      };
      const onMessagesChanged = (event?: { data?: unknown }) => {
        if (Array.isArray(event?.data) && event.data.some((message) => {
          if (!message || typeof message !== 'object') return false;
          const item = message as { sentStatus?: number; messageType?: string; file?: File };
          const isAttachment = item.file || [MessageType.FILE, MessageType.IMAGE, MessageType.GIF, MessageType.SHORT_VIDEO, MessageType.HD_VOICE].includes(item.messageType as never);
          return isAttachment && item.sentStatus === SentStatus.FAILED;
        })) {
          setVoiceMessageNotice('Attachment upload failed. Check your connection, then use the retry control on the message.');
          window.setTimeout(() => setVoiceMessageNotice(''), 4500);
        }
        window.requestAnimationFrame(() => refreshSearch());
      };
      const onDownloadLink = (event: { data: { message: { downloadMedia: () => Promise<{ isOk: boolean; code?: number }> } } }) => {
        const message = event.data?.message;
        if (!message || typeof message.downloadMedia !== 'function') {
          setVoiceMessageNotice('This attachment cannot be opened. Ask the sender to resend it.');
          window.setTimeout(() => setVoiceMessageNotice(''), 4500);
          return;
        }
        // Nexconn's Message.downloadMedia opens its SDK-provided remote URL.
        // Invoke it synchronously from the SDK click event so popup blockers
        // recognize the user gesture; it does not send app credentials.
        void message.downloadMedia().then((result) => {
          if (!result.isOk) throw new Error(`Nexconn could not open the attachment (code ${result.code ?? 'unknown'}).`);
        }).catch((cause) => {
          setVoiceMessageNotice(cause instanceof Error ? cause.message : 'Could not open this attachment.');
          window.setTimeout(() => setVoiceMessageNotice(''), 4500);
        });
      };
      const onFileSendFailed = (event: { data?: unknown }) => {
        const files = Array.isArray(event.data) ? event.data as File[] : [];
        const hasEmptyFile = files.some((file) => file.size === 0);
        const hasOversizeFile = files.some((file) => file.size > 100 * 1024 * 1024);
        setVoiceMessageNotice(hasEmptyFile
          ? 'Empty files cannot be sent.'
          : hasOversizeFile
            ? 'Files must be 100 MiB or smaller.'
            : 'One or more files could not be sent. Check the file and try again.');
        window.setTimeout(() => setVoiceMessageNotice(''), 4500);
      };
      app.addEventListener(ChatUIEvents.CHANNEL_SELECTED, onChannelSelected);
      app.addEventListener(ChatUIEvents.CHANNEL_PANEL_EXTENSION_TOUCH, onPanelExtension);
      app.addEventListener(ChatUIEvents.CHANNELS_MENU_ITEM_CLICK, onChannelMenuAction);
      app.addEventListener('MESSAGE_STATE_CHANGE', onMessagesChanged);
      app.addEventListener('RECV_NEW_MESSAGES', onMessagesChanged);
      app.addEventListener('DOWNLOAD_LINK_EVENT', onDownloadLink);
      app.addEventListener('FILE_SEND_FAILED_EVENT', onFileSendFailed);
      const onSidebarModelsChanged = () => window.requestAnimationFrame(() => applySdkChannelFilters(sidebarFilterRef.current.filter, sidebarFilterRef.current.query));
      // ChatUI paginates its channel list in batches of 30 when its scroll
      // provider emits `loading`. Since Nexconn intentionally hides non-direct
      // conversations, the visible list may be too short to ever reach that
      // scroll threshold. Keep asking the SDK's own provider for the next page
      // until it reports that pagination is complete.
      let channelPagingTimer = 0;
      let channelPagingActive = false;
      let channelPagingCancelled = false;
      let channelPagingAttempts = 0;
      const stopChannelPaging = () => {
        channelPagingCancelled = true;
        if (channelPagingTimer) window.clearTimeout(channelPagingTimer);
        channelPagingTimer = 0;
        channelPagingActive = false;
      };
      const scheduleChannelPage = (delay = 350) => {
        if (channelPagingCancelled || channelPagingTimer || channelPagingAttempts >= 180) return;
        channelPagingTimer = window.setTimeout(() => {
          channelPagingTimer = 0;
          const listProvider = findDeepElements(document, 'nc-channel-list-provider')[0] as (HTMLElement & { loading?: boolean; convList?: unknown[] }) | undefined;
          const scrollProvider = listProvider?.shadowRoot
            ? findDeepElements(listProvider.shadowRoot, 'nc-scrollbar-provider')[0]
            : undefined;
          if (!listProvider || !scrollProvider || channelPagingCancelled) {
            if (channelPagingAttempts < 180) scheduleChannelPage(350);
            return;
          }

          // The list can mount after CHANNELS_LIST_RESET and miss the SDK's
          // initial `loading` state. If 30+ rows are present, initialize the
          // same pagination state the SDK sets when it receives that event.
          if (listProvider.loading === false && (listProvider.convList?.length ?? 0) >= 30) {
            listProvider.loading = true;
          }
          if (!listProvider.loading) {
            channelPagingActive = false;
            applySdkChannelFilters(sidebarFilterRef.current.filter, sidebarFilterRef.current.query);
            return;
          }

          channelPagingAttempts += 1;
          scrollProvider.dispatchEvent(new Event('loading', { bubbles: true, composed: true }));
          // The event is handled by ChatUI's own pagination method. Reapply
          // our channel filter after the page has been rendered; the SDK does
          // not emit CHANNELS_LIST_RESET for lazy-loaded pages.
          applySdkChannelFilters(sidebarFilterRef.current.filter, sidebarFilterRef.current.query);
          scheduleChannelPage(450);
        }, delay);
      };
      const startChannelPaging = () => {
        if (channelPagingActive || channelPagingCancelled || channelPagingAttempts >= 180) return;
        channelPagingActive = true;
        scheduleChannelPage(0);
      };
      const onChannelListReset = (event: { data?: unknown }) => {
        diagnostic('CHANNEL_LIST_RESET_RECEIVED', {
          count: Array.isArray(event.data) ? event.data.length : 0,
          status: sdk.getStatus(),
        });
        onSidebarModelsChanged();
        startChannelPaging();
      };
      app.addEventListener('CHANNELS_LIST_RESET', onChannelListReset);
      app.addEventListener('CHANNELS_ITEM_CHANGE', onSidebarModelsChanged);
      app.addEventListener('CHANNELS_ITEM_ORDER_CHANGE', onSidebarModelsChanged);
      app.addEventListener('CHANNELS_ITEM_DELETED', onSidebarModelsChanged);
      // Apply the current search/filter as soon as existing SDK channel rows
      // are present, in addition to handling the list's subsequent events.
      window.requestAnimationFrame(() => applySdkChannelFilters(sidebarFilterRef.current.filter, sidebarFilterRef.current.query));
      // Also cover the case where the SDK completed its first list reset
      // before this screen mounted. The provider's cached rows are available
      // immediately after the custom element connects.
      startChannelPaging();
      detachApp = () => {
        stopChannelPaging();
        app.removeEventListener(ChatUIEvents.CHANNEL_SELECTED, onChannelSelected);
        app.removeEventListener(ChatUIEvents.CHANNEL_PANEL_EXTENSION_TOUCH, onPanelExtension);
        app.removeEventListener(ChatUIEvents.CHANNELS_MENU_ITEM_CLICK, onChannelMenuAction);
        app.removeEventListener('MESSAGE_STATE_CHANGE', onMessagesChanged);
        app.removeEventListener('RECV_NEW_MESSAGES', onMessagesChanged);
        app.removeEventListener('DOWNLOAD_LINK_EVENT', onDownloadLink);
        app.removeEventListener('FILE_SEND_FAILED_EVENT', onFileSendFailed);
        app.removeEventListener('CHANNELS_LIST_RESET', onChannelListReset);
        app.removeEventListener('CHANNELS_ITEM_CHANGE', onSidebarModelsChanged);
        app.removeEventListener('CHANNELS_ITEM_ORDER_CHANGE', onSidebarModelsChanged);
        app.removeEventListener('CHANNELS_ITEM_DELETED', onSidebarModelsChanged);
      };
    };
    const onAppReady = () => { const app = sdk.getApp(); if (app) attachApp(app); };
    if (sdk.getApp()) attachApp(sdk.getApp()!);
    window.addEventListener('nexconn-app-ready', onAppReady);
    return () => { detachApp(); window.removeEventListener('nexconn-app-ready', onAppReady); };
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/favorites', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Could not load your favorites.');
        const payload = await readApiResponse<{ favorites: FavoriteChannel[] }>(response, 'Favorites');
        if (!active) return;
        const favorites = Array.isArray(payload.favorites) ? payload.favorites : [];
        replaceFavoriteChannels(favorites);
        setFavoriteChannels(favorites);
        applySdkChannelFilters(sidebarFilterRef.current.filter, sidebarFilterRef.current.query);
      } catch (cause) {
        if (active) setConversationActionError(cause instanceof Error ? cause.message : 'Could not load your favorites.');
      }
    })();
    return () => { active = false; replaceFavoriteChannels([]); };
  }, [account.id]);
  useEffect(() => {
    replaceFavoriteChannels(favoriteChannels);
    applySdkChannelFilters(sidebarFilter, sidebarQuery);
  }, [favoriteChannels, sidebarFilter, sidebarQuery]);
  useEffect(() => sdk.onStatus((value) => {
    setStatus(value);
    setConnectionError(sdk.getConnectionError());
  }), []);
  useEffect(() => {
    diagnostic('CONNECTION_BANNER_STATE', {
      status,
      appWarningVisible: shouldShowConnectionWarning(status),
      connectingIndicatorVisible: status === 'connecting',
      chatUiConnectionStatusIndicatorEnabled: false,
    });
  }, [status]);
  useEffect(() => { if (status === 'connected') setConnectionError(''); }, [status]);

  const refreshSearch = useCallback(() => {
    clearMessageHighlights();
    if (!messageSearchOpen || !messageQuery.trim()) { setMessageMatches([]); setSelectedMatchIndex(-1); return; }
    const matches = matchConversationMessages(collectRenderedMessages(), messageQuery) as MessageSearchMatch[];
    setMessageMatches(matches);
    setSelectedMatchIndex((current) => matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : -1);
    matches.forEach((match) => highlightMessageText(match.element, messageQuery.trim()));
  }, [messageQuery, messageSearchOpen]);

  useEffect(() => {
    if (!messageSearchOpen) { clearMessageHighlights(); setMessageMatches([]); setSelectedMatchIndex(-1); return; }
    const timer = window.setTimeout(refreshSearch, 0);
    const refreshOnScroll = (event: Event) => {
      if ((event.target as Element | null)?.closest?.('.nc-chatui-msg-list-scroll')) window.requestAnimationFrame(refreshSearch);
    };
    document.addEventListener('scroll', refreshOnScroll, true);
    return () => { window.clearTimeout(timer); document.removeEventListener('scroll', refreshOnScroll, true); };
  }, [messageSearchOpen, refreshSearch]);

  useEffect(() => {
    if (!conversationMenuOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      const path = event.composedPath();
      const isMenuTrigger = path.some((target) => target instanceof Element && target.matches('.extension-button[aria-label="Conversation menu"]'));
      if (!isMenuTrigger && !conversationMenuRef.current?.contains(event.target as Node)) setConversationMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setConversationMenuOpen(false); };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [conversationMenuOpen]);

  useEffect(() => {
    for (const item of findDeepElements(document, '.nexconn-search-current')) item.classList.remove('nexconn-search-current');
    if (messageSearchOpen && selectedMatchIndex >= 0) messageMatches[selectedMatchIndex]?.element.classList.add('nexconn-search-current');
  }, [messageMatches, messageSearchOpen, selectedMatchIndex]);

  useEffect(() => {
    if (!messageSearchOpen && !conversationInfoOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMessageSearchOpen(false);
      setConversationInfoOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [messageSearchOpen, conversationInfoOpen]);

  const navigateSearchResult = (direction: number) => {
    const nextIndex = nextConversationMatchIndex(selectedMatchIndex, messageMatches.length, direction);
    setSelectedMatchIndex(nextIndex);
    if (nextIndex >= 0) messageMatches[nextIndex].element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const copyConversationId = async () => {
    if (!selectedChannel) return;
    try {
      await navigator.clipboard.writeText(selectedChannel.channelId);
      setConversationActionError('');
      setCopiedConversationId(true);
      window.setTimeout(() => setCopiedConversationId(false), 1800);
    } catch {
      setConversationActionError('Your browser did not allow copying the conversation ID.');
    }
    setConversationMenuOpen(false);
  };

  useEffect(() => {
    const finishRecording = async (recorder: MediaRecorder) => {
      const stream = voiceStreamRef.current;
      voiceStreamRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());
      voiceRecorderRef.current = null;
      setVoiceRecording(false);
      setVoiceRecordingStarting(false);
      const chunks = voiceChunksRef.current;
      voiceChunksRef.current = [];
      const channelIdentifier = voiceChannelRef.current;
      voiceChannelRef.current = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (!blob.size || !channelIdentifier) {
        if (!blob.size) setVoiceMessageNotice('No voice audio was recorded.');
        return;
      }
      setVoiceMessageNotice('Sending voice message…');
      try {
        const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `nexconn-voice-message.${extension}`, { type: blob.type });
        const params = await Helper.createSendHDVoiceMessageParams(file);
        if (!params.isOk || !params.data) throw new Error(`Nexconn could not process this recording (code ${params.code}).`);
        if (channelIdentifier.channelType !== ChannelType.DIRECT) throw new Error('Voice messages are only available in direct conversations.');
        const app = sdk.getApp();
        if (!app?.ifReady()) throw new Error('Chat is still connecting. Please try again.');
        const result = await new DirectChannel(channelIdentifier.channelId).sendMediaMessage(params.data);
        if (!result?.isOk || !result.data) throw new Error(`Nexconn could not send the voice message${result ? ` (code ${result.code})` : ''}.`);
        const inserted = await app.insertMessage(result.data);
        if (!inserted.isOk) {
          setVoiceMessageNotice('Voice message sent. Reopen the conversation if it does not appear yet.');
          window.setTimeout(() => setVoiceMessageNotice(''), 4000);
          return;
        }
        setVoiceMessageNotice('Voice message sent.');
        window.setTimeout(() => setVoiceMessageNotice(''), 2600);
      } catch (cause) {
        setVoiceMessageNotice(cause instanceof Error ? cause.message : 'Could not send this voice message.');
      }
    };

    const toggleVoiceRecording = async (event: Event) => {
      const detail = (event as CustomEvent<{ channelIdentifier?: ChannelIdentifier }>).detail;
      if (voiceRecorderRef.current) {
        if (voiceRecorderRef.current.state !== 'inactive') voiceRecorderRef.current.stop();
        return;
      }
      if (voiceStartingRef.current) return;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setVoiceMessageNotice('Voice recording is not supported by this browser.');
        return;
      }
      if (!detail?.channelIdentifier) {
        setVoiceMessageNotice('Open a conversation before recording a voice message.');
        return;
      }
      voiceStartingRef.current = true;
      setVoiceRecordingStarting(true);
      setVoiceMessageNotice('Allow microphone access to record.');
      let pendingStream: MediaStream | null = null;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        pendingStream = stream;
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        voiceStreamRef.current = stream;
        pendingStream = null;
        voiceRecorderRef.current = recorder;
        voiceChannelRef.current = detail.channelIdentifier;
        voiceChunksRef.current = [];
        recorder.addEventListener('dataavailable', (dataEvent) => {
          if (dataEvent.data.size) voiceChunksRef.current.push(dataEvent.data);
        });
        recorder.addEventListener('stop', () => { void finishRecording(recorder); }, { once: true });
        recorder.addEventListener('error', () => {
          voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
          voiceStreamRef.current = null;
          voiceRecorderRef.current = null;
          setVoiceRecording(false);
          setVoiceMessageNotice('The browser could not record audio. Try again.');
        }, { once: true });
        recorder.start();
        setVoiceRecording(true);
        setVoiceMessageNotice('Recording… select the microphone again to send.');
      } catch (cause) {
        pendingStream?.getTracks().forEach((track) => track.stop());
        setVoiceMessageNotice(cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it in your browser settings to record.'
          : 'Could not start microphone recording. Check that a microphone is connected.');
      } finally {
        voiceStartingRef.current = false;
        setVoiceRecordingStarting(false);
      }
    };

    window.addEventListener('nexconn-voice-toggle', toggleVoiceRecording);
    return () => {
      window.removeEventListener('nexconn-voice-toggle', toggleVoiceRecording);
      if (voiceRecorderRef.current?.state !== 'inactive') voiceRecorderRef.current?.stop();
      else voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    for (const button of findDeepElements(document, '.nexconn-voice-button') as HTMLButtonElement[]) {
      const pressed = voiceRecording || voiceRecordingStarting;
      button.setAttribute('aria-pressed', String(pressed));
      button.setAttribute('aria-label', voiceRecording ? 'Stop and send voice message' : voiceRecordingStarting ? 'Requesting microphone' : 'Record a voice message');
      button.title = voiceRecording ? 'Stop and send voice message' : 'Record a voice message';
      button.disabled = voiceRecordingStarting;
    }
  }, [voiceRecording, voiceRecordingStarting]);

  const reconnect = async () => {
    setReconnecting(true); setConnectionError('');
    try { await onReconnect(); }
    catch (cause) { setConnectionError(cause instanceof Error ? cause.message : 'Could not reconnect to Nexconn.'); }
    finally { setReconnecting(false); }
  };

  useEffect(() => {
    if (dialog !== 'search' || query.trim().length < 2) { setPeople([]); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true); setError('');
      try {
        const response = await fetch(`/api/users?search=${encodeURIComponent(query.trim())}`, { credentials: 'same-origin' });
        const payload = await readApiResponse<{ users: Person[]; error?: string }>(response, 'User search');
        if (!response.ok) throw new Error(payload.error || 'Could not search users.');
        if (active) setPeople(payload.users);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Could not search users.'); }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [dialog, query]);

  useEffect(() => {
    if (sidebarQuery.trim().length < 2) { setSidebarPeople([]); setSidebarSearchError(''); setSidebarSearching(false); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setSidebarSearching(true); setSidebarSearchError('');
      try {
        const response = await fetch(`/api/users?search=${encodeURIComponent(sidebarQuery.trim())}`, { credentials: 'same-origin' });
        const payload = await readApiResponse<{ users: Person[]; error?: string }>(response, 'Nexconn user search');
        if (!response.ok) throw new Error(payload.error || 'Could not search Nexconn users.');
        if (active) setSidebarPeople(payload.users);
      } catch (cause) {
        if (active) {
          setSidebarPeople([]);
          setSidebarSearchError(cause instanceof Error ? cause.message : 'Could not search Nexconn users.');
        }
      } finally { if (active) setSidebarSearching(false); }
    }, 220);
    return () => { active = false; clearTimeout(timer); };
  }, [sidebarQuery]);

  useEffect(() => {
    applySdkChannelFilters(sidebarFilter, sidebarQuery);
    const observer = new MutationObserver(() => applySdkChannelFilters(sidebarFilterRef.current.filter, sidebarFilterRef.current.query));
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [sidebarFilter, sidebarQuery]);

  const startChat = async (person: Person) => {
    try { setError(''); setConversationActionError(''); await sdk.openDirect(person.nexconnUserId); setDialog(null); setQuery(''); }
    catch (cause) { setConversationActionError(cause instanceof Error ? cause.message : 'Could not open conversation.'); }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const response = await fetch('/api/account/profile', {
        method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile),
      });
      const payload = await readApiResponse<{ user: { displayName: string; avatarUrl: string }; error?: string }>(response, 'Profile update');
      if (!response.ok) throw new Error(payload.error || 'Could not save your profile.');
      setProfile({ displayName: payload.user.displayName, avatarUrl: payload.user.avatarUrl });
      setDialog(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your profile.'); }
    finally { setSaving(false); }
  };

  const initials = profile.displayName.trim().slice(0, 1).toUpperCase() || account.username.slice(0, 1).toUpperCase();
  const avatar = profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initials;

  return <div className={`app-shell app-shell--direct${hasOpenChannel ? ' app-shell--has-conversation' : ''}`}>
    <aside className="app-rail" aria-label="Nexconn account">
      <a className="app-rail__brand" href="#chats" aria-label="Nexconn home" title="Nexconn"><img src="/nexconn-logo.png" alt="" /></a>
      <button className="app-rail__button app-rail__button--active" type="button" aria-label="Start a direct chat" title="Start a direct chat" onClick={() => setDialog('search')}><MessageSquarePlus size={21} /></button>
      <button className="app-rail__button" type="button" aria-label="Account settings" title="Account settings" onClick={() => setDialog('profile')}><Settings size={19} /></button>
      <span className="app-rail__spacer" />
      <button className="app-rail__avatar" type="button" title="Account profile" aria-label="Account profile" onClick={() => setDialog('profile')}>{avatar}</button>
    </aside>
    <header className="mobile-topbar"><div className="mobile-topbar__brand"><img src="/nexconn-logo.png" alt="" /> <span>Nexconn</span></div><div className="mobile-topbar__actions"><button type="button" aria-label="Search or start a direct chat" onClick={() => setDialog('search')}><Search size={20} /></button><button type="button" aria-label="Account settings" onClick={() => setDialog('profile')}><Settings size={20} /></button><button className="mobile-topbar__avatar" type="button" aria-label="Account profile" onClick={() => setDialog('profile')}>{avatar}</button></div></header>
    <main className={`chat-workspace${hasOpenChannel ? ' chat-workspace--conversation' : ''}`} aria-label="Nexconn direct conversations">
      <nc-chat-ui-app-provider style={{ display: 'block', width: '100%', height: '100%' }} />
      {hasOpenChannel && <div className="mobile-conversation-actions" aria-label="Conversation actions">
        <button type="button" aria-label="Search messages" title="Search messages" onClick={() => { setConversationMenuOpen(false); setMessageSearchOpen(true); window.requestAnimationFrame(() => searchInputRef.current?.focus()); }}><Search size={18} /></button>
        <button type="button" aria-label="Conversation menu" title="Conversation menu" aria-expanded={conversationMenuOpen} onClick={() => { setMessageSearchOpen(false); setConversationMenuOpen((open) => !open); }}><MoreVertical size={19} /></button>
      </div>}
      <section className="channel-sidebar-toolbar" aria-label="Search and filter direct conversations">
      <div className="channel-sidebar-search"><Search size={18} aria-hidden="true" /><input id="conversation-list-search" name="conversationSearch" ref={sidebarSearchRef} value={sidebarQuery} onChange={(event) => setSidebarQuery(event.target.value)} placeholder="Search or start a new chat" aria-label="Search users or conversations" /><button type="button" aria-label="Start a new direct chat" title="Start a new direct chat" onClick={() => { setSidebarQuery(''); setQuery(''); setDialog('search'); }}><Plus size={18} /></button></div>
        <div className="channel-sidebar-filters" role="group" aria-label="Conversation filters">
          {(['all', 'unread', 'favourites'] as const).map((filter) => <button key={filter} type="button" aria-pressed={sidebarFilter === filter} className={sidebarFilter === filter ? 'is-active' : ''} onClick={() => setSidebarFilter(filter)}>{filter === 'all' ? 'All' : filter === 'unread' ? 'Unread' : 'Favorites'}</button>)}
        </div>
        {sidebarQuery.trim().length >= 2 && <div className="channel-user-results" role="listbox" aria-label="Registered Nexconn users">
          {sidebarSearching ? <p>Searching users…</p> : sidebarSearchError ? <p role="alert">{sidebarSearchError}</p> : sidebarPeople.length ? sidebarPeople.map((person) => <button type="button" role="option" key={person.id} onClick={() => { setSidebarQuery(''); void startChat(person); }}><span className="channel-user-results__avatar">{person.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{person.displayName}</strong><small>@{person.username}</small></span></button>) : <p>No registered users found.</p>}
        </div>}
      </section>
      {status === 'connecting' && <div className="connection-pill" role="status">Connecting to Nexconn…</div>}
      {shouldShowConnectionWarning(status) && <div className="connection-retry" role="status"><span>{connectionError || (status === 'error' ? 'The Nexconn token was rejected or expired.' : 'Messaging connection was interrupted.')}</span>{sdk.getConnectionCode() === 31010 ? <button type="button" onClick={() => void onLogout()}>Sign in again</button> : <button type="button" onClick={() => void reconnect()} disabled={reconnecting}>{reconnecting ? 'Reconnecting…' : 'Reconnect'}</button>}</div>}
      {voiceMessageNotice && <div className="voice-message-toast" role="status">{voiceMessageNotice}</div>}
      {messageSearchOpen && <section className="conversation-search" role="search" aria-label="Search this conversation">
        <div className="conversation-search__row"><Search size={18} aria-hidden="true" /><input id="message-search" name="messageSearch" ref={searchInputRef} value={messageQuery} onChange={(event) => { setMessageQuery(event.target.value); setSelectedMatchIndex(-1); }} placeholder="Search messages in this chat" aria-label="Search messages in this chat" /><span className="conversation-search__count">{messageMatches.length ? `${selectedMatchIndex + 1} of ${messageMatches.length}` : `0 of ${messageMatches.length}`}</span><button type="button" aria-label="Previous match" title="Previous match" disabled={!messageMatches.length} onClick={() => navigateSearchResult(-1)}><ChevronUp size={18} /></button><button type="button" aria-label="Next match" title="Next match" disabled={!messageMatches.length} onClick={() => navigateSearchResult(1)}><ChevronDown size={18} /></button><button type="button" aria-label="Close message search" title="Close search" onClick={() => setMessageSearchOpen(false)}><X size={18} /></button></div>
        <div className="conversation-search__results" aria-live="polite">{!messageQuery.trim() ? <p>Search messages currently loaded in this conversation.</p> : messageMatches.length ? messageMatches.map((match, index) => <button type="button" className={index === selectedMatchIndex ? 'is-current' : ''} key={match.id} onClick={() => { setSelectedMatchIndex(index); match.element.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><span className="conversation-search__meta">{match.sender || 'Message'}{match.timestamp ? ` · ${match.timestamp}` : ''}</span><span>{match.text}</span></button>) : <p>No messages found</p>}</div>
      </section>}
      {conversationMenuOpen && <div className="conversation-menu" role="menu" ref={conversationMenuRef}>
        <button type="button" role="menuitem" onClick={() => { setConversationMenuOpen(false); setMessageSearchOpen(true); window.requestAnimationFrame(() => searchInputRef.current?.focus()); }}><Search size={17} />Search messages</button>
        <button type="button" role="menuitem" onClick={() => { setConversationMenuOpen(false); setConversationInfoOpen(true); }}><Info size={17} />Conversation info</button>
        <button type="button" role="menuitem" onClick={() => void copyConversationId()}><Copy size={17} />Copy conversation ID</button>
      </div>}
      {copiedConversationId && <div className="conversation-toast" role="status"><Check size={16} />Conversation ID copied</div>}
      {conversationActionError && <div className="conversation-toast" role="alert">{conversationActionError}</div>}
      {conversationInfoOpen && selectedChannel && <section className="conversation-info" role="dialog" aria-modal="false" aria-labelledby="conversation-info-title">
        <div className="conversation-info__head"><h2 id="conversation-info-title">Conversation info</h2><button type="button" aria-label="Close conversation info" onClick={() => setConversationInfoOpen(false)}><X size={18} /></button></div>
        <dl><dt>Name</dt><dd>{selectedChannel.name || selectedChannel.channelId}</dd><dt>Type</dt><dd>{selectedChannel.channelType}</dd><dt>Conversation ID</dt><dd>{selectedChannel.channelId}</dd>{selectedChannel.updateTime ? <><dt>Last activity</dt><dd>{new Date(selectedChannel.updateTime).toLocaleString()}</dd></> : null}</dl>
      </section>}
    </main>
    {dialog && <div className="channel-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><section className="channel-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
      <div className="channel-dialog__head"><h2 id="account-dialog-title">{dialog === 'search' ? 'Start a direct chat' : 'Your profile'}</h2><button className="channel-dialog__close" type="button" aria-label="Close" onClick={() => { setDialog(null); setError(''); }}><X size={18} /></button></div>
      {dialog === 'search' ? <div className="direct-search"><label htmlFor="direct-search-input">Find a Nexconn user</label><div className="direct-search__input"><Search size={18} /><input id="direct-search-input" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by username or email" /></div>{query.trim().length < 2 ? <p className="direct-search__hint">Enter at least two characters.</p> : searching ? <p className="direct-search__hint">Searching…</p> : people.length ? <ul>{people.map((person) => <li key={person.id}><button type="button" onClick={() => void startChat(person)}><span className="direct-search__avatar">{person.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{person.displayName}</strong><small>@{person.username}</small></span></button></li>)}</ul> : <p className="direct-search__hint">No registered users found.</p>}{error && <p className="dialog-error" role="alert">{error}</p>}</div> : <>
        <div className="account-profile"><span className="account-profile__avatar">{avatar}</span><dl><dt>Username</dt><dd>{account.username}</dd><dt>Email</dt><dd>{account.email}</dd><dt>Account created</dt><dd>{new Date(account.createdAt).toLocaleDateString()}</dd></dl></div>
        <form className="account-profile__form" onSubmit={saveProfile}><label htmlFor="profile-display-name">Display name<input id="profile-display-name" name="displayName" required value={profile.displayName} onChange={(event) => setProfile((value) => ({ ...value, displayName: event.target.value }))} maxLength={80} /></label><label htmlFor="profile-avatar-url">Avatar image URL<input id="profile-avatar-url" name="avatarUrl" type="url" value={profile.avatarUrl} onChange={(event) => setProfile((value) => ({ ...value, avatarUrl: event.target.value }))} placeholder="https://example.com/avatar.jpg" /></label>{error && <p className="dialog-error" role="alert">{error}</p>}<button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button><button type="button" className="account-profile__logout" onClick={() => void onLogout()}><LogOut size={17} /> Sign out</button></form>
      </>}
    </section></div>}
  </div>;
}
