#!/usr/bin/env bash
set -euo pipefail

# Mechanics for the copilot-e2e skill (.claude/skills/copilot-e2e/SKILL.md).
#
#   lock <run-id>          take the global e2e lock (exit 75 if held)
#   unlock <run-id>        release it if this run owns it
#   vault-reset            replace the test vault's content with the fixture template
#   inject-keys            copy secrets from bws / the macOS Keychain into Obsidian SecretStorage
#   gate --out FILE ...    assemble and validate one e2e gate object

HERE="$(cd "$(dirname "$0")" && pwd)"
LOCK_DIR="${READY_GATE_E2E_LOCK:-$HOME/.cache/ready-gate/e2e.lock}"
LOCK_STALE_SECS="${READY_GATE_E2E_STALE_SECS:-1800}"
OBS="${OBSIDIAN_BIN:-/Applications/Obsidian.app/Contents/MacOS/obsidian}"
TEMPLATE="${COPILOT_E2E_TEMPLATE:-$HERE/vault-template}"
SENTINEL=".copilot-e2e-vault"

die() { echo "copilot-e2e: $*" >&2; exit 1; }

lock_age() {
  node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Math.floor(Date.now()/1000-o.started_at))' "$LOCK_DIR/owner.json" 2>/dev/null || echo 0
}

cmd_lock() {
  local run_id="${1:?usage: lock <run-id>}"
  mkdir -p "$(dirname "$LOCK_DIR")"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    local age; age="$(lock_age)"
    if [[ "$age" -le "$LOCK_STALE_SECS" ]]; then
      echo "copilot-e2e: e2e lock held: $(cat "$LOCK_DIR/owner.json" 2>/dev/null)" >&2
      exit 75
    fi
    # Move the stale lock aside first so only one contender wins the retry.
    mv "$LOCK_DIR" "$LOCK_DIR.stale.$$" 2>/dev/null || true
    rm -rf "$LOCK_DIR.stale.$$"
    mkdir "$LOCK_DIR" 2>/dev/null || { echo "copilot-e2e: lost the race for a stale lock" >&2; exit 75; }
  fi
  printf '{"pid":%s,"run_id":"%s","started_at":%s}\n' "$PPID" "$run_id" "$(date +%s)" >"$LOCK_DIR/owner.json"
}

cmd_unlock() {
  local run_id="${1:?usage: unlock <run-id>}"
  [[ -f "$LOCK_DIR/owner.json" ]] || return 0
  if grep -q "\"run_id\":\"$run_id\"" "$LOCK_DIR/owner.json"; then rm -rf "$LOCK_DIR"; fi
}

vault_path() {
  [[ -n "${COPILOT_TEST_VAULT_PATH:-}" ]] || die "COPILOT_TEST_VAULT_PATH is not set"
  [[ -d "$COPILOT_TEST_VAULT_PATH/.obsidian" ]] || die "$COPILOT_TEST_VAULT_PATH is not an opened vault"
  (cd "$COPILOT_TEST_VAULT_PATH" && pwd -P)
}

# Wipes everything except .obsidian/plugins (the deployed build) and the sentinel.
# The sentinel is created once by a human: `touch "$COPILOT_TEST_VAULT_PATH/.copilot-e2e-vault"`.
cmd_vault_reset() {
  local vault; vault="$(vault_path)"
  [[ "$vault" != "/" && "$vault" != "$(cd "$HOME" && pwd -P)" ]] || die "refusing to reset $vault"
  [[ -e "$vault/$SENTINEL" ]] || die "$vault is not marked as an e2e vault; create $vault/$SENTINEL to allow wiping it"
  [[ ! -d "$vault/.git" ]] || die "$vault is a git repository; refusing to wipe it"
  find "$vault" -mindepth 1 -maxdepth 1 ! -name "$SENTINEL" ! -name .obsidian -exec rm -rf {} +
  find "$vault/.obsidian" -mindepth 1 -maxdepth 1 ! -name plugins -exec rm -rf {} +
  cp -R "$TEMPLATE"/. "$vault"/
  local vault_name; vault_name="$(basename "$vault")"
  if [[ -x "$OBS" ]]; then
    "$OBS" vault="$vault_name" reload >/dev/null 2>&1 || echo "copilot-e2e: Obsidian not reachable; reload it before driving" >&2
  fi
  echo "vault reset: $vault"
}

# COPILOT_E2E_SECRETS: whitespace-separated "<keychainId>=bws:<secret-name>" or
# "<keychainId>=keychain:<service>". keychainId is the provider's apiKeyKeychainId.
secret_value() {
  local source="$1"
  case "$source" in
    bws:*)
      bws secret list | node -e 'const n=process.argv[1];const s=JSON.parse(require("fs").readFileSync(0,"utf8")).find(x=>x.key===n);if(!s)process.exit(1);process.stdout.write(s.value)' "${source#bws:}" ;;
    keychain:*) security find-generic-password -s "${source#keychain:}" -w ;;
    *) return 2 ;;
  esac
}

cmd_inject_keys() {
  local vault_name; vault_name="$(basename "$(vault_path)")"
  local spec id source tmp
  for spec in ${COPILOT_E2E_SECRETS:-}; do
    id="${spec%%=*}"; source="${spec#*=}"
    tmp="$(mktemp)"; chmod 600 "$tmp"
    if ! secret_value "$source" >"$tmp"; then rm -f "$tmp"; die "could not read secret source '$source' for $id"; fi
    # The value goes through a 0600 file the renderer reads and deletes, never argv.
    "$OBS" vault="$vault_name" eval code="(()=>{const fs=require('fs');const v=fs.readFileSync('$tmp','utf8').trim();fs.unlinkSync('$tmp');app.secretStorage.setSecret('$id',v);return 'ok'})()" >/dev/null || { rm -f "$tmp"; die "injection failed for $id"; }
    rm -f "$tmp"
    echo "injected secret $id"
  done
}

cmd_gate() {
  node "$HERE/gate-json.mjs" "$@"
}

sub="${1:-}"; shift || true
case "$sub" in
  lock) cmd_lock "$@" ;;
  unlock) cmd_unlock "$@" ;;
  vault-reset) cmd_vault_reset "$@" ;;
  inject-keys) cmd_inject_keys "$@" ;;
  gate) cmd_gate "$@" ;;
  *) die "usage: copilot-e2e.sh lock|unlock|vault-reset|inject-keys|gate" ;;
esac
