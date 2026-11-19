import { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendState } from "@/agentMode/session/types";
import type { AgentMention } from "@/agents/agentMentions";
import type { AskedAgentChat, HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import {
  createFakeAgentBackend,
  type FakeAgentBackend,
} from "@/agents/agentMode/testing/fakeAgentBackend";
import { AskedAgentView, ChatAskedAgentView } from "@/agents/agentMode/ui/AskedAgentView";
import { COCO, LEO } from "@/agents/ui/testing/rosterFixtures";
import { AppContext } from "@/context";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
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

function renderView(
  change: Partial<AgentMention> = {},
  chat: AskedAgentChat | null = { session: leo, continuedAt: new Map() }
) {
  const onBack = jest.fn();
  jest.useFakeTimers({ now: STARTED + 3 * 60_000 + 12_000 });
  render(
    <AppContext.Provider value={APP}>
      <AskedAgentView
        run={run(change)}
        from="Coco"
        fromFaceSrc={COCO.faceSrc}
        faceSrc={LEO.faceSrc}
        chat={chat}
        app={APP}
        onBack={onBack}
      />
    </AppContext.Provider>
  );
  return { onBack };
}

describe("AskedAgentView", () => {
  beforeEach(async () => {
    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    fake = createFakeAgentBackend(SONNET);
    await startLeo();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (window as { ResizeObserver?: unknown }).ResizeObserver;
  });

  describe("AskedAgentView()", () => {
    it(`heads the view with the agent, who sent it and its model, and the run's state with its clock, and gives no place to type (${ISSUE})`, async () => {
      await turn(job("Reconcile October."), "Matching by date.");
      renderView();

      expect(screen.getByText("Leo")).toBeTruthy();
      expect(screen.getByText("Sent by Coco · Sonnet 5.5")).toBeTruthy();
      expect(screen.getByText("Working · 3:12")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Back to Coco" })).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(
        screen.getByText("You can only watch here. To tell Leo something, tell Coco.")
      ).toBeTruthy();
    });

    it(`shows what the asking agent sent in its own words, then the agent's steps (${ISSUE})`, async () => {
      await turn(job("Reconcile October."), "Matching by date.");
      renderView();

      expect(screen.getByText(/^Coco asked Leo · \d+:\d\d$/)).toBeTruthy();
      expect(screen.getByText("Reconcile October.")).toBeTruthy();
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

      expect(screen.getByText(/^Coco passed on your answer · /)).toBeTruthy();
      expect(screen.getByText("October.")).toBeTruthy();
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
        "Continued at 10:21",
      ]);
    });

    it.each([
      ["question", "Waiting for you", "Leo asked a question in Coco's chat."],
      ["permission", "Needs your OK", "Leo needs your OK in Coco's chat."],
    ] as const)(
      `says a run waiting on a %s waits, without a clock it doesn't know, and points back to the asking chat to answer (${ISSUE})`,
      async (status, state, banner) => {
        await turn(job("Reconcile October."), "Which month?");
        const { onBack } = renderView({ status });

        expect(screen.getByText(state)).toBeTruthy();
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
      renderView({ status: "finished", endedAt: STARTED + 60_000 });

      expect(screen.getByText("Files changed (2)")).toBeTruthy();
      expect(screen.getByText("Figma.md")).toBeTruthy();
    });

    it(`says how a finished run ended, with how long it took and no banner (${ISSUE})`, async () => {
      await turn(job("Reconcile October."), "Done.");
      renderView({ status: "finished", endedAt: STARTED + 12 * 60_000 + 4_000 });

      expect(screen.getByText("Finished · 12:04")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Answer there" })).toBeNull();
    });

    it(`shows the error a reply failed with, as the chat does, when the agent failed before any step (${ISSUE})`, async () => {
      const sessionId = leo.getBackendSessionId()!;
      const { turn: failed } = leo.sendPrompt(job("Reconcile October."));
      failed.catch(() => undefined);
      await fake.untilPrompt(sessionId);
      act(() => fake.endTurn(sessionId, { error: new Error("The model is overloaded.") }));
      renderView({
        status: "didnt_finish",
        end: { kind: "error", message: "The model is overloaded." },
      });

      expect(screen.getByText(/The model is overloaded\./)).toBeTruthy();
    });

    it(`says a run's steps are no longer available when its chat is gone, as after a restart, and still shows how it ended (${ISSUE})`, () => {
      renderView({ status: "didnt_finish", end: { kind: "obsidian_closed" } }, null);

      expect(screen.getByText("Leo's steps from this run are no longer available.")).toBeTruthy();
      expect(screen.getByText("Didn't finish")).toBeTruthy();
      expect(screen.getByText("Sent by Coco")).toBeTruthy();
    });

    it(`says the agent is starting while its chat opens (${ISSUE})`, () => {
      renderView({}, null);

      expect(screen.getByText("Starting…")).toBeTruthy();
      expect(screen.getByText("Sent by Coco")).toBeTruthy();
    });
  });

  describe("ChatAskedAgentView()", () => {
    it.each([
      ["coco", "Sent by Coco · Sonnet 5.5"],
      [null, "Sent by Copilot · Sonnet 5.5"],
    ])(
      `names the asking chat's agent, or Copilot for a chat without one, and shows the run's chat (${ISSUE})`,
      async (agentSlug, sentBy) => {
        await turn(job("Reconcile October."), "Matching by date.");
        const asking = { agentSlug } as AgentSession;
        const askedChat = jest.fn(() => ({ session: leo, continuedAt: new Map() }));

        render(
          <ChatAskedAgentView
            run={run()}
            chat={asking}
            hiddenChats={{ askedChat } as unknown as HiddenAgentChats}
            agents={[COCO, LEO]}
            app={APP}
            onBack={() => {}}
          />
        );

        expect(screen.getByText(sentBy)).toBeTruthy();
        expect(askedChat).toHaveBeenCalledWith(asking, run());
        expect(screen.getByText("Matching by date.")).toBeTruthy();
      }
    );
  });
});
