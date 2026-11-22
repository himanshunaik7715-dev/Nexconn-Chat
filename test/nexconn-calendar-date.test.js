import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNexconnMessageTime, nexconnCalendarDateLabel, nexconnCalendarDayChanged, nexconnMessageStatusIcon } from '../scripts/nexconn-calendar-date.js';

const labels = { today: 'Today', yesterday: 'Yesterday', full: 'SDK full date' };
const label = (timestamp, now) => nexconnCalendarDateLabel(
  timestamp,
  now,
  labels.today,
  labels.yesterday,
  labels.full,
);

test('message date separators use local calendar dates, not elapsed-hour windows', () => {
  const now = new Date(2026, 10, 22, 0, 5);
  assert.equal(label(new Date(2026, 10, 22, 0, 1).getTime(), now), 'Today');
  assert.equal(label(new Date(2026, 10, 21, 23, 59).getTime(), now), 'Yesterday');
  assert.equal(label(new Date(2026, 10, 20, 23, 59).getTime(), now), '20 November 2026');
});

test('date label helper falls back to SDK full-date formatting for invalid timestamps', () => {
  assert.equal(label(Number.NaN, new Date(2026, 10, 22)), labels.full);
});

test('message separators compare local calendar days, including midnight rollover', () => {
  const todayMorning = new Date(2026, 10, 22, 0, 1).getTime();
  const todayEvening = new Date(2026, 10, 22, 23, 59).getTime();
  const yesterday = new Date(2026, 10, 21, 23, 59).getTime();
  assert.equal(nexconnCalendarDayChanged(todayMorning, todayEvening), false);
  assert.equal(nexconnCalendarDayChanged(todayMorning, yesterday), true);
  assert.equal(nexconnCalendarDayChanged(Number.NaN, todayMorning), false);
});

test('message timestamp uses the original local time in lowercase 12-hour format', () => {
  const timestamp = new Date(2026, 10, 22, 0, 5).getTime();
  assert.equal(formatNexconnMessageTime(timestamp), '12:05 am');
  assert.equal(formatNexconnMessageTime(new Date(2026, 10, 22, 12, 5).getTime()), '12:05 pm');
  assert.equal(formatNexconnMessageTime(Number.NaN), '');
});

test('only SDK sent and read states map to tick icons; in-flight and failed states stay SDK-owned', () => {
  assert.equal(nexconnMessageStatusIcon(10), null);
  assert.equal(nexconnMessageStatusIcon(20), null);
  assert.equal(nexconnMessageStatusIcon(30), '/icons/message-sent.svg');
  assert.equal(nexconnMessageStatusIcon(50), '/icons/message-read.svg');
});
