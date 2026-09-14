import { describe, it, expect } from "vitest";
import { fixtures, planWeek, overlap, weekDates } from "../src/data";
describe("User outcomes", () => {
  it("has substantial deterministic data through 2027", () => {
    expect(fixtures.length).toBe(12528);
    expect(new Set(fixtures.map((x) => x.id)).size).toBe(fixtures.length);
    expect(fixtures.some((x) => x.date === "2027-12-31")).toBe(true);
  });
  it("plans realistic weeks without collisions and preserves protected commitments", () => {
    const plan = planWeek(fixtures, "2026-09-14", ["Launch Orion"]);
    expect(plan.changes.some((x) => x.start > 0)).toBe(true);
    expect(plan.unscheduled.length).toBeGreaterThan(0);
    for (const a of plan.scheduled) {
      expect(a.start).toBeGreaterThanOrEqual(540);
      expect(a.start + a.duration).toBeLessThanOrEqual(1020);
      for (const b of plan.scheduled)
        if (a.id !== b.id) expect(overlap(a, b)).toBe(false);
    }
    for (const x of fixtures.filter(
      (x) => x.fixed && weekDates("2026-09-14").includes(x.date)
    ))
      expect(plan.scheduled).toContainEqual(x);
  });
  it("prioritizes the requested project and returns the work that does not fit", () => {
    const plan = planWeek(fixtures, "2026-09-14", ["Customer research"]);
    expect(plan.changes[0].project).toBe("Customer research");
    expect(plan.changes.length).toBe(40);
    expect(plan.changes.filter((x) => x.start === 0).map((x) => x.id)).toEqual(
      plan.unscheduled
    );
  });
  it("is deterministic across fresh requests", () =>
    expect(planWeek(fixtures, "2027-05-12", [])).toEqual(
      planWeek(fixtures, "2027-05-12", [])
    ));
});
