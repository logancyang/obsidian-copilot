import { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage, BackendState } from "@/agentMode/session/types";
import type { AgentMention } from "@/agents/agentMentions";
import type { AskedAgentChat, HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import {
  createFakeAgentBackend,
  type FakeAgentBackend,
} from "@/agents/agentMode/testing/fakeAgentBackend";
import { AskedAgentView, ChatAskedAgentView } from "@/agents/agentMode/ui/AskedAgentView";
import { formatAgentReply } from "@/agents/agentReply";
import { COCO, LEO } from "@/agents/ui/testing/rosterFixtures";
import { AppContext } from "@/context";
import { formatMessageClock, formatMessageDateTime } from "@/lib/messageTime";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/components/chat-components/ChatSingleMessage", () => ({
  __esModule: true,
  default: ({ message }: { message: { sender: string; message: string } }) => (
    <div data-testid={`message-${message.sender}`}>{message.message}</div>
  ),
}));
jest.mock("@/agentMode/ui/AgentTrailView", () => ({
  AgentTrail: ({
    parts,
    errorText,
  }: {
    parts: { kind: string; text?: string }[];
    errorText?: string;
  }) => (
    <div>
      {parts.map((part) => part.text ?? "").join("")}
      {errorText}
    </div>
  ),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/948";
const CARDS = "https://github.com/Brevilabs/obsidian-copilot-private/issues/967";
const STARTED = new Date(2026, 10, 16, 10, 2).getTime();
const APP = {} as App;
const SONNET: BackendState = {
  model: {
    current: { baseModelId: "sonnet", effort: null },
    availableModels: [
      { baseModelId: "sonnet", name: "Sonnet 5.5", provider: null, effortOptions: [] },
    ],
    apply: { kind: "setModel" },
  },
  mode: null,
};

function job(text: string): string {
  return `Coco asked you this for the user, from another chat.\n\n<message from="Coco">\n${text}\n</message>`;
}

function run(change: Partial<AgentMention> = {}): AgentMention {
  return {
    id: "run-1",
    agent: "leo",
    name: "Leo",
    status: "working",
    startedAt: STARTED,
    ...change,
  };
}

let fake: FakeAgentBackend;
let leo: AgentSession;

async function startLeo(): Promise<void> {
  leo = new AgentSession({
    backend: fake.backend,
    cwd: "/vault",
    internalId: "leo-hidden",
    backendId: "fake",
  });
  await leo.ready;
}

async function turn(prompt: string, reply: string): Promise<string> {
  const sessionId = leo.getBackendSessionId()!;
  const count = fake.promptsTo(sessionId).length + 1;
  const { userMessageId } = leo.sendPrompt(prompt);
  await fake.untilPrompt(sessionId, count);
  act(() => {
    fake.say(sessionId, reply);
    fake.endTurn(sessionId);
  });
  return userMessageId;
}

function relay(mention: string, reply: string): AgentChatMessage {
  return {
    id: `relay-${mention}-${reply}`,
    sender: "user",
    timestamp: { epoch: STARTED, display: "", fileName: "" },
    isVisible: true,
    message: formatAgentReply({ agent: "leo", name: "Leo", mention, reply, changed: [] }),
  };
}

function renderView(
  change: Partial<AgentMention> = {},
  chat: AskedAgentChat | null = { session: leo, continuedAt: new Map() },
  replies?: ReadonlyMap<string, string>
) {
  const onBack = jest.fn();
  render(
    <AppContext.Provider value={APP}>
      <AskedAgentView
        run={run(change)}
        from="Coco"
        fromFaceSrc={COCO.faceSrc}
        faceSrc={LEO.faceSrc}
        chat={chat}
        replies={replies}
        app={APP}
        onBack={onBack}
      />
    </AppContext.Provider>
  );
  return { onBack };
}

const resizeCallbacks: ResizeObserverCallback[] = [];

function contentResized() {
  act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
}

function fakeLayout(scroller: HTMLElement, viewBottom: number, scrollHeight: () => number) {
  let scrollTop = 0;
  Object.defineProperties(scroller, {
    scrollHeight: { get: scrollHeight },
    clientHeight: { get: () => viewBottom },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => (scrollTop = Math.min(value, scrollHeight() - viewBottom)),
    },
  });
  scroller.getBoundingClientRect = () => ({ bottom: viewBottom }) as DOMRect;
  return () => scrollTop;
}

describe("AskedAgentView", () => {
  beforeEach(async () => {
    resizeCallbacks.length = 0;
    window.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    fake = createFakeAgentBackend(SONNET);
    await startLeo();
  });

  afterEach(() => {
    delete (window as { ResizeObserver?: unknown }).ResizeObserver;
  });

  describe("AskedAgentView()", () => {
    it(`heads the view with one row, Back then the asking agent and the asked agent with their faces, no model, state or clock, and gives no place to type (${CARDS})`, async () => {
      await turn(job("Reconcile October."), "Matching by date.");
      renderView();

      const header = screen.getByRole("button", { name: "Back to Coco" }).parentElement!;
      expect(header.textContent).toBe("CocoLeo");
      expect([...header.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
        COCO.faceSrc,
        LEO.faceSrc,
      ]);
      expect(screen.queryByText(/Sent by|Working|Sonnet|\d:\d\d/)).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(
        screen.getByText("You can only watch here. To tell Leo something, tell Coco.")
      ).toBeTruthy();
    });

    it(`shows what the asking agent sent in its own words as a user's message, then the agent's steps (${CARDS})`, async () => {
      await turn(job("Reconcile October."), "Matching by date.");
      renderView();

      expect(screen.getByTestId("message-user").textContent).toBe("Reconcile October.");
      expect(screen.queryByText(/asked you this for the user/)).toBeNull();
      expect(screen.getByText("Matching by date.")).toBeTruthy();
    });

    it(`marks an answer the asking agent passed on as the user's answer (${ISSUE})`, async () => {
      await turn(job("Reconcile October."), "Which month?");
      await turn(
        `Coco passed on the user's answer to your question.\n\n<answer from="user">\nOctober.\n</answer>`,
        "Counting them in October."
      );
      renderView();

      expect(screen.getByText("Coco passed on your answer")).toBeTruthy();
      expect(screen.getAllByTestId("message-user").map((bubble) => bubble.textContent)).toEqual([
        "Reconcile October.",
        "October.",
      ]);
    });

    it(`divides the earlier work from a later run with the time the agent was sent back (${ISSUE})`, async () => {
      const first = await turn(job("Reconcile October."), "Matched 182 of 214.");
      const second = await turn(job("Send Leo back to it."), "Picking up at 183.");
      const sentBack = new Date(2026, 10, 16, 10, 21).getTime();
      renderView(
        {},
        {
          session: leo,
          continuedAt: new Map([
            [first, STARTED],
            [second, sentBack],
          ]),
        }
      );

      expect(screen.getAllByText(/^Continued at/).map((divider) => divider.textContent)).toEqual([
        `Continued at ${formatMessageClock(sentBack)}`,
      ]);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/971 writes the divider's time as the view's message times show theirs, a short clock time in the user's locale with the full date and time on hover", async () => {
      const first = await turn(job("Reconcile October."), "Matched 182 of 214.");
      const second = await turn(job("Send Leo back to it."), "Picking up at 183.");
      const sentBack = new Date(2026, 10, 16, 21, 54).getTime();
      renderView(
        {},
        {
          session: leo,
          continuedAt: new Map([
            [first, STARTED],
            [second, sentBack],
          ]),
        }
      );

      const divider = screen.getByText(/^Continued at/);
      expect(divider.textContent).toBe(`Continued at ${formatMessageClock(sentBack)}`);
      expect(divider.getAttribute("title")).toBe(formatMessageDateTime(sentBack));
    });

    it(`opened for an earlier run, rests where that run ends, above the next run's divider, so its reply is in view (${CARDS})`, async () => {
      const first = await turn(job("Reconcile October."), "Matched 182 of 214.");
      const second = await turn(job("Send Leo back to it."), "Picking up at 183.");
      renderView(
        {},
        {
          session: leo,
          continuedAt: new Map([
            [first, STARTED],
            [second, STARTED + 60_000],
          ]),
        }
      );
      const divider = screen.getByText(/^Continued at/);
      const scrollTop = fakeLayout(
        divider.closest<HTMLElement>(".tw-overflow-y-auto")!,
        300,
        () => 1000
      );
      divider.getBoundingClientRect = () => ({ top: 500 - scrollTop() }) as DOMRect;

      contentResized();

      expect(scrollTop()).toBe(200);
    });

    it(`opened for an earlier run, follows the newer run's output again once scrolled to the real bottom (${CARDS})`, async () => {
      const first = await turn(job("Reconcile October."), "Matched 182 of 214.");
      const second = await turn(job("Send Leo back to it."), "Picking up at 183.");
      renderView(
        {},
        {
          session: leo,
          continuedAt: new Map([
            [first, STARTED],
            [second, STARTED + 60_000],
          ]),
        }
      );
      const divider = screen.getByText(/^Continued at/);
      const scroller = divider.closest<HTMLElement>(".tw-overflow-y-auto")!;
      let height = 1000;
      const scrollTop = fakeLayout(scroller, 300, () => height);
      divider.getBoundingClientRect = () => ({ top: 500 - scrollTop() }) as DOMRect;
      contentResized();

      scroller.scrollTop = 700;
      fireEvent.scroll(scroller);
      height = 1400;
      contentResized();

      expect(scrollTop()).toBe(1100);
    });

    it(`opened for the latest run, rests at the end of the conversation (${CARDS})`, async () => {
      const first = await turn(job("Reconcile October."), "Matched 182 of 214.");
      const second = await turn(job("Send Leo back to it."), "Picking up at 183.");
      renderView(
        { startedAt: STARTED + 60_000 },
        {
          session: leo,
          continuedAt: new Map([
            [first, STARTED],
            [second, STARTED + 60_000],
          ]),
        }
      );
      const scrollTop = fakeLayout(
        screen.getByText(/^Continued at/).closest<HTMLElement>(".tw-overflow-y-auto")!,
        300,
        () => 1000
      );

      contentResized();

      expect(scrollTop()).toBe(700);
    });

    it.each([
      ["question", "Leo asked a question in Coco's chat."],
      ["permission", "Leo needs your OK in Coco's chat."],
    ] as const)(
      `points back to the asking chat to answer a run waiting on a %s (${ISSUE})`,
      async (status, banner) => {
        await turn(job("Reconcile October."), "Which month?");
        const { onBack } = renderView({ status });

        expect(screen.getByText(banner)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Answer there" }));
        expect(onBack).toHaveBeenCalled();
      }
    );

    it(`lists the files a turn changed below it, like the chat does (${ISSUE})`, async () => {
      await turn(job("Add the Figma contact."), "Done.");
      const reply = leo.store.getDisplayMessages().at(-1)!;
      const change = (path: string) => ({
        path,
        status: "modified" as const,
        before: "",
        after: "Checked: yes\n",
        additions: 1,
        deletions: 0,
      });
      leo.store.setFileChanges(reply.id, [change("Finance/Figma.md"), change("Finance/AWS.md")]);
      renderView({ status: "finished" });

      expect(screen.getByText("Files changed (2)")).toBeTruthy();
      expect(screen.getByText("Figma.md")).toBeTruthy();
    });

    it(`shows no banner once the run finished (${ISSUE})`, async () => {
      await turn(job("Reconcile October."), "Done.");
      renderView({ status: "finished" });

      expect(screen.queryByRole("button", { name: "Answer there" })).toBeNull();
    });

    it(`shows the error a reply failed with, as the chat does, when the agent failed before any step (${ISSUE})`, async () => {
      const sessionId = leo.getBackendSessionId()!;
      const { turn: failed } = leo.sendPrompt(job("Reconcile October."));
      failed.catch(() => undefined);
      await fake.untilPrompt(sessionId);
      act(() => fake.endTurn(sessionId, { error: new Error("The model is overloaded.") }));
      renderView({ status: "didnt_finish" });

      expect(screen.getByText(/The model is overloaded\./)).toBeTruthy();
    });

    it(`says a run's steps are no longer available when its chat is gone, as after a restart (${ISSUE})`, () => {
      renderView({ status: "didnt_finish" }, null);

      expect(screen.getByText("Leo's steps from this run are no longer available.")).toBeTruthy();
    });

    it(`shows the words the asking chat saved from the run under that note, as the agent's messages, when its chat is gone, so a reply stays readable after a restart (${CARDS})`, () => {
      renderView(
        { status: "finished" },
        null,
        new Map([
          ["question", "Which month?"],
          ["reply", "Matched 182 of 214."],
        ])
      );

      const note = screen.getByText("Leo's steps from this run are no longer available.");
      expect(note.nextElementSibling?.textContent).toBe("Which month?");
      expect(note.nextElementSibling?.nextElementSibling?.textContent).toBe("Matched 182 of 214.");
    });

    it(`says the agent is starting while its chat opens (${ISSUE})`, () => {
      renderView({}, null);

      expect(screen.getByText("Starting…")).toBeTruthy();
    });
  });

  describe("ChatAskedAgentView()", () => {
    it.each([
      ["coco", "Back to Coco", "CocoLeo"],
      [null, "Back to Copilot", "CopilotLeo"],
    ])(
      `names the asking chat's agent, or Copilot for a chat without one, and shows the run's chat (${CARDS})`,
      async (agentSlug, back, names) => {
        await turn(job("Reconcile October."), "Matching by date.");
        const asking = { agentSlug } as AgentSession;
        const askedChat = jest.fn(() => ({ session: leo, continuedAt: new Map() }));

        render(
          <ChatAskedAgentView
            run={run()}
            chat={asking}
            hiddenChats={{ askedChat } as unknown as HiddenAgentChats}
            messages={[]}
            agents={[COCO, LEO]}
            app={APP}
            onBack={() => {}}
          />
        );

        expect(screen.getByRole("button", { name: back }).parentElement?.textContent).toBe(names);
        expect(askedChat).toHaveBeenCalledWith(asking, run());
        expect(screen.getByText("Matching by date.")).toBeTruthy();
      }
    );

    it(`when the run's chat is gone, shows every non-empty reply the asking chat saved for this run, in order, and none of another run's (${CARDS})`, () => {
      render(
        <ChatAskedAgentView
          run={run({ status: "finished" })}
          chat={{ agentSlug: "coco" } as AgentSession}
          hiddenChats={{ askedChat: () => null } as unknown as HiddenAgentChats}
          messages={[
            relay("run-1", "Which month?"),
            relay("run-2", "Another run's reply."),
            relay("run-1", ""),
            relay("run-1", "Matched 182 of 214."),
          ]}
          agents={[COCO, LEO]}
          app={APP}
          onBack={() => {}}
        />
      );

      const note = screen.getByText("Leo's steps from this run are no longer available.");
      expect(note.parentElement?.textContent).toBe(
        "Leo's steps from this run are no longer available.Which month?Matched 182 of 214."
      );
    });
  });
});
