import { addDays, addMonthsClamped, weekdayOf } from "./tz";

/** Calendar grid maths on "YYYY-MM-DD" day keys (timezone-free; the page converts to UTC). */

export type GridView = "month" | "week" | "day" | "list" | "kanban" | "campaign" | "platform";

export function startOfWeek(day: string, weekStart: number) {
  return addDays(day, -((weekdayOf(day) - weekStart + 7) % 7));
}

/**
 * Days shown by a view and the anchors of the previous / next period.
 * month → whole weeks covering the month; week → 7 days; day → 1 day;
 * list / kanban / campaign / platform → the calendar month of the anchor.
 */
export function calendarRange(view: GridView, anchor: string, weekStart: number) {
  const monthStart = anchor.slice(0, 8) + "01";
  const monthEnd = addDays(addMonthsClamped(monthStart, 1), -1);
  let days: string[];
  let prev: string;
  let next: string;
  if (view === "month") {
    const first = startOfWeek(monthStart, weekStart);
    const last = addDays(startOfWeek(monthEnd, weekStart), 6);
    days = [];
    for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
    prev = addMonthsClamped(monthStart, -1);
    next = addMonthsClamped(monthStart, 1);
  } else if (view === "week") {
    const first = startOfWeek(anchor, weekStart);
    days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
    prev = addDays(anchor, -7);
    next = addDays(anchor, 7);
  } else if (view === "day") {
    days = [anchor];
    prev = addDays(anchor, -1);
    next = addDays(anchor, 1);
  } else {
    days = [];
    for (let d = monthStart; d <= monthEnd; d = addDays(d, 1)) days.push(d);
    prev = addMonthsClamped(monthStart, -1);
    next = addMonthsClamped(monthStart, 1);
  }
  return { days, first: days[0], last: days[days.length - 1], prev, next, month: anchor.slice(0, 7) };
}
