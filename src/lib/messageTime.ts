const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(epoch: number): number {
  const date = new Date(epoch);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatMessageClock(epoch: number, locale?: string): string {
  return new Date(epoch).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

export function formatMessageDateTime(epoch: number, locale?: string): string {
  return new Date(epoch).toLocaleString(locale, { dateStyle: "long", timeStyle: "medium" });
}

export function formatDayLabel(epoch: number, today: number, locale?: string): string {
  const date = new Date(epoch);
  // Rounding absorbs the hour a daylight saving change adds to or takes from a day.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/971
  const daysAgo = Math.round((startOfDay(today) - startOfDay(epoch)) / DAY_MS);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo <= 7) return date.toLocaleDateString(locale, { weekday: "long" });
  const sameYear = date.getFullYear() === new Date(today).getFullYear();
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

export function dayLabels(
  epochs: ReadonlyArray<number | undefined>,
  today: number,
  locale?: string
): Map<number, string> {
  const labels = new Map<number, string>();
  let previousDay: number | undefined;
  epochs.forEach((epoch, index) => {
    if (epoch === undefined) return;
    const day = startOfDay(epoch);
    if (day === previousDay) return;
    const label = formatDayLabel(epoch, today, locale);
    // A chat that began today needs no label above its first message.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/971
    if (previousDay !== undefined || label !== "Today") labels.set(index, label);
    previousDay = day;
  });
  return labels;
}
