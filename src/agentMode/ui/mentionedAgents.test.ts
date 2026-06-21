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

describe("resolveAnswerers", () => {
  const installed = new Set(["opencode", "claude", "codex"]);

  it("returns the frozen empty constant when nothing is mentioned (main is NOT auto-included)", () => {
    expect(
      resolveAnswerers({
        mentionedAgentIds: [],
        installedAgentIds: installed,
      })
    ).toBe(EMPTY_ANSWERERS);
  });

  it("returns the mentions in order, without the main agent", () => {
    expect(
      resolveAnswerers({
        mentionedAgentIds: ["claude", "codex"],
        installedAgentIds: installed,
      })
    ).toEqual(["claude", "codex"]);
  });

  it("keeps the main agent when it is explicitly mentioned (it then answers too)", () => {
    expect(
      resolveAnswerers({
        mentionedAgentIds: ["claude", "opencode"],
        installedAgentIds: installed,
      })
    ).toEqual(["claude", "opencode"]);
  });

  it("dedupes repeated mentions", () => {
    expect(
      resolveAnswerers({
        mentionedAgentIds: ["claude", "claude"],
        installedAgentIds: installed,
      })
    ).toEqual(["claude"]);
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
  it("is false for no answerers (no qualifying mentions)", () => {
    expect(isFanout([], "claude")).toBe(false);
  });

  it("is false when the ONLY answerer is the main agent (@claude foo collapses to single-agent)", () => {
    expect(isFanout(["claude"], "claude")).toBe(false);
  });

  it("is true for a single non-main answerer (@opencode → opencode answers, Claude summarizes)", () => {
    expect(isFanout(["opencode"], "claude")).toBe(true);
  });

  it("is true for multiple answerers (@opencode @codex → both answer, Claude summarizes)", () => {
    expect(isFanout(["opencode", "codex"], "claude")).toBe(true);
  });

  it("is true when the main agent is one of several answerers (@claude @opencode)", () => {
    expect(isFanout(["claude", "opencode"], "claude")).toBe(true);
  });
});
