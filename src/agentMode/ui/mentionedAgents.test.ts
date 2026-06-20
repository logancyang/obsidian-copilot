import {
  EMPTY_AGENT_BRANDS,
  isFanout,
  listInstalledAgentBrands,
  resolveMentionedAgents,
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
  it("offers only installed (ready) backends, projected to brands", () => {
    mockedList.mockReturnValue([
      descriptor("opencode", { kind: "ready", source: "managed" }),
      descriptor("claude", { kind: "absent" }),
      descriptor("codex", { kind: "ready", source: "custom" }),
    ]);

    const brands = listInstalledAgentBrands(settings);

    expect(brands.map((b) => b.id)).toEqual(["opencode", "codex"]);
    expect(brands[0]).toMatchObject({ id: "opencode", displayName: "Opencode", Icon });
  });

  it("excludes errored backends", () => {
    mockedList.mockReturnValue([
      descriptor("opencode", { kind: "ready", source: "managed" }),
      descriptor("claude", { kind: "error", message: "boom" }),
    ]);

    expect(listInstalledAgentBrands(settings).map((b) => b.id)).toEqual(["opencode"]);
  });

  it("returns the frozen empty constant when nothing is installed", () => {
    mockedList.mockReturnValue([descriptor("opencode", { kind: "absent" })]);
    expect(listInstalledAgentBrands(settings)).toBe(EMPTY_AGENT_BRANDS);
  });
});

describe("resolveMentionedAgents", () => {
  const installed = new Set(["opencode", "claude", "codex"]);

  it("includes the main agent first even when nothing is mentioned", () => {
    expect(
      resolveMentionedAgents({
        mainAgentId: "opencode",
        mentionedAgentIds: [],
        installedAgentIds: installed,
      })
    ).toEqual(["opencode"]);
  });

  it("prepends the main agent and appends mentions in order", () => {
    expect(
      resolveMentionedAgents({
        mainAgentId: "opencode",
        mentionedAgentIds: ["claude", "codex"],
        installedAgentIds: installed,
      })
    ).toEqual(["opencode", "claude", "codex"]);
  });

  it("dedupes the main agent when it is explicitly mentioned", () => {
    expect(
      resolveMentionedAgents({
        mainAgentId: "opencode",
        mentionedAgentIds: ["opencode", "claude"],
        installedAgentIds: installed,
      })
    ).toEqual(["opencode", "claude"]);
  });

  it("dedupes repeated mentions", () => {
    expect(
      resolveMentionedAgents({
        mainAgentId: "opencode",
        mentionedAgentIds: ["claude", "claude"],
        installedAgentIds: installed,
      })
    ).toEqual(["opencode", "claude"]);
  });

  it("drops mentions of uninstalled agents", () => {
    expect(
      resolveMentionedAgents({
        mainAgentId: "opencode",
        mentionedAgentIds: ["claude", "ghost"],
        installedAgentIds: new Set(["opencode", "claude"]),
      })
    ).toEqual(["opencode", "claude"]);
  });
});

describe("isFanout", () => {
  it("is false for the single main-agent path", () => {
    expect(isFanout(["opencode"])).toBe(false);
  });

  it("is true once another agent is included", () => {
    expect(isFanout(["opencode", "claude"])).toBe(true);
  });
});
