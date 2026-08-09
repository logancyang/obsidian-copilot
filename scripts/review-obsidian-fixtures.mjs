import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import {
  collectPackageFindings,
  getManifestFilename,
  validateSelectedManifest,
} from "./review-obsidian-package.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Negative examples must not be real source files because the authenticated
// community reviewer scans them without the repository's local ignore rules.
const invalidSourceFixture = `import "node:fs";

// eslint-disable-next-line no-console
console.log(fetch("https://example.com"));
`;
const invalidStyleWarningFixture = `.review-fixture:has(button) {
  display: block !important;
}
`;
const invalidStyleErrorFixture = `.review-fixture {
  background-image: url("https://example.com/review-fixture.png");
}
`;
const invalidLicenseFixture = "Copyright (C) 2020-2025 by Dynalist Inc.\n";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function lintSourceFixture(code, filePath) {
  const eslint = new ESLint({
    cwd: repositoryRoot,
    ignore: false,
    overrideConfigFile: resolve(repositoryRoot, "eslint.review.config.mjs"),
  });
  const [result] = await eslint.lintText(code, {
    filePath: resolve(repositoryRoot, filePath),
  });
  return result;
}

function expectEslintRules(result, expectedRules) {
  const reportedRules = new Set(result.messages.map((message) => message.ruleId));
  for (const rule of expectedRules) {
    assert(reportedRules.has(rule), `ESLint fixture did not exercise ${rule}`);
  }
}

function expectRejected(command, args, expectedRules, input) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert(result.status !== 0, `${command} unexpectedly accepted its invalid review fixture`);
  for (const rule of expectedRules) {
    assert(output.includes(rule), `${command} fixture did not exercise ${rule}`);
  }
}

function expectReported(command, args, expectedRules, input) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert(result.status === 0, `${command} treated a warning-only fixture as blocking`);
  for (const rule of expectedRules) {
    assert(output.includes(rule), `${command} did not report warning rule ${rule}`);
  }
}

async function main() {
  const invalidSourceResult = await lintSourceFixture(invalidSourceFixture, "src/utils.ts");
  assert(invalidSourceResult.errorCount > 0, "ESLint accepted its invalid source fixture");
  expectEslintRules(invalidSourceResult, [
    "obsidianmd/no-nodejs-modules",
    "no-restricted-globals",
    "eslint-comments/require-description",
    "eslint-comments/no-restricted-disable",
  ]);
  const invalidLicenseResult = await lintSourceFixture(invalidLicenseFixture, "LICENSE");
  assert(
    invalidLicenseResult.errorCount === 0,
    "ESLint treated a warning-only LICENSE fixture as blocking"
  );
  expectEslintRules(invalidLicenseResult, ["obsidianmd/validate-license"]);

  expectRejected(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/stylelint/bin/stylelint.mjs"),
      "--stdin",
      "--stdin-filename",
      "src/review-fixtures/invalid-review.css",
      "--config",
      "stylelint.config.mjs",
      "--max-warnings",
      "0",
    ],
    ["declaration-no-important", "selector-pseudo-class-disallowed-list"],
    invalidStyleWarningFixture
  );
  expectReported(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/stylelint/bin/stylelint.mjs"),
      "--stdin",
      "--stdin-filename",
      "src/review-fixtures/invalid-review.css",
      "--config",
      "stylelint.config.mjs",
    ],
    ["declaration-no-important", "selector-pseudo-class-disallowed-list"],
    invalidStyleWarningFixture
  );
  expectRejected(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/stylelint/bin/stylelint.mjs"),
      "--stdin",
      "--stdin-filename",
      "src/review-fixtures/invalid-review-error.css",
      "--config",
      "stylelint.config.mjs",
    ],
    ["function-url-scheme-disallowed-list"],
    invalidStyleErrorFixture
  );
  const invalidManifestAccepted = await validateSelectedManifest(
    resolve(repositoryRoot, "manifest-beta.json"),
    JSON.stringify({
      id: "invalid",
      name: "Invalid",
      version: "1.0.0-beta.1",
      minAppVersion: "1.0.0",
      description: "A valid description.",
      author: "Tester",
      isDesktopOnly: false,
      fundingUrl: { sponsor: 42 },
      unsupported: true,
    })
  );
  assert(!invalidManifestAccepted, "upstream manifest schema failure was accepted");
  const copyWarningAccepted = await validateSelectedManifest(
    resolve(repositoryRoot, "manifest.json"),
    JSON.stringify({
      id: "valid",
      name: "Valid",
      version: "1.0.0",
      minAppVersion: "1.0.0",
      description: "Visible copy: unchanged.",
      author: "Tester",
      isDesktopOnly: false,
    })
  );
  assert(copyWarningAccepted, "manifest copy guidance unexpectedly blocked the review gate");

  const packageFindings = collectPackageFindings({
    manifest: { name: "Invalid", version: "2.0.0", isDesktopOnly: true },
    packageJson: { version: "1.0.0", license: "" },
    licenseText: "",
  });
  assert(packageFindings.length >= 3, "invalid manifest/license fixture was accepted");
  assert(
    getManifestFilename("1.0.0-beta.1") === "manifest-beta.json",
    "prerelease package was not matched to manifest-beta.json"
  );

  console.info("Obsidian review fixtures passed.");
}

await main();
