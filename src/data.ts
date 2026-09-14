export type Item = {
  id: string;
  kind: "event" | "task" | "email";
  title: string;
  project: string;
  priority: number;
  date: string;
  start: number;
  duration: number;
  fixed: boolean;
  status: "todo" | "done";
  body: string;
};
export const projects = [
  "Launch Orion",
  "Customer research",
  "Platform reliability",
  "Team operations",
  "Personal growth",
];
export function seed(): Item[] {
  const items: Item[] = [];
  for (let day = 0; day < 730; day++) {
    const d = new Date(Date.UTC(2026, 0, 1 + day)),
      date = d.toISOString().slice(0, 10),
      weekday = d.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let i = 0; i < 4; i++)
      items.push({
        id: `event-${date}-${i}`,
        kind: "event",
        title: [
          "Team standup",
          "Customer sync",
          "Lunch / recharge",
          "Project review",
        ][i],
        project: projects[(day + i) % 5],
        priority: 2,
        date,
        start: [9, 11, 12, 15][i] * 60,
        duration: [30, 45, 60, 30][i],
        fixed: i === 0 || i === 2,
        status: "todo",
        body: "Synthetic calendar fixture. All times are UTC. Fixed events are protected during replanning.",
      });
    for (let i = 0; i < 8; i++)
      items.push({
        id: `task-${date}-${i}`,
        kind: "task",
        title: `${
          [
            "Write launch brief",
            "Review customer feedback",
            "Fix reliability regression",
            "Draft weekly update",
            "Prepare product demo",
            "Review design proposal",
            "Triage backlog",
            "Document API decisions",
          ][i]
        } · ${projects[(day + i) % 5]}`,
        project: projects[(day + i) % 5],
        priority: 1 + ((day + i) % 3),
        date,
        start: 0,
        duration: [60, 45, 90, 30][i % 4],
        fixed: false,
        status: "todo",
        body: `Dummy task ${day * 8 + i}. Due ${date}. ${
          i % 3 === 0
            ? "Needs uninterrupted focus."
            : "Can be moved around meetings."
        }`,
      });
    for (let i = 0; i < 12; i++)
      items.push({
        id: `email-${date}-${i}`,
        kind: "email",
        title: `${
          [
            "Customer deadline moved",
            "Launch decision needed",
            "Feedback from pilot",
            "Weekly team digest",
          ][i % 4]
        } · ${projects[(day + i) % 5]}`,
        project: projects[(day + i) % 5],
        priority: 1 + (i % 3),
        date,
        start: 0,
        duration: 0,
        fixed: false,
        status: "todo",
        body: `From: teammate${i}@example.test. Synthetic message for ${date}. ${
          i % 4 === 0
            ? "Please prioritize the customer deliverable before Friday."
            : "Background context; no immediate action required."
        }`,
      });
  }
  return items;
}
export const fixtures = seed();
export const today = () => new Date().toISOString().slice(0, 10);
export function weekDates(date: string) {
  const d = new Date(date + "T00:00:00Z");
  const offset = (d.getUTCDay() + 6) % 7;
  return Array.from({ length: 5 }, (_, i) =>
    new Date(+d + (i - offset) * 86400000).toISOString().slice(0, 10)
  );
}
export function overlap(a: Item, b: Item) {
  return (
    a.date === b.date &&
    a.start < b.start + b.duration &&
    b.start < a.start + a.duration
  );
}
export function planWeek(
  items: Item[],
  week: string,
  priorities: string[],
  focusMinutes = 90
) {
  const days = weekDates(week);
  const scheduled = items.filter(
    (x) =>
      x.kind !== "email" &&
      x.start > 0 &&
      days.includes(x.date) &&
      !(x.kind === "task" && !x.fixed && x.status === "todo")
  );
  const tasks = items
    .filter(
      (x) =>
        x.kind === "task" &&
        x.status === "todo" &&
        x.date <= days[4] &&
        x.date >= days[0] &&
        !x.fixed
    )
    .sort((a, b) => {
      const rank = (x: Item) => {
        const i = priorities.findIndex((p) =>
          x.project.toLowerCase().includes(p.toLowerCase())
        );
        return i < 0 ? 100 : i;
      };
      return (
        rank(a) - rank(b) || a.priority - b.priority || a.id.localeCompare(b.id)
      );
    });
  const changes: Item[] = [],
    unscheduled: string[] = [];
  for (const task of tasks) {
    let placed = false;
    for (const date of days) {
      for (let start = 9 * 60; start + task.duration <= 17 * 60; start += 15) {
        const candidate = { ...task, date, start };
        if (task.duration > focusMinutes) continue;
        if (!scheduled.some((x) => overlap(x, candidate))) {
          scheduled.push(candidate);
          changes.push(candidate);
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      changes.push({ ...task, start: 0 });
      unscheduled.push(task.id);
    }
  }
  return {
    changes,
    unscheduled,
    scheduled: scheduled.sort(
      (a, b) => a.date.localeCompare(b.date) || a.start - b.start
    ),
    capacity_minutes: days.length * 8 * 60,
    assumptions: [
      "UTC timezone",
      "Work hours 09:00–17:00",
      "Fixed meetings and lunch preserved",
      "Tasks outside the selected week are excluded",
      "No meetings moved automatically",
    ],
    focus_minutes: focusMinutes,
  };
}
