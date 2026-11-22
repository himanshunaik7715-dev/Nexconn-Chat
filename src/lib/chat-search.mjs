/** Search only the message records supplied by the currently rendered SDK view. */
export function matchConversationMessages(messages, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  return messages.filter((message) => message.text.toLocaleLowerCase().includes(normalizedQuery));
}

/** Join adjacent SDK text nodes before normalizing whitespace so split words remain searchable. */
export function normalizeConversationMessageText(textParts) {
  return textParts.join('').replace(/\s+/g, ' ').trim();
}

/** Wrap through results in either direction, including from an unset selection. */
export function nextConversationMatchIndex(currentIndex, count, direction) {
  if (count <= 0) return -1;
  if (currentIndex < 0) return direction > 0 ? 0 : count - 1;
  return (currentIndex + direction + count) % count;
}
