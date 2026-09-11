import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { EMPTY_AGENT_MENTION_BRANDS } from "@/components/chat-components/hooks/useAtMentionCategories";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { AgentTaskCoordinator } from "@/agentMode/session/AgentTaskCoordinator";
import type { AgentQueuedTask } from "@/agentMode/session/AgentTaskCoordinator";
import type { AgentTaskResult, AgentTaskSubmission } from "@/agentMode/session/voiceTypes";
import type { StopReason } from "@/agentMode/session/types";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice, type App } from "obsidian";
import React from "react";

// Mock factory names must match the real `use*` exports, so the no-hook `use`
// prefix is expected on the mocked hooks below.
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

// Entitlement gate — flipped per test.
const mockUseCanUseMultiAgent = jest.fn<boolean, []>();
const mockNavigateToPlusPage = jest.fn();
jest.mock("@/plusUtils", () => ({
  useCanUseMultiAgent: () => mockUseCanUseMultiAgent(),
  navigateToPlusPage: (...args: unknown[]) => mockNavigateToPlusPage(...args),
}));

// Installed agents the gate either surfaces or suppresses.
const FAKE_BRANDS = Object.freeze([{ id: "claude", displayName: "Claude", Icon: () => null }]);
jest.mock("@/agentMode/ui/mentionedAgents", () => ({
  EMPTY_ANSWERERS: Object.freeze([]),
  isFanout: () => false,
  resolveAnswerers: () => [],
  useInstalledAgentBrands: () => FAKE_BRANDS,
}));

// One ChatInput mock serves both suites: it captures the brands handed to the
// editor (agent-mention gate) AND renders a clickable send button that routes
// through `handleSendMessage` — the same entry the real Lexical editor's Enter
// key hits (send-flow regression tests).
let capturedAgentBrands: ReadonlyArray<unknown> | undefined;
let capturedTopRightAccessory: React.ReactNode | undefined;
let capturedPlaceholder: string | undefined;
jest.mock("@/components/chat-components/ChatInput", () => ({
  __esModule: true,
  default: (props: {
    agentBrands?: ReadonlyArray<unknown>;
    topRightAccessory?: React.ReactNode;
    placeholder?: string;
    handleSendMessage?: () => void;
    onStopGenerating?: () => void;
  }) => {
    capturedAgentBrands = props.agentBrands;
    capturedTopRightAccessory = props.topRightAccessory;
    capturedPlaceholder = props.placeholder;
    return (
      <>
        {props.topRightAccessory}
        <button type="button" onClick={() => props.handleSendMessage?.()}>
          send
        </button>
        <button type="button" onClick={() => props.onStopGenerating?.()}>
          stop
        </button>
      </>
    );
  },
}));

jest.mock("@/components/chat-components/hooks/useActiveWebTabState", () => ({
  useActiveWebTabState: () => ({ activeWebTabForMentions: undefined }),
}));
jest.mock("@/aiParams", () => ({
  clearSelectedTextContexts: jest.fn(),
  removeSelectedTextContext: jest.fn(),
  useSelectedTextContexts: () => [[], jest.fn()],
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

const makeDraft = (overrides: Partial<AgentInputDraftControls> = {}): AgentInputDraftControls => ({
  input: "hello",
  images: [],
  contextNotes: [],
  includeActiveNote: false,
  includeActiveWebTab: false,
  setInput: jest.fn(),
  setContextNotes: jest.fn(),
  setSelectedImages: jest.fn(),
  addImages: jest.fn(),
  setIncludeActiveNote: jest.fn(),
  setIncludeActiveWebTab: jest.fn(),
  resetCompose: jest.fn(),
  ...overrides,
});

/**
 * Backend stub whose task surface is the real coordinator driven by a fake
 * session, so the composer is exercised against the scheduling contract it
 * actually talks to rather than a hand-written queue mock.
 */
function makeTaskBackend() {
  const dispatched: Array<{
    submission: AgentTaskSubmission;
    resolve: (stopReason: StopReason) => void;
  }> = [];
  const cancel = jest.fn(async () => {});
  const coordinator = new AgentTaskCoordinator({
    submitTask(submission, taskId) {
      let resolve!: (stopReason: StopReason) => void;
      const turn = new Promise<StopReason>((res) => {
        resolve = res;
      });
      dispatched.push({ submission, resolve });
      return { assistantMessageId: `assistant-${taskId}`, turn };
    },
    settleTask: (taskId): AgentTaskResult => ({
      taskId,
      state: "completed",
      assistantMessageId: `assistant-${taskId}`,
      answerText: "",
    }),
    cancel,
    getTask: (taskId) => ({
      taskId,
      sourceMessageIds: [],
      assistantMessageId: `assistant-${taskId}`,
      delegationIds: [],
      state: "running" as const,
      presentation: "text" as const,
    }),
  });
  const backend = {
    submitTask: (submission: AgentTaskSubmission) => coordinator.submit(submission),
    setQueueHold: (reason: Parameters<typeof coordinator.setDispatchHold>[0]) =>
      coordinator.setDispatchHold(reason),
    getQueuedTasks: () => coordinator.getQueuedTasks(),
    removeQueuedTask: (taskId: string) => coordinator.removeQueuedTask(taskId),
    cancelActiveAndClearQueue: () => coordinator.cancelActiveAndClearQueue(),
    getActiveTask: () => coordinator.getActiveTask(),
  } as unknown as AgentChatBackend;
  return { backend, coordinator, dispatched, cancel };
}

const NO_QUEUED_TASKS: readonly AgentQueuedTask[] = Object.freeze([]);

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
      queuedTasks={NO_QUEUED_TASKS}
      isTaskActive={false}
      isStarting={false}
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

/** Backend stub for tests that only care about what the composer submitted. */
const makeStubBackend = () =>
  ({
    submitTask: jest.fn(() => ({ taskId: "task-1", disposition: "dispatched" as const })),
    setQueueHold: jest.fn(),
    getQueuedTasks: () => NO_QUEUED_TASKS,
    removeQueuedTask: jest.fn(),
    cancelActiveAndClearQueue: jest.fn(async () => {}),
    getActiveTask: () => null,
  }) as unknown as AgentChatBackend;

const submittedTexts = (backend: AgentChatBackend) =>
  (backend.submitTask as jest.Mock).mock.calls.map(
    (call) => (call[0] as AgentTaskSubmission).requestText
  );

/**
 * Render the composer against the real coordinator, mirroring how AgentHome
 * feeds queue and active-task state back down as props.
 */
function renderComposer(extraProps: Partial<React.ComponentProps<typeof AgentChatInput>> = {}) {
  const harness = makeTaskBackend();
  let draft!: AgentInputDraftControls;
  function Harness() {
    draft = useAgentInputDrafts({
      activeChatInputId: "input-1",
      liveChatInputIds: ["input-1"],
      defaultIncludeActiveNote: false,
    });
    const [, bump] = React.useState(0);
    React.useEffect(() => harness.coordinator.subscribe(() => bump((n) => n + 1)), []);
    return inputNode(harness.backend, draft, {
      queuedTasks: harness.coordinator.getQueuedTasks(),
      isTaskActive: harness.coordinator.isBusy(),
      ...extraProps,
    });
  }
  const view = render(<Harness />);
  return { ...harness, view, getDraft: () => draft };
}

describe("AgentChatInput", () => {
  describe("handleSendMessage()", () => {
    it("sends text-only commands that expand to empty without an image-read error https://github.com/logancyang/obsidian-copilot/issues/2850", async () => {
      jest.mocked(expandCustomCommandPrefix).mockResolvedValueOnce({ text: "" });
      jest.mocked(Notice).mockClear();
      const backend = makeStubBackend();
      renderInput(backend, makeDraft({ input: "/empty" }));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(backend.submitTask).toHaveBeenCalledTimes(1));
      expect(Notice).not.toHaveBeenCalled();
    });

    const image = {
      type: "image/png",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File;
    const imageBlock = { type: "image", mimeType: "image/png", data: "AQID" };

    it.each(["", "   ", "Describe this"])(
      "sends image content with draft %p https://github.com/logancyang/obsidian-copilot/issues/2850",
      async (input) => {
        const backend = makeStubBackend();
        const draft = makeDraft({ input, images: [image] });
        renderInput(backend, draft);
        fireEvent.click(screen.getByText("send"));
        await waitFor(() => expect(backend.submitTask).toHaveBeenCalledTimes(1));
        expect((backend.submitTask as jest.Mock).mock.calls[0][0]).toMatchObject({
          source: "typed",
          presentation: "text",
          requestText: input.trim(),
          context: undefined,
          promptContent: [imageBlock],
        });
        expect(draft.resetCompose).toHaveBeenCalledTimes(1);
      }
    );

    it.each(["", "   "])(
      "does not send empty draft %p without images https://github.com/logancyang/obsidian-copilot/issues/2850",
      async (input) => {
        const backend = makeStubBackend();
        const draft = makeDraft({ input });
        renderInput(backend, draft);
        await act(async () => fireEvent.click(screen.getByText("send")));
        expect(backend.submitTask).not.toHaveBeenCalled();
        expect(draft.resetCompose).not.toHaveBeenCalled();
      }
    );

    it.each(["empty", "unreadable"])(
      "does not submit an image-only draft when its image is %s https://github.com/logancyang/obsidian-copilot/issues/2850",
      async (failure) => {
        jest.mocked(Notice).mockClear();
        const brokenImage = {
          type: "image/png",
          arrayBuffer: async () => {
            if (failure === "unreadable") throw new Error("Image read failed");
            return new ArrayBuffer(0);
          },
        } as File;
        const backend = makeStubBackend();
        renderInput(backend, makeDraft({ input: "", images: [brokenImage] }));
        await act(async () => fireEvent.click(screen.getByText("send")));
        expect(backend.submitTask).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(
          "Could not read the attached images. Please attach them again."
        );
      }
    );

    it("keeps an image-only draft when the selected model lacks vision https://github.com/logancyang/obsidian-copilot/issues/2850", async () => {
      const backend = makeStubBackend();
      const draft = makeDraft({ input: "", images: [image] });
      renderInput(backend, draft, {
        modelPickerOverride: {
          models: [{ name: "text-only", provider: "agent", enabled: true, capabilities: [] }],
          value: "text-only|agent",
          onChange: jest.fn(),
        },
      });
      await act(async () => fireEvent.click(screen.getByText("send")));
      expect(backend.submitTask).not.toHaveBeenCalled();
      expect(draft.resetCompose).not.toHaveBeenCalled();
    });

    it("records each typed message in the input history as it is submitted", async () => {
      const backend = makeStubBackend();
      const updateUserMessageHistory = jest.fn();
      renderInput(backend, makeDraft({ input: "remember this" }), { updateUserMessageHistory });
      await act(async () => fireEvent.click(screen.getByText("send")));
      expect(updateUserMessageHistory).toHaveBeenCalledWith("remember this");
    });

    it("preserves a queued image-only follow-up through normal auto-send https://github.com/logancyang/obsidian-copilot/issues/2850", async () => {
      const { dispatched, getDraft, coordinator } = renderComposer();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(dispatched).toHaveLength(1));
      act(() => getDraft().setSelectedImages([image]));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(coordinator.getQueuedTasks()).toHaveLength(1));
      expect(coordinator.getQueuedTasks()[0].submission).toMatchObject({
        requestText: "",
        promptContent: [imageBlock],
      });
      expect(getDraft().images).toHaveLength(0);

      await act(async () => dispatched[0].resolve("end_turn"));

      expect(dispatched).toHaveLength(2);
      expect(dispatched[1].submission).toMatchObject({
        requestText: "",
        promptContent: [imageBlock],
      });
      expect(coordinator.getQueuedTasks()).toHaveLength(0);
    });
  });

  describe("handleStopGenerating()", () => {
    it("discards queued follow-ups before cancellation settles the active turn https://github.com/Brevilabs/obsidian-copilot-private/issues/365", async () => {
      const { dispatched, cancel, coordinator, getDraft } = renderComposer();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(dispatched).toHaveLength(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(coordinator.getQueuedTasks()).toHaveLength(1));
      cancel.mockImplementation(async () => dispatched[0].resolve("cancelled"));

      await act(async () => fireEvent.click(screen.getByText("stop")));

      expect(dispatched).toHaveLength(1);
      expect(coordinator.getQueuedTasks()).toHaveLength(0);
      expect(coordinator.isBusy()).toBe(false);
    });

    it("keeps a subsequent turn running when the previous cancellation resolves", async () => {
      const { dispatched, cancel, coordinator, getDraft } = renderComposer();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(dispatched).toHaveLength(1));
      cancel.mockImplementation(async () => dispatched[0].resolve("cancelled"));
      await act(async () => fireEvent.click(screen.getByText("stop")));

      act(() => getDraft().setInput("new turn after Stop"));
      fireEvent.click(screen.getByText("send"));

      await waitFor(() => expect(dispatched).toHaveLength(2));
      expect(coordinator.isBusy()).toBe(true);
    });

    it("discards queued follow-ups but keeps the active turn running when cancellation fails https://github.com/Brevilabs/obsidian-copilot-private/issues/365", async () => {
      const { dispatched, cancel, coordinator, getDraft } = renderComposer();
      cancel.mockRejectedValueOnce(new Error("Cancellation failed"));
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(dispatched).toHaveLength(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(coordinator.getQueuedTasks()).toHaveLength(1));

      await act(async () => fireEvent.click(screen.getByText("stop")));

      expect(coordinator.getQueuedTasks()).toHaveLength(0);
      expect(coordinator.isBusy()).toBe(true);
      await act(async () => dispatched[0].resolve("end_turn"));
      expect(coordinator.isBusy()).toBe(false);
      expect(dispatched).toHaveLength(1);
    });
  });

  describe("queue dispatch", () => {
    it("combines queued follow-ups into one turn when the active turn finishes", async () => {
      const { dispatched, coordinator, getDraft } = renderComposer();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(dispatched).toHaveLength(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      act(() => getDraft().setInput("second follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(coordinator.getQueuedTasks()).toHaveLength(2));

      await act(async () => dispatched[0].resolve("end_turn"));

      expect(dispatched).toHaveLength(2);
      expect(dispatched[1].submission.requestText).toBe("queued follow-up\n\nsecond follow-up");
      expect(coordinator.getQueuedTasks()).toHaveLength(0);
    });

    it("holds dispatch once the composer unmounts so a backgrounded chat never flushes", async () => {
      // Only the foreground conversation may drain its queue; switching chats
      // unmounts this composer and must re-apply the hold.
      // See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Local task submission and queue".
      const { dispatched, coordinator, getDraft, view } = renderComposer();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(dispatched).toHaveLength(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(coordinator.getQueuedTasks()).toHaveLength(1));

      view.unmount();
      await act(async () => dispatched[0].resolve("end_turn"));

      expect(dispatched).toHaveLength(1);
      expect(coordinator.getQueuedTasks()).toHaveLength(1);
    });

    it("removes a queued row the user dismissed", async () => {
      const { dispatched, coordinator, getDraft } = renderComposer();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(dispatched).toHaveLength(1));
      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(coordinator.getQueuedTasks()).toHaveLength(1));

      await act(async () => fireEvent.click(screen.getByLabelText("Remove queued message")));

      expect(coordinator.getQueuedTasks()).toHaveLength(0);
    });
  });

  describe("identity and agent-mention gate", () => {
    beforeEach(() => {
      capturedAgentBrands = undefined;
      mockNavigateToPlusPage.mockClear();
    });

    it("passes the real installed-agent list when entitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      renderInput(makeStubBackend(), makeDraft());
      expect(capturedAgentBrands).toBe(FAKE_BRANDS);
    });

    it("clears input-scoped context only when the logical chat input changes", () => {
      const clearSelectedTextContexts = jest.requireMock("@/aiParams")
        .clearSelectedTextContexts as jest.Mock;
      clearSelectedTextContexts.mockClear();
      const backend = makeStubBackend();
      const draft = makeDraft();
      const view = renderInput(backend, draft);

      view.rerender(inputNode(backend, draft, { chatInputId: "input-1" }));
      expect(clearSelectedTextContexts).not.toHaveBeenCalled();
      view.rerender(inputNode(backend, draft, { chatInputId: "input-2" }));
      expect(clearSelectedTextContexts).toHaveBeenCalledTimes(1);
    });

    it("passes the frozen empty list (not a fresh []) when not entitled", () => {
      mockUseCanUseMultiAgent.mockReturnValue(false);
      renderInput(makeStubBackend(), makeDraft());
      expect(capturedAgentBrands).toBe(EMPTY_AGENT_MENTION_BRANDS);
    });
  });

  describe("AgentChatInput()", () => {
    it("keeps the static composer guidance when an empty draft is typed into and cleared", () => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
      const backend = makeStubBackend();
      const view = renderInput(backend, makeDraft({ input: "" }));
      expect(capturedPlaceholder).toBe("Ask anything • @ to add context • / for commands");
      view.rerender(inputNode(backend, makeDraft({ input: "Summarize my week" })));
      view.rerender(inputNode(backend, makeDraft({ input: "" })));
      expect(capturedPlaceholder).toBe("Ask anything • @ to add context • / for commands");
    });
  });

  describe("queue reason", () => {
    const queuedTask = (
      queueReason: AgentQueuedTask["queueReason"],
      requestText: string,
      promptContent?: AgentTaskSubmission["promptContent"]
    ): AgentQueuedTask => ({
      taskId: `task-${requestText}`,
      queueReason,
      submission: {
        submissionId: `submission-${requestText}`,
        conversationId: "input-1",
        sourceMessageIds: [],
        source: "typed",
        presentation: "text",
        requestText,
        rawInput: requestText,
        promptContent,
      },
    });

    beforeEach(() => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
    });

    it("snapshots 'context' when the send is held for project-context materialization", async () => {
      const { coordinator, dispatched, getDraft } = renderComposer({
        activeProjectId: "proj-1",
        contextLoadBlocking: true,
      });
      act(() => getDraft().setInput("held for context"));
      fireEvent.click(screen.getByText("send"));

      await waitFor(() => expect(coordinator.getQueuedTasks()).toHaveLength(1));
      expect(dispatched).toHaveLength(0);
      expect(coordinator.getQueuedTasks()[0].queueReason).toBe("context");
    });

    it("snapshots 'busy' when queued behind an in-flight turn", async () => {
      const { coordinator, dispatched, getDraft } = renderComposer();
      act(() => getDraft().setInput("first turn"));
      fireEvent.click(screen.getByText("send"));
      await waitFor(() => expect(dispatched).toHaveLength(1));

      act(() => getDraft().setInput("queued follow-up"));
      fireEvent.click(screen.getByText("send"));

      await waitFor(() => expect(coordinator.getQueuedTasks()).toHaveLength(1));
      expect(coordinator.getQueuedTasks()[0].queueReason).toBe("busy");
    });

    it("labels only context-held rows with the amber waiting prefix", () => {
      renderInput(makeStubBackend(), makeDraft(), {
        queuedTasks: [
          queuedTask("context", "held for context"),
          queuedTask("busy", "held while busy"),
        ],
      });

      const rows = screen.getAllByTitle(/held/);
      expect(rows[0].textContent).toContain("Waiting for context · held for context");
      expect(rows[1].textContent).toContain("held while busy");
      expect(rows[1].textContent).not.toContain("Waiting for context");
    });

    it("keeps queued images parked when the active model is known not to support vision", async () => {
      jest.mocked(Notice).mockClear();
      const backend = makeStubBackend();
      renderInput(backend, makeDraft(), {
        queuedTasks: [
          queuedTask("busy", "describe this", [
            { type: "image", mimeType: "image/png", data: "AA==" },
          ]),
        ],
        modelPickerOverride: {
          models: [{ name: "text-only", provider: "agent", enabled: true, capabilities: [] }],
          value: "text-only|agent",
          onChange: jest.fn(),
        },
      });
      await act(async () => {});

      expect(backend.setQueueHold).toHaveBeenCalledWith("busy");
      expect(Notice).toHaveBeenCalledWith(
        "text-only doesn't support images. Switch to a vision-capable model to send images."
      );
    });
  });

  describe("status-icon boundary", () => {
    // Locks the #205 layering decision: AgentChatInput owns the project-context
    // status node and hands it to the shared ChatInput only through the neutral
    // topRightAccessory slot — the shared component never learns what it is.
    beforeEach(() => {
      capturedTopRightAccessory = undefined;
      mockUseCanUseMultiAgent.mockReturnValue(true);
    });

    it("passes the indicator through the accessory slot when mounted", () => {
      renderInput(makeStubBackend(), makeDraft(), {
        contextStatusIndicator: <span>status</span>,
      });
      expect(capturedTopRightAccessory).toBeTruthy();
      expect(screen.getByText("status")).toBeTruthy();
    });

    it("passes no accessory when there is no indicator (global scope)", () => {
      renderInput(makeStubBackend(), makeDraft());
      expect(capturedTopRightAccessory).toBeUndefined();
    });
  });

  describe("compose reset ordering", () => {
    beforeEach(() => {
      mockUseCanUseMultiAgent.mockReturnValue(true);
    });

    it("regression: clears the composer before awaiting attached-image conversion (#211)", async () => {
      // Hold the image read open so ordering is observable. The composer must
      // clear the instant the user sends, not after every File.arrayBuffer()
      // resolves — leaving the draft populated across those awaits let the
      // Lexical editor race resetCompose and strand the just-sent text in the
      // input when text was sent alongside images.
      let resolveRead!: (buf: ArrayBuffer) => void;
      const image = {
        type: "image/png",
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((resolve) => {
            resolveRead = resolve;
          }),
      } as unknown as File;

      const backend = makeStubBackend();
      const draft = makeDraft({ images: [image] });

      renderInput(backend, draft);
      fireEvent.click(screen.getByText("send"));

      // Composer is cleared while the image read is still pending, before the
      // submission is handed over.
      await waitFor(() => expect(draft.resetCompose).toHaveBeenCalledTimes(1));
      expect(backend.submitTask).not.toHaveBeenCalled();

      // Finishing the read lets the submission carry the converted image.
      await act(async () => {
        resolveRead(new ArrayBuffer(1));
        await Promise.resolve();
      });
      await waitFor(() => expect(backend.submitTask).toHaveBeenCalledTimes(1));
      const submission = (backend.submitTask as jest.Mock).mock.calls[0][0] as AgentTaskSubmission;
      expect(submission.promptContent).toHaveLength(1);
      expect(submission.promptContent?.[0].type).toBe("image");
    });
  });

  describe("hard-disable", () => {
    it("drops a send when the composer is disabled (orphaned project)", async () => {
      // The mocked ChatInput's send button routes through handleSendMessage — the
      // same entry the real Lexical editor's Enter key hits. A hard-disabled
      // composer only dims + blocks pointer events in the DOM, so this keyboard
      // path must be gated in the handler or a turn leaks into a dead project.
      const backend = makeStubBackend();
      const draft = makeDraft();

      renderInput(backend, draft, { disabled: true });
      fireEvent.click(screen.getByText("send"));
      await act(async () => {});

      expect(backend.submitTask).not.toHaveBeenCalled();
      expect(draft.resetCompose).not.toHaveBeenCalled();
      expect(submittedTexts(backend)).toEqual([]);
    });
  });
});
