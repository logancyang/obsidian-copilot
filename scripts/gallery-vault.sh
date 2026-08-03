#!/usr/bin/env bash
set -euo pipefail

OBSIDIAN_BIN="${OBSIDIAN_BIN:-/Applications/Obsidian.app/Contents/MacOS/obsidian}"

if [[ -z "${COPILOT_TEST_VAULT_PATH:-}" ]]; then
  cat >&2 <<'EOF'
error: COPILOT_TEST_VAULT_PATH is not set.

Set it once at the user level to the absolute path of an Obsidian vault you've
opened at least once, then re-run: npm run gallery:vault
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

if ! PLUGIN_ID="$(node -e '
  const id = require("./dev/gallery/manifest.json").id;
  if (typeof id !== "string" || id.length === 0) process.exit(1);
  process.stdout.write(id);
')"; then
  echo "error: could not read plugin id from dev/gallery/manifest.json" >&2
  exit 1
fi
if [[ ! "$PLUGIN_ID" =~ ^[a-z0-9-]+$ ]]; then
  echo "error: invalid plugin id in dev/gallery/manifest.json: $PLUGIN_ID" >&2
  exit 1
fi
PLUGIN_ID_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$PLUGIN_ID")"

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"
mkdir -p "$PLUGIN_DIR"
touch "$PLUGIN_DIR/.hotreload"

echo "==> Linking gallery artifacts into $PLUGIN_DIR"
for artifact in main.js manifest.json styles.css; do
  source_path="$WORKTREE_ROOT/dev/gallery/$artifact"
  if [[ "$artifact" != "styles.css" && ! -f "$source_path" ]]; then
    echo "error: expected gallery artifact missing: $source_path" >&2
    exit 1
  fi
  rm -f "$PLUGIN_DIR/$artifact"
  ln -s "$source_path" "$PLUGIN_DIR/$artifact"
done

echo "==> Reloading gallery plugin in Obsidian (vault dir: $VAULT_PATH)"
if [[ ! -x "$OBSIDIAN_BIN" ]]; then
  echo "warning: Obsidian CLI not found at $OBSIDIAN_BIN; skipping reload." >&2
else
  RELOAD_CODE="(async()=>{const id=$PLUGIN_ID_JSON;await app.plugins.loadManifests();if(app.plugins.plugins[id])await app.plugins.disablePlugin(id);await app.plugins.enablePluginAndSave(id);const state={manifest:!!app.plugins.manifests[id],loaded:!!app.plugins.plugins[id],enabled:app.plugins.enabledPlugins.has(id)};if(!state.manifest||!state.loaded||!state.enabled)throw new Error('Gallery plugin failed to load: '+JSON.stringify(state));return JSON.stringify(state);})()"
  if (cd "$VAULT_PATH" && "$OBSIDIAN_BIN" eval code="$RELOAD_CODE" >/dev/null 2>&1); then
    echo "    reloaded"
  else
    echo "warning: could not reload via the CLI. Is Obsidian running with this vault open? The plugin will load on next open." >&2
  fi
fi

echo
echo "Done."
echo "  worktree: $WORKTREE_ROOT"
echo "  vault:    $VAULT_PATH"
echo "  plugin:   $PLUGIN_ID"
