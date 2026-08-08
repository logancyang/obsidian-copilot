import {
  EMPTY_AGENT_BRANDS,
  EMPTY_ANSWERERS,
  isFanout,
  listInstalledAgentBrands,
  resolveAnswerers,
  useInstalledAgentBrands,
} from "@/agentMode/ui/mentionedAgents";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import { act, renderHook } from "@testing-library/react";

const Icon = () => null;

jest.mock("@/agentMode/backends/registry", () => ({
  listBackendDescriptors: jest.fn(),
  backendNeedsSelfHostWarning: (
    descriptor: { selfHostable?: boolean },
    settings: { enableSelfHostMode?: boolean }
  ) => Boolean(settings.enableSelfHostMode) && !descriptor.selfHostable,
}));

jest.mock("@/settings/model", () => ({
  useSettingsValue: () => ({}),
}));

import { listBackendDescriptors } from "@/agentMode/backends/registry";

const mockedList = listBackendDescriptors as jest.MockedFunction<typeof listBackendDescriptors>;

function descriptor(id: string, install: InstallState, selfHostable = true): BackendDescriptor {
  return {
    id,
    displayName: id[0].toUpperCase() + id.slice(1),
    Icon,
    selfHostable,
    getInstallState: () => install,
  } as unknown as BackendDescriptor;
}

const settings = {} as CopilotSettings;
const selfHostSettings = { enableSelfHostMode: true } as CopilotSettings;

describe("listInstalledAgentBrands", () => {
  it("offers only ready backends; excludes absent, checking, incompatible, and errored", () => {
    mockedList.mockReturnValue([
      descriptor("opencode", { kind: "ready", source: "managed" }),
      descriptor("claude", { kind: "absent" }),
      descriptor("codex", { kind: "error", message: "boom" }),
      descriptor("checking", { kind: "checking", source: "custom" }),
      descriptor("old", {
        kind: "incompatible",
        source: "custom",
        currentVersion: "1.0.0",
        minVersion: "2.0.0",
        message: "too old",
      }),
    ]);

    const brands = listInstalledAgentBrands(settings);
    expect(brands.map((b) => b.id)).toEqual(["opencode"]);
    expect(brands[0]).toMatchObject({ id: "opencode", displayName: "Opencode", Icon });
  });

  it("returns the frozen empty constant when nothing is installed", () => {
    mockedList.mockReturnValue([descriptor("opencode", { kind: "absent" })]);
    expect(listInstalledAgentBrands(settings)).toBe(EMPTY_AGENT_BRANDS);
  });

  it("does not flag any brand when Self-Host Mode is off", () => {
    mockedList.mockReturnValue([
      descriptor("opencode", { kind: "ready", source: "managed" }, true),
      descriptor("claude", { kind: "ready", source: "managed" }, false),
    ]);
    const byId = new Map(listInstalledAgentBrands(settings).map((b) => [b.id, b]));
    expect(byId.get("opencode")?.needsSelfHostWarning).toBe(false);
    expect(byId.get("claude")?.needsSelfHostWarning).toBe(false);
  });

  it("flags cloud agents (not opencode) when Self-Host Mode is on", () => {
    mockedList.mockReturnValue([
      descriptor("opencode", { kind: "ready", source: "managed" }, true),
      descriptor("claude", { kind: "ready", source: "managed" }, false),
      descriptor("codex", { kind: "ready", source: "managed" }, false),
    ]);
    const byId = new Map(listInstalledAgentBrands(selfHostSettings).map((b) => [b.id, b]));
    expect(byId.get("opencode")?.needsSelfHostWarning).toBe(false);
    expect(byId.get("claude")?.needsSelfHostWarning).toBe(true);
    expect(byId.get("codex")?.needsSelfHostWarning).toBe(true);
  });
});

describe("useInstalledAgentBrands", () => {
  it("re-lists a backend whose readiness settles without a settings write", () => {
    let install: InstallState = { kind: "checking", source: "managed" };
    const listeners = new Set<() => void>();
    mockedList.mockReturnValue([
      {
        id: "claude",
        displayName: "Claude",
        Icon,
        getInstallState: () => install,
        subscribeInstallState: (_plugin: CopilotPlugin, cb: () => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      } as unknown as BackendDescriptor,
    ]);

    const { result, unmount } = renderHook(() => useInstalledAgentBrands({} as CopilotPlugin));
    expect(result.current).toBe(EMPTY_AGENT_BRANDS);

    // The compatibility probe settles ready — no settings write involved.
    act(() => {
      install = { kind: "ready", source: "managed" };
      listeners.forEach((cb) => cb());
    });
    expect(result.current.map((b) => b.id)).toEqual(["claude"]);

    unmount();
    expect(listeners.size).toBe(0);
  });
});

describe("resolveAnswerers", () => {
  const installed = new Set(["opencode", "claude", "codex"]);

  it("returns the frozen empty constant when nothing is mentioned (main is NOT auto-included)", () => {
    expect(resolveAnswerers({ mentionedAgentIds: [], installedAgentIds: installed })).toBe(
      EMPTY_ANSWERERS
    );
  });

  it("returns mentions in order (keeping an explicitly-mentioned main), dedup'd", () => {
    expect(
      resolveAnswerers({
        mentionedAgentIds: ["claude", "opencode", "claude"],
        installedAgentIds: installed,
      })
    ).toEqual(["claude", "opencode"]);
  });

  it("drops mentions of uninstalled agents", () => {
    expect(
      resolveAnswerers({
        mentionedAgentIds: ["claude", "ghost"],
        installedAgentIds: new Set(["opencode", "claude"]),
      })
    ).toEqual(["claude"]);
  });
});

describe("isFanout", () => {
  // Claude is the session main agent in these cases.
  it("routes single-vs-fan-out: collapses to single-agent only when no non-main answerer exists", () => {
    // No answerers, or the only answerer IS the main agent → single-agent.
    expect(isFanout([], "claude")).toBe(false);
    expect(isFanout(["claude"], "claude")).toBe(false);
    // A non-main answerer (alone or with others) → fan-out, main summarizes.
    expect(isFanout(["opencode"], "claude")).toBe(true);
    expect(isFanout(["opencode", "codex"], "claude")).toBe(true);
    expect(isFanout(["claude", "opencode"], "claude")).toBe(true);
  });
});
