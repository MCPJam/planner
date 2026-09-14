import { describe, it, expect } from "vitest";
import { snapStart, proposedIssue, minutes } from "../ui/scheduling";
import { fixtures } from "../src/data";
const task = fixtures.find((x) => x.id === "task-2026-09-14-0")!;
describe("Calendar proposals", () => {
  it("snaps to 15 minutes and retains the grabbed position within an event", () => {
    expect(snapStart(280, 100, 576, 60)).toBe(690);
    expect(snapStart(280, 100, 576, 60, 30)).toBe(660);
  });
  it("keeps the entire event in the workday", () => {
    expect(snapStart(-20, 100, 576, 60)).toBe(540);
    expect(snapStart(900, 100, 576, 90)).toBe(930);
  });
  it("flags conflicts before a user confirms but excludes the original event", () => {
    expect(proposedIssue({ ...task, start: 540 }, fixtures)).toContain(
      "Team standup"
    );
    const proposed = { ...task, start: 600 };
    expect(proposedIssue(proposed, [proposed])).toBe("");
  });
  it("accepts adjacent events and rejects invalid durations and dates", () => {
    expect(proposedIssue({ ...task, start: 600, duration: 60 }, fixtures)).toBe(
      ""
    );
    expect(
      proposedIssue({ ...task, start: 600, duration: 0 }, fixtures)
    ).toContain("duration");
    expect(
      proposedIssue({ ...task, start: 600, date: "2026-09-19" }, fixtures)
    ).toContain("weekday");
    expect(
      proposedIssue({ ...task, start: 990, duration: 60 }, fixtures)
    ).toContain("17:00");
  });
  it("keeps invalid empty time input out of proposals", () => {
    expect(minutes("10:15")).toBe(615);
    expect(Number.isNaN(minutes(""))).toBe(true);
  });
});
