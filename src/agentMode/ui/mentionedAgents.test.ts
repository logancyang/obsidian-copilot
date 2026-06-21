import {
  EMPTY_AGENT_BRANDS,
  EMPTY_ANSWERERS,
  isFanout,
  listInstalledAgentBrands,
  resolveAnswerers,
} from "@/agentMode/ui/mentionedAgents";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";

const Icon = () => null;

jest.mock("@/agentMode/backends/registry", () => ({
  listBackendDescriptors: jest.fn(),
}));

import { listBackendDescriptors } from "@/agentMode/backends/registry";

const mockedList = listBackendDescriptors as jest.MockedFunction<typeof listBackendDescriptors>;

function descriptor(id: string, install: InstallState): BackendDescriptor {
  return {
    id,
    displayName: id[0].toUpperCase() + id.slice(1),
    Icon,
    getInstallState: () => install,
  } as unknown as BackendDescriptor;
}

const settings = {} as CopilotSettings;

describe("listInstalledAgentBrands", () => {
  it("offers only installed (ready) backends projected to brands; excludes absent/errored", () => {
    mockedList.mockReturnValue([
      descriptor("opencode", { kind: "ready", source: "managed" }),
      descriptor("claude", { kind: "absent" }),
      descriptor("codex", { kind: "error", message: "boom" }),
    ]);

    const brands = listInstalledAgentBrands(settings);
    expect(brands.map((b) => b.id)).toEqual(["opencode"]);
    expect(brands[0]).toMatchObject({ id: "opencode", displayName: "Opencode", Icon });
  });

  it("returns the frozen empty constant when nothing is installed", () => {
    mockedList.mockReturnValue([descriptor("opencode", { kind: "absent" })]);
    expect(listInstalledAgentBrands(settings)).toBe(EMPTY_AGENT_BRANDS);
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
