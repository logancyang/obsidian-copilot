import { ESLint } from "eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestCopyMessageIds = new Set(["descriptionFormat", "noForbiddenWords"]);
const runtimeDependencyRule = obsidianmd.configs.recommended
  .map((config) => config.rules?.["depend/ban-dependencies"])
  .find((rule) => rule !== undefined);
if (!Array.isArray(runtimeDependencyRule)) {
  throw new Error("Obsidian's recommended dependency review rule is unavailable");
}

export function getManifestFilename(version) {
  return version.includes("-") ? "manifest-beta.json" : "manifest.json";
}

export function collectPackageFindings({ manifest, packageJson, licenseText }) {
  const findings = [];
  if (manifest.version !== packageJson.version) {
    findings.push("the selected manifest and package.json versions must match");
  }
  if (manifest.isDesktopOnly !== false) {
    findings.push("the selected manifest must keep isDesktopOnly=false for mobile compatibility");
  }
  if (typeof packageJson.license !== "string" || packageJson.license.trim() === "") {
    findings.push("package.json must declare a license");
  }
  if (licenseText.trim() === "") {
    findings.push("LICENSE must exist and contain the project license text");
  }
  return findings;
}

export async function validateSelectedManifest(manifestPath, manifestText) {
  const eslint = new ESLint({
    overrideConfigFile: resolve(repositoryRoot, "eslint.review.config.mjs"),
  });
  const [result] = await eslint.lintText(manifestText, {
    filePath: resolve(repositoryRoot, "manifest.json"),
  });
  const messages = result.messages.map((message) =>
    message.ruleId === "obsidianmd/validate-manifest" &&
    !manifestCopyMessageIds.has(message.messageId ?? "")
      ? { ...message, severity: 2 }
      : message
  );
  const formatter = await eslint.loadFormatter(
    resolve(repositoryRoot, "scripts/eslint-github-formatter.cjs")
  );
  const output = await formatter.format([{ ...result, filePath: manifestPath, messages }]);
  if (output) process.stdout.write(`${output}\n`);
  return !messages.some((message) => message.severity === 2);
}

export async function lintRuntimeDependencies(packageJson) {
  const eslint = new ESLint({
    cwd: repositoryRoot,
    overrideConfigFile: resolve(repositoryRoot, "eslint.review.config.mjs"),
    overrideConfig: {
      rules: {
        "depend/ban-dependencies": ["warn", ...runtimeDependencyRule.slice(1)],
      },
    },
  });
  const [result] = await eslint.lintText(
    JSON.stringify({ dependencies: packageJson.dependencies ?? {} }, null, 2),
    { filePath: resolve(repositoryRoot, "package.json") }
  );
  return result;
}

async function printLintResult(result) {
  const eslint = new ESLint({
    overrideConfigFile: resolve(repositoryRoot, "eslint.review.config.mjs"),
  });
  const formatter = await eslint.loadFormatter(
    resolve(repositoryRoot, "scripts/eslint-github-formatter.cjs")
  );
  const output = await formatter.format([result]);
  if (output) process.stdout.write(`${output}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const licensePath = resolve(repositoryRoot, "LICENSE");
  const packageJson = readJson(resolve(repositoryRoot, "package.json"));
  const manifestFilename = getManifestFilename(packageJson.version);
  const manifestPath = resolve(repositoryRoot, manifestFilename);
  if (!existsSync(manifestPath)) {
    console.error(
      `::error title=Obsidian package validation::${manifestFilename} must exist for package version ${packageJson.version}`
    );
    process.exitCode = 1;
    return;
  }

  const manifestText = readFileSync(manifestPath, "utf8");
  if (!(await validateSelectedManifest(manifestPath, manifestText))) {
    process.exitCode = 1;
    return;
  }

  const findings = collectPackageFindings({
    manifest: JSON.parse(manifestText),
    packageJson,
    licenseText: existsSync(licensePath) ? readFileSync(licensePath, "utf8") : "",
  });
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`::error title=Obsidian package validation::${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  await printLintResult(await lintRuntimeDependencies(packageJson));
  console.info("Obsidian package metadata, dependency, and license validation passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
