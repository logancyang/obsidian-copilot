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
elif [[ "$1" == "eval" && "$2" == *vault-open* && -z "${REFUSE_REGISTER:-}" ]]; then
  path="$(printf '%s' "$2" | sed -E "s/.*'vault-open', \"([^\"]*)\".*/\1/")"
  printf '%s\t%s\n' "${path##*/}" "$path" >>"$REGISTRY"
fi
exit 0
FAKE
printf '#!/usr/bin/env bash\nexit 0\n' >"$FAKE_BIN/sleep"
chmod +x "$FAKE_BIN/obsidian" "$FAKE_BIN/sleep"

STDERR="$TEST_ROOT/stderr.log"
run_reset() {
  : >"$CALL_LOG"
  PATH="$FAKE_BIN:$PATH" \
    COPILOT_TEST_VAULT_PATH="$VAULT_ROOT" \
    OBSIDIAN_BIN="$FAKE_BIN/obsidian" \
    CALL_LOG="$CALL_LOG" \
    REGISTRY="$REGISTRY" \
    bash "$FIXTURE_ROOT/scripts/test-reset-data.sh" "$TEST_ROOT/data.json" >/dev/null 2>"$STDERR"
}

mkdir -p "$TEST_ROOT/other-vault"
printf 'other\t%s\n' "$TEST_ROOT/other-vault" >"$REGISTRY"
printf 'settings that must survive\n' >"$TARGET"
if REFUSE_REGISTER=1 run_reset; then
  echo "reset the data of a vault Obsidian would not register" >&2
  exit 1
fi
if [[ "$(cat "$TARGET")" != "settings that must survive" ]]; then
  echo "overwrote data.json in a vault it could not register" >&2
  exit 1
fi
if grep -q "plugin:" "$CALL_LOG"; then
  echo "reloaded a plugin after failing to register the vault" >&2
  exit 1
fi

run_reset
if ! grep -q "vault-open" "$CALL_LOG"; then
  echo "did not register the unregistered vault" >&2
  exit 1
fi
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
