#!/usr/bin/env bash
set -euo pipefail

OBSIDIAN_BIN="/Applications/Obsidian.app/Contents/MacOS/obsidian"

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

# Deployment mode: symlinks by default (macOS / native Linux). Switch to file
# copy on WSL when the vault lives on a Windows-mounted filesystem — Obsidian
# on Windows can't resolve WSL-flavored POSIX symlinks stored on DrvFs/9p.
DEPLOY_MODE="link"
if [[ "$(uname -r 2>/dev/null)" == *[Mm]icrosoft* ]] && [[ "$VAULT_REAL" == /mnt/* ]]; then
  DEPLOY_MODE="copy"
fi
# iCloud-synced vaults (Obsidian on iOS/iPadOS) can't use symlinks: iCloud
# uploads file contents, not link targets, so a symlinked main.js never reaches
# the phone. Copy real files so the mobile device receives the build.
if [[ "$VAULT_REAL" == *"/Mobile Documents/"* ]]; then
  DEPLOY_MODE="copy"
fi

echo "==> Installing dependencies"
npm install --prefer-offline --no-audit --no-fund

echo "==> Building plugin"
npm run build

PLUGIN_ID="$(node -p "require('./manifest.json').id")"
if [[ -z "$PLUGIN_ID" ]]; then
  echo "error: could not read plugin id from manifest.json" >&2
  exit 1
fi

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"
mkdir -p "$PLUGIN_DIR"

echo "==> Deploying artifacts into $PLUGIN_DIR (mode: $DEPLOY_MODE)"
for f in main.js styles.css; do
  if [[ ! -f "$WORKTREE_ROOT/$f" ]]; then
    echo "error: expected build artifact missing: $WORKTREE_ROOT/$f" >&2
    exit 1
  fi
  rm -f "$PLUGIN_DIR/$f"
  if [[ "$DEPLOY_MODE" == "copy" ]]; then
    cp -f "$WORKTREE_ROOT/$f" "$PLUGIN_DIR/$f"
  else
    ln -sfn "$WORKTREE_ROOT/$f" "$PLUGIN_DIR/$f"
  fi
done

# Write a timestamp-tagged manifest.json (real file, not a symlink). The plugin
# NAME (shown in Obsidian's Community plugins list / sidebar) carries the build
# timestamp ONLY — never the branch/worktree name, which is not a reliable signal
# of what code is actually loaded. The DESCRIPTION still carries `branch: <name>`
# because the `npm run test:vault` preflight in TESTING_GUIDE.md greps it
# (`/branch: ([^ |]+)/`) to catch deploying from the wrong worktree when several
# worktrees share one vault.
BRANCH="$(git -C "$WORKTREE_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
BUILD_TS="$(date +%Y%m%d-%H%M%S)"
echo "==> Writing timestamp-tagged manifest.json (name build: $BUILD_TS, branch: $BRANCH)"
rm -f "$PLUGIN_DIR/manifest.json"
SRC="$WORKTREE_ROOT/manifest.json" DEST="$PLUGIN_DIR/manifest.json" BRANCH="$BRANCH" BUILD_TS="$BUILD_TS" node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.env.SRC, "utf8"));
  m.name = m.name + " [" + process.env.BUILD_TS + "]";
  m.description = "[branch: " + process.env.BRANCH + " | build: " + process.env.BUILD_TS + "] " + m.description;
  fs.writeFileSync(process.env.DEST, JSON.stringify(m, null, 2) + "\n");
'

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

echo
echo "Done."
echo "  worktree: $WORKTREE_ROOT"
echo "  branch:   $BRANCH"
echo "  build:    $BUILD_TS"
echo "  vault:    $VAULT_PATH"
echo "  plugin:   $PLUGIN_ID"
