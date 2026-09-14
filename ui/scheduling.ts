import type { Item } from "../src/data";
export const WORK_START = 540;
export const WORK_END = 1020;
export function snapStart(
  pointerY: number,
  top: number,
  height: number,
  duration: number,
  grabOffset = 0
) {
  const minutes =
    ((pointerY - top) / height) * (WORK_END - WORK_START) - grabOffset;
  return Math.max(
    WORK_START,
    Math.min(
      Math.floor((WORK_END - duration) / 15) * 15,
      WORK_START + Math.round(minutes / 15) * 15
    )
  );
}
export function proposedIssue(item: Item, events: Item[]): string {
  const date = new Date(item.date + "T00:00:00Z");
  if (
    !/^202[67]-\d{2}-\d{2}$/.test(item.date) ||
    Number.isNaN(+date) ||
    date.toISOString().slice(0, 10) !== item.date
  )
    return "Choose a date in 2026–2027.";
  if ([0, 6].includes(date.getUTCDay())) return "Choose a weekday.";
  if (
    !Number.isFinite(item.start) ||
    !Number.isFinite(item.duration) ||
    item.duration < 15 ||
    item.duration > 180 ||
    item.duration % 15 !== 0
  )
    return "Use a duration of 15–180 minutes, in 15-minute steps.";
  if (item.start < WORK_START || item.start + item.duration > WORK_END)
    return "Keep the event between 09:00 and 17:00 UTC.";
  if (item.start % 15 !== 0) return "Choose a start time in 15-minute steps.";
  const conflict = events.find(
    (x) =>
      x.id !== item.id &&
      x.date === item.date &&
      x.start > 0 &&
      item.start < x.start + x.duration &&
      x.start < item.start + item.duration
  );
  return conflict
    ? `Overlaps ${conflict.title.split(" · ")[0]}. Choose another time.`
    : "";
}
export function minutes(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return NaN;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
