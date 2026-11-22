import test from 'node:test';
import assert from 'node:assert/strict';
import { matchConversationMessages, nextConversationMatchIndex, normalizeConversationMessageText } from '../src/lib/chat-search.mjs';

const messages = [
  { id: '1', text: 'The internship looks interesting' },
  { id: '2', text: 'Research and development' },
  { id: '3', text: 'See you later' },
];

test('in-chat search is case-insensitive and matches partial words', () => {
  assert.deepEqual(matchConversationMessages(messages, 'INTER'), [messages[0]]);
  assert.deepEqual(matchConversationMessages(messages, 'lop'), [messages[1]]);
  assert.deepEqual(matchConversationMessages(messages, '   '), []);
});

test('message search preserves words split across SDK text nodes', () => {
  assert.equal(normalizeConversationMessageText(['hel', 'lo ', 'Rahul']), 'hello Rahul');
  assert.equal(normalizeConversationMessageText(['Aap ', 'batao', '  sab']), 'Aap batao sab');
});

test('in-chat search navigation wraps through results in both directions', () => {
  assert.equal(nextConversationMatchIndex(-1, 3, 1), 0);
  assert.equal(nextConversationMatchIndex(-1, 3, -1), 2);
  assert.equal(nextConversationMatchIndex(2, 3, 1), 0);
  assert.equal(nextConversationMatchIndex(0, 3, -1), 2);
  assert.equal(nextConversationMatchIndex(0, 0, 1), -1);
});
