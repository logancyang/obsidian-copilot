import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { inspect } from "node:util";

import {
  After,
  AfterAll,
  AfterStep,
  Before,
  BeforeAll,
  BeforeStep,
  DataTable,
  Given,
  Status,
  Then,
  When,
  World,
  defineParameterType,
  setDefaultTimeout,
  setDefinitionFunctionWrapper,
  setWorldConstructor,
  type ITestCaseHookParameter,
} from "@cucumber/cucumber";

import { listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentAnswer } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { buildAgentModelPicker } from "@/agentMode/ui/agentModelPickerHelpers";
import { buildAgentModePicker } from "@/agentMode/ui/agentModePickerHelpers";
import type { AgentModePickerOverride } from "@/agentMode/ui/useAgentModePicker";
import type { AgentModelPickerOverride } from "@/agentMode/ui/useAgentModelPicker";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { getModelKeyFromModel, getSettings } from "@/settings/model";

import { shownNotices, vaultWrites } from "../harness/obsidianShim";
import { pinnedBinaryPath } from "../harness/pinnedBinary";
import {
  Conversation,
  Runtime,
  drawnPermissionCard,
  drawnReadOnlyAnswer,
  drawnText,
  drawnToolCalls,
  type ScriptedModel,
} from "../harness/runtime";
import type { HeldStream, RecordedRequest } from "../harness/scriptedProvider";
import { Report } from "./report";

// Above the harness's own bounds (at most 30s in one step, 30s teardown), so a
// slow runtime fails with the harness's message naming what it was waiting for
// rather than Cucumber's generic timeout.
setDefaultTimeout(60_000);

// Created when the run starts, so a dry run, which lists the step vocabulary, keeps the last report.
let report: Report;
BeforeAll(function () {
  report = new Report(path.resolve(__dirname, "..", ".report"));
});

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
  /**
   * Where the scripted model stops for the scenario, in the order it will: an
   * answer it holds open, or a retry it refuses with a long wait. Each message
   * sent returns at the next one.
   */
  readonly pauses: ScriptedPause[] = [];
  /** How many requests the provider had received when the answer was stopped. */
  requestsWhenStopped = 0;
  /** The notes the vault started with, by vault path. */
  readonly notes = new Map<string, string>();
  /** Every file outside the agent home as the scenario started, by digest. */
  filesBefore = new Map<string, string>();
  /** The id of the tool call the model asked for last. */
  toolCallId = "";
  /** opencode's settled answer to the last read-only question. */
  readOnlyAnswer: AgentAnswer | null = null;
  /** What a `@known-gap` scenario's last step fails with today, or null for any other scenario. */
  knownGap: KnownGap | null = null;
  /** Whether the step running now is the last step of a `@known-gap` scenario. */
  atGapStep = false;
  /** Set once that step failed as the gap says it does. */
  gapConfirmed = false;

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

  /** The absolute path of `note` in the scenario's vault. */
  vaultFile(note: string): string {
    return path.join(this.runtime.vaultPath, note);
  }

  get heldAnswer(): { stream: HeldStream; in: Conversation } {
    if (!this.held) throw new Error("the provider holds no answer");
    return this.held;
  }
}

setWorldConstructor(RuntimeWorld);

Before(function (this: RuntimeWorld, { gherkinDocument, pickle }: ITestCaseHookParameter) {
  this.startedAt = Date.now();
  if (pickle.tags.some((tag) => tag.name === KNOWN_GAP_TAG)) {
    this.knownGap = readKnownGap(gherkinDocument, pickle);
  }
});

BeforeStep(function (this: RuntimeWorld, { pickle, pickleStep }) {
  this.atGapStep = this.knownGap !== null && pickleStep.id === pickle.steps.at(-1)?.id;
});

AfterStep(function (this: RuntimeWorld) {
  this.atGapStep = false;
});

// A known gap's last step fails today with the wrong value its scenario states.
// That failure is the gap, so the step passes and the scenario is reported as a
// known gap. Any other failure, including one earlier in the scenario or one
// that finds a different wrong value, fails it.
setDefinitionFunctionWrapper(
  (code: (...args: unknown[]) => unknown) =>
    async function (this: RuntimeWorld | undefined, ...args: unknown[]): Promise<unknown> {
      try {
        const result: unknown = await code.call(this, ...args);
        return result;
      } catch (error) {
        const gap = this?.atGapStep ? this.knownGap : null;
        if (!gap || !(error instanceof assert.AssertionError)) throw error;
        if (inspect(error.actual) !== gap.failsWith) throw error;
        this!.gapConfirmed = true;
      }
    }
);

After(async function (this: RuntimeWorld, scenario: ITestCaseHookParameter) {
  // Read before teardown: a clean shutdown right after a turn logs warnings of
  // its own (see runtime-tests/README.md).
  const problems = this.runtime.problems();
  // Cucumber passes a run whose scenarios were skipped; every scenario here is required.
  if (scenario.result?.status === Status.SKIPPED) problems.push("the scenario was skipped");
  const gap = this.knownGap;
  if (gap && scenario.result?.status === Status.PASSED && !this.gapConfirmed) {
    problems.push(
      `${gap.issue} no longer fails: promote this scenario by removing its ${KNOWN_GAP_TAG} tag and the three lines under its title, and list it in runtime-tests/README.md`
    );
  } else if (gap && scenario.result?.status === Status.FAILED) {
    problems.push(
      `a ${KNOWN_GAP_TAG} scenario may fail only at its last step, with an assertion whose actual value is ${gap.failsWith}`
    );
  }
  // Read before `stop()` deletes the agent home that holds opencode's logs.
  const diagnostics = await this.runtime.diagnostics();
  try {
    problems.push(...(await this.runtime.stop()));
  } finally {
    const failed = scenario.result?.status !== Status.PASSED || problems.length > 0;
    const error = [scenario.result?.message, ...problems].filter(Boolean).join("\n");
    report.add(
      {
        feature: scenario.gherkinDocument.feature?.name ?? scenario.pickle.uri,
        name: scenarioTitle(scenario.gherkinDocument, scenario.pickle),
        status: failed ? "failed" : gap ? `known gap, unverified: ${gap.issue}` : "passed",
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

// A saved or shown effort: `at "high" effort`, or `with no effort` for a model
// that has none.
defineParameterType({
  name: "effort",
  regexp: [/at "([^"]*)" effort/, /with no effort/],
  transformer: (level: string | undefined) => level ?? null,
});

// How long a refused request tells opencode to wait before it retries, in its
// `retry-after-ms` header, or undefined when it sends none.
defineParameterType({
  name: "retryAdvice",
  regexp: [/asking to retry at once/, /asking to wait a minute/, /giving no retry time/],
  transformer: (advice: string) =>
    ({ "asking to retry at once": 0, "asking to wait a minute": 60_000 })[advice],
});

// How a scripted answer stops partway: held open until the scenario continues
// it, or cut off as a failing stream is.
defineParameterType({ name: "streamEnd", regexp: /hold|break/ });

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

Given("the model will answer {string}", function (this: RuntimeWorld, text: string) {
  this.runtime.provider.answer(text);
});

// Returns at the model's next scripted pause, or else once the chat shows a
// permission card or the turn has ended.
When("I send {string}", async function (this: RuntimeWorld, text: string) {
  this.conversation.start(text);
  const pause = this.pauses.shift();
  if (!pause) return this.conversation.untilPermissionOrEnd();
  const held = await this.runtime.waitForProvider(pause.reached, pause.event);
  if (held) this.held = { stream: held, in: this.conversation };
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
  "Copilot starts with opencode's default model set to {string} {effort}",
  async function (this: RuntimeWorld, model: string, effort: string | null) {
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

// Once the conversation shows these words, a held answer returns the message it
// answers, and a broken one drops the connection.
Given(
  "the model will start answering {string} and then {streamEnd}",
  function (this: RuntimeWorld, text: string, end: string) {
    const held = this.runtime.provider.hold(text);
    if (end === "hold") this.pauses.push({ event: "hold the answer", reached: held });
    else void held.then((stream) => stream.break());
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

// The chat input's stop button, then the input unlocking once the turn ends.
When("I stop the answer", async function (this: RuntimeWorld) {
  await this.conversation.stop();
  this.requestsWhenStopped = this.runtime.provider.requests.length;
  await this.conversation.finish();
});

// The provider refuses every attempt at the question it refuses first. Asked to
// retry at once, or refused for good, opencode gives up within a turn and the
// turn fails. Asked to wait a minute, it waits longer than a turn may take, so
// the message sent returns once the refusal is sent, for the scenario to act
// while opencode waits.
Given(
  "the provider will refuse the next request with {int} {string}, {retryAdvice}",
  function (this: RuntimeWorld, status: number, message: string, retryAfterMs: number | undefined) {
    const refused = this.runtime.provider.refuse(status, message, retryAfterMs);
    if (retryAfterMs) this.pauses.push({ event: "refuse opencode's retry", reached: refused });
    else this.runtime.expectTurnToFail(message);
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

// The Default model setting's write.
When(
  "I set opencode's default model to {string} {effort} in settings",
  async function (this: RuntimeWorld, model: string, effort: string | null) {
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

When("I restart opencode from the chat's Reload action", async function (this: RuntimeWorld) {
  this.conversation = await this.runtime.restartAgent();
});

// Waits for the picker to show the pick, which it does once opencode confirms it.
When(
  "I pick {string} {effort} in the model picker",
  async function (this: RuntimeWorld, model: string, effort: string | null) {
    const picker = modelPicker(this.runtime);
    const row = picker.models.find((entry) => entry.displayName === model);
    if (!row) throw new Error(`the model picker offers no "${model}"`);
    const key = getModelKeyFromModel(row);
    const options = picker.effortOptionsByModelKey?.[key];
    picker.commitSelection?.(key, effort && effortOption(options, model, effort).value);
    const expected = selectionShown(model, effort);
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
  "the model picker shows {string} {effort}",
  function (this: RuntimeWorld, model: string, effort: string | null) {
    assert.equal(pickerSelection(this.runtime), selectionShown(model, effort));
  }
);

Then("the mode picker offers {string}", function (this: RuntimeWorld, options: string) {
  assert.equal(
    modePicker(this.runtime)
      .options.map((o) => o.label)
      .join(", "),
    options
  );
});

// A new conversation opens in the agent's own mode and switches to the saved one
// once it is ready, so this waits for the mode it should show.
Then("the mode picker shows {string}", async function (this: RuntimeWorld, label: string) {
  await this.conversation.waitFor(
    () => modeShown(this.runtime) === label,
    () => `the mode picker to show ${label}; it shows ${modeShown(this.runtime)}`
  );
});

Then("the provider answered these agent turns:", function (this: RuntimeWorld, table: DataTable) {
  const turns = this.runtime.provider.requests
    .filter((request) => request.kind === "turn")
    .map((request) => [request.endpoint, request.model, request.reasoningEffort ?? ""]);
  assert.deepEqual(turns, table.rows());
});

Then(
  "opencode's saved default is {string} {effort}",
  function (this: RuntimeWorld, model: string, effort: string | null) {
    assert.deepEqual(this.runtime.manager.getDefaultSelection("opencode"), {
      baseModelId: this.runtime.wireId(model),
      effort,
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
  return selectionShown(
    model,
    options.find((option) => option.value === value)?.label ?? String(value)
  );
}

/** What the model picker's trigger reads for `model` at `effort`. */
function selectionShown(model: string, effort: string | null): string {
  return effort === null ? model : `${model} at ${effort} effort`;
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

/** A tool call the scripted model asks the agent to make. */
interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** A point where the scripted model stops for the scenario, and what it does there. */
interface ScriptedPause {
  /** What the provider does at this point, for the failure message if it never does. */
  event: string;
  /** Resolves when the provider gets there, with the answer it holds, if any. */
  reached: Promise<HeldStream | void>;
}

/** Marks a scenario that asserts behavior Copilot does not have yet. */
const KNOWN_GAP_TAG = "@known-gap";

/**
 * What a `@known-gap` scenario states under its title: the issue that tracks
 * the gap, what shipping with it means for users, and the wrong value its last
 * step's assertion finds today, as `util.inspect` prints it.
 */
interface KnownGap {
  issue: string;
  failsWith: string;
}

type GherkinDocument = ITestCaseHookParameter["gherkinDocument"];
type Pickle = ITestCaseHookParameter["pickle"];

/** The scenario, or scenario outline, that `pickle` was compiled from. */
function scenarioOf(document: GherkinDocument, pickle: Pickle) {
  return document.feature?.children.find(
    (child) => child.scenario && pickle.astNodeIds.includes(child.scenario.id)
  )?.scenario;
}

/**
 * The scenario's name as a report lists it: an outline's example row adds its
 * values, since examples whose values are not in the name share one title.
 */
function scenarioTitle(document: GherkinDocument, pickle: Pickle): string {
  const row = scenarioOf(document, pickle)
    ?.examples.flatMap((examples) => examples.tableBody)
    .find((candidate) => pickle.astNodeIds.includes(candidate.id));
  return row ? `${pickle.name} (${row.cells.map((cell) => cell.value).join("; ")})` : pickle.name;
}

/** Read the known gap `pickle`'s scenario states in its description, or fail the scenario. */
function readKnownGap(document: GherkinDocument, pickle: Pickle): KnownGap {
  const description = scenarioOf(document, pickle)?.description ?? "";
  const issue = /https:\/\/github\.com\/\S+\/issues\/\d+/.exec(description)?.[0];
  const consequence = /^\s*Release consequence: \S/m.test(description);
  const failsWith = /^\s*Fails today with: (.+)$/m.exec(description)?.[1].trim();
  if (!issue || !consequence || !failsWith) {
    throw new Error(
      `a ${KNOWN_GAP_TAG} scenario must state its issue URL, a "Release consequence:" line, and a "Fails today with:" line under its title`
    );
  }
  return { issue, failsWith };
}

/** A quoted value in the wording of a file operation. */
const QUOTED = '"([^"]*)"';

/**
 * How the pinned opencode (1.18.31) is asked to work on a note: for each way a
 * scenario words what the model does, the tool and the arguments its schema
 * takes, as it advertises them to the model. Scenarios name only what the agent
 * does to which note, so a release that renames a tool or an argument is
 * adapted here and nowhere else.
 */
const OPENCODE_FILE_TOOLS: readonly [
  string,
  (world: RuntimeWorld, ...words: string[]) => ToolCall,
][] = [
  [
    `edit ${QUOTED}, replacing ${QUOTED} with ${QUOTED}`,
    (world, note, oldString, newString) => ({
      name: "edit",
      args: { filePath: world.vaultFile(note), oldString, newString },
    }),
  ],
  [
    `rewrite ${QUOTED} as ${QUOTED}`,
    (world, note, content) => ({
      name: "write",
      args: { filePath: world.vaultFile(note), content },
    }),
  ],
  [
    `read ${QUOTED}`,
    (world, note) => ({ name: "read", args: { filePath: world.vaultFile(note) } }),
  ],
  [`run ${QUOTED}`, (_world, command) => ({ name: "bash", args: { command } })],
];

// One of the wordings above. Cucumber hands a parameter the capture groups of
// all its alternatives in one flat list, so each wording matches here without
// groups and is parsed again for its values.
defineParameterType({
  name: "fileOperation",
  regexp: OPENCODE_FILE_TOOLS.map(([words]) => words.replaceAll(QUOTED, '"[^"]*"')),
  transformer(this: RuntimeWorld, phrase: string): ToolCall {
    for (const [words, toCall] of OPENCODE_FILE_TOOLS) {
      const match = new RegExp(`^${words}$`).exec(phrase);
      if (match) return toCall(this, ...match.slice(1));
    }
    throw new Error(`no opencode tool is mapped for "${phrase}"`);
  },
});

/** How a permission card names the vault in a scenario's table. */
const VAULT_TOKEN = "$VAULT";

// Each note is written byte for byte as the table gives it, then every file
// is recorded so a scenario can prove which ones changed.
Given("the vault holds these notes:", function (this: RuntimeWorld, table: DataTable) {
  for (const { note, content } of table.hashes()) {
    const file = path.join(this.runtime.vaultPath, note);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    this.notes.set(note, content);
  }
  this.filesBefore = this.runtime.fileDigests();
});

// The agent runs its real tool, and sends the model the result in its next
// request. The call names a note by its path in the vault, so Copilot must
// have started.
Given("the model will {fileOperation}", function (this: RuntimeWorld, call: ToolCall) {
  this.toolCallId = this.runtime.provider.callTool(call.name, call.args);
});

// The call a chat makes when a message @-mentions opencode alongside other agents.
When(
  "I ask opencode {string} as a read-only question",
  async function (this: RuntimeWorld, text: string) {
    this.readOnlyAnswer = await this.runtime.askReadOnly(text);
  }
);

Then(
  "the chat asks for permission with a card that reads:",
  function (this: RuntimeWorld, table: DataTable) {
    const request = this.conversation.shownPermission;
    if (!request) throw new Error("the chat shows no permission card");
    const drawn = drawnPermissionCard(request).map((line) =>
      line.replaceAll(this.runtime.vaultPath, VAULT_TOKEN)
    );
    assert.deepEqual(drawn, table.raw().flat());
  }
);

// The card's button, then the chat input unlocking once the turn ends.
When(
  "I choose {string} on the permission card",
  async function (this: RuntimeWorld, label: string) {
    this.conversation.answerPermission(label);
    await this.conversation.finish();
  }
);

Then("the chat asked for no permission", async function (this: RuntimeWorld) {
  const shown = this.conversation.permissionsShown.map((request) => drawnPermissionCard(request));
  assert.deepEqual(shown, [], "the chat showed a permission card");
  await this.conversation.finish();
});

Then(
  "{string} reads {string}, and no other file changed",
  function (this: RuntimeWorld, note: string, content: string) {
    // Digests are keyed by path from the temp root, which holds the vault.
    const changed = path.relative(path.dirname(this.runtime.vaultPath), this.vaultFile(note));
    assert.deepEqual(changedFiles(this.filesBefore, this.runtime.fileDigests()), [changed]);
    assert.equal(fs.readFileSync(this.vaultFile(note), "utf-8"), content);
  }
);

// opencode's own tool writes the same bytes afterwards, so the file alone cannot
// show that Copilot's write reached Obsidian's vault adapter.
Then(
  "Copilot wrote {string} to {string} through the vault",
  function (this: RuntimeWorld, content: string, note: string) {
    assert.deepEqual(vaultWrites, [[note, content]]);
  }
);

Then("no file changed", function (this: RuntimeWorld) {
  assert.deepEqual(changedFiles(this.filesBefore, this.runtime.fileDigests()), []);
});

Then(
  "the model was told the result the chat shows for the tool call",
  function (this: RuntimeWorld) {
    const shown = shownToolOutput(this.conversation, this.toolCallId);
    assert.ok(shown, "the chat shows no result for the tool call");
    assert.equal(toolResultSent(this), shown);
  }
);

Then("the model was told what {string} says", function (this: RuntimeWorld, note: string) {
  const result = toolResultSent(this);
  const content = this.notes.get(note) ?? "";
  for (const line of content.split("\n").filter(Boolean)) {
    assert.ok(result.includes(line), `the tool result ${JSON.stringify(result)} lacks "${line}"`);
  }
});

Then("the answer shows these tool calls:", function (this: RuntimeWorld, table: DataTable) {
  assert.deepEqual(
    drawnToolCalls(lastAnswer(this.conversation), this.runtime.vaultPath),
    table.rows()
  );
});

Then("the answer reads {string}", function (this: RuntimeWorld, text: string) {
  assert.equal(drawnText(lastAnswer(this.conversation)), text);
});

Then("opencode's read-only answer reads {string}", function (this: RuntimeWorld, text: string) {
  if (!this.readOnlyAnswer) throw new Error("opencode was asked no read-only question");
  assert.deepEqual(drawnReadOnlyAnswer(this.readOnlyAnswer), [text]);
});

/** The latest answer the conversation shows. */
function lastAnswer(conversation: Conversation): AgentChatMessage {
  const answer = conversation.messages.findLast((m) => m.sender === AI_SENDER);
  if (!answer) throw new Error("the conversation shows no answer");
  return answer;
}

/** The files, by path from the temp root, that were added, removed, or changed. */
function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((file) => before.get(file) !== after.get(file)).sort();
}

/** The result text the chat's trail shows for tool call `id`, as `ActionCard` draws it. */
function shownToolOutput(conversation: Conversation, id: string): string {
  const part = conversation.messages
    .flatMap((message) => message.parts ?? [])
    .find((candidate) => candidate.kind === "tool_call" && candidate.id === id);
  if (part?.kind !== "tool_call") throw new Error(`the chat shows no tool call ${id}`);
  return (part.output ?? []).flatMap((o) => (o.type === "text" ? [o.text] : [])).join("\n");
}

/** The tool message the model's next request carried for the scenario's tool call. */
function toolResultSent(world: RuntimeWorld): string {
  const result = world.runtime.provider.requests
    .flatMap((request) => request.messages)
    .find((message) => message.role === "tool" && message.toolCallId === world.toolCallId);
  if (!result) throw new Error(`no request to the model carried the result of ${world.toolCallId}`);
  return result.content;
}
