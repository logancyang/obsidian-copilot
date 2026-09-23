// The runtime suite's step vocabulary, read from a Cucumber dry run of the
// built steps against the feature files, so the listing cannot drift from
// either. Needs `runtime-tests/build.mjs` first; runs no scenario and no binary.
//
//   node runtime-tests/vocabulary.mjs          print every step by role, with
//                                              its uses and an example
//   node runtime-tests/vocabulary.mjs --check  fail on an undefined, ambiguous,
//                                              or unused step, or no scenarios;
//                                              list single-use steps in the
//                                              GitHub job summary
import { appendFileSync } from "node:fs";
import process from "node:process";
import { Writable } from "node:stream";

import { loadConfiguration, runCucumber } from "@cucumber/cucumber/api";

const ROLES = { Context: "Given", Action: "When", Outcome: "Then" };

const { runConfiguration } = await loadConfiguration({
  file: "runtime-tests/cucumber.mjs",
  provided: { dryRun: true },
});
const envelopes = [];
const discard = new Writable({ write: (_chunk, _encoding, done) => done() });
const { success } = await runCucumber(runConfiguration, { stdout: discard }, (envelope) =>
  envelopes.push(envelope)
);

const definitions = new Map();
const pickleSteps = new Map();
const parameterTypes = [];
for (const { stepDefinition, pickle, parameterType } of envelopes) {
  if (stepDefinition) definitions.set(stepDefinition.id, { ...stepDefinition.pattern, uses: [] });
  for (const step of pickle?.steps ?? []) pickleSteps.set(step.id, step);
  if (parameterType) parameterTypes.push(parameterType);
}
const problems = [];
let scenarios = 0;
for (const { testCase } of envelopes) {
  if (!testCase) continue;
  scenarios += 1;
  for (const { pickleStepId, stepDefinitionIds } of testCase.testSteps) {
    if (!pickleStepId) continue;
    const step = pickleSteps.get(pickleStepId);
    if (stepDefinitionIds.length === 0) problems.push(`undefined step: ${step.text}`);
    else if (stepDefinitionIds.length > 1) problems.push(`ambiguous step: ${step.text}`);
    else definitions.get(stepDefinitionIds[0]).uses.push(step);
  }
}
if (scenarios === 0) problems.push("no runtime scenarios were found");
if (!success && problems.length === 0)
  problems.push("the dry run failed; npm run test:runtime shows why");
const all = [...definitions.values()];
for (const unused of all.filter((d) => d.uses.length === 0)) {
  problems.push(`unused step definition: ${unused.source}`);
}

if (process.argv.includes("--check")) {
  const single = all.filter((d) => d.uses.length === 1);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(
      summary,
      [
        "## Runtime step vocabulary",
        "",
        `${all.length} step definitions; these ${single.length} are used by one scenario step each. A new one needs its reason in the pull request.`,
        "",
        ...single.map((d) => `- \`${d.source}\``),
        "",
      ].join("\n")
    );
  }
  if (problems.length > 0) {
    process.stderr.write(`Runtime step vocabulary check failed:\n  ${problems.join("\n  ")}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `Runtime step vocabulary: ${all.length} definitions, ${single.length} used once, none unused.\n`
  );
} else {
  const lines = [];
  for (const [type, role] of Object.entries(ROLES)) {
    lines.push(role);
    const inRole = all.filter((d) => d.uses[0]?.type === type);
    for (const d of inRole.sort((a, b) => a.source.localeCompare(b.source))) {
      lines.push(`  ${d.source}  (${d.uses.length})`, `      e.g. ${d.uses[0].text}`);
    }
  }
  lines.push("Parameter types");
  for (const { name, regularExpressions } of parameterTypes) {
    lines.push(`  {${name}}  ${regularExpressions.join("  |  ")}`);
  }
  if (problems.length > 0) lines.push("Problems", ...problems.map((p) => `  ${p}`));
  process.stdout.write(`${lines.join("\n")}\n`);
}
