import { renderHook } from "@testing-library/react";
import {
  CREATE_AGENT_OPTION_KEY,
  useAtMentionSearch,
} from "@/components/chat-components/hooks/useAtMentionSearch";
import {
  NO_AGENT_MENTIONS,
  type AgentMentionState,
} from "@/components/chat-components/hooks/useAtMentionCategories";

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- these mock the real `use*` exports, so the names must match */
jest.mock("./useAllNotes", () => ({ useAllNotes: () => [] }));
jest.mock("./useAllFolders", () => ({ useAllFolders: () => [] }));
jest.mock("./useOpenWebTabs", () => ({ useOpenWebTabs: () => [] }));
jest.mock("./useActiveWebTabState", () => ({
  useActiveWebTabState: () => ({ activeWebTabForMentions: null }),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/settings/copilotFolder", () => ({
  getEffectiveCustomPromptsFolder: () => "copilot/prompts",
}));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => true }));

const jennifer = { slug: "jennifer", name: "Jennifer", description: "Cuts fluff.", icon: "🪶" };

function agentRows(agentMentions: AgentMentionState, query = "") {
  const { result } = renderHook(() =>
    useAtMentionSearch(query, "search", "agents", true, false, [], null, agentMentions)
  );
  return result.current;
}

describe("useAtMentionSearch", () => {
  describe("the Agents category", () => {
    it("lists each agent with its name, description and emoji", () => {
      const rows = agentRows({ entries: [jennifer], enabled: true });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        key: "agent-jennifer",
        title: "Jennifer",
        subtitle: "Cuts fluff.",
        category: "agents",
        data: "jennifer",
        pillIcon: "🪶",
      });
    });

    it("offers a create row instead of an empty list when the user has no agents yet", () => {
      // designdocs/CUSTOM_AGENTS.md §6 — fan-out has no answerers until an agent
      // exists, so the group is the way to make one rather than a dead end.
      const rows = agentRows({ entries: [], enabled: true, onCreateAgent: jest.fn() });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        key: CREATE_AGENT_OPTION_KEY,
        title: "Create an agent",
        isAction: true,
      });
    });

    it("offers nothing at all when the group is not enabled", () => {
      expect(agentRows(NO_AGENT_MENTIONS)).toEqual([]);
      expect(agentRows({ entries: [jennifer], enabled: false })).toEqual([]);
    });

    it("filters agents by name as the user keeps typing after the @", () => {
      expect(agentRows({ entries: [jennifer], enabled: true }, "jenn")).toHaveLength(1);
      expect(agentRows({ entries: [jennifer], enabled: true }, "zzz")).toHaveLength(0);
    });
  });
});
