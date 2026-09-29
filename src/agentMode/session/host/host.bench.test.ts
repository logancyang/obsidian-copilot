import fs from "fs";
import path from "path";
import {
  buildHost,
  FakeManager,
  makeTestSession,
  settle,
} from "@/agentMode/session/host/hostTestHarness";
import { SYNTHETIC_BACKEND_STATE } from "@/agentMode/session/host/scriptRunner";
import type { ScriptStep, SessionScript } from "@/agentMode/session/host/sessionScript";
import type { SessionUpdate } from "@/agentMode/session/types";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const REPEATS = Number(process.env.BENCH_REPEATS ?? 60);
const RUNS = 5;

function recordedScripts(): SessionUpdate[][] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".script.json"))
    .sort()
    .map((name) => {
      const script = JSON.parse(
        fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")
      ) as SessionScript;
      return script.steps
        .filter((step): step is Extract<ScriptStep, { step: "event" }> => step.step === "event")
        .map((step) => step.update);
    });
}

function longTurn(): SessionUpdate[] {
  const scripts = recordedScripts();
  const turn: SessionUpdate[] = [];
  for (let round = 0; round < REPEATS; round++) {
    for (const [index, events] of scripts.entries()) {
      for (const update of events) {
        turn.push(
          JSON.parse(
            JSON.stringify(update, (key, value: unknown) =>
              /Id$/.test(key) && typeof value === "string" ? `${value}-f${index}-r${round}` : value
            )
          ) as SessionUpdate
        );
      }
    }
  }
  return turn;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

interface Sample {
  perEventMicros: number[];
  cpuMs: number;
  frames: number;
  bytesPerFrame: number;
}

async function replay(
  mode: "none" | "reference" | "serialized",
  turn: SessionUpdate[]
): Promise<Sample> {
  const manager = new FakeManager();
  const { session, backend } = makeTestSession("s1");
  manager.add(session);
  backend.emit({
    sessionId: "acp-s1",
    update: { sessionUpdate: "state_changed", state: SYNTHETIC_BACKEND_STATE },
  });
  let frames = 0;
  let bytes = 0;
  if (mode !== "none") {
    const host = buildHost(manager);
    const { client, transport } = host.createClient({ serialize: mode === "serialized" });
    transport.onFrame((frame) => {
      if (frame.type !== "ops") return;
      frames += 1;
      if (mode === "serialized") bytes += JSON.stringify(frame).length;
    });
    client.watchSession("s1");
    await settle();
  }
  backend.holdPrompt();
  session.sendPrompt("bench");
  await settle();

  const perEventMicros: number[] = [];
  const cpuStart = process.cpuUsage();
  for (const [index, update] of turn.entries()) {
    const start = process.hrtime.bigint();
    backend.emit({ sessionId: "acp-s1", update });
    perEventMicros.push(Number(process.hrtime.bigint() - start) / 1000);
    if (index % 50 === 49) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
  await settle();
  const cpu = process.cpuUsage(cpuStart);
  return {
    perEventMicros: perEventMicros.sort((a, b) => a - b),
    cpuMs: (cpu.user + cpu.system) / 1000,
    frames,
    bytesPerFrame: frames > 0 ? bytes / frames : 0,
  };
}

const bench = process.env.BENCH === "1" ? describe : describe.skip;

bench("host.bench", () => {
  it("reports the streaming cost of the host with and without serialization", async () => {
    const turn = longTurn();
    const rows: Record<string, unknown>[] = [];
    const medians = new Map<string, Sample>();
    await replay("none", turn.slice(0, 2000));
    for (const mode of ["none", "reference", "serialized"] as const) {
      const samples: Sample[] = [];
      for (let run = 0; run < RUNS; run++) samples.push(await replay(mode, turn));
      samples.sort((a, b) => a.cpuMs - b.cpuMs);
      const median = samples[Math.floor(RUNS / 2)];
      medians.set(mode, median);
      rows.push({
        mode,
        events: turn.length,
        emitP50Micros: +percentile(median.perEventMicros, 0.5).toFixed(1),
        emitP99Micros: +percentile(median.perEventMicros, 0.99).toFixed(1),
        turnCpuMs: +median.cpuMs.toFixed(0),
        frames: median.frames,
        meanBytesPerFrame: Math.round(median.bytesPerFrame),
      });
    }
    const base = medians.get("none")!;
    for (const mode of ["reference", "serialized"] as const) {
      const sample = medians.get(mode)!;
      rows.push({
        mode: `${mode} minus none`,
        addedEmitP50Micros: +(
          percentile(sample.perEventMicros, 0.5) - percentile(base.perEventMicros, 0.5)
        ).toFixed(1),
        addedEmitP99Micros: +(
          percentile(sample.perEventMicros, 0.99) - percentile(base.perEventMicros, 0.99)
        ).toFixed(1),
        addedCpuMsForTurn: +(sample.cpuMs - base.cpuMs).toFixed(0),
        addedCpuMicrosPerEvent: +(((sample.cpuMs - base.cpuMs) * 1000) / turn.length).toFixed(1),
      });
    }
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    expect(rows.length).toBe(5);
  }, 600000);
});
