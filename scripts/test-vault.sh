#!/usr/bin/env bash
set -euo pipefail

OBSIDIAN_BIN="${OBSIDIAN_BIN:-/Applications/Obsidian.app/Contents/MacOS/obsidian}"

if [[ -z "${COPILOT_TEST_VAULT_PATH:-}" ]]; then
  cat >&2 <<'EOF'
error: COPILOT_TEST_VAULT_PATH is not set.

Set it once at the user level (e.g. in ~/.zshrc or ~/.config/fish/config.fish)
to the absolute path of an Obsidian vault you've opened at least once:

  export COPILOT_TEST_VAULT_PATH="$HOME/Obsidian/CopilotTestVault"

Then re-run: npm run test:vault
EOF
  exit 1
fi

VAULT_PATH="$COPILOT_TEST_VAULT_PATH"

if [[ ! -d "$VAULT_PATH" ]]; then
  echo "error: vault directory not found: $VAULT_PATH" >&2
  exit 1
fi

if [[ ! -d "$VAULT_PATH/.obsidian" ]]; then
  echo "error: $VAULT_PATH has no .obsidian/ folder." >&2
  echo "Open the folder as a vault in Obsidian once, then re-run." >&2
  exit 1
fi

WORKTREE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WORKTREE_ROOT"

# Guard: refuse to run if the worktree lives inside the target vault. Otherwise
# the build artifacts and source tree become vault content, Obsidian indexes
# the whole repo on the next reload, and the plugin dir may coincide with the
# worktree (deploying onto itself).
WORKTREE_REAL="$(cd "$WORKTREE_ROOT" && pwd -P)"
VAULT_REAL="$(cd "$VAULT_PATH" && pwd -P)"
case "$WORKTREE_REAL" in
  "$VAULT_REAL"|"$VAULT_REAL"/*)
    cat >&2 <<EOF
error: the worktree is inside the test vault — refusing to deploy.
  worktree: $WORKTREE_REAL
  vault:    $VAULT_REAL
Move the worktree outside the vault, or point \$COPILOT_TEST_VAULT_PATH
at a different vault, then re-run.
EOF
    exit 1
    ;;
esac

echo "==> Installing dependencies"
npm install --prefer-offline --no-audit --no-fund

BRANCH="$(git -C "$WORKTREE_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
BUILD_COMMIT="$(git -C "$WORKTREE_ROOT" rev-parse --short=8 HEAD 2>/dev/null || echo unknown)"
BUILD_STATE="clean"
if [[ -n "$(git -C "$WORKTREE_ROOT" status --porcelain --untracked-files=normal 2>/dev/null)" ]]; then
  BUILD_STATE="dirty"
fi

echo "==> Building plugin"
npm run build

PLUGIN_ID="$(node -p "require('./manifest.json').id")"
if [[ -z "$PLUGIN_ID" ]]; then
  echo "error: could not read plugin id from manifest.json" >&2
  exit 1
fi

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"
mkdir -p "$PLUGIN_DIR"

echo "==> Copying artifacts into $PLUGIN_DIR"
for f in main.js styles.css; do
  if [[ ! -f "$WORKTREE_ROOT/$f" ]]; then
    echo "error: expected build artifact missing: $WORKTREE_ROOT/$f" >&2
    exit 1
  fi
  rm -f "$PLUGIN_DIR/$f"
  cp -f "$WORKTREE_ROOT/$f" "$PLUGIN_DIR/$f"
done

BUILD_TS="$(date +%Y%m%d-%H%M%S)"
rm -f "$PLUGIN_DIR/manifest.json"
BUILD_TAG="$(
  SRC="$WORKTREE_ROOT/manifest.json" \
    DEST="$PLUGIN_DIR/manifest.json" \
    ARTIFACT_DIR="$PLUGIN_DIR" \
    BRANCH="$BRANCH" \
    BUILD_COMMIT="$BUILD_COMMIT" \
    BUILD_STATE="$BUILD_STATE" \
    BUILD_TS="$BUILD_TS" \
    node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const hash = crypto.createHash("sha256");
    for (const file of ["main.js", "styles.css"]) {
      hash.update(file);
      hash.update("\0");
      hash.update(fs.readFileSync(path.join(process.env.ARTIFACT_DIR, file)));
      hash.update("\0");
    }
    const bundleSha = hash.digest("hex").slice(0, 12);
    const buildTag = [
      process.env.BUILD_COMMIT,
      process.env.BUILD_STATE,
      bundleSha,
    ].join("-");
    const manifest = JSON.parse(fs.readFileSync(process.env.SRC, "utf8"));
    const versionSeparator = manifest.version.includes("+") ? "." : "+";
    manifest.version += versionSeparator + [
      "dev",
      process.env.BUILD_COMMIT,
      process.env.BUILD_STATE,
      bundleSha,
    ].join(".");
    manifest.name += " [" + buildTag + "]";
    manifest.description = [
      "[dev build: " + buildTag,
      "branch: " + process.env.BRANCH,
      "built: " + process.env.BUILD_TS + "]",
    ].join(" | ") + " " + manifest.description;
    fs.writeFileSync(process.env.DEST, JSON.stringify(manifest, null, 2) + "\n");
    process.stdout.write(buildTag);
  '
)"
echo "==> Wrote development manifest (build: $BUILD_TAG, branch: $BRANCH)"

# Reload by toggling disable -> enable, NOT `plugin:reload`. On this setup
# `plugin:reload` returns success but does NOT re-run the plugin's onload, so the
# freshly deployed main.js never executes. A disable+enable cycle re-runs onload.
#
# CRITICAL: the Obsidian CLI picks its TARGET VAULT from the current working
# directory (it resolves the vault enclosing $PWD; `vault=` does NOT override
# this). So we MUST run the CLI from inside the target vault's directory, or the
# reload silently hits whatever vault the caller's cwd sits in (e.g. the
# repo/worktree vault) instead of the deploy target. Hence the `cd "$VAULT_PATH"`.
echo "==> Reloading plugin in Obsidian (vault dir: $VAULT_PATH)"
if [[ ! -x "$OBSIDIAN_BIN" ]]; then
  echo "warning: Obsidian CLI not found at $OBSIDIAN_BIN; skipping reload." >&2
else
  ( cd "$VAULT_PATH" && "$OBSIDIAN_BIN" plugin:disable id="$PLUGIN_ID" >/dev/null 2>&1 ) || true
  if ( cd "$VAULT_PATH" && "$OBSIDIAN_BIN" plugin:enable id="$PLUGIN_ID" >/dev/null 2>&1 ); then
    echo "    reloaded (onload re-ran). Note: the sidebar manifest label only"
    echo "    refreshes on a full Obsidian restart; use a dev-console marker to"
    echo "    confirm the loaded build, not the label."
  else
    echo "warning: could not reload via the CLI. Is Obsidian running with this vault open? The plugin will load on next open." >&2
  fi
fi

# The component gallery plugin ships a near-complete copy of the production
# stylesheet (scripts/prepare-gallery-css.mjs concatenates src/styles/tailwind.css
# into its source), and Obsidian injects every enabled plugin's styles.css
# document-wide. Both copies then compete at equal specificity in shared views, so
# a gallery copy built from an older src/styles/tailwind.css silently outranks the
# CSS deployed above and the plugin renders pre-change behavior.
GALLERY_MANIFEST="$WORKTREE_ROOT/dev/gallery/manifest.json"
GALLERY_ID=""
if [[ -f "$GALLERY_MANIFEST" ]]; then
  if ! GALLERY_ID="$(node -e '
    const id = require("./dev/gallery/manifest.json").id;
    if (typeof id !== "string" || id.length === 0) process.exit(1);
    process.stdout.write(id);
  ')" || [[ ! "$GALLERY_ID" =~ ^[a-z0-9-]+$ ]]; then
    echo "warning: no valid plugin id in $GALLERY_MANIFEST; skipping the gallery refresh." >&2
    GALLERY_ID=""
  fi
fi

if [[ -n "$GALLERY_ID" ]]; then
  GALLERY_PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$GALLERY_ID"
  if [[ -e "$GALLERY_PLUGIN_DIR" || -L "$GALLERY_PLUGIN_DIR" ]]; then
    # gallery-vault.sh symlinks its whole source directory into the vault, so the
    # live stylesheet belongs to whichever worktree deployed it last. Only that
    # worktree can refresh it.
    GALLERY_SOURCE_REAL="$(cd "$WORKTREE_ROOT/dev/gallery" && pwd -P)"
    GALLERY_DEPLOYED_REAL="$(cd "$GALLERY_PLUGIN_DIR" 2>/dev/null && pwd -P || true)"
    if [[ "$GALLERY_DEPLOYED_REAL" == "$GALLERY_SOURCE_REAL" ]]; then
      # Obsidian injects styles.css when a plugin is enabled, so rewriting the
      # symlinked file in place does not re-inject it. gallery:vault rebuilds and
      # reloads, which is what makes the new stylesheet take effect.
      echo "==> Redeploying the gallery plugin so both stylesheets match"
      npm run gallery:vault
    else
      cat >&2 <<EOF
warning: the vault's gallery plugin comes from somewhere else, so nothing built
here can refresh it. Its stale copy of the production stylesheet can outrank the
CSS just deployed, making these changes look like they had no effect.
  deployed: ${GALLERY_DEPLOYED_REAL:-unresolved ($GALLERY_PLUGIN_DIR)}
  here:     $GALLERY_SOURCE_REAL
Run \`npm run gallery:vault\` from that worktree, or disable the $GALLERY_ID
plugin while testing this one.
EOF
    fi
  fi
fi

echo
echo "Done."
echo "  worktree: $WORKTREE_ROOT"
echo "  branch:   $BRANCH"
echo "  build:    $BUILD_TAG"
echo "  built:    $BUILD_TS"
echo "  vault:    $VAULT_PATH"
echo "  plugin:   $PLUGIN_ID"
