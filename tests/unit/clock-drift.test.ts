import { describe, expect, it } from "vitest";
import { matchReasonAllowingClockDrift } from "../e2e/clock-drift";

// The e2e "Delivery risk detection" test compares risk reasons read from the API with the
// pages that show them. The reasons contain durations computed from the current time, so
// these cases pin down exactly how much the comparison tolerates, and no more.

const t0 = Date.parse("2026-11-20T13:33:00Z");
const reason = "Projected to arrive 2 h 4 min after the expected time";

describe("matchReasonAllowingClockDrift", () => {
  it("accepts the exact text", () => {
    expect(matchReasonAllowingClockDrift(`High risk\n${reason}\nRule-based estimate`, reason, t0, t0 + 2_000)).toBeNull();
  });

  it("accepts the CI failure case: a minute boundary passed between the API read and the page", () => {
    // First CI run, 20 Nov 2026: the page showed 2 h 5 min, 26 s after the API said 2 h 4 min.
    const page = "Projected to arrive 2 h 5 min after the expected time";
    expect(matchReasonAllowingClockDrift(page, reason, t0, t0 + 26_000)).toBeNull();
  });

  it("accepts a crossing from minutes into hours", () => {
    expect(matchReasonAllowingClockDrift("Pickup is 1 h overdue", "Pickup is 59 min overdue", t0, t0 + 30_000)).toBeNull();
  });

  it("rejects a drift larger than the time that actually passed", () => {
    const page = "Projected to arrive 2 h 30 min after the expected time";
    expect(matchReasonAllowingClockDrift(page, reason, t0, t0 + 30_000)).toMatch(/differs .* by 26 min/);
  });

  it("rejects different wording, even with the same duration", () => {
    expect(matchReasonAllowingClockDrift("Only 2 h 4 min of buffer before the expected time", reason, t0, t0 + 1_000)).toMatch(/no text/);
  });

  it("keeps numbers that are not durations exact", () => {
    const r = "Past deliveries have taken about 25% longer than estimated";
    expect(matchReasonAllowingClockDrift(r, r, t0, t0 + 120_000)).toBeNull();
    expect(matchReasonAllowingClockDrift("Past deliveries have taken about 26% longer than estimated", r, t0, t0 + 120_000)).toMatch(/not found/);
  });

  it("checks every duration in a reason", () => {
    const r = "Scheduled start passed 45 min ago and no driver is assigned";
    expect(matchReasonAllowingClockDrift("Scheduled start passed 46 min ago and no driver is assigned", r, t0, t0 + 10_000)).toBeNull();
    expect(matchReasonAllowingClockDrift("Scheduled start passed 50 min ago and no driver is assigned", r, t0, t0 + 10_000)).toMatch(/differs/);
  });
});
