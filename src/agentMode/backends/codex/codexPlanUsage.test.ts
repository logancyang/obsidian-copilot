import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { PlanUsageReading, UsageWindow } from "@/agentMode/session/planUsage";
import { lastRateLimits, planUsageFromCodexRateLimits, readCodexPlanUsage } from "./codexPlanUsage";

jest.mock("@/logger", () => ({ logInfo: jest.fn() }));

const UNAVAILABLE: PlanUsageReading = { kind: "unavailable" };

/** The windows of a usage reading, or the empty list for any other kind. */
function windowsOf(reading: PlanUsageReading): UsageWindow[] {
  return reading.kind === "usage" ? reading.planUsage.windows : [];
}

describe("codexPlanUsage", () => {
  describe("planUsageFromCodexRateLimits()", () => {
    /** The `rate_limits` object from a real Codex rollout, on a Pro account. */
    const LIVE_PRO_SNAPSHOT = {
      limit_id: "codex",
      limit_name: null,
      primary: { used_percent: 13.0, window_minutes: 10_080, resets_at: 1_787_196_738 },
      secondary: null,
      credits: { has_credits: false, unlimited: false, balance: "0" },
      plan_type: "pro",
    };

    it("reads the single weekly window a Pro account reports", () => {
      // Codex fills `primary` with whatever window the plan has, so on this account the
      // weekly cap arrives in the slot other plans use for a shorter one. Naming the row
      // after the slot would have labelled this "5h".
      const reading = planUsageFromCodexRateLimits(LIVE_PRO_SNAPSHOT, 1_000);

      expect(reading).toEqual({
        kind: "usage",
        planUsage: {
          windows: [{ id: "primary", label: "Weekly", percent: 13.0, resetsAt: 1_787_196_738_000 }],
          updatedAt: 1_000,
        },
      });
    });

    it("reads both windows when the plan caps two", () => {
      const reading = planUsageFromCodexRateLimits({
        primary: { used_percent: 42, window_minutes: 300, resets_at: 1_787_196_738 },
        secondary: { used_percent: 8, window_minutes: 10_080, resets_at: 1_787_800_000 },
      });

      expect(windowsOf(reading).map((w) => [w.label, w.percent])).toEqual([
        ["5h", 42],
        ["Weekly", 8],
      ]);
    });

    it.each([
      ["a five-hour window", 300, "5h"],
      ["a weekly window", 10_080, "Weekly"],
      ["a daily window", 1440, "1d"],
      ["a fortnight", 20_160, "14d"],
      ["a sub-hour window", 45, "45m"],
      ["an odd duration", 90, "90m"],
    ])("labels %s", (_label, windowMinutes, expected) => {
      const reading = planUsageFromCodexRateLimits({
        primary: { used_percent: 1, window_minutes: windowMinutes },
      });

      expect(windowsOf(reading)[0]?.label).toBe(expected);
    });

    it("keeps a percentage above 100 for an account served past its cap", () => {
      const reading = planUsageFromCodexRateLimits({
        primary: { used_percent: 118, window_minutes: 10_080 },
      });

      expect(windowsOf(reading)[0]?.percent).toBe(118);
    });

    it("keeps the window when its reset is missing", () => {
      const reading = planUsageFromCodexRateLimits({
        primary: { used_percent: 13, window_minutes: 10_080, resets_at: null },
      });

      expect(windowsOf(reading)[0]?.resetsAt).toBeUndefined();
    });

    it("drops a window whose duration it cannot name", () => {
      // A percentage with no window is a number with no meaning attached; rendering it
      // would put an unlabelled row in front of the user.
      const reading = planUsageFromCodexRateLimits({
        primary: { used_percent: 13, window_minutes: null },
        secondary: { used_percent: 8, window_minutes: 10_080 },
      });

      expect(windowsOf(reading).map((w) => w.id)).toEqual(["secondary"]);
    });

    it.each([
      ["a failed read", null],
      ["a snapshot with no windows", {}],
      ["windows the plan does not cap", { primary: null, secondary: null }],
      ["a window with no percentage", { primary: { window_minutes: 10_080 } }],
    ])(
      "reports %s unavailable rather than clearing the meters (https://github.com/logancyang/obsidian-copilot-preview/issues/193)",
      (_label, limits) => {
        // A rollout can never affirm that an account is unmetered, so an empty snapshot
        // is the absence of news, never a statement that clears a meter.
        expect(planUsageFromCodexRateLimits(limits as never)).toEqual(UNAVAILABLE);
      }
    );
  });

  describe("readCodexPlanUsage()", () => {
    /**
     * A future reset, because the reader drops windows whose recorded reset has passed
     * — a fixed instant here would expire and start failing these tests on real time.
     */
    const RESETS_AT_SECONDS = Math.floor(Date.now() / 1000) + 3_600;

    /** A `token_count` event as Codex appends it, trimmed to the fields this reads. */
    function tokenCountLine(
      usedPercent: number,
      windowMinutes = 10_080,
      resetsAt = RESETS_AT_SECONDS
    ): string {
      return JSON.stringify({
        timestamp: "2026-08-15T04:39:03.544Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { model_context_window: 258_400 },
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: usedPercent,
              window_minutes: windowMinutes,
              resets_at: resetsAt,
            },
            secondary: null,
          },
        },
      });
    }

    let codexHome: string;

    beforeEach(() => {
      codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-plan-usage-"));
    });

    afterEach(() => {
      fs.rmSync(codexHome, { recursive: true, force: true });
    });

    /** Write a rollout under `sessions/<day>/`, optionally stamping its modification time. */
    function writeRollout(day: string, name: string, lines: string[], mtime?: Date): string {
      const dir = path.join(codexHome, "sessions", ...day.split("/"));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name);
      fs.writeFileSync(file, lines.join("\n") + "\n");
      if (mtime) fs.utimesSync(file, mtime, mtime);
      return file;
    }

    it("reads the newest rate limits from the rollout", async () => {
      writeRollout("2026/08/14", "rollout-2026-08-14T21-38-38-abc.jsonl", [
        tokenCountLine(11),
        tokenCountLine(13),
      ]);

      const reading = await readCodexPlanUsage(codexHome);

      expect(windowsOf(reading)).toEqual([
        { id: "primary", label: "Weekly", percent: 13, resetsAt: RESETS_AT_SECONDS * 1000 },
      ]);
    });

    it("takes the most recently written rollout, not the most recently dated directory", async () => {
      // A session opened yesterday and still running now keeps appending to yesterday's
      // directory, so the newest numbers can sit behind an older-looking path.
      writeRollout(
        "2026/09/01",
        "rollout-2026-09-01T00-05-00-new.jsonl",
        [tokenCountLine(4)],
        new Date("2026-09-01T00:05:00Z")
      );
      writeRollout(
        "2026/08/31",
        "rollout-2026-08-31T09-00-00-old.jsonl",
        [tokenCountLine(37)],
        new Date("2026-09-01T22:00:00Z")
      );

      const reading = await readCodexPlanUsage(codexHome);

      expect(windowsOf(reading)[0]?.percent).toBe(37);
    });

    it("reports a snapshot whose recorded reset has passed unavailable (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
      // A rollout can be arbitrarily old. After a long idle, presenting the finished
      // period's 95% as current would be worse than showing nothing.
      writeRollout("2026/08/10", "rollout-2026-08-10T10-00-00-idle.jsonl", [
        tokenCountLine(95, 10_080, Math.floor(Date.now() / 1000) - 60),
      ]);

      await expect(readCodexPlanUsage(codexHome)).resolves.toEqual(UNAVAILABLE);
    });

    it("falls back past a rollout that has no limits recorded yet (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
      // Opening a chat creates a rollout holding only session metadata, and on a fresh
      // plugin start there is no in-memory snapshot to keep showing — the account's
      // last recorded caps live in the next-newest file.
      writeRollout(
        "2026/08/14",
        "rollout-2026-08-14T09-00-00-prior.jsonl",
        [tokenCountLine(13)],
        new Date("2026-08-14T09:00:00Z")
      );
      writeRollout(
        "2026/08/14",
        "rollout-2026-08-14T10-00-00-fresh.jsonl",
        [JSON.stringify({ type: "session_meta", payload: { id: "new-session" } })],
        new Date("2026-08-14T10:00:00Z")
      );

      const reading = await readCodexPlanUsage(codexHome);

      expect(windowsOf(reading)[0]?.percent).toBe(13);
    });

    it("still finds a session active for days behind newer day directories", async () => {
      // A rollout is filed under the day its session STARTED, so a chat kept open all
      // week appends to a directory several dates behind the newest one.
      for (let day = 11; day <= 14; day++) {
        writeRollout(
          `2026/08/${day}`,
          `rollout-2026-08-${day}T09-00-00-done.jsonl`,
          [tokenCountLine(day)],
          new Date(`2026-08-${day}T09:00:00Z`)
        );
      }
      writeRollout(
        "2026/08/10",
        "rollout-2026-08-10T08-00-00-active.jsonl",
        [tokenCountLine(55)],
        new Date("2026-08-14T23:00:00Z")
      );

      const reading = await readCodexPlanUsage(codexHome);

      expect(windowsOf(reading)[0]?.percent).toBe(55);
    });

    it("ignores files that are not rollouts", async () => {
      writeRollout("2026/08/14", "rollout-2026-08-14T10-00-00-real.jsonl", [tokenCountLine(13)]);
      writeRollout(
        "2026/08/14",
        "notes.jsonl",
        [tokenCountLine(99)],
        new Date("2026-12-01T00:00:00Z")
      );

      const reading = await readCodexPlanUsage(codexHome);

      expect(windowsOf(reading)[0]?.percent).toBe(13);
    });

    /** Filler wide enough that the head of the file falls outside the 256KB tail read. */
    function pastTheTail(): string[] {
      const line = JSON.stringify({
        type: "event_msg",
        payload: { type: "agent_message", text: "x".repeat(500) },
      });
      return Array.from({ length: 1200 }, () => line);
    }

    it("finds the limits at the end of a rollout larger than the tail read", async () => {
      const file = writeRollout("2026/08/14", "rollout-2026-08-14T10-00-00-big.jsonl", [
        ...pastTheTail(),
        tokenCountLine(13),
      ]);

      // The bound only means something if the file actually exceeds it.
      expect(fs.statSync(file).size).toBeGreaterThan(256 * 1024);
      const reading = await readCodexPlanUsage(codexHome);

      expect(windowsOf(reading)[0]?.percent).toBe(13);
    });

    it("does not read limits that fall outside the tail", async () => {
      // Rollouts reach megabytes and this runs at every attach and turn boundary, so the
      // read is bounded. Limits that old are stale anyway, and a stale number on a cap
      // meter is worse than no number.
      writeRollout("2026/08/14", "rollout-2026-08-14T10-00-00-old.jsonl", [
        tokenCountLine(13),
        ...pastTheTail(),
      ]);

      await expect(readCodexPlanUsage(codexHome)).resolves.toEqual(UNAVAILABLE);
    });

    it.each([
      ["Codex has never run here", () => undefined],
      [
        "the rollout carries no rate limits",
        () =>
          writeRollout("2026/08/14", "rollout-2026-08-14T10-00-00-quiet.jsonl", [
            JSON.stringify({ type: "event_msg", payload: { type: "agent_message" } }),
          ]),
      ],
      [
        "the rollout is unreadable",
        () => writeRollout("2026/08/14", "rollout-2026-08-14T10-00-00-bad.jsonl", ["{not json"]),
      ],
    ])("reports unavailable when %s", async (_label, setup) => {
      setup();

      await expect(readCodexPlanUsage(codexHome)).resolves.toEqual(UNAVAILABLE);
    });

    it("reports unavailable when the home directory does not exist", async () => {
      await expect(readCodexPlanUsage(path.join(codexHome, "nope"))).resolves.toEqual(UNAVAILABLE);
    });

    describe("lastRateLimits()", () => {
      it("skips a truncated leading line", () => {
        // The tail read starts mid-file, so the first line is normally a fragment.
        const tail = ['_count","rate_limits":{"primary"', tokenCountLine(13)].join("\n");

        expect(lastRateLimits(tail)?.primary?.used_percent).toBe(13);
      });

      it("returns null when no line carries rate limits", () => {
        expect(lastRateLimits('{"type":"event_msg"}\n')).toBeNull();
      });
    });
  });
});
