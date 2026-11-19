import type { HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import { AgentProfile, agentDeleteNotice } from "@/agents/agentMode/ui/AgentProfile";
import { CustomAgentStore, type CustomAgent } from "@/agents/CustomAgentStore";
import { PRESET_FACES_URL } from "@/agents/presetFaces";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { createFakeAgentVault, type FakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { webpBytes } from "@/agents/testing/webpBytes";
import type { AgentModelChoices } from "@/agents/ui/CreateAgentForm";
import { useCustomAgents } from "@/agents/ui/useCustomAgents";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { AgentDeleteModal } from "@/agents/ui/AgentDeleteModal";
import { resetSettings } from "@/settings/model";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as obsidian from "obsidian";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/entitlement");
jest.mock("@/agents/ui/AgentDeleteModal", () => ({
  AgentDeleteModal: jest.fn(() => ({ open: jest.fn() })),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/940";

const setRequestUrlImpl = (
  obsidian as unknown as { __setRequestUrlImpl: (impl: jest.Mock) => void }
).__setRequestUrlImpl;

const FOLDER = "copilot/agents/coco";
const LEO_URL = "https://images.brevilabs.com/agent-faces/leo.webp";
const KAI_URL = "https://images.brevilabs.com/agent-faces/kai.webp";

const MODELS: AgentModelChoices = {
  models: [
    {
      name: "opus",
      displayName: "Opus 5.5",
      provider: "agent",
      enabled: true,
      _group: "Claude",
      _backendId: "claude",
    },
    {
      name: "sonnet",
      displayName: "Sonnet 5.5",
      provider: "agent",
      enabled: true,
      _group: "Claude",
      _backendId: "claude",
    },
  ],
  effortOptionsByModelKey: {},
  initial: { baseModelId: "opus", effort: null },
};

function seed(vault: FakeAgentVault, slug: string, name: string, title = "") {
  vault.writeByHand(
    `copilot/agents/${slug}/instructions.md`,
    `---\nname: ${name}\ntitle: ${title}\nface: face.webp\nmodel: ''\n---\nYou keep the whole vault in view. Answer briefly.`
  );
}

interface ProfileHarnessProps {
  store: CustomAgentStore;
  app: App;
  handlers: { onBack: () => void; onNewChat: (agent: CustomAgent) => void };
}

const deletedChats = jest.fn(async (_id: string, _options?: unknown) => {});
const hiddenChats = {
  workingIn: jest.fn((_slug: string): string | null => "Maya"),
  stopAgent: jest.fn((_slug: string) => {}),
} as unknown as HiddenAgentChats;

function ProfileHarness({ store, app, handlers }: ProfileHarnessProps) {
  const coco = useCustomAgents(store).find((agent) => agent.slug === "coco");
  const manager = {
    getChatHistoryItems: async () => [
      { id: "a.md", agent: "coco" },
      { id: "maya.md", agent: "maya" },
    ],
    getSession: () => undefined,
    deleteChatHistory: deletedChats,
  } as unknown as AgentSessionManager;
  if (!coco) return null;
  return (
    <AgentProfile
      agent={coco}
      app={app}
      manager={manager}
      store={store}
      hiddenChats={hiddenChats}
      hostSessionId="host"
      getModels={() => MODELS}
      {...handlers}
    />
  );
}

async function setup() {
  await setCustomAgentsAccess("team");
  const vault = createFakeAgentVault();
  seed(vault, "coco", "Coco", "Keeps the whole vault in view");
  seed(vault, "maya", "Maya");
  vault.writeByHand(`${FOLDER}/MEMORY.md`, "## How to work\n\nLead with user value.\n");
  vault.writeByHand(`${FOLDER}/face.webp`, webpBytes(1));
  const newLeaf = { openFile: jest.fn().mockResolvedValue(undefined) };
  const app = {
    ...vault.app,
    metadataCache: { getCache: () => null },
    workspace: { getLeavesOfType: () => [], getLeaf: jest.fn(() => newLeaf) },
  } as unknown as App;
  const store = new CustomAgentStore(app);
  await store.start();
  const handlers = { onBack: jest.fn(), onNewChat: jest.fn() };
  render(<ProfileHarness store={store} app={app} handlers={handlers} />);
  await waitFor(() => expect(screen.getByText(/^1 chat · since /)).not.toBeNull());
  return { vault, app, store, newLeaf, handlers };
}

function startEditing(button: string): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: button }));
  return screen.getByRole<HTMLInputElement>("textbox");
}

describe("AgentProfile", () => {
  beforeAll(() => {
    window.ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    }));
  });

  beforeEach(() => resetSettings());

  describe("AgentProfile()", () => {
    it("shows the agent's chats and its saved rules from the vault", async () => {
      await setup();

      expect(screen.getByRole("button", { name: /Rules Coco remembers/ }).textContent).toContain(
        "1 rule"
      );
    });

    it("opens the agent's instructions.md in a new tab of the main editor area from its row", async () => {
      const { app, newLeaf } = await setup();

      fireEvent.click(screen.getByRole("button", { name: /What Coco handles/ }));

      await waitFor(() =>
        expect(newLeaf.openFile).toHaveBeenCalledWith(
          app.vault.getAbstractFileByPath(`${FOLDER}/instructions.md`),
          { active: true, eState: undefined }
        )
      );
    });

    it("starts a new chat with this agent and goes back", async () => {
      const { handlers } = await setup();

      fireEvent.click(screen.getByRole("button", { name: "New chat with Coco" }));
      fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));

      expect(handlers.onNewChat).toHaveBeenCalledWith(expect.objectContaining({ slug: "coco" }));
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
    });

    it(`renames the agent in its instructions.md and keeps its folder (${ISSUE})`, async () => {
      const { vault } = await setup();
      const pathsBefore = vault.listPaths();

      const input = startEditing("Rename Coco");
      fireEvent.change(input, { target: { value: "Cocoa" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(await screen.findByRole("button", { name: "Rename Cocoa" })).not.toBeNull();
      expect(vault.readText(`${FOLDER}/instructions.md`)).toContain("name: Cocoa");
      expect(vault.listPaths()).toEqual(pathsBefore);
    });

    it(`refuses another agent's name and writes nothing (${ISSUE})`, async () => {
      const { vault } = await setup();
      const before = vault.readText(`${FOLDER}/instructions.md`);

      const input = startEditing("Rename Coco");
      fireEvent.change(input, { target: { value: "MAYA" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(
        await screen.findByText("Maya is already on your team. Pick another name.")
      ).not.toBeNull();
      expect(vault.readText(`${FOLDER}/instructions.md`)).toBe(before);
    });

    it(`shows the instruction's first sentence once the title is emptied (${ISSUE})`, async () => {
      const { vault } = await setup();

      const input = startEditing("Change Coco's title");
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Change Coco's title" }).textContent).toBe(
          "You keep the whole vault in view."
        )
      );
      expect(vault.readText(`${FOLDER}/instructions.md`)).not.toContain("Keeps the whole vault");
    });

    it(`sets the model future chats start on in the agent's instructions.md (${ISSUE})`, async () => {
      const { vault } = await setup();

      fireEvent.click(screen.getByTitle("Model · effort"));
      fireEvent.click(await screen.findByRole("option", { name: /Sonnet 5\.5/ }));
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

      await waitFor(() =>
        expect(vault.readText(`${FOLDER}/instructions.md`)).toContain(
          '{"baseModelId":"sonnet","effort":null}'
        )
      );
    });

    it(`downloads the preset faces only once the face picker opens, shows the face worn as chosen, and saves a picked preset byte for byte (${ISSUE})`, async () => {
      const requestUrl = jest.fn(async ({ url }: { url: string }) =>
        url === PRESET_FACES_URL
          ? {
              json: {
                faces: [
                  { id: "leo", alt: "Leo", url: LEO_URL },
                  { id: "kai", alt: "Kai", url: KAI_URL },
                ],
              },
            }
          : { arrayBuffer: url === LEO_URL ? webpBytes(1) : webpBytes(2) }
      );
      setRequestUrlImpl(requestUrl);
      const { vault } = await setup();
      expect(requestUrl).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Change Coco's face" }));
      const picker = within(await screen.findByRole("dialog"));
      const worn = await picker.findByRole("button", { name: "Leo" });
      await waitFor(() => expect(worn.getAttribute("aria-pressed")).toBe("true"));
      fireEvent.click(picker.getByRole("button", { name: "Kai" }));

      await waitFor(() =>
        expect(Array.from(new Uint8Array(vault.readBytes(`${FOLDER}/face.webp`) ?? []))).toEqual(
          Array.from(new Uint8Array(webpBytes(2)))
        )
      );
      expect(requestUrl.mock.calls.map(([{ url }]) => url)).toEqual([
        PRESET_FACES_URL,
        LEO_URL,
        KAI_URL,
      ]);
    });

    it(`asks before deleting, naming the chat count, then deletes the agent's folder and its chats only (${ISSUE})`, async () => {
      const { vault } = await setup();

      fireEvent.click(screen.getByRole("button", { name: "Delete Coco…" }));
      await waitFor(() => expect(AgentDeleteModal).toHaveBeenCalledTimes(1));
      const [, details, confirm] = jest.mocked(AgentDeleteModal).mock.calls[0] as unknown as [
        unknown,
        { chatCount: number; memoryRules: number | null },
        () => void,
      ];
      expect(details).toMatchObject({ chatCount: 1, memoryRules: 1 });
      expect(vault.trashedPaths).toEqual([]);
      confirm();

      await waitFor(() => expect(obsidian.Notice).toHaveBeenCalledWith("Deleted Coco and 1 chat."));
      expect(hiddenChats.stopAgent).toHaveBeenCalledWith("coco");
      expect(deletedChats.mock.calls.map(([id]) => id)).toEqual(["a.md"]);
      expect(vault.trashedPaths).toEqual([FOLDER]);
    });

    it(`tells the delete dialog which chat the agent is working in when an @ runs it (https://github.com/Brevilabs/obsidian-copilot-private/issues/945)`, async () => {
      await setup();

      fireEvent.click(screen.getByRole("button", { name: "Delete Coco…" }));
      await waitFor(() => expect(AgentDeleteModal).toHaveBeenCalledTimes(1));

      expect(hiddenChats.workingIn).toHaveBeenCalledWith("coco");
      expect(jest.mocked(AgentDeleteModal).mock.calls[0][1]).toMatchObject({ workingIn: "Maya" });
    });
  });

  describe("agentDeleteNotice()", () => {
    it("names the deleted agent and how many of its chats went with it", () => {
      expect([
        agentDeleteNotice("Coco", { deletedChats: 3, failedChats: 0, agentDeleted: true }),
        agentDeleteNotice("Coco", { deletedChats: 0, failedChats: 0, agentDeleted: true }),
      ]).toEqual(["Deleted Coco and 3 chats.", "Deleted Coco."]);
    });

    it(`says what was and wasn't deleted when the agent was kept (${ISSUE})`, () => {
      expect([
        agentDeleteNotice("Coco", { deletedChats: 2, failedChats: 1, agentDeleted: false }),
        agentDeleteNotice("Coco", { deletedChats: 2, failedChats: 0, agentDeleted: false }),
        agentDeleteNotice("Coco", { deletedChats: 0, failedChats: 0, agentDeleted: false }),
      ]).toEqual([
        "Couldn't delete 1 of Coco's 3 chats, so Coco was kept.",
        "Deleted 2 chats with Coco, but couldn't delete Coco.",
        "Couldn't delete Coco.",
      ]);
    });
  });
});
