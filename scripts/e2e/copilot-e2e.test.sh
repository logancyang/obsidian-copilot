#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/copilot-e2e.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
export READY_GATE_E2E_LOCK="$TEST_ROOT/lock"
export OBSIDIAN_BIN="$TEST_ROOT/no-obsidian"

fail() { echo "FAIL: $*" >&2; exit 1; }

# lock: second holder is refused, wrong run cannot release, owner can.
bash "$SCRIPT" lock run-a
[[ -f "$READY_GATE_E2E_LOCK/owner.json" ]] || fail "lock owner.json missing"
rc=0; bash "$SCRIPT" lock run-b 2>/dev/null || rc=$?
[[ "$rc" -eq 75 ]] || fail "second lock should exit 75, got $rc"
bash "$SCRIPT" unlock run-b
[[ -d "$READY_GATE_E2E_LOCK" ]] || fail "non-owner released the lock"
bash "$SCRIPT" unlock run-a
[[ ! -d "$READY_GATE_E2E_LOCK" ]] || fail "owner could not release the lock"

# lock: a lock older than the stale cap is taken over.
bash "$SCRIPT" lock run-a
READY_GATE_E2E_STALE_SECS=-1 bash "$SCRIPT" lock run-c
grep -q '"run_id":"run-c"' "$READY_GATE_E2E_LOCK/owner.json" || fail "stale lock was not taken over"
bash "$SCRIPT" unlock run-c

# vault-reset: refuses an unmarked vault, then replaces content but keeps plugins.
VAULT="$TEST_ROOT/vault"
mkdir -p "$VAULT/.obsidian/plugins/copilot" "$VAULT/old"
echo old >"$VAULT/old/note.md"
echo build >"$VAULT/.obsidian/plugins/copilot/main.js"
export COPILOT_TEST_VAULT_PATH="$VAULT"
rc=0; bash "$SCRIPT" vault-reset 2>/dev/null || rc=$?
[[ "$rc" -ne 0 && -f "$VAULT/old/note.md" ]] || fail "unmarked vault was wiped"
touch "$VAULT/.copilot-e2e-vault"
bash "$SCRIPT" vault-reset >/dev/null 2>&1
[[ ! -e "$VAULT/old" ]] || fail "old content survived reset"
[[ -f "$VAULT/Welcome.md" && -f "$VAULT/.obsidian/community-plugins.json" ]] || fail "template not copied"
[[ -f "$VAULT/.obsidian/plugins/copilot/main.js" ]] || fail "deployed plugin was removed"

# gate: derives status and validates evidence URLs.
URL="https://github.com/user-attachments/assets/1234"
cat >"$TEST_ROOT/pass.json" <<JSON
[{"step":"Open chat","expected":"Chat renders","status":"pass","evidence":["$URL"]}]
JSON
bash "$SCRIPT" gate --out "$TEST_ROOT/g.json" --sha abc --checklist "$TEST_ROOT/pass.json" >/dev/null
node -e 'const g=require(process.argv[1]);if(g.status!=="pass"||g.sha!=="abc"||g.errors_clean!==true||g.video!==null||g.na_reason!==null)process.exit(1)' "$TEST_ROOT/g.json" || fail "pass gate shape"
bash "$SCRIPT" gate --out "$TEST_ROOT/g.json" --sha abc --checklist "$TEST_ROOT/pass.json" --errors-clean false >/dev/null
node -e 'if(require(process.argv[1]).status!=="fail")process.exit(1)' "$TEST_ROOT/g.json" || fail "dirty errors should fail"
bash "$SCRIPT" gate --out "$TEST_ROOT/g.json" --sha abc --na-reason "no user-visible surface: docs only" >/dev/null
node -e 'const g=require(process.argv[1]);if(g.status!=="na"||!g.na_reason||g.checklist.length!==0)process.exit(1)' "$TEST_ROOT/g.json" || fail "na gate shape"
echo '[{"step":"s","expected":"e","status":"pass","evidence":["http://example.com/x.png"]}]' >"$TEST_ROOT/bad.json"
rc=0; bash "$SCRIPT" gate --out "$TEST_ROOT/g.json" --sha abc --checklist "$TEST_ROOT/bad.json" 2>/dev/null || rc=$?
[[ "$rc" -ne 0 ]] || fail "non-attachment evidence URL accepted"

echo "copilot-e2e tests passed"
