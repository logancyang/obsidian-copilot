#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

FIXTURE_ROOT="$TEST_ROOT/repo"
VAULT_ROOT="$TEST_ROOT/vault"
FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$FIXTURE_ROOT/scripts" "$VAULT_ROOT/.obsidian/plugins/copilot" "$FAKE_BIN"
cp "$REPO_ROOT/scripts/test-reset-data.sh" "$FIXTURE_ROOT/scripts/test-reset-data.sh"
cp "$REPO_ROOT/scripts/obsidian-vault.sh" "$FIXTURE_ROOT/scripts/obsidian-vault.sh"
printf '{ "id": "copilot" }\n' >"$FIXTURE_ROOT/manifest.json"
printf '{ "fixture": true }\n' >"$TEST_ROOT/data.json"
TARGET="$VAULT_ROOT/.obsidian/plugins/copilot/data.json"

CALL_LOG="$TEST_ROOT/calls.log"
REGISTRY="$TEST_ROOT/registry.tsv"
cat >"$FAKE_BIN/obsidian" <<'FAKE'
#!/usr/bin/env bash
echo "obsidian $*" >>"$CALL_LOG"
if [[ "$1" == "vaults" ]]; then
  cat "$REGISTRY"
elif [[ "$1" == vault=* && "${2:-}" == "vault" ]]; then
  awk -F'\t' -v name="${1#vault=}" \
    '$1 == name { print "name\t" $1; print "path\t" $2; exit }' "$REGISTRY"
fi
exit 0
FAKE
chmod +x "$FAKE_BIN/obsidian"

STDERR="$TEST_ROOT/stderr.log"
run_reset() {
  : >"$CALL_LOG"
  COPILOT_TEST_VAULT_PATH="$VAULT_ROOT" \
    OBSIDIAN_BIN="$FAKE_BIN/obsidian" \
    CALL_LOG="$CALL_LOG" \
    REGISTRY="$REGISTRY" \
    bash "$FIXTURE_ROOT/scripts/test-reset-data.sh" "$TEST_ROOT/data.json" >/dev/null 2>"$STDERR"
}

mkdir -p "$TEST_ROOT/other-vault"
printf 'other\t%s\n' "$TEST_ROOT/other-vault" >"$REGISTRY"
printf 'settings that must survive\n' >"$TARGET"
if run_reset; then
  echo "reset the data of a vault Obsidian has not registered" >&2
  exit 1
fi
if [[ "$(cat "$TARGET")" != "settings that must survive" ]]; then
  echo "overwrote data.json in an unregistered vault" >&2
  exit 1
fi
if grep -q "plugin:" "$CALL_LOG"; then
  echo "reloaded a plugin after finding the vault unregistered" >&2
  exit 1
fi

printf 'vault\t%s\n' "$VAULT_ROOT" >"$REGISTRY"
run_reset
if ! cmp -s "$TEST_ROOT/data.json" "$TARGET"; then
  echo "did not write the fixture into the registered vault" >&2
  exit 1
fi
for action in plugin:enable plugin:reload; do
  if ! grep -qxF "obsidian vault=vault $action id=copilot" "$CALL_LOG"; then
    echo "expected $action to name the registered test vault" >&2
    exit 1
  fi
done

echo "test-reset-data tests passed"
