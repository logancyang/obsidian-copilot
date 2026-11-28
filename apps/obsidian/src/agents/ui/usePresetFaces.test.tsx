import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { PRESET_FACES_URL } from "@/agents/presetFaces";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { webpBytes } from "@/agents/testing/webpBytes";
import { usePresetFaces } from "@/agents/ui/usePresetFaces";
import { renderHook, waitFor } from "@testing-library/react";
import * as obsidian from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/939";

const setRequestUrlImpl = (
  obsidian as unknown as { __setRequestUrlImpl: (impl: jest.Mock) => void }
).__setRequestUrlImpl;

const COCO_URL = "https://images.brevilabs.com/agent-faces/coco.webp";
const KAI_URL = "https://images.brevilabs.com/agent-faces/kai.webp";

function dataUri(bytes: ArrayBuffer): string {
  return `data:image/webp;base64,${btoa(String.fromCharCode(...new Uint8Array(bytes)))}`;
}

function storeWith(agents: Partial<CustomAgent>[]): CustomAgentStore {
  return { getAgents: () => agents } as unknown as CustomAgentStore;
}

describe("usePresetFaces", () => {
  describe("usePresetFaces()", () => {
    it(`loads the preset faces with previews and marks the ones an agent already wears (${ISSUE})`, async () => {
      setRequestUrlImpl(
        jest.fn(async ({ url }: { url: string }) =>
          url === PRESET_FACES_URL
            ? {
                json: {
                  faces: [
                    { id: "coco", alt: "Coco", url: COCO_URL },
                    { id: "kai", alt: "Kai", url: KAI_URL },
                  ],
                },
              }
            : { arrayBuffer: url === COCO_URL ? webpBytes(1) : webpBytes(2) }
        )
      );
      const vault = createFakeAgentVault();
      vault.writeByHand("copilot/teammates/coco/face.webp", webpBytes(1));

      const { result } = renderHook(() =>
        usePresetFaces(
          vault.app.vault,
          storeWith([{ slug: "coco", facePath: "copilot/teammates/coco/face.webp" }])
        )
      );

      expect(result.current).toEqual({ status: "loading" });
      await waitFor(() => expect(result.current.status).toBe("ready"));
      const ready = result.current as Extract<typeof result.current, { status: "ready" }>;
      expect(ready.faces.map((face) => [face.id, face.src])).toEqual([
        ["coco", dataUri(webpBytes(1))],
        ["kai", dataUri(webpBytes(2))],
      ]);
      expect([...ready.usedIds]).toEqual(["coco"]);
    });

    it(`reports that the faces could not load when the face list does not answer (${ISSUE})`, async () => {
      setRequestUrlImpl(jest.fn().mockRejectedValue(new Error("Request failed, status 404")));

      const { result } = renderHook(() =>
        usePresetFaces(createFakeAgentVault().app.vault, storeWith([]))
      );

      await waitFor(() => expect(result.current).toEqual({ status: "failed" }));
    });
  });
});
