import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectPackageFindings,
  getManifestFilename,
  validateSelectedManifest,
} from "./review-obsidian-package.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectRejected(command, args, expectedRules) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert(result.status !== 0, `${command} unexpectedly accepted its invalid review fixture`);
  for (const rule of expectedRules) {
    assert(output.includes(rule), `${command} fixture did not exercise ${rule}`);
  }
}

function expectReported(command, args, expectedRules) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert(result.status === 0, `${command} treated a warning-only fixture as blocking`);
  for (const rule of expectedRules) {
    assert(output.includes(rule), `${command} did not report warning rule ${rule}`);
  }
}

async function main() {
  expectRejected(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/eslint/bin/eslint.js"),
      "--config",
      "eslint.review.config.mjs",
      "--no-ignore",
      "src/review-fixtures/invalid-review.ts",
    ],
    [
      "obsidianmd/no-nodejs-modules",
      "no-restricted-globals",
      "eslint-comments/require-description",
      "eslint-comments/no-restricted-disable",
    ]
  );
  expectRejected(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/stylelint/bin/stylelint.mjs"),
      "src/review-fixtures/invalid-review.css",
      "--config",
      "stylelint.config.mjs",
      "--max-warnings",
      "0",
    ],
    ["declaration-no-important", "selector-pseudo-class-disallowed-list"]
  );
  expectReported(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/stylelint/bin/stylelint.mjs"),
      "src/review-fixtures/invalid-review.css",
      "--config",
      "stylelint.config.mjs",
    ],
    ["declaration-no-important", "selector-pseudo-class-disallowed-list"]
  );
  expectRejected(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/stylelint/bin/stylelint.mjs"),
      "src/review-fixtures/invalid-review-error.css",
      "--config",
      "stylelint.config.mjs",
    ],
    ["function-url-scheme-disallowed-list"]
  );
  expectReported(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/eslint/bin/eslint.js"),
      "--config",
      "eslint.review.config.mjs",
      "--no-ignore",
      "src/review-fixtures/invalid-review-LICENSE",
    ],
    ["obsidianmd/validate-license"]
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
