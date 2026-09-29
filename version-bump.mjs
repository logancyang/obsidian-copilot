import { execSync } from "child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;
const isPrerelease = targetVersion.includes("-");

const manifestPath = isPrerelease ? "manifest-beta.json" : "manifest.json";

const sourceManifestPath =
  isPrerelease && !existsSync(manifestPath) ? "manifest.json" : manifestPath;

const manifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");

execSync(`git add ${manifestPath} versions.json`);

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
