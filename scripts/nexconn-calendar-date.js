/**
 * Calendar-day labels used to patch Nexconn Chat UI 26.2.0's message separators.
 * The SDK otherwise classifies by elapsed hours, which mislabels calendar dates.
 */
export function nexconnCalendarDateLabel(timestamp, now, todayLabel, yesterdayLabel, fullDateLabel) {
  const messageDate = new Date(timestamp);
  if (!Number.isFinite(messageDate.getTime())) return fullDateLabel;
  if (messageDate.toDateString() === now.toDateString()) return todayLabel;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (messageDate.toDateString() === yesterday.toDateString()) return yesterdayLabel;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(messageDate);
}

/** Match the SDK's local-calendar grouping rule and ignore invalid timestamps safely. */
export function nexconnCalendarDayChanged(currentTimestamp, previousTimestamp) {
  const currentDate = new Date(currentTimestamp);
  const previousDate = new Date(previousTimestamp);
  return Number.isFinite(currentDate.getTime())
    && Number.isFinite(previousDate.getTime())
    && currentDate.toDateString() !== previousDate.toDateString();
}

/** Format an SDK message timestamp in the viewer's local 12-hour clock. */
export function formatNexconnMessageTime(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase();
}

/** Preserve SDK transitions; use custom tick art only for sent and read. */
export function nexconnMessageStatusIcon(status) {
  if (status === 30) return '/icons/message-sent.svg';
  if (status === 50) return '/icons/message-read.svg';
  return null;
}
