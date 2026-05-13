import { execSync } from "child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;
const isPrerelease = targetVersion.includes("-");

// Obsidian's community plugin store reads manifest.json on master to decide
// which GitHub Release to serve. It MUST stay at the latest stable version.
// Prereleases live in manifest-beta.json instead. See:
//   https://github.com/obsidianmd/obsidian-releases#submit-your-plugin
const manifestPath = isPrerelease ? "manifest-beta.json" : "manifest.json";

// When cutting the first prerelease of a line, manifest-beta.json may not
// exist yet. Seed it from manifest.json so it inherits the stable manifest's
// fields (description, fundingUrl, etc.) and minAppVersion.
const sourceManifestPath =
  isPrerelease && !existsSync(manifestPath) ? "manifest.json" : manifestPath;

const manifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

// versions.json records every version's minimum Obsidian app version so
// Obsidian's installer can pick the right plugin version for the user's
// Obsidian build. Both stable and prerelease entries belong here.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");

// Stage the files we modified. npm version's auto-commit (or the agent's
// later explicit commit) picks them up.
execSync(`git add ${manifestPath} versions.json`);

// When a stable release ships, an existing manifest-beta.json is now
// historical. Remove it so BRAT and similar tools don't keep surfacing the
// older prerelease entry alongside the new stable.
//
// `git rm` fails on untracked files or files with local modifications, so
// check trackedness first and fall back to a plain unlink when the file is
// only in the working tree. This keeps stable bumps robust against a partial
// or in-progress prerelease state on the local machine.
if (!isPrerelease && existsSync("manifest-beta.json")) {
  let isTracked = false;
  try {
    execSync("git ls-files --error-unmatch manifest-beta.json", { stdio: "ignore" });
    isTracked = true;
  } catch {
    isTracked = false;
  }

  if (isTracked) {
    execSync("git rm -f manifest-beta.json");
  } else {
    unlinkSync("manifest-beta.json");
  }
  console.log(
    `Removed manifest-beta.json (${isTracked ? "tracked, staged deletion" : "untracked, removed from working tree"}).`
  );
}

console.log(`version-bump: wrote ${targetVersion} to ${manifestPath} and versions.json.`);
