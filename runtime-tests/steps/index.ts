import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";

import {
  After,
  Before,
  Given,
  Then,
  When,
  setDefaultTimeout,
  setWorldConstructor,
  Status,
  World,
  type ITestCaseHookParameter,
} from "@cucumber/cucumber";
import { execFileSync } from "node:child_process";

import { pinnedBinaryPath } from "../harness/pinnedBinary";
import { Conversation, Runtime, type Turn } from "../harness/runtime";

// Spawning a real binary and streaming a turn through it takes seconds, not
// milliseconds; Cucumber's 5s default would fail on machine load alone.
setDefaultTimeout(120_000);

/** Cucumber's per-scenario state. The harness itself knows nothing about it. */
class RuntimeWorld extends World {
  readonly runtime = new Runtime();
  conversation: Conversation | null = null;
  turn: Turn | null = null;

  get open(): Conversation {
    if (!this.conversation) throw new Error("no conversation is open");
    return this.conversation;
  }

  get lastTurn(): Turn {
    if (!this.turn) throw new Error("no turn has completed");
    return this.turn;
  }
}

setWorldConstructor(RuntimeWorld);

Before(function (this: RuntimeWorld) {
  this.turn = null;
});

After(async function (this: RuntimeWorld, scenario: ITestCaseHookParameter) {
  // One diagnostic line, so a CI failure identifies the runtime and commit it
  // happened on without digging through logs.
  if (scenario.result?.status === Status.FAILED) {
    this.attach(
      `opencode ${version(pinnedBinaryPath())} | ${process.platform}-${process.arch} ${os.release()} | commit ${commit()}`
    );
  }
  await this.runtime.stop();
});

// --- setup ----------------------------------------------------------------

Given(
  "an opencode runtime serving the models {string}",
  async function (this: RuntimeWorld, models: string) {
    await this.runtime.start({
      binaryPath: pinnedBinaryPath(),
      models: models.split(",").map((m) => m.trim()),
    });
  }
);

Given(
  "the vault file {string} contains {string}",
  async function (this: RuntimeWorld, file: string, content: string) {
    await this.runtime.writeVaultFile(file, content);
  }
);

// --- provider script ------------------------------------------------------

Given("the provider will answer {string}", function (this: RuntimeWorld, text: string) {
  this.runtime.provider.reply({ kind: "text", text });
});

Given("the provider will then answer {string}", function (this: RuntimeWorld, text: string) {
  this.runtime.provider.reply({ kind: "text", text });
});

Given(
  "the provider will answer {string} and hold the stream open",
  function (this: RuntimeWorld, text: string) {
    this.runtime.provider.reply({ kind: "hold", text });
  }
);

Given(
  "the provider will ask to write {string} into the vault file {string}",
  function (this: RuntimeWorld, content: string, file: string) {
    this.runtime.provider.reply({
      kind: "toolCall",
      name: "write",
      arguments: { filePath: path.join(this.runtime.vaultPath, file), content },
    });
  }
);

Given("I will deny every permission request", function (this: RuntimeWorld) {
  this.runtime.answerPermissionsWith("deny");
});

// --- conversation ---------------------------------------------------------

When("I open a conversation on {string}", async function (this: RuntimeWorld, modelId: string) {
  this.conversation = await this.runtime.openConversation(modelId);
});

When("I select the model {string}", async function (this: RuntimeWorld, modelId: string) {
  await this.open.selectModel(modelId);
});

When("I send {string}", async function (this: RuntimeWorld, text: string) {
  this.turn = await this.open.send(text);
});

When(
  "I send {string} without waiting for the turn to end",
  function (this: RuntimeWorld, text: string) {
    this.open.sendWithoutWaiting(text);
  }
);

When(
  "I cancel the turn once {string} has streamed",
  async function (this: RuntimeWorld, marker: string) {
    await this.open.waitForText(marker);
    await this.open.cancel();
    this.turn = await this.open.awaitTurn();
  }
);

// --- assertions -----------------------------------------------------------

Then("the conversation shows {string}", function (this: RuntimeWorld, expected: string) {
  assert.equal(this.lastTurn.text.trim(), expected);
});

Then("the conversation does not show {string}", function (this: RuntimeWorld, forbidden: string) {
  assert.ok(
    !this.lastTurn.text.includes(forbidden),
    `expected the turn not to mention "${forbidden}", got "${this.lastTurn.text}"`
  );
});

Then("the turn ended because it was cancelled", function (this: RuntimeWorld) {
  assert.equal(this.lastTurn.stopReason, "cancelled");
});

Then(
  "the provider's last request used the model {string}",
  function (this: RuntimeWorld, modelId: string) {
    const last = this.runtime.provider.requests.at(-1);
    assert.ok(last, "the scripted provider received no request at all");
    assert.equal(last.model, modelId);
  }
);

Then("Copilot was asked to approve the edit", function (this: RuntimeWorld) {
  assert.equal(this.runtime.permissionPrompts.length, 1);
});

Then(
  "the vault file {string} still contains {string}",
  async function (this: RuntimeWorld, file: string, expected: string) {
    assert.equal(await this.runtime.readVaultFile(file), expected);
  }
);

function version(binary: string): string {
  try {
    return execFileSync(binary, ["--version"], { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function commit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}
