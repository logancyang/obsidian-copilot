import { buildBackendSummary } from "@/agentMode/protocol/testBuilders";
import {
  AgentPaneCapabilitiesProvider,
  NO_PANE_CAPABILITIES,
} from "@/agentMode/ui/AgentPaneContext";
import { createFixtureClient } from "@/agentMode/ui/agentPane.fixtures";
import { useAgentBrands } from "@/agentMode/ui/hooks/useAgentBrands";
import { EMPTY_AGENT_MENTION_BRANDS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { act, renderHook } from "@testing-library/react";
import React from "react";

const ClaudeIcon = () => null;

function rig(backends: ReturnType<typeof buildBackendSummary>[], icons = true) {
  const fixture = createFixtureClient({ sessionId: "s1", host: { backends } });
  const capabilities = {
    ...NO_PANE_CAPABILITIES,
    backendIcon: icons ? (id: string) => (id === "claude" ? ClaudeIcon : undefined) : undefined,
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AgentPaneCapabilitiesProvider value={capabilities}>{children}</AgentPaneCapabilitiesProvider>
  );
  return {
    fixture,
    hook: renderHook(() => useAgentBrands(fixture.client), { wrapper }),
  };
}

describe("useAgentBrands", () => {
  describe("useAgentBrands()", () => {
    it("offers only agents the host reports ready, with their names, icons and self-host warning", () => {
      const { hook } = rig([
        buildBackendSummary({ id: "claude", displayName: "Claude Code", selfHostWarning: true }),
        buildBackendSummary({ id: "codex", displayName: "Codex", readiness: "not_set_up" }),
      ]);
      expect(hook.result.current.installed).toEqual([
        {
          id: "claude",
          displayName: "Claude Code",
          Icon: ClaudeIcon,
          needsSelfHostWarning: true,
        },
      ]);
    });

    it("falls back to a generic icon for an agent the environment has no icon for", () => {
      const { hook } = rig([buildBackendSummary({ id: "codex", displayName: "Codex" })]);
      expect(hook.result.current.installed[0].Icon).toBeDefined();
      expect(hook.result.current.installed[0].Icon).not.toBe(ClaudeIcon);
    });

    it("returns the shared empty list when no agent is ready", () => {
      const { hook } = rig([buildBackendSummary({ id: "claude", readiness: "checking" })]);
      expect(hook.result.current.installed).toBe(EMPTY_AGENT_MENTION_BRANDS);
    });

    it("lists the agents whose models run in the cloud", () => {
      const { hook } = rig([
        buildBackendSummary({ id: "claude", selfHostable: false }),
        buildBackendSummary({ id: "opencode", selfHostable: true }),
      ]);
      expect([...hook.result.current.cloudAgentIds]).toEqual(["claude"]);
    });

    it("follows an agent becoming ready as the host's catalog changes", () => {
      const { fixture, hook } = rig([buildBackendSummary({ id: "claude", readiness: "checking" })]);
      expect(hook.result.current.installed).toEqual([]);
      act(() => {
        fixture.emitHost({
          t: "backend.set",
          index: 0,
          backend: buildBackendSummary({ id: "claude", readiness: "ready" }),
        });
      });
      expect(hook.result.current.installed.map((brand) => brand.id)).toEqual(["claude"]);
    });

    it("returns the same lists while the catalog is unchanged", () => {
      const { hook } = rig([buildBackendSummary({ id: "claude" })]);
      const first = hook.result.current;
      hook.rerender();
      expect(hook.result.current).toBe(first);
    });
  });
});
