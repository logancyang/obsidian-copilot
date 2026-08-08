import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_MANIFEST_STRINGS = [
  "id",
  "name",
  "version",
  "minAppVersion",
  "description",
  "author",
];

/**
 * Select the manifest that represents the package version being validated.
 *
 * @param {string} version - package.json version.
 * @returns {string} Stable or prerelease manifest filename.
 */
export function getManifestFilename(version) {
  return version.includes("-") ? "manifest-beta.json" : "manifest.json";
}

/**
 * Return package/manifest/license failures that would block an Obsidian release.
 *
 * @param {object} input - Package metadata to validate.
 * @param {Record<string, unknown>} input.manifest - Parsed manifest.json contents.
 * @param {Record<string, unknown>} input.packageJson - Parsed package.json contents.
 * @param {string} input.licenseText - Repository license file contents.
 * @returns {string[]} Human-readable release validation failures.
 */
export function collectPackageFindings({ manifest, packageJson, licenseText }) {
  const findings = [];
  for (const field of REQUIRED_MANIFEST_STRINGS) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      findings.push(`manifest.json must contain a non-empty ${field} string`);
    }
  }
  if (manifest.version !== packageJson.version) {
    findings.push("manifest.json and package.json versions must match");
  }
  if (manifest.isDesktopOnly !== false) {
    findings.push("manifest.json must keep isDesktopOnly=false for mobile compatibility");
  }
  if (typeof packageJson.license !== "string" || packageJson.license.trim() === "") {
    findings.push("package.json must declare a license");
  }
  if (licenseText.trim() === "") {
    findings.push("LICENSE must exist and contain the project license text");
  }
  return findings;
}

/**
 * Return one finding for each runtime dependency reported as vulnerable by npm.
 *
 * @param {Record<string, unknown>} auditReport - Parsed npm audit JSON report.
 * @returns {string[]} Vulnerable package findings.
 */
export function collectAuditFindings(auditReport) {
  const vulnerabilities = auditReport.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") return [];
  return Object.entries(vulnerabilities).map(([name, detail]) => {
    const severity =
      detail && typeof detail === "object" && "severity" in detail
        ? String(detail.severity)
        : "unknown";
    return `${name} has a ${severity} runtime vulnerability`;
  });
}

/**
 * Return whether npm reported a critical runtime dependency advisory.
 *
 * @param {Record<string, unknown>} auditReport - Parsed npm audit JSON report.
 * @returns {boolean} Whether the review gate must block the release.
 */
export function hasCriticalAuditFinding(auditReport) {
  const vulnerabilities = auditReport.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") return false;
  return Object.values(vulnerabilities).some(
    (detail) =>
      detail && typeof detail === "object" && "severity" in detail && detail.severity === "critical"
  );
}

function escapeAnnotationData(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function executeNpmAudit() {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(npmExecutable, ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === "win32",
  });
}

/**
 * Run the same production dependency audit policy used by CI and releases.
 * The command boundary is injectable so rejection fixtures can exercise the
 * real parser and exit-code behavior without depending on the live registry.
 *
 * @param {() => {stdout: string | null, stderr: string | null, status: number | null}} executeAudit - Command that returns npm audit JSON and its exit status.
 */
export function runAudit(executeAudit = executeNpmAudit) {
  const result = executeAudit();

  let auditReport;
  try {
    auditReport = JSON.parse(result.stdout);
  } catch {
    process.stderr.write(
      result.stderr || result.stdout || "npm audit produced no readable output\n"
    );
    process.exitCode = result.status || 1;
    return;
  }

  const findings = collectAuditFindings(auditReport);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.warn(
        `::warning title=Obsidian dependency advisory::${escapeAnnotationData(finding)}`
      );
    }
    if (hasCriticalAuditFinding(auditReport)) process.exitCode = 1;
    return;
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr || JSON.stringify(auditReport, null, 2));
    process.exitCode = result.status || 1;
    return;
  }

  console.info("No production dependency advisories found.");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const licensePath = resolve(repositoryRoot, "LICENSE");
  const packageJson = readJson(resolve(repositoryRoot, "package.json"));
  const manifestFilename = getManifestFilename(packageJson.version);
  const manifestPath = resolve(repositoryRoot, manifestFilename);
  const findings = existsSync(manifestPath)
    ? collectPackageFindings({
        manifest: readJson(manifestPath),
        packageJson,
        licenseText: existsSync(licensePath) ? readFileSync(licensePath, "utf8") : "",
      })
    : [`${manifestFilename} must exist for package version ${packageJson.version}`];

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`::error title=Obsidian package validation::${finding}`);
    }
    process.exitCode = 1;
    return;
  }
  console.info("Obsidian package metadata and license validation passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--audit")) runAudit();
  else main();
}
