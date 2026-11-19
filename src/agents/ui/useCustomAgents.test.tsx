import type { CustomAgent } from "@/agents/CustomAgentStore";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { fakeAgentStore } from "@/agents/ui/testing/fakeAgentStore";
import { useCustomAgents } from "@/agents/ui/useCustomAgents";
import { resetSettings } from "@/settings/model";
import { renderHook } from "@testing-library/react";

jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/938";

function agent(slug: string, name: string, faceSrc = `face:${slug}`): CustomAgent {
  return { slug, name, title: `${name}'s job`, faceSrc } as CustomAgent;
}

const COCO = agent("coco", "Coco");
const MAYA = agent("maya", "Maya");

describe("useCustomAgents", () => {
  beforeEach(() => resetSettings());

  describe("useCustomAgents()", () => {
    it("lists the store's agents while the license carries custom agents", async () => {
      await setCustomAgentsAccess("team");
      const { store } = fakeAgentStore([COCO, MAYA]);

      const { result } = renderHook(() => useCustomAgents(store));

      expect(result.current).toEqual([COCO, MAYA]);
    });

    it(`follows a new face or name the store lists, without a reload (${ISSUE})`, async () => {
      await setCustomAgentsAccess("team");
      const { store, publish } = fakeAgentStore([COCO]);
      const { result } = renderHook(() => useCustomAgents(store));

      const renamed = agent("coco", "Coco Chanel", "face:coco?v=2");
      publish([renamed]);

      expect(result.current).toEqual([renamed]);
    });

    it.each(["free", "plus-without-custom-agents", "unverified"] as const)(
      `lists no agents for a %s license, so every surface stays as it is without custom agents (${ISSUE})`,
      async (access) => {
        await setCustomAgentsAccess(access);
        const { store } = fakeAgentStore([COCO, MAYA]);

        const { result } = renderHook(() => useCustomAgents(store));

        expect(result.current).toEqual([]);
        expect(Object.isFrozen(result.current)).toBe(true);
      }
    );

    it("lists no agents when the plugin has no agent store", async () => {
      await setCustomAgentsAccess("team");

      const { result } = renderHook(() => useCustomAgents(undefined));

      expect(result.current).toEqual([]);
    });
  });
});
