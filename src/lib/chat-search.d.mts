export interface SearchableConversationMessage {
  id: string;
  text: string;
  sender?: string;
  timestamp?: string;
  element?: Element;
}

export function matchConversationMessages<T extends SearchableConversationMessage>(messages: T[], query: string): T[];
export function nextConversationMatchIndex(currentIndex: number, count: number, direction: number): number;
export function normalizeConversationMessageText(textParts: string[]): string;
