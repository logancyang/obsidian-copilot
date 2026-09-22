import * as assert from "node:assert/strict";
import * as path from "node:path";

import {
  After,
  AfterAll,
  Before,
  DataTable,
  Given,
  Status,
  Then,
  When,
  World,
  setDefaultTimeout,
  setWorldConstructor,
  type ITestCaseHookParameter,
} from "@cucumber/cucumber";

import { pinnedBinaryPath } from "../harness/pinnedBinary";
import { Conversation, Runtime } from "../harness/runtime";
import { Report } from "./report";

// Above the harness's own bounds (30s startup plus a 20s turn in one step, 30s
// teardown), so a slow runtime fails with the harness's message naming what it
// was waiting for rather than Cucumber's generic timeout.
setDefaultTimeout(60_000);

const report = new Report(path.resolve(__dirname, "..", ".report"));

/** Cucumber's per-scenario state. The harness itself knows nothing about it. */
class RuntimeWorld extends World {
  readonly runtime = new Runtime();
  startedAt = 0;
  #conversation: Conversation | null = null;

  get conversation(): Conversation {
    if (!this.#conversation) throw new Error("no conversation has been opened");
    return this.#conversation;
  }

  set conversation(value: Conversation) {
    this.#conversation = value;
  }
}

setWorldConstructor(RuntimeWorld);

Before(function (this: RuntimeWorld) {
  this.startedAt = Date.now();
});

After(async function (this: RuntimeWorld, scenario: ITestCaseHookParameter) {
  // Read before teardown: a clean shutdown right after a turn logs warnings of
  // its own (see runtime-tests/README.md).
  const problems = this.runtime.problems();
  // Cucumber passes a run whose scenarios were skipped; every scenario here is required.
  if (scenario.result?.status === Status.SKIPPED) problems.push("the scenario was skipped");
  // Read before `stop()` deletes the agent home that holds opencode's logs.
  const diagnostics = await this.runtime.diagnostics();
  try {
    problems.push(...(await this.runtime.stop()));
  } finally {
    const failed = scenario.result?.status !== Status.PASSED || problems.length > 0;
    const error = [scenario.result?.message, ...problems].filter(Boolean).join("\n");
    report.add(
      {
        name: scenario.pickle.name,
        status: failed ? "failed" : "passed",
        elapsedMs: Date.now() - this.startedAt,
        ...(error ? { error } : {}),
      },
      failed ? diagnostics : undefined
    );
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
});

AfterAll(function () {
  process.stdout.write(`\nruntime report: ${report.write()}\n`);
  // Cucumber passes a run that found no scenarios, e.g. after a path typo.
  if (report.size === 0) throw new Error("no runtime scenarios ran");
});

Given(
  "Copilot's opencode agent uses the scripted model {string} by default",
  async function (this: RuntimeWorld, model: string) {
    await this.runtime.start({ binaryPath: pinnedBinaryPath(), model });
  }
);

Given(
  "the model will answer {string} to exactly the message I send",
  function (this: RuntimeWorld, text: string) {
    this.runtime.provider.answer(text);
  }
);

When("I send {string} in a new conversation", async function (this: RuntimeWorld, text: string) {
  this.conversation = await this.runtime.openConversation();
  await this.conversation.send(text);
});

Then("the answer grew in the conversation as:", function (this: RuntimeWorld, table: DataTable) {
  const shown = this.conversation.timeline
    .map((snapshot) => snapshot.text)
    .filter((text, i, all) => text !== "" && text !== all[i - 1]);
  assert.deepEqual(shown, table.raw().flat());
});

Then("the turn ended only after its last word", function (this: RuntimeWorld) {
  const timeline = this.conversation.timeline;
  const ended = timeline.findIndex((snapshot) => snapshot.stopReason !== null);
  assert.equal(ended, timeline.length - 1, `the answer went ${JSON.stringify(timeline)}`);
  assert.equal(
    timeline.at(-1)?.text,
    timeline.at(-2)?.text,
    "the answer changed as the turn ended"
  );
});

Then("the conversation shows exactly:", function (this: RuntimeWorld, table: DataTable) {
  const shown = this.conversation.messages.map((m) => [
    m.sender,
    m.message,
    m.turnStopReason ?? "",
  ]);
  assert.deepEqual(shown, table.rows());
});
