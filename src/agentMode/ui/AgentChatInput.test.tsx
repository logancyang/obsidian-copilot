import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { EMPTY_AGENT_MENTION_BRANDS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import { AgentInputDraftStore } from "@/agentMode/session/AgentInputDraftStore";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice, TFile, type App } from "obsidian";
import type {
  NoteSelectedTextContext,
  SelectedTextContext,
  WebSelectedTextContext,
  WebTabContext,
} from "@/types/message";
import React from "react";

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

const mockUseCanUseMultiAgent = jest.fn<boolean, []>();
jest.mock("@/plusUtils", () => ({
  useCanUseMultiAgent: () => mockUseCanUseMultiAgent(),
  navigateToPlusPage: jest.fn(),
}));

const FAKE_BRANDS = Object.freeze([{ id: "claude", displayName: "Claude", Icon: () => null }]);
jest.mock("@/agentMode/ui/mentionedAgents", () => ({
  EMPTY_ANSWERERS: Object.freeze([]),
  isFanout: () => false,
  resolveAnswerers: () => [],
  useInstalledAgentBrands: () => FAKE_BRANDS,
}));

let capturedAgentBrands: ReadonlyArray<unknown> | undefined;
const mockPrependContent = jest.fn();
jest.mock("@/components/chat-components/ChatInput", () => ({
  __esModule: true,
  default: jest.requireActual<typeof React>("react").forwardRef(
    (
      props: {
        setInputMessage: React.Dispatch<React.SetStateAction<string>>;
        agentBrands?: ReadonlyArray<unknown>;
        topRightAccessory?: React.ReactNode;
        handleSendMessage?: () => void;
        onStopGenerating?: () => void;
        isGenerating?: boolean;
      },
      ref: React.ForwardedRef<import("@/components/chat-components/ChatInput").ChatInputHandle>
    ) => {
      React.useImperativeHandle(ref, () => ({
        removeToolPills: jest.fn(),
        prependContent: (text: string, agents: readonly string[], webTabs: readonly unknown[]) => {
          mockPrependContent(text, agents, webTabs);
          props.setInputMessage((current) =>
            [text, current].filter((part) => part.trim()).join("\n\n")
          );
        },
      }));
      capturedAgentBrands = props.agentBrands;
      return (
        <>
          {props.topRightAccessory}
          <span data-testid="generating-state">{props.isGenerating ? "running" : "idle"}</span>
          <button type="button" onClick={() => props.handleSendMessage?.()}>
            send
          </button>
          <button type="button" onClick={() => props.onStopGenerating?.()}>
            stop
          </button>
        </>
      );
    }
  ),
}));

let mockActiveWebTab: WebTabContext | undefined;
jest.mock("@/components/chat-components/hooks/useActiveWebTabState", () => ({
  useActiveWebTabState: () => ({ activeWebTabForMentions: mockActiveWebTab }),
}));
let mockSelectedTextContexts: SelectedTextContext[] = [];
jest.mock("@/aiParams", () => ({
  clearSelectedTextContexts: jest.fn(),
  removeSelectedTextContext: jest.fn(),
  useSelectedTextContexts: () => [mockSelectedTextContexts, jest.fn()],
}));
let mockSettings: {
  debug: boolean;
  agentMode: { dataNoticeAccepted: boolean };
  providers?: Record<string, unknown>;
};
jest.mock("@/settings/model", () => ({
  getModelKeyFromModel: (model: { name: string; provider: string; _backendId?: string }) => {
    const baseKey = `${model.name}|${model.provider}`;
    return model._backendId ? `${model._backendId}:${baseKey}` : baseKey;
  },
  useSettingsValue: () => ({}),
  getSettings: () => mockSettings,
  updateSetting: (key: "agentMode", value: typeof mockSettings.agentMode) => {
    mockSettings = { ...mockSettings, [key]: value };
  },
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

jest.mock("@/commands/customCommandManager", () => ({
  CustomCommandManager: { getInstance: () => ({ recordUsage: jest.fn() }) },
}));
jest.mock("@/commands/state", () => ({ getCachedCustomCommands: () => [] }));
jest.mock("@/agentMode/session/expandCustomCommandPrefix", () => ({
  expandCustomCommandPrefix: jest.fn(async (text: string) => ({ text })),
}));
const mockBuildWebTabsWithActiveSnapshot = jest.fn(
  (_app: unknown, _tabs: unknown, _includeActive: boolean): WebTabContext[] => []
);
jest.mock("@/services/webViewerService/activeWebTabSnapshot", () => ({
  buildWebTabsWithActiveSnapshot: (app: unknown, tabs: unknown, includeActive: boolean) =>
    mockBuildWebTabsWithActiveSnapshot(app, tabs, includeActive),
}));

let mockActiveFile: TFile | null = null;
const makeApp = (): App =>
  ({ workspace: { getActiveFile: () => mockActiveFile } }) as unknown as App;

const makeFile = (path: string): TFile =>
  new (TFile as unknown as new (path: string) => TFile)(path);

const image = {
  type: "image/png",
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
} as File;
const imageBlock = { type: "image", mimeType: "image/png", data: "AQID" };

const makeDraft = (overrides: Partial<AgentInputDraftControls> = {}): AgentInputDraftControls => ({
  input: "hello",
  images: [],
  contextNotes: [],
  includeActiveNote: false,
  includeActiveWebTab: false,
  loading: false,
  queue: [],
  setInput: jest.fn(),
  setContextNotes: jest.fn(),
  setSelectedImages: jest.fn(),
  addImages: jest.fn(),
  setIncludeActiveNote: jest.fn(),
  setIncludeActiveWebTab: jest.fn(),
  setLoading: jest.fn(),
  setQueue: jest.fn(),
  resetCompose: jest.fn(),
  ...overrides,
});

function inputNode(
  backend: AgentChatBackend,
  draft: AgentInputDraftControls,
  extraProps: Partial<React.ComponentProps<typeof AgentChatInput>> = {}
) {
  return (
    <AgentChatInput
      backend={backend}
      plugin={{} as never}
      chatInputId="input-1"
      draft={draft}
      app={makeApp()}
      mainAgentId={null}
      updateUserMessageHistory={jest.fn()}
      isStarting={false}
      isLoading={draft.loading}
      hasPendingPlanPermission={false}
      modelPickerOverride={undefined}
      modePickerOverride={undefined}
      onCycleMode={jest.fn()}
      {...extraProps}
    />
  );
}

const renderInput = (
  backend: AgentChatBackend,
  draft: AgentInputDraftControls,
  extraProps: Partial<React.ComponentProps<typeof AgentChatInput>> = {}
) => render(inputNode(backend, draft, extraProps));

function setupCancellation() {
  let settleTurn!: () => void;
  let settleCancel!: () => void;
  const cancellation = new Promise<void>((resolve) => {
    settleCancel = resolve;
  });
  const backend = {
    sendMessage: jest.fn(() => ({
      turn: new Promise<void>((resolve) => {
        settleTurn = resolve;
      }),
    })),
    cancel: jest.fn(() => {
      settleTurn();
      return cancellation;
    }),
  } as unknown as AgentChatBackend;
  let draft!: AgentInputDraftControls;
  const store = new AgentInputDraftStore(
    { workspace: { getActiveFile: () => null } } as unknown as App,
    () => true
  );
  function Composer() {
    draft = useAgentInputDrafts({ store, chatInputId: "input-1" });
    return inputNode(backend, draft);
  }
  render(<Composer />);
  return { backend, getDraft: () => draft, settleCancel, settleTurn: () => settleTurn() };
}

describe("AgentChatInput", () => {
  beforeEach(() => {
    mockSelectedTextContexts = [];
    mockActiveWebTab = undefined;
    mockActiveFile = null;
    capturedAgentBrands = undefined;
    mockUseCanUseMultiAgent.mockReturnValue(true);
    mockSettings = { debug: false, agentMode: { dataNoticeAccepted: true } };
  });

  describe("AgentChatInput()", () => {
    it("holds the first send until Continue and never shows again for https://github.com/logancyang/obsidian-copilot/issues/2889", async () => {
      mockSettings = { debug: false, agentMode: { dataNoticeAccepted: false } };
      const backend = {
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
      } as unknown as AgentChatBackend;
      const draft = makeDraft();
      renderInput(backend, draft, { mainAgentId: "codex" });

      fireEvent.click(screen.getByRole("button", { name: "send" }));
      expect(await screen.findByText("Where your Agent context goes")).toBeTruthy();
      expect(screen.getByText("Codex")).toBeTruthy();
      expect(screen.getByText("The endpoint the Codex CLI is set to use")).toBeTruthy();
      for (const category of [
        "Your message",
        "Notes and files you attach or the agent reads",
        "Tool results",
        "The conversation so far",
      ]) {
        expect(screen.getByText(category)).toBeTruthy();
      }
      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(draft.resetCompose).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      expect(mockSettings.agentMode.dataNoticeAccepted).toBe(true);
      expect(screen.queryByText("Where your Agent context goes")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "send" }));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(2));
      expect(screen.queryByText("Where your Agent context goes")).toBeNull();
    });

    it("keeps Continue off while the agent loads its models for https://github.com/logancyang/obsidian-copilot/issues/2889", async () => {
      mockSettings = { debug: false, agentMode: { dataNoticeAccepted: false }, providers: {} };
      const backend = {
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
      } as unknown as AgentChatBackend;
      const picker = (name: string, displayName: string) => ({
        models: [
          {
            name,
            displayName,
            provider: "agent",
            enabled: true,
            isBuiltIn: false,
            _backendId: "opencode",
          },
        ],
        value: `opencode:${name}|agent`,
        onChange: jest.fn(),
      });
      const draft = makeDraft();
      const { rerender } = renderInput(backend, draft, {
        modelPickerOverride: picker("__preload_pending__", "Loading models…"),
      });

      fireEvent.click(screen.getByRole("button", { name: "send" }));
      const continueButton = await screen.findByRole("button", { name: "Continue" });
      expect(continueButton).toHaveProperty("disabled", true);

      rerender(
        inputNode(backend, draft, { modelPickerOverride: picker("zen/big-pickle", "Big Pickle") })
      );
      expect(screen.getByText("Big Pickle")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", false);
    });

    it("sends nothing and keeps the notice pending when it is cancelled for https://github.com/logancyang/obsidian-copilot/issues/2889", async () => {
      mockSettings = { debug: false, agentMode: { dataNoticeAccepted: false } };
      const backend = {
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
      } as unknown as AgentChatBackend;
      renderInput(backend, makeDraft());

      fireEvent.click(screen.getByRole("button", { name: "send" }));
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(screen.queryByText("Where your Agent context goes")).toBeNull();
      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(mockSettings.agentMode.dataNoticeAccepted).toBe(false);
    });
    it.each([
      {
        scenario: "the active note and its selection together",
        includeActiveNote: true,
        includeSelection: true,
      },
      {
        scenario: "the active note without a selection",
        includeActiveNote: true,
        includeSelection: false,
      },
      {
        scenario: "a selection without the active note",
        includeActiveNote: false,
        includeSelection: true,
      },
    ])(
      "sends $scenario as independent context https://github.com/Brevilabs/obsidian-copilot-private/issues/465",
      async ({ includeActiveNote, includeSelection }) => {
        const note = makeFile("Research.md");
        const selection: NoteSelectedTextContext = {
          id: "research-excerpt",
          sourceType: "note",
          noteTitle: "Research",
          notePath: note.path,
          content: "Compare the interview findings.",
          startLine: 3,
          endLine: 3,
        };
        mockSelectedTextContexts = includeSelection ? [selection] : [];
        const backend = {
          sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
        } as unknown as AgentChatBackend;
        const app = {
          workspace: { getActiveFile: () => note },
        } as unknown as App;
        renderInput(backend, makeDraft({ includeActiveNote }), { app });

        fireEvent.click(screen.getByText("send"));

        await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
        expect(jest.mocked(backend.sendMessage).mock.calls[0][1]).toEqual({
          notes: includeActiveNote ? [note] : [],
          urls: [],
          selectedTextContexts: includeSelection ? [selection] : undefined,
          webTabs: undefined,
        });
      }
    );

    it("sends a web selection together with the active web tab https://github.com/Brevilabs/obsidian-copilot-private/issues/667", async () => {
      const selection: WebSelectedTextContext = {
        id: "video-excerpt",
        sourceType: "web",
        title: "Me at the zoo",
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        content: "really really long trunks",
      };
      const activeTab: WebTabContext = {
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        title: "Me at the zoo",
        isActive: true,
      };
      mockSelectedTextContexts = [selection];
      mockBuildWebTabsWithActiveSnapshot.mockImplementationOnce((_app, _tabs, includeActive) =>
        includeActive ? [activeTab] : []
      );
      const backend = {
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
      } as unknown as AgentChatBackend;
      renderInput(backend, makeDraft({ includeActiveWebTab: true }));

      fireEvent.click(screen.getByText("send"));

      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      expect(jest.mocked(backend.sendMessage).mock.calls[0][1]).toEqual({
        notes: [],
        urls: [],
        selectedTextContexts: [selection],
        webTabs: [activeTab],
      });
    });

    it("sends text-only commands that expand to empty without an image-read error https://github.com/logancyang/obsidian-copilot/issues/2850", async () => {
      jest.mocked(expandCustomCommandPrefix).mockResolvedValueOnce({ text: "" });
      jest.mocked(Notice).mockClear();
      const backend = {
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
      } as unknown as AgentChatBackend;
      renderInput(backend, makeDraft({ input: "/empty" }));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      expect(Notice).not.toHaveBeenCalled();
    });

    it.each(["", "   ", "Describe this"])(
      "sends image content with draft %p https://github.com/logancyang/obsidian-copilot/issues/2850",
      async (input) => {
        const backend = {
          sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
          cancel: jest.fn(),
        } as unknown as AgentChatBackend;
        const draft = makeDraft({ input, images: [image] });
        renderInput(backend, draft);
        fireEvent.click(screen.getByText("send"));
        await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
        expect(jest.mocked(backend.sendMessage).mock.calls[0].slice(0, 3)).toEqual([
          input.trim(),
          undefined,
          [imageBlock],
        ]);
        expect(draft.resetCompose).toHaveBeenCalledTimes(1);
      }
    );

    it.each(["", "   "])(
      "does not send empty draft %p without images https://github.com/logancyang/obsidian-copilot/issues/2850",
      async (input) => {
        const backend = {
          sendMessage: jest.fn(),
          cancel: jest.fn(),
        } as unknown as AgentChatBackend;
        const draft = makeDraft({ input });
        renderInput(backend, draft);
        await act(async () => fireEvent.click(screen.getByText("send")));
        expect(backend.sendMessage).not.toHaveBeenCalled();
        expect(draft.resetCompose).not.toHaveBeenCalled();
      }
    );

    it.each(["empty", "unreadable"])(
      "does not send or queue an image-only draft when its image is %s https://github.com/logancyang/obsidian-copilot/issues/2850",
      async (failure) => {
        jest.mocked(Notice).mockClear();
        const brokenImage = {
          type: "image/png",
          arrayBuffer: async () => {
            if (failure === "unreadable") throw new Error("Image read failed");
            return new ArrayBuffer(0);
          },
        } as File;
        const backend = {
          sendMessage: jest.fn(),
          cancel: jest.fn(),
        } as unknown as AgentChatBackend;
        const draft = makeDraft({ input: "", images: [brokenImage], loading: true });
        renderInput(backend, draft);
        await act(async () => fireEvent.click(screen.getByText("send")));
        expect(backend.sendMessage).not.toHaveBeenCalled();
        expect(draft.setQueue).not.toHaveBeenCalled();
        expect(draft.setLoading).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(
          "Could not read the attached images. Please attach them again."
        );
      }
    );

    it("keeps an image-only draft when the selected model lacks vision https://github.com/logancyang/obsidian-copilot/issues/2850", async () => {
      const backend = { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend;
      const draft = makeDraft({ input: "", images: [image] });
      renderInput(backend, draft, {
        modelPickerOverride: {
          models: [{ name: "text-only", provider: "agent", enabled: true, capabilities: [] }],
          value: "text-only|agent",
          onChange: jest.fn(),
        },
      });
      await act(async () => fireEvent.click(screen.getByText("send")));
      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(draft.resetCompose).not.toHaveBeenCalled();
    });

    it("preserves a queued image-only follow-up through normal auto-send https://github.com/logancyang/obsidian-copilot/issues/2850", async () => {
      const { backend, getDraft, settleTurn } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      act(() => getDraft().setSelectedImages([image]));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(1));
      expect(getDraft().queue[0]).toMatchObject({ text: "", promptContent: [imageBlock] });
      expect(getDraft().images).toHaveLength(0);

      await act(async () => settleTurn());

      expect(backend.sendMessage).toHaveBeenCalledTimes(2);
      expect(jest.mocked(backend.sendMessage).mock.calls[1].slice(0, 3)).toEqual([
        "",
        undefined,
        [imageBlock],
      ]);
      expect(getDraft().queue).toHaveLength(0);
      await act(async () => settleTurn());
    });
    it("returns queued follow-ups to the composer before cancellation settles the active turn https://github.com/Brevilabs/obsidian-copilot-private/issues/485", async () => {
      const { backend, getDraft, settleCancel } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(1));

      await act(async () => fireEvent.click(screen.getByText("stop")));

      expect(backend.sendMessage).toHaveBeenCalledTimes(1);
      expect(getDraft().queue).toHaveLength(0);
      expect(getDraft().input).toBe("queued follow-up");
      expect(getDraft().loading).toBe(false);
      await act(async () => settleCancel());
    });

    it("joins several queued follow-ups ahead of text typed since they were queued https://github.com/Brevilabs/obsidian-copilot-private/issues/485", async () => {
      const { backend, getDraft, settleCancel } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      act(() => getDraft().setInput("first follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(1));
      act(() => getDraft().setInput("second follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(2));
      act(() => getDraft().setInput("still typing"));

      await act(async () => fireEvent.click(screen.getByText("stop")));

      expect(getDraft().input).toBe("first follow-up\n\nsecond follow-up\n\nstill typing");
      await act(async () => settleCancel());
    });

    it("returns a queued follow-up's notes and images to the composer https://github.com/Brevilabs/obsidian-copilot-private/issues/485", async () => {
      const note = makeFile("Queued.md");
      const { backend, getDraft, settleCancel } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      act(() => {
        getDraft().setInput("look at this");
        getDraft().setContextNotes([note]);
        getDraft().setSelectedImages([image]);
      });
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(1));
      expect(getDraft().contextNotes).toHaveLength(0);
      expect(getDraft().images).toHaveLength(0);

      await act(async () => fireEvent.click(screen.getByText("stop")));

      expect(getDraft().input).toBe("look at this");
      expect(getDraft().contextNotes).toEqual([note]);
      expect(getDraft().images).toHaveLength(1);
      expect(getDraft().images[0]).toMatchObject({ type: "image/png", size: 3 });
      await act(async () => settleCancel());
    });

    it("restores resolved commands and prepends queued images before draft images https://github.com/Brevilabs/obsidian-copilot-private/issues/485", async () => {
      const { getDraft, settleCancel } = setupCancellation();
      act(() => {
        getDraft().setLoading(true);
        getDraft().setInput("current draft");
        getDraft().setSelectedImages([image]);
        getDraft().setQueue([
          {
            id: "one",
            rawInput: "first",
            text: "first",
            mentionedAgents: ["claude"],
            context: {
              notes: [],
              urls: [],
              webTabs: [{ url: "https://example.com/report", title: "Report" }],
            },
          },
          {
            id: "two",
            rawInput: "/review",
            text: "Review the changes",
            promptContent: [{ type: "image", mimeType: "image/png", data: "BAUG" }],
          },
        ]);
      });
      await act(async () => fireEvent.click(screen.getByText("stop")));
      expect(getDraft().input).toBe("first\n\nReview the changes\n\ncurrent draft");
      expect(getDraft().images[0]).toMatchObject({ name: "queued-image-1.png" });
      expect(getDraft().images[1]).toBe(image);
      expect(mockPrependContent).toHaveBeenLastCalledWith(
        "first\n\nReview the changes",
        ["claude"],
        [{ url: "https://example.com/report", title: "Report" }]
      );
      await act(async () => settleCancel());
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/667 restores a queued snapshot of the current page as the Active Web Tab badge instead of a second fixed badge", async () => {
      const current: WebTabContext = { url: "https://example.com/current", title: "Current" };
      const other: WebTabContext = { url: "https://example.com/other", title: "Other" };
      mockActiveWebTab = current;
      const { getDraft, settleCancel } = setupCancellation();
      act(() => {
        getDraft().setLoading(true);
        getDraft().setIncludeActiveWebTab(false);
        getDraft().setQueue([
          {
            id: "one",
            rawInput: "follow-up",
            text: "follow-up",
            context: { notes: [], urls: [], webTabs: [{ ...current, isActive: true }, other] },
          },
        ]);
      });

      await act(async () => fireEvent.click(screen.getByText("stop")));

      expect(mockPrependContent).toHaveBeenLastCalledWith("follow-up", [], [other]);
      expect(getDraft().includeActiveWebTab).toBe(true);
      await act(async () => settleCancel());
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/670 restores a queued copy of the active note as the Active Note badge instead of a second fixed badge", async () => {
      const active = makeFile("Active.md");
      const other = makeFile("Other.md");
      mockActiveFile = active;
      const { getDraft, settleCancel } = setupCancellation();
      act(() => {
        getDraft().setLoading(true);
        getDraft().setIncludeActiveNote(false);
        getDraft().setQueue([
          {
            id: "one",
            rawInput: "follow-up",
            text: "follow-up",
            context: { notes: [active, other], urls: [], webTabs: [] },
          },
        ]);
      });

      await act(async () => fireEvent.click(screen.getByText("stop")));

      expect(getDraft().contextNotes).toEqual([other]);
      expect(getDraft().includeActiveNote).toBe(true);
      await act(async () => settleCancel());
    });

    it("keeps a subsequent turn running when the previous cancellation resolves https://github.com/Brevilabs/obsidian-copilot-private/issues/365", async () => {
      const { backend, getDraft, settleCancel } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      await act(async () => fireEvent.click(screen.getByText("stop")));
      act(() => getDraft().setInput("new turn after Stop"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(2));
      expect(getDraft().loading).toBe(true);

      await act(async () => settleCancel());

      expect(getDraft().loading).toBe(true);
    });
    it("returns queued follow-ups to the composer but keeps the active turn running when cancellation fails https://github.com/Brevilabs/obsidian-copilot-private/issues/365 https://github.com/Brevilabs/obsidian-copilot-private/issues/485", async () => {
      const { backend, getDraft, settleTurn } = setupCancellation();
      jest.mocked(backend.cancel).mockRejectedValueOnce(new Error("Cancellation failed"));
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(1));

      await act(async () => fireEvent.click(screen.getByText("stop")));

      expect(getDraft().queue).toHaveLength(0);
      expect(getDraft().input).toBe("queued follow-up");
      expect(getDraft().loading).toBe(true);
      await act(async () => settleTurn());
      expect(getDraft().loading).toBe(false);
      expect(backend.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("sends queued follow-ups when the active turn finishes normally", async () => {
      const { backend, getDraft, settleTurn } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(1));

      await act(async () => settleTurn());

      expect(backend.sendMessage).toHaveBeenCalledTimes(2);
      expect(getDraft().queue).toHaveLength(0);
      expect(getDraft().loading).toBe(true);
      await act(async () => settleTurn());
      expect(getDraft().loading).toBe(false);
    });
    it("regression: clears draft.loading when the turn resolves after the composer unmounted", async () => {
      let resolveTurn!: () => void;
      const turn = new Promise<void>((resolve) => {
        resolveTurn = resolve;
      });
      const backend = {
        sendMessage: jest.fn(() => ({ turn })),
        cancel: jest.fn(),
      } as unknown as AgentChatBackend;
      const draft = makeDraft();

      const { unmount } = renderInput(backend, draft);
      fireEvent.click(screen.getByText("send"));

      await waitFor(() => expect(draft.setLoading).toHaveBeenCalledWith(true));
      expect(backend.sendMessage).toHaveBeenCalledTimes(1);

      unmount();

      await act(async () => {
        resolveTurn();
        await turn;
      });

      await waitFor(() => expect(draft.setLoading).toHaveBeenCalledWith(false));
    });

    it("passes the real installed-agent list when entitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      renderInput(
        { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend,
        makeDraft()
      );
      expect(capturedAgentBrands).toBe(FAKE_BRANDS);
    });

    it("clears input-scoped context only when the logical chat input changes", () => {
      const clearSelectedTextContexts = jest.requireMock("@/aiParams")
        .clearSelectedTextContexts as jest.Mock;
      clearSelectedTextContexts.mockClear();
      const backend = { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend;
      const draft = makeDraft();
      const view = renderInput(backend, draft);

      view.rerender(inputNode(backend, draft, { chatInputId: "input-1" }));
      expect(clearSelectedTextContexts).not.toHaveBeenCalled();
      view.rerender(inputNode(backend, draft, { chatInputId: "input-2" }));
      expect(clearSelectedTextContexts).toHaveBeenCalledTimes(1);
    });

    it("passes the frozen empty list (not a fresh []) when not entitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(false);
      renderInput(
        { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend,
        makeDraft()
      );
      expect(capturedAgentBrands).toBe(EMPTY_AGENT_MENTION_BRANDS);
    });

    it("shows the running state while a plan-approved turn continues after the composer send settles (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      const backend = { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend;
      const draft = makeDraft({ loading: false });
      const view = renderInput(backend, draft, { isLoading: true });

      expect(screen.getByTestId("generating-state").textContent).toBe("running");
      view.rerender(inputNode(backend, draft, { isLoading: false }));
      expect(screen.getByTestId("generating-state").textContent).toBe("idle");
    });

    const makeBackend = () =>
      ({
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
        cancel: jest.fn(),
      }) as unknown as AgentChatBackend;

    const enqueuedItem = (setQueue: jest.Mock) => {
      const updater = setQueue.mock.calls[0][0] as (
        q: readonly unknown[]
      ) => { queueReason?: string }[];
      return updater([])[0];
    };

    it("snapshots 'context' when the send is held for project-context materialization", async () => {
      const backend = makeBackend();
      const draft = makeDraft();

      renderInput(backend, draft, { activeProjectId: "proj-1", contextLoadBlocking: true });
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(draft.setQueue).toHaveBeenCalled());

      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(enqueuedItem(draft.setQueue as jest.Mock).queueReason).toBe("context");
    });

    it("snapshots 'busy' when queued behind an in-flight turn", async () => {
      const backend = makeBackend();
      const draft = makeDraft({ loading: true });

      renderInput(backend, draft);
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(draft.setQueue).toHaveBeenCalled());

      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(enqueuedItem(draft.setQueue as jest.Mock).queueReason).toBe("busy");
    });

    it("queues a message behind a plan-approved turn even after draft loading clears (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)", async () => {
      const backend = makeBackend();
      const draft = makeDraft({ loading: false });

      renderInput(backend, draft, { isLoading: true });
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(draft.setQueue).toHaveBeenCalled());

      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(enqueuedItem(draft.setQueue as jest.Mock).queueReason).toBe("busy");
    });

    it("labels only context-held rows with the amber waiting prefix", () => {
      const draft = makeDraft({
        queue: [
          {
            id: "q1",
            text: "held for context",
            rawInput: "held for context",
            queueReason: "context",
          },
          { id: "q2", text: "held while busy", rawInput: "held while busy", queueReason: "busy" },
        ],
      });

      renderInput(makeBackend(), draft);

      const rows = screen.getAllByTitle(/held/);
      expect(rows[0].textContent).toContain("Waiting for context · held for context");
      expect(rows[1].textContent).toContain("held while busy");
      expect(rows[1].textContent).not.toContain("Waiting for context");
    });

    it("keeps queued images when the active model is known not to support vision", async () => {
      const backend = makeBackend();
      const draft = makeDraft({
        queue: [
          {
            id: "q1",
            text: "describe this",
            rawInput: "describe this",
            promptContent: [{ type: "image", mimeType: "image/png", data: "AA==" }],
          },
        ],
      });

      renderInput(backend, draft, {
        modelPickerOverride: {
          models: [
            {
              name: "text-only",
              provider: "agent",
              enabled: true,
              capabilities: [],
            },
          ],
          value: "text-only|agent",
          onChange: jest.fn(),
        },
      });
      await act(async () => {});

      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(draft.setQueue).not.toHaveBeenCalled();
    });

    it("passes the indicator through the accessory slot when mounted", () => {
      const backend = { sendMessage: jest.fn(), cancel: jest.fn() } as unknown as AgentChatBackend;

      renderInput(backend, makeDraft(), { contextStatusIndicator: <span>status</span> });
      expect(screen.getByText("status")).toBeTruthy();
    });

    it("regression: clears the composer before awaiting attached-image conversion (#211)", async () => {
      let resolveRead!: (buf: ArrayBuffer) => void;
      const slowImage = {
        type: "image/png",
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((resolve) => {
            resolveRead = resolve;
          }),
      } as unknown as File;

      const backend = {
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
        cancel: jest.fn(),
      } as unknown as AgentChatBackend;
      const draft = makeDraft({ images: [slowImage] });

      renderInput(backend, draft);
      fireEvent.click(screen.getByText("send"));

      await waitFor(() => expect(draft.resetCompose).toHaveBeenCalledTimes(1));
      expect(backend.sendMessage).not.toHaveBeenCalled();

      await act(async () => {
        resolveRead(new ArrayBuffer(1));
        await Promise.resolve();
      });
      await waitFor(() => expect(backend.sendMessage).toHaveBeenCalledTimes(1));
      const promptContent = (backend.sendMessage as jest.Mock).mock.calls[0][2];
      expect(promptContent).toHaveLength(1);
      expect(promptContent[0].type).toBe("image");
    });

    it("drops a send when the composer is disabled (orphaned project)", async () => {
      const backend = {
        sendMessage: jest.fn(() => ({ turn: Promise.resolve() })),
        cancel: jest.fn(),
      } as unknown as AgentChatBackend;
      const draft = makeDraft();

      renderInput(backend, draft, { disabled: true });
      fireEvent.click(screen.getByText("send"));
      await act(async () => {});

      expect(backend.sendMessage).not.toHaveBeenCalled();
      expect(draft.setLoading).not.toHaveBeenCalledWith(true);
      expect(draft.resetCompose).not.toHaveBeenCalled();
    });
  });
});
