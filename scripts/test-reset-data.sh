#!/usr/bin/env bash
set -euo pipefail

# Companion to test-vault.sh: overwrite the target vault's plugin data.json with
# a predefined fixture, then reload the plugin so the reset takes effect.
#
# Usage:
#   npm run test:reset-data                 # uses the bundled clean-onboarding fixture
#   npm run test:reset-data -- <path>       # uses an arbitrary data.json

OBSIDIAN_BIN="/Applications/Obsidian.app/Contents/MacOS/obsidian"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKTREE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_FIXTURE="$SCRIPT_DIR/test-fixtures/data.clean-onboarding.json"

if [[ -z "${COPILOT_TEST_VAULT_PATH:-}" ]]; then
  cat >&2 <<'EOF'
error: COPILOT_TEST_VAULT_PATH is not set.

Set it once at the user level (e.g. in ~/.zshrc or ~/.config/fish/config.fish)
to the absolute path of an Obsidian vault you've opened at least once:

  export COPILOT_TEST_VAULT_PATH="$HOME/Obsidian/CopilotTestVault"

Then re-run: npm run test:reset-data
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

SRC="${1:-$DEFAULT_FIXTURE}"
if [[ ! -f "$SRC" ]]; then
  echo "error: source data.json not found: $SRC" >&2
  exit 1
fi

# Validate the source parses as JSON before touching the vault so a malformed
# file can never corrupt the target data.json.
if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$SRC" 2>/dev/null; then
  echo "error: source file is not valid JSON: $SRC" >&2
  exit 1
fi

cd "$WORKTREE_ROOT"

PLUGIN_ID="$(node -p "require('./manifest.json').id")"
if [[ -z "$PLUGIN_ID" ]]; then
  echo "error: could not read plugin id from manifest.json" >&2
  exit 1
fi

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"
mkdir -p "$PLUGIN_DIR"
TARGET="$PLUGIN_DIR/data.json"

echo "==> Writing $SRC -> $TARGET"
cp "$SRC" "$TARGET"

echo "==> Reloading plugin in Obsidian"
if [[ ! -x "$OBSIDIAN_BIN" ]]; then
  echo "warning: Obsidian CLI not found at $OBSIDIAN_BIN; skipping reload." >&2
else
  if ! "$OBSIDIAN_BIN" plugin:enable id="$PLUGIN_ID" >/dev/null 2>&1 \
     || ! "$OBSIDIAN_BIN" plugin:reload id="$PLUGIN_ID" >/dev/null 2>&1; then
    echo "warning: Obsidian doesn't appear to be running. Start it and the reset data.json will load on next open." >&2
  fi
fi

echo
echo "Done."
echo "  source:  $SRC"
echo "  vault:   $VAULT_PATH"
echo "  plugin:  $PLUGIN_ID"
echo "  target:  $TARGET"
