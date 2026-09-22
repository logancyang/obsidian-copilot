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

import { listBackendDescriptors } from "@/agentMode/backends/registry";
import { buildAgentModelPicker } from "@/agentMode/ui/agentModelPickerHelpers";
import { buildAgentModePicker } from "@/agentMode/ui/agentModePickerHelpers";
import type { AgentModePickerOverride } from "@/agentMode/ui/useAgentModePicker";
import type { AgentModelPickerOverride } from "@/agentMode/ui/useAgentModelPicker";
import { USER_SENDER } from "@/constants";
import { getModelKeyFromModel, getSettings } from "@/settings/model";

import { shownNotices } from "../harness/obsidianShim";
import { pinnedBinaryPath } from "../harness/pinnedBinary";
import { Conversation, Runtime, drawnText, type ScriptedModel } from "../harness/runtime";
import type { HeldStream, RecordedRequest } from "../harness/scriptedProvider";
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
  /** The models the scenario configures once Copilot starts. */
  models: ScriptedModel[] = [];
  #conversation: Conversation | null = null;
  /** Conversations the scenario opened by name, in the order it opened them. */
  readonly named = new Map<string, Conversation>();
  /** The answer the provider holds open, and the conversation waiting on it. */
  held: { stream: HeldStream; in: Conversation } | null = null;
  /** How many requests the provider had received when the answer was stopped. */
  requestsWhenStopped = 0;

  /** The conversation the chat view shows, which the scenario's messages go to. */
  get conversation(): Conversation {
    if (!this.#conversation) throw new Error("no conversation has been opened");
    return this.#conversation;
  }

  set conversation(value: Conversation) {
    this.#conversation = value;
  }

  conversationNamed(name: string): Conversation {
    const conversation = this.named.get(name);
    if (!conversation) throw new Error(`no conversation "${name}" has been opened`);
    return conversation;
  }

  get heldAnswer(): { stream: HeldStream; in: Conversation } {
    if (!this.held) throw new Error("the provider holds no answer");
    return this.held;
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
    await this.runtime.start({
      binaryPath: pinnedBinaryPath(),
      models: [{ provider: "scripted", model, reasoning: false }],
      defaultModel: { model, effort: null },
    });
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
  assert.deepEqual(messageRows(this.conversation), table.rows());
});

Then(
  "conversation {string} shows exactly:",
  function (this: RuntimeWorld, name: string, table: DataTable) {
    assert.deepEqual(messageRows(this.conversationNamed(name)), table.rows());
  }
);

Given(
  "Copilot's opencode agent is configured with these scripted models:",
  function (this: RuntimeWorld, table: DataTable) {
    this.models = table.hashes().map((row) => ({
      provider: row.provider,
      model: row.model,
      reasoning: row.reasoning === "yes",
    }));
  }
);

Given(
  "Copilot starts with {string} as opencode's default model",
  async function (this: RuntimeWorld, model: string) {
    await this.runtime.start({
      binaryPath: pinnedBinaryPath(),
      models: this.models,
      defaultModel: { model, effort: null },
    });
  }
);

Given(
  "Copilot starts with {string} at {string} effort as opencode's default model",
  async function (this: RuntimeWorld, model: string, effort: string) {
    await this.runtime.start({
      binaryPath: pinnedBinaryPath(),
      models: this.models,
      defaultModel: { model, effort },
    });
  }
);

When("I open a new conversation", async function (this: RuntimeWorld) {
  this.conversation = await this.runtime.openConversation();
});

When("I open conversation {string}", async function (this: RuntimeWorld, name: string) {
  this.conversation = await this.runtime.openConversation();
  this.named.set(name, this.conversation);
});

// Clicking the conversation's tab.
When("I switch to conversation {string}", function (this: RuntimeWorld, name: string) {
  this.conversation = this.conversationNamed(name);
  this.runtime.show(this.conversation);
});

// Returns once the provider holds the answer, which is after the conversation shows its words.
When(
  "I send {string}, which the model starts answering with {string} and then holds",
  async function (this: RuntimeWorld, text: string, answer: string) {
    const holding = this.runtime.provider.hold(answer);
    this.conversation.start(text);
    const stream = await this.runtime.waitForProvider(holding, "hold the answer");
    this.held = { stream, in: this.conversation };
  }
);

When(
  "the model's held answer continues with {string}",
  async function (this: RuntimeWorld, rest: string) {
    const held = this.heldAnswer;
    held.stream.release(` ${rest}`);
    await held.in.finish();
  }
);

When("the held answer's connection breaks", async function (this: RuntimeWorld) {
  const held = this.heldAnswer;
  held.stream.break();
  await held.in.finish();
});

// Returns once opencode has tried again and been refused, so it is waiting to retry.
When(
  "the held answer's connection breaks, and the provider refuses the retry with {int} {string}, asking to wait a minute",
  async function (this: RuntimeWorld, status: number, message: string) {
    const refused = this.runtime.provider.refuse(status, message, 60_000);
    this.heldAnswer.stream.break();
    await this.runtime.waitForProvider(refused, "refuse opencode's retry");
  }
);

// The chat input's stop button, then the input unlocking once the turn ends.
When("I stop the answer", async function (this: RuntimeWorld) {
  await this.conversation.stop();
  this.requestsWhenStopped = this.runtime.provider.requests.length;
  await this.conversation.finish();
});

When(
  "I send {string}, which the provider refuses with {int} {string}, asking to retry at once",
  async function (this: RuntimeWorld, text: string, status: number, message: string) {
    void this.runtime.provider.refuse(status, message, 0);
    this.runtime.expectTurnToFail(message);
    await this.conversation.send(text);
  }
);

When(
  "the provider refuses the next request with {int} {string}",
  function (this: RuntimeWorld, status: number, message: string) {
    void this.runtime.provider.refuse(status, message);
    this.runtime.expectTurnToFail(message);
  }
);

Then("opencode closed the held answer's request", async function (this: RuntimeWorld) {
  await this.runtime.requestClosed(this.heldAnswer.stream);
});

// How many times opencode retries is its own policy; runtime-tests/README.md records the counts.
Then("opencode retried {string}", function (this: RuntimeWorld, text: string) {
  const attempts = agentTurnsAsking(this.runtime.provider.requests, text).length;
  assert.ok(attempts > 1, `opencode sent "${text}" to the provider ${attempts} time(s)`);
});

Then(
  "opencode made no more attempts at {string} after the answer was stopped",
  function (this: RuntimeWorld, text: string) {
    const later = this.runtime.provider.requests.slice(this.requestsWhenStopped);
    assert.equal(agentTurnsAsking(later, text).length, 0);
  }
);

Then("the model was last asked {string}", function (this: RuntimeWorld, text: string) {
  const last = this.runtime.provider.requests.findLast((request) => request.kind === "turn");
  assert.equal(last?.question, text);
});

Then(
  "the request for {string} carried no message conversation {string} sent",
  function (this: RuntimeWorld, text: string, name: string) {
    const [request] = agentTurnsAsking(this.runtime.provider.requests, text);
    if (!request) throw new Error(`the provider received no agent turn asking "${text}"`);
    const carried = this.conversationNamed(name)
      .messages.filter((m) => m.sender === USER_SENDER)
      .map((m) => m.message)
      .filter((sent) => request.messages.some((m) => m.content.includes(sent)));
    assert.deepEqual(carried, []);
  }
);

// The status the chat's tab draws: a spinner while running, a red dot on an error.
Then("the chat's status is {string}", function (this: RuntimeWorld, status: string) {
  assert.equal(this.runtime.manager.getSession(this.conversation.id)?.getStatus(), status);
});

Then("the chat tabs show:", function (this: RuntimeWorld, table: DataTable) {
  const shownId = this.runtime.manager.getActiveSession()?.internalId;
  const rows = [...this.named].map(([name, conversation]) => {
    const session = this.runtime.manager.getSession(conversation.id);
    return [
      name,
      conversation.id === shownId ? "yes" : "no",
      session?.getStatus() ?? "closed",
      session?.getNeedsAttention() ? "yes" : "no",
    ];
  });
  assert.deepEqual(rows, table.rows());
});

When(
  "I send {string}, which the model answers with {string}",
  async function (this: RuntimeWorld, text: string, answer: string) {
    this.runtime.provider.answer(answer);
    await this.conversation.send(text);
  }
);

// The Default model setting's write.
When(
  "I set opencode's default model to {string} at {string} effort in settings",
  async function (this: RuntimeWorld, model: string, effort: string) {
    await this.runtime.manager.persistDefaultSelection("opencode", {
      baseModelId: this.runtime.wireId(model),
      effort,
    });
  }
);

// The opencode tab's model toggle, then the restart its settings subscription asks for.
When(
  "I turn off {string} for opencode in settings",
  async function (this: RuntimeWorld, model: string) {
    const configured = getSettings().configuredModels.find((m) => m.info.id === model);
    if (!configured) throw new Error(`"${model}" is not a configured model`);
    await this.runtime.modelManagement.backendConfigRegistry.disableModel(
      "opencode",
      configured.configuredModelId
    );
    await this.runtime.noteSpawnConfigChanged("model config changed");
  }
);

When("opencode restarts from the chat's Reload action", async function (this: RuntimeWorld) {
  this.conversation = await this.runtime.restartAgent();
});

// Waits for the picker to show the pick, which it does once opencode confirms it.
When(
  "I pick {string} at {string} effort in the model picker",
  async function (this: RuntimeWorld, model: string, effort: string) {
    const picker = modelPicker(this.runtime);
    const row = picker.models.find((entry) => entry.displayName === model);
    if (!row) throw new Error(`the model picker offers no "${model}"`);
    const key = getModelKeyFromModel(row);
    const option = effortOption(picker.effortOptionsByModelKey?.[key], model, effort);
    picker.commitSelection?.(key, option.value);
    const expected = `${model} at ${effort} effort`;
    await this.conversation.waitFor(
      () => pickerSelection(this.runtime) === expected,
      () => `the model picker to show ${expected}; it shows ${pickerSelection(this.runtime)}`
    );
  }
);

When("I choose {string} in the effort picker", async function (this: RuntimeWorld, effort: string) {
  const control = modelPicker(this.runtime).effort;
  if (!control) throw new Error("the model picker has no effort control");
  const option = effortOption(control.options, "the current model", effort);
  control.onChange(option.value);
  await this.conversation.waitFor(
    () => modelPicker(this.runtime).effort?.value === option.value,
    () => `the effort picker to show ${effort}; it shows ${pickerSelection(this.runtime)}`
  );
});

When("I choose {string} in the mode picker", async function (this: RuntimeWorld, label: string) {
  const picker = modePicker(this.runtime);
  const option = picker.options.find((o) => o.label === label);
  if (!option) throw new Error(`the mode picker offers no "${label}"`);
  picker.onChange(option.value);
  await this.conversation.waitFor(
    () => modeShown(this.runtime) === label,
    () => `the mode picker to show ${label}; it shows ${modeShown(this.runtime)}`
  );
});

Then("the model picker offers exactly:", function (this: RuntimeWorld, table: DataTable) {
  const picker = modelPicker(this.runtime);
  const rows = picker.models.map((entry) => [
    entry._disabledReason ? `${entry.displayName} (${entry._disabledReason})` : entry.displayName,
    (picker.effortOptionsByModelKey?.[getModelKeyFromModel(entry)] ?? [])
      .map((option) => option.label)
      .join(", "),
  ]);
  assert.deepEqual(rows, table.rows());
});

Then(
  "the model picker shows {string} at {string} effort",
  function (this: RuntimeWorld, model: string, effort: string) {
    assert.equal(pickerSelection(this.runtime), `${model} at ${effort} effort`);
  }
);

Then(
  "the model picker shows {string} with no effort control",
  function (this: RuntimeWorld, model: string) {
    assert.equal(pickerSelection(this.runtime), model);
  }
);

Then(
  "the mode picker offers {string} and shows {string}",
  function (this: RuntimeWorld, options: string, label: string) {
    const picker = modePicker(this.runtime);
    assert.equal(picker.options.map((o) => o.label).join(", "), options);
    assert.equal(modeShown(this.runtime), label);
  }
);

// A new conversation opens in the agent's own mode and switches to the saved one
// once it is ready, so this waits for the switch.
Then("the mode picker switches to {string}", async function (this: RuntimeWorld, label: string) {
  await this.conversation.waitFor(
    () => modeShown(this.runtime) === label,
    () => `the mode picker to switch to ${label}; it shows ${modeShown(this.runtime)}`
  );
});

Then("the provider answered these agent turns:", function (this: RuntimeWorld, table: DataTable) {
  const turns = this.runtime.provider.requests
    .filter((request) => request.kind === "turn")
    .map((request) => [request.endpoint, request.model, request.reasoningEffort ?? ""]);
  assert.deepEqual(turns, table.rows());
});

Then(
  "opencode's saved default is {string} at {string} effort",
  function (this: RuntimeWorld, model: string, effort: string) {
    assert.deepEqual(this.runtime.manager.getDefaultSelection("opencode"), {
      baseModelId: this.runtime.wireId(model),
      effort,
    });
  }
);

Then(
  "opencode's saved default is {string} with no effort",
  function (this: RuntimeWorld, model: string) {
    assert.deepEqual(this.runtime.manager.getDefaultSelection("opencode"), {
      baseModelId: this.runtime.wireId(model),
      effort: null,
    });
  }
);

Then("Copilot showed exactly these notices:", function (table: DataTable) {
  assert.deepEqual(shownNotices, table.raw().flat());
});

/** Each message as the chat view draws it: sender, text, and how its turn ended. */
function messageRows(conversation: Conversation): string[][] {
  return conversation.messages.map((m) => [m.sender, drawnText(m), m.turnStopReason ?? ""]);
}

/** The agent turns among `requests` that ask `question`. */
function agentTurnsAsking(
  requests: readonly RecordedRequest[],
  question: string
): RecordedRequest[] {
  return requests.filter((request) => request.kind === "turn" && request.question === question);
}

/** The chat input's model picker, built by production code for the chat now shown. */
function modelPicker(runtime: Runtime): AgentModelPickerOverride {
  const picker = buildAgentModelPicker({
    manager: runtime.manager,
    descriptors: listBackendDescriptors(),
    settings: getSettings(),
  });
  if (!picker) throw new Error("the chat has no model picker");
  return picker;
}

/** What the model picker's trigger reads: the selected row, and its effort's label when it has one. */
function pickerSelection(runtime: Runtime): string {
  const picker = modelPicker(runtime);
  const row = picker.models.find((entry) => getModelKeyFromModel(entry) === picker.value);
  const model = row?.displayName ?? "no model";
  if (!picker.effort) return model;
  const { options, value } = picker.effort;
  const effort = options.find((option) => option.value === value)?.label ?? String(value);
  return `${model} at ${effort} effort`;
}

/** The effort option a user picks by its label, as the picker's stepper shows it. */
function effortOption(
  options: readonly { label: string; value: string | null }[] | undefined,
  model: string,
  label: string
): { label: string; value: string | null } {
  const option = options?.find((candidate) => candidate.label === label);
  if (!option) {
    const offered = options?.map((candidate) => candidate.label).join(", ") || "none";
    throw new Error(
      `the model picker offers no "${label}" effort for ${model}; it offers ${offered}`
    );
  }
  return option;
}

/** The chat input's mode picker, built by production code for the chat now shown. */
function modePicker(runtime: Runtime): AgentModePickerOverride {
  const picker = buildAgentModePicker({ manager: runtime.manager });
  if (!picker) throw new Error("the chat has no mode picker");
  return picker;
}

function modeShown(runtime: Runtime): string {
  const picker = modePicker(runtime);
  return picker.options.find((o) => o.value === picker.value)?.label ?? String(picker.value);
}
