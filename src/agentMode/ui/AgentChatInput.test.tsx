import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { EMPTY_AGENT_MENTION_BRANDS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import {
  AgentPaneCapabilitiesProvider,
  type AgentPaneCapabilities,
} from "@/agentMode/ui/AgentPaneContext";
import type { SessionCommands } from "@/agentMode/ui/hooks/useSessionCommands";
import { AgentInputDraftStore } from "@/agentMode/session/AgentInputDraftStore";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice, TFile, type App } from "obsidian";
import type { NoteSelectedTextContext, SelectedTextContext } from "@/types/message";
import React from "react";

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

const mockUseCanUseMultiAgent = jest.fn<boolean, []>();
const mockNavigateToPlusPage = jest.fn();
jest.mock("@/plusUtils", () => ({
  useCanUseMultiAgent: () => mockUseCanUseMultiAgent(),
  navigateToPlusPage: (...args: unknown[]) => mockNavigateToPlusPage(...args),
}));

type ComposerMock = Pick<SessionCommands, "send" | "cancel">;

const FAKE_BRANDS = Object.freeze([{ id: "claude", displayName: "Claude", Icon: () => null }]);
jest.mock("@/agentMode/ui/mentionedAgents", () => ({
  EMPTY_ANSWERERS: Object.freeze([]),
  isFanout: () => false,
  resolveAnswerers: () => [],
}));

let mockCommands: ComposerMock = { send: jest.fn(), cancel: jest.fn() };
let mockRuntime = { isStarting: false, isTurnInFlight: false, hasPendingPlanPermission: false };
let mockModelPicker: unknown = null;
jest.mock("@/agentMode/ui/hooks/useSessionCommands", () => ({
  useSessionCommands: () => mockCommands,
}));
jest.mock("@/agentMode/ui/hooks/useChatRuntime", () => ({ useChatRuntime: () => mockRuntime }));
jest.mock("@/agentMode/protocol/react", () => ({
  useClientView: () => ({ host: { tabs: [], host: { startingBackendId: null } } }),
}));
jest.mock("@/agentMode/ui/useAgentModelPicker", () => ({
  useAgentModelPicker: () => mockModelPicker,
}));
jest.mock("@/agentMode/ui/useAgentModePicker", () => ({ useAgentModePicker: () => null }));
jest.mock("@/agentMode/ui/hooks/useAgentBrands", () => ({
  useAgentBrands: () => ({ installed: FAKE_BRANDS, cloudAgentIds: new Set<string>() }),
}));

let capturedAgentBrands: ReadonlyArray<unknown> | undefined;
let capturedTopRightAccessory: React.ReactNode | undefined;
const mockPrependContent = jest.fn();
let capturedPlaceholder: string | undefined;
jest.mock("@/components/chat-components/ChatInput", () => ({
  __esModule: true,
  default: jest.requireActual<typeof React>("react").forwardRef(
    (
      props: {
        setInputMessage: React.Dispatch<React.SetStateAction<string>>;
        agentBrands?: ReadonlyArray<unknown>;
        topRightAccessory?: React.ReactNode;
        placeholder?: string;
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
      capturedTopRightAccessory = props.topRightAccessory;
      capturedPlaceholder = props.placeholder;
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

jest.mock("@/components/chat-components/hooks/useActiveWebTabState", () => ({
  useActiveWebTabState: () => ({ activeWebTabForMentions: undefined }),
}));
let mockSelectedTextContexts: SelectedTextContext[] = [];
jest.mock("@/aiParams", () => ({
  clearSelectedTextContexts: jest.fn(),
  removeSelectedTextContext: jest.fn(),
  useSelectedTextContexts: () => [mockSelectedTextContexts, jest.fn()],
}));
jest.mock("@/settings/model", () => ({
  getModelKeyFromModel: (model: { name: string; provider: string; _backendId?: string }) => {
    const baseKey = `${model.name}|${model.provider}`;
    return model._backendId ? `${model._backendId}:${baseKey}` : baseKey;
  },
  useSettingsValue: () => ({}),
  getSettings: () => ({ debug: false }),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

jest.mock("@/commands/customCommandManager", () => ({
  CustomCommandManager: { getInstance: () => ({ recordUsage: jest.fn() }) },
}));
jest.mock("@/commands/state", () => ({ getCachedCustomCommands: () => [] }));
jest.mock("@/agentMode/session/expandCustomCommandPrefix", () => ({
  expandCustomCommandPrefix: jest.fn(async (text: string) => ({ text })),
}));
jest.mock("@/services/webViewerService/activeWebTabSnapshot", () => ({
  buildWebTabsWithActiveSnapshot: () => [],
}));

const makeApp = (): App => ({ workspace: { getActiveFile: () => null } }) as unknown as App;

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

interface ComposerScenario {
  isLoading?: boolean;
  isStarting?: boolean;
  hasPendingPlanPermission?: boolean;
  modelPickerOverride?: unknown;
}

function inputNode(
  composer: ComposerMock,
  draft: AgentInputDraftControls,
  extraProps: Partial<React.ComponentProps<typeof AgentChatInput>> & ComposerScenario = {}
) {
  const { isLoading, isStarting, hasPendingPlanPermission, modelPickerOverride, ...props } =
    extraProps;
  mockCommands = composer;
  mockRuntime = {
    isStarting: isStarting ?? false,
    isTurnInFlight: isLoading ?? false,
    hasPendingPlanPermission: hasPendingPlanPermission ?? false,
  };
  mockModelPicker = modelPickerOverride ?? null;
  return (
    <AgentChatInput
      client={{} as never}
      view={{} as never}
      sessionId="s1"
      chatInputId="input-1"
      draft={draft}
      app={makeApp()}
      updateUserMessageHistory={jest.fn()}
      {...props}
    />
  );
}

const renderInput = (
  composer: ComposerMock,
  draft: AgentInputDraftControls,
  extraProps: Partial<React.ComponentProps<typeof AgentChatInput>> & ComposerScenario = {}
) => render(inputNode(composer, draft, extraProps));

function setupCancellation() {
  let settleTurn!: () => void;
  let settleCancel!: () => void;
  const cancellation = new Promise<void>((resolve) => {
    settleCancel = resolve;
  });
  const composer = {
    send: jest.fn(async () => ({
      turn: new Promise<void>((resolve) => {
        settleTurn = resolve;
      }),
    })),
    cancel: jest.fn(() => {
      settleTurn();
      return cancellation;
    }),
  } as unknown as ComposerMock;
  let draft!: AgentInputDraftControls;
  const store = new AgentInputDraftStore(
    { workspace: { getActiveFile: () => null } } as unknown as App,
    () => true
  );
  function Composer() {
    draft = useAgentInputDrafts({
      store,
      chatInputId: "input-1",
      defaultIncludeActiveNote: false,
    });
    return inputNode(composer, draft);
  }
  render(<Composer />);
  return { composer, getDraft: () => draft, settleCancel, settleTurn: () => settleTurn() };
}

const ISSUE_613 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

describe("AgentChatInput", () => {
  beforeEach(() => {
    mockSelectedTextContexts = [];
  });
  describe("handleSendMessage()", () => {
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
        const composer = {
          send: jest.fn(async () => ({ turn: Promise.resolve() })),
        } as unknown as ComposerMock;
        const app = {
          workspace: { getActiveFile: () => note },
        } as unknown as App;
        renderInput(composer, makeDraft({ includeActiveNote }), { app });

        fireEvent.click(screen.getByText("send"));

        await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
        expect(jest.mocked(composer.send).mock.calls[0][1]).toEqual({
          notes: includeActiveNote ? [note] : [],
          urls: [],
          selectedTextContexts: includeSelection ? [selection] : undefined,
          webTabs: undefined,
        });
      }
    );

    it("sends text-only commands that expand to empty without an image-read error https://github.com/logancyang/obsidian-copilot/issues/2850", async () => {
      jest.mocked(expandCustomCommandPrefix).mockResolvedValueOnce({ text: "" });
      jest.mocked(Notice).mockClear();
      const composer = {
        send: jest.fn(async () => ({ turn: Promise.resolve() })),
      } as unknown as ComposerMock;
      renderInput(composer, makeDraft({ input: "/empty" }));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
      expect(Notice).not.toHaveBeenCalled();
    });

    it.each(["", "   ", "Describe this"])(
      "sends image content with draft %p https://github.com/logancyang/obsidian-copilot/issues/2850",
      async (input) => {
        const composer = {
          send: jest.fn(async () => ({ turn: Promise.resolve() })),
          cancel: jest.fn(),
        } as unknown as ComposerMock;
        const draft = makeDraft({ input, images: [image] });
        renderInput(composer, draft);
        fireEvent.click(screen.getByText("send"));
        await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
        expect(jest.mocked(composer.send).mock.calls[0].slice(0, 3)).toEqual([
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
        const composer = {
          send: jest.fn(),
          cancel: jest.fn(),
        } as unknown as ComposerMock;
        const draft = makeDraft({ input });
        renderInput(composer, draft);
        await act(async () => fireEvent.click(screen.getByText("send")));
        expect(composer.send).not.toHaveBeenCalled();
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
        const composer = {
          send: jest.fn(),
          cancel: jest.fn(),
        } as unknown as ComposerMock;
        const draft = makeDraft({ input: "", images: [brokenImage], loading: true });
        renderInput(composer, draft);
        await act(async () => fireEvent.click(screen.getByText("send")));
        expect(composer.send).not.toHaveBeenCalled();
        expect(draft.setQueue).not.toHaveBeenCalled();
        expect(draft.setLoading).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(
          "Could not read the attached images. Please attach them again."
        );
      }
    );

    it.each([
      [
        "five images",
        Array.from({ length: 5 }, () => ({ ...image, size: 10 })),
        "At most 4 images per message",
      ],
      [
        "an oversized image",
        [{ ...image, size: 9 * 1024 * 1024 }],
        "Image data exceeds the size limit",
      ],
      [
        "an unsupported image type",
        [{ ...image, type: "image/bmp", size: 10 }],
        "Unsupported image type image/bmp",
      ],
    ] as const)(
      "keeps the draft and warns instead of sending %s the host would refuse https://github.com/Brevilabs/obsidian-copilot-private/issues/611",
      async (_name, images, notice) => {
        jest.mocked(Notice).mockClear();
        const composer = {
          send: jest.fn(),
          cancel: jest.fn(),
        } as unknown as ComposerMock;
        const draft = makeDraft({ input: "look", images: [...images] as unknown as File[] });
        renderInput(composer, draft);

        await act(async () => fireEvent.click(screen.getByText("send")));

        expect(composer.send).not.toHaveBeenCalled();
        expect(draft.resetCompose).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(notice);
      }
    );

    it("sends queued follow-ups one at a time when together they carry more images than a message may https://github.com/Brevilabs/obsidian-copilot-private/issues/611", async () => {
      jest.mocked(Notice).mockClear();
      const composer = {
        send: jest.fn(async () => ({ turn: new Promise<void>(() => undefined) })),
        cancel: jest.fn(),
      } as unknown as ComposerMock;
      const block = { type: "image" as const, mimeType: "image/png", data: "AQID" };
      const queue = [
        { id: "a", text: "one", rawInput: "one", promptContent: [block, block, block] },
        { id: "b", text: "two", rawInput: "two", promptContent: [block, block] },
      ];
      const draft = makeDraft({ queue });

      renderInput(composer, draft);
      await act(async () => {});

      expect(composer.send).toHaveBeenCalledTimes(1);
      expect(jest.mocked(composer.send).mock.calls[0].slice(0, 3)).toEqual([
        "one",
        undefined,
        [block, block, block],
      ]);
      const applyQueueUpdate = jest.mocked(draft.setQueue).mock.calls[0][0] as (
        current: typeof queue
      ) => typeof queue;
      expect(applyQueueUpdate(queue)).toEqual([queue[1]]);
      expect(Notice).not.toHaveBeenCalled();
    });

    it("keeps a single queued follow-up queued and warns when it alone carries more images than a message may https://github.com/Brevilabs/obsidian-copilot-private/issues/611", async () => {
      jest.mocked(Notice).mockClear();
      const composer = { send: jest.fn(), cancel: jest.fn() } as unknown as ComposerMock;
      const block = { type: "image" as const, mimeType: "image/png", data: "AQID" };
      const draft = makeDraft({
        queue: [
          {
            id: "a",
            text: "one",
            rawInput: "one",
            promptContent: [block, block, block, block, block],
          },
        ],
      });

      renderInput(composer, draft);
      await act(async () => {});

      expect(composer.send).not.toHaveBeenCalled();
      expect(draft.setQueue).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("At most 4 images per message");
    });

    it("refuses images that exceed the link's budget before sending https://github.com/Brevilabs/obsidian-copilot-private/issues/613", async () => {
      jest.mocked(Notice).mockClear();
      const composer = { send: jest.fn(), cancel: jest.fn() } as unknown as ComposerMock;
      const sixMb = { type: "image/png", size: 6 * 1024 * 1024 } as File;
      const capabilities: AgentPaneCapabilities = {
        vaultBase: null,
        imageBytesBudget: 5 * 1024 * 1024,
      };
      render(
        <AgentPaneCapabilitiesProvider value={capabilities}>
          {inputNode(composer, makeDraft({ input: "", images: [sixMb] }))}
        </AgentPaneCapabilitiesProvider>
      );

      await act(async () => fireEvent.click(screen.getByText("send")));

      expect(composer.send).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Images can total at most 5 MB from here");
    });

    it("keeps an image-only draft when the selected model lacks vision https://github.com/logancyang/obsidian-copilot/issues/2850", async () => {
      const composer = { send: jest.fn(), cancel: jest.fn() } as unknown as ComposerMock;
      const draft = makeDraft({ input: "", images: [image] });
      renderInput(composer, draft, {
        modelPickerOverride: {
          models: [{ name: "text-only", provider: "agent", enabled: true, capabilities: [] }],
          value: "text-only|agent",
          onChange: jest.fn(),
        },
      });
      await act(async () => fireEvent.click(screen.getByText("send")));
      expect(composer.send).not.toHaveBeenCalled();
      expect(draft.resetCompose).not.toHaveBeenCalled();
    });

    it("preserves a queued image-only follow-up through normal auto-send https://github.com/logancyang/obsidian-copilot/issues/2850", async () => {
      const { composer, getDraft, settleTurn } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
      act(() => getDraft().setSelectedImages([image]));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(1));
      expect(getDraft().queue[0]).toMatchObject({ text: "", promptContent: [imageBlock] });
      expect(getDraft().images).toHaveLength(0);

      await act(async () => settleTurn());

      expect(composer.send).toHaveBeenCalledTimes(2);
      expect(jest.mocked(composer.send).mock.calls[1].slice(0, 3)).toEqual([
        "",
        undefined,
        [imageBlock],
      ]);
      expect(getDraft().queue).toHaveLength(0);
      await act(async () => settleTurn());
    });
  });
  describe("handleStopGenerating()", () => {
    it("returns queued follow-ups to the composer before cancellation settles the active turn https://github.com/Brevilabs/obsidian-copilot-private/issues/485", async () => {
      const { composer, getDraft, settleCancel } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(1));

      await act(async () => fireEvent.click(screen.getByText("stop")));

      expect(composer.send).toHaveBeenCalledTimes(1);
      expect(getDraft().queue).toHaveLength(0);
      expect(getDraft().input).toBe("queued follow-up");
      expect(getDraft().loading).toBe(false);
      await act(async () => settleCancel());
    });

    it("joins several queued follow-ups ahead of text typed since they were queued https://github.com/Brevilabs/obsidian-copilot-private/issues/485", async () => {
      const { composer, getDraft, settleCancel } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
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
      const { composer, getDraft, settleCancel } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
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

    it("keeps a subsequent turn running when the previous cancellation resolves https://github.com/Brevilabs/obsidian-copilot-private/issues/365", async () => {
      const { composer, getDraft, settleCancel } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
      await act(async () => fireEvent.click(screen.getByText("stop")));
      act(() => getDraft().setInput("new turn after Stop"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(2));
      expect(getDraft().loading).toBe(true);

      await act(async () => settleCancel());

      expect(getDraft().loading).toBe(true);
    });
    it("returns queued follow-ups to the composer but keeps the active turn running when cancellation fails https://github.com/Brevilabs/obsidian-copilot-private/issues/365 https://github.com/Brevilabs/obsidian-copilot-private/issues/485", async () => {
      const { composer, getDraft, settleTurn } = setupCancellation();
      jest.mocked(composer.cancel).mockRejectedValueOnce(new Error("Cancellation failed"));
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(1));

      await act(async () => fireEvent.click(screen.getByText("stop")));

      expect(getDraft().queue).toHaveLength(0);
      expect(getDraft().input).toBe("queued follow-up");
      expect(getDraft().loading).toBe(true);
      await act(async () => settleTurn());
      expect(getDraft().loading).toBe(false);
      expect(composer.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("runSend()", () => {
    it("sends queued follow-ups when the active turn finishes normally", async () => {
      const { composer, getDraft, settleTurn } = setupCancellation();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(getDraft().queue).toHaveLength(1));

      await act(async () => settleTurn());

      expect(composer.send).toHaveBeenCalledTimes(2);
      expect(getDraft().queue).toHaveLength(0);
      expect(getDraft().loading).toBe(true);
      await act(async () => settleTurn());
      expect(getDraft().loading).toBe(false);
    });
    it(`returns the message to the composer and asks the user to check the chat first when the connection dropped before the host answered, because the host may have run it (${ISSUE_613})`, async () => {
      jest.mocked(Notice).mockClear();
      mockPrependContent.mockClear();
      const composer = {
        send: jest.fn(async () => {
          throw new Error("disconnected");
        }),
        cancel: jest.fn(),
      } as unknown as ComposerMock;
      const note = makeFile("Trip.md");
      const draft = makeDraft({ input: "Plan the trip", contextNotes: [note] });

      renderInput(composer, draft);
      fireEvent.click(screen.getByText("send"));

      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith(
          "Connection lost while sending. Your message is back in the box: check the chat, and send it again only if it did not arrive."
        )
      );
      expect(mockPrependContent).toHaveBeenCalledWith("Plan the trip", [], []);
      const restoreNotes = jest.mocked(draft.setContextNotes).mock.calls[0][0] as (
        previous: TFile[]
      ) => TFile[];
      expect(restoreNotes([])).toEqual([note]);
    });

    it(`returns the message to the composer with a retry notice when the host refused it (${ISSUE_613})`, async () => {
      jest.mocked(Notice).mockClear();
      mockPrependContent.mockClear();
      const composer = {
        send: jest.fn(async () => {
          throw new Error("Session is closed");
        }),
        cancel: jest.fn(),
      } as unknown as ComposerMock;

      renderInput(composer, makeDraft({ input: "Plan the trip" }));
      fireEvent.click(screen.getByText("send"));

      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith("Failed to send message. Please try again.")
      );
      expect(mockPrependContent).toHaveBeenCalledWith("Plan the trip", [], []);
    });

    it(`returns the queued follow-ups with the failed message, in the order they were written, instead of sending them into a dead connection (${ISSUE_613})`, async () => {
      mockPrependContent.mockClear();
      let rejectSend!: (error: Error) => void;
      const composer = {
        send: jest.fn(
          () =>
            new Promise((_resolve, reject) => {
              rejectSend = reject;
            })
        ),
        cancel: jest.fn(),
      } as unknown as ComposerMock;
      const draft = makeDraft({ input: "first this" });
      const view = renderInput(composer, draft);
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalled());
      const withFollowUp = makeDraft({
        loading: true,
        queue: [{ id: "q1", text: "then this", rawInput: "then this" }],
      });
      view.rerender(inputNode(composer, withFollowUp));

      await act(async () => rejectSend(new Error("disconnected")));

      await waitFor(() => expect(mockPrependContent).toHaveBeenCalledTimes(1));
      expect(mockPrependContent.mock.calls[0][0]).toBe("first this\n\nthen this");
      expect(jest.mocked(draft.setQueue).mock.calls.at(-1)![0]).toEqual([]);
    });

    it(`does not put a failed message into another chat's composer when the user switched chats while it was sending (${ISSUE_613})`, async () => {
      jest.mocked(Notice).mockClear();
      mockPrependContent.mockClear();
      let rejectSend!: (error: Error) => void;
      const composer = {
        send: jest.fn(
          () =>
            new Promise((_resolve, reject) => {
              rejectSend = reject;
            })
        ),
        cancel: jest.fn(),
      } as unknown as ComposerMock;
      const draft = makeDraft({ input: "Plan the trip" });
      const view = renderInput(composer, draft);
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(composer.send).toHaveBeenCalled());

      view.rerender(inputNode(composer, draft, { chatInputId: "input-2" }));
      await act(async () => rejectSend(new Error("disconnected")));

      await waitFor(() => expect(Notice).toHaveBeenCalled());
      expect(mockPrependContent).not.toHaveBeenCalled();
    });

    it("regression: clears draft.loading when the turn resolves after the composer unmounted", async () => {
      let resolveTurn!: () => void;
      const turn = new Promise<void>((resolve) => {
        resolveTurn = resolve;
      });
      const composer = {
        send: jest.fn(async () => ({ turn })),
        cancel: jest.fn(),
      } as unknown as ComposerMock;
      const draft = makeDraft();

      const { unmount } = renderInput(composer, draft);
      fireEvent.click(screen.getByText("send"));

      await waitFor(() => expect(draft.setLoading).toHaveBeenCalledWith(true));
      expect(composer.send).toHaveBeenCalledTimes(1);

      unmount();

      await act(async () => {
        resolveTurn();
        await turn;
      });

      await waitFor(() => expect(draft.setLoading).toHaveBeenCalledWith(false));
    });
  });

  describe("identity and agent-mention gate", () => {
    beforeEach(() => {
      capturedAgentBrands = undefined;
      mockNavigateToPlusPage.mockClear();
    });

    it("passes the real installed-agent list when entitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      renderInput({ send: jest.fn(), cancel: jest.fn() }, makeDraft());
      expect(capturedAgentBrands).toBe(FAKE_BRANDS);
    });

    it("clears input-scoped context only when the logical chat input changes", () => {
      const clearSelectedTextContexts = jest.requireMock("@/aiParams")
        .clearSelectedTextContexts as jest.Mock;
      clearSelectedTextContexts.mockClear();
      const composer = { send: jest.fn(), cancel: jest.fn() } as unknown as ComposerMock;
      const draft = makeDraft();
      const view = renderInput(composer, draft);

      view.rerender(inputNode(composer, draft, { chatInputId: "input-1" }));
      expect(clearSelectedTextContexts).not.toHaveBeenCalled();
      view.rerender(inputNode(composer, draft, { chatInputId: "input-2" }));
      expect(clearSelectedTextContexts).toHaveBeenCalledTimes(1);
    });

    it("offers agent mentions on a device whose own Plus check is off when the environment allows them https://github.com/Brevilabs/obsidian-copilot-private/issues/613", () => {
      mockUseCanUseMultiAgent.mockReturnValue(false);
      render(
        <AgentPaneCapabilitiesProvider value={{ vaultBase: null, multiAgentAllowed: true }}>
          {inputNode({ send: jest.fn(), cancel: jest.fn() }, makeDraft())}
        </AgentPaneCapabilitiesProvider>
      );
      expect(capturedAgentBrands).toBe(FAKE_BRANDS);
    });

    it("passes the frozen empty list (not a fresh []) when not entitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(false);
      renderInput({ send: jest.fn(), cancel: jest.fn() }, makeDraft());
      expect(capturedAgentBrands).toBe(EMPTY_AGENT_MENTION_BRANDS);
    });
  });

  describe("AgentChatInput()", () => {
    it("shows the running state while a plan-approved turn continues after the composer send settles (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      const composer = { send: jest.fn(), cancel: jest.fn() } as unknown as ComposerMock;
      const draft = makeDraft({ loading: false });
      const view = renderInput(composer, draft, { isLoading: true });

      expect(screen.getByTestId("generating-state").textContent).toBe("running");
      view.rerender(inputNode(composer, draft, { isLoading: false }));
      expect(screen.getByTestId("generating-state").textContent).toBe("idle");
    });

    it("keeps the static composer guidance when an empty draft is typed into and cleared", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      const composer = { send: jest.fn(), cancel: jest.fn() } as unknown as ComposerMock;
      const view = renderInput(composer, makeDraft({ input: "" }));
      expect(capturedPlaceholder).toBe("Ask anything • @ to add context • / for commands");
      view.rerender(inputNode(composer, makeDraft({ input: "Summarize my week" })));
      view.rerender(inputNode(composer, makeDraft({ input: "" })));
      expect(capturedPlaceholder).toBe("Ask anything • @ to add context • / for commands");
    });
  });

  describe("queue reason", () => {
    const makeBackend = () =>
      ({
        send: jest.fn(async () => ({ turn: Promise.resolve() })),
        cancel: jest.fn(),
      }) as unknown as ComposerMock;

    const enqueuedItem = (setQueue: jest.Mock) => {
      const updater = setQueue.mock.calls[0][0] as (
        q: readonly unknown[]
      ) => { queueReason?: string }[];
      return updater([])[0];
    };

    beforeEach(() => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
    });

    it("snapshots 'context' when the send is held for project-context materialization", async () => {
      const composer = makeBackend();
      const draft = makeDraft();

      renderInput(composer, draft, { activeProjectId: "proj-1", contextLoadBlocking: true });
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(draft.setQueue).toHaveBeenCalled());

      expect(composer.send).not.toHaveBeenCalled();
      expect(enqueuedItem(draft.setQueue as jest.Mock).queueReason).toBe("context");
    });

    it("snapshots 'busy' when queued behind an in-flight turn", async () => {
      const composer = makeBackend();
      const draft = makeDraft({ loading: true });

      renderInput(composer, draft);
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(draft.setQueue).toHaveBeenCalled());

      expect(composer.send).not.toHaveBeenCalled();
      expect(enqueuedItem(draft.setQueue as jest.Mock).queueReason).toBe("busy");
    });

    it("queues a message behind a plan-approved turn even after draft loading clears (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)", async () => {
      const composer = makeBackend();
      const draft = makeDraft({ loading: false });

      renderInput(composer, draft, { isLoading: true });
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(draft.setQueue).toHaveBeenCalled());

      expect(composer.send).not.toHaveBeenCalled();
      expect(enqueuedItem(draft.setQueue as jest.Mock).queueReason).toBe("busy");
    });

    it("queues a message while the session is still starting, read from the replica https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
      const composer = makeBackend();
      const draft = makeDraft();

      renderInput(composer, draft, { isStarting: true });
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(draft.setQueue).toHaveBeenCalled());

      expect(composer.send).not.toHaveBeenCalled();
      expect(enqueuedItem(draft.setQueue as jest.Mock).queueReason).toBe("busy");
    });

    it("disables the composer while a plan awaits approval, read from the replica https://github.com/Brevilabs/obsidian-copilot-private/issues/612", () => {
      const { container } = renderInput(makeBackend(), makeDraft(), {
        hasPendingPlanPermission: true,
      });
      expect(container.querySelector('[aria-disabled="true"]')).not.toBeNull();
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
      const composer = makeBackend();
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

      renderInput(composer, draft, {
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

      expect(composer.send).not.toHaveBeenCalled();
      expect(draft.setQueue).not.toHaveBeenCalled();
    });
  });

  describe("status-icon boundary", () => {
    beforeEach(() => {
      capturedTopRightAccessory = undefined;
      mockUseCanUseMultiAgent.mockReturnValue(true);
    });

    it("passes the indicator through the accessory slot when mounted", () => {
      const composer = { send: jest.fn(), cancel: jest.fn() } as unknown as ComposerMock;

      renderInput(composer, makeDraft(), { contextStatusIndicator: <span>status</span> });
      expect(capturedTopRightAccessory).toBeTruthy();
      expect(screen.getByText("status")).toBeTruthy();
    });

    it("passes no accessory when there is no indicator (global scope)", () => {
      const composer = { send: jest.fn(), cancel: jest.fn() } as unknown as ComposerMock;

      renderInput(composer, makeDraft());
      expect(capturedTopRightAccessory).toBeUndefined();
    });
  });

  describe("compose reset ordering", () => {
    beforeEach(() => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
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

      const composer = {
        send: jest.fn(async () => ({ turn: Promise.resolve() })),
        cancel: jest.fn(),
      } as unknown as ComposerMock;
      const draft = makeDraft({ images: [slowImage] });

      renderInput(composer, draft);
      fireEvent.click(screen.getByText("send"));

      await waitFor(() => expect(draft.resetCompose).toHaveBeenCalledTimes(1));
      expect(composer.send).not.toHaveBeenCalled();

      await act(async () => {
        resolveRead(new ArrayBuffer(1));
        await Promise.resolve();
      });
      await waitFor(() => expect(composer.send).toHaveBeenCalledTimes(1));
      const promptContent = (composer.send as jest.Mock).mock.calls[0][2];
      expect(promptContent).toHaveLength(1);
      expect(promptContent[0].type).toBe("image");
    });
  });

  describe("hard-disable", () => {
    it("drops a send when the composer is disabled (orphaned project)", async () => {
      const composer = {
        send: jest.fn(async () => ({ turn: Promise.resolve() })),
        cancel: jest.fn(),
      } as unknown as ComposerMock;
      const draft = makeDraft();

      renderInput(composer, draft, { disabled: true });
      fireEvent.click(screen.getByText("send"));
      await act(async () => {});

      expect(composer.send).not.toHaveBeenCalled();
      expect(draft.setLoading).not.toHaveBeenCalledWith(true);
      expect(draft.resetCompose).not.toHaveBeenCalled();
    });
  });
});
