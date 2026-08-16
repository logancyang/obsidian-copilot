import { execFileSync, spawnSync } from "node:child_process";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import reviewConfig from "../eslint.review.config.mjs";
import {
  collectPackageFindings,
  getManifestFilename,
  lintRuntimeDependencies,
  validateSelectedManifest,
} from "./review-obsidian-package.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const reviewSourceRoots = ["src", "dev/gallery"];
const reviewSourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

// Negative examples must not be real source files because the authenticated
// community reviewer scans them without the repository's local ignore rules.
const invalidSourceFixture = `import "node:fs";
export { promisify } from "node:util";
const path = require("path");
void path;
async function loadOs() {
  return import("node:os");
}
void loadOs;

// eslint-disable-next-line no-console
console.log(fetch("https://example.com"));
`;
const validNodeBoundaryFixture = `import { Buffer } from "buffer/";
import { requireNodeModule } from "@/utils/desktopRuntime";

type Stats = import("node:fs").Stats;

export function encodeSize(stats: Stats): string {
  const path = requireNodeModule<typeof import("node:path")>("path");
  return Buffer.from(path.basename(String(stats.size))).toString("base64");
}
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

/**
 * Prove the review config keeps an untyped target out of type-aware rule scope.
 *
 * ESLint aborts the entire run when a rule cannot load, so a type-aware rule
 * that reaches a file carrying no type information silences the whole gate
 * rather than failing it. Force such a rule on ahead of the repository's own
 * config blocks and confirm those blocks still switch it off.
 *
 * @param {string} filePath - Repository-relative untyped review target.
 */
async function expectOutsideTypeAwareScope(filePath) {
  const eslint = new ESLint({
    cwd: repositoryRoot,
    // The forced rule must sit ahead of the repository's blocks, which rules
    // out overrideConfig (applied last) and the config file (loaded first).
    overrideConfigFile: true,
    baseConfig: [{ rules: { "obsidianmd/no-plugin-as-component": "error" } }, ...reviewConfig],
  });
  try {
    await eslint.lintText("{}", { filePath: resolve(repositoryRoot, filePath) });
  } catch (error) {
    throw new Error(
      `${filePath} is in type-aware ESLint scope, which aborts the whole review gate: ${error.message}`
    );
  }
}

function listTrackedReviewSources() {
  return execFileSync("git", ["ls-files", "-z", "--", ...reviewSourceRoots], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter((filePath) => reviewSourceExtensions.has(extname(filePath)));
}

async function lintSourceFixture(code, filePath) {
  const eslint = new ESLint({
    cwd: repositoryRoot,
    ignore: false,
    overrideConfig: {
      languageOptions: {
        parserOptions: {
          // CI single-run programs otherwise replace lintText input with the anchor file on disk.
          disallowAutomaticSingleRunInference: true,
        },
      },
    },
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
  const baseEslint = new ESLint({
    cwd: repositoryRoot,
    overrideConfigFile: resolve(repositoryRoot, "eslint.config.mjs"),
  });
  const ignoredSources = [];
  for (const filePath of listTrackedReviewSources()) {
    if (await baseEslint.isPathIgnored(filePath)) ignoredSources.push(filePath);
  }
  assert(
    ignoredSources.length === 0,
    `Tracked files under Obsidian review source roots are hidden by the base ESLint config:\n${ignoredSources.join("\n")}\nMove non-source fixtures outside the review roots instead of ignoring them.`
  );

  for (const target of ["manifest.json", "package.json", "LICENSE"]) {
    await expectOutsideTypeAwareScope(target);
  }

  const invalidSourceResult = await lintSourceFixture(invalidSourceFixture, "src/utils.ts");
  assert(invalidSourceResult.errorCount > 0, "ESLint accepted its invalid source fixture");
  expectEslintRules(invalidSourceResult, [
    "obsidianmd/no-nodejs-modules",
    "copilot/no-direct-node-imports",
    "no-restricted-globals",
    "eslint-comments/require-description",
    "eslint-comments/no-restricted-disable",
  ]);
  assert(
    ["node:fs", "node:util", "path", "node:os"].every((moduleName) =>
      invalidSourceResult.messages.some(
        (message) =>
          message.ruleId === "copilot/no-direct-node-imports" &&
          message.message.includes(`"${moduleName}"`) &&
          message.message.includes("requireNodeModule()")
      )
    ),
    "direct Node access guidance did not cover imports, re-exports, and require() calls"
  );
  const validNodeBoundaryResult = await lintSourceFixture(validNodeBoundaryFixture, "src/utils.ts");
  assert(
    validNodeBoundaryResult.messages.every(
      (message) => message.ruleId !== "copilot/no-direct-node-imports"
    ),
    "browser polyfills or guarded/type-only Node access were rejected"
  );
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
  const runtimeDependencyResult = await lintRuntimeDependencies({
    dependencies: { axios: "^1.0.0" },
  });
  assert(
    runtimeDependencyResult.errorCount === 0,
    "runtime dependency guidance unexpectedly blocked the review gate"
  );
  expectEslintRules(runtimeDependencyResult, ["depend/ban-dependencies"]);
  const developmentDependencyResult = await lintRuntimeDependencies({
    devDependencies: { axios: "^1.0.0" },
  });
  assert(
    developmentDependencyResult.messages.every(
      (message) => message.ruleId !== "depend/ban-dependencies"
    ),
    "development-only dependency was reported as a runtime dependency"
  );
  assert(
    getManifestFilename("1.0.0-beta.1") === "manifest-beta.json",
    "prerelease package was not matched to manifest-beta.json"
  );

  console.info("Obsidian review fixtures passed.");
}

await main();
