# Sourced by the scripts that deploy into $COPILOT_TEST_VAULT_PATH and reload a
# plugin through the Obsidian CLI.
#
# The CLI targets the vault named by `vault=`, else the registered vault
# enclosing $PWD, else whichever vault Obsidian last focused. A folder that was
# never opened as a vault is not registered, so a reload aimed at it silently
# reloads the plugin in some other vault instead. Resolve the target's
# registered name first, registering the folder when Obsidian has none, and
# pass that name on every call.

# Prints the registered name of the vault at real path $1.
# Returns 1 when Obsidian lists vaults but none at that path, and 2 when the
# CLI gives no listing (Obsidian not running or unreachable).
resolve_obsidian_vault_name() {
  local vault_real="$1"
  local listing name path

  listing="$("$OBSIDIAN_BIN" vaults verbose 2>/dev/null)" || return 2
  [[ -n "$listing" ]] || return 2

  while IFS=$'\t' read -r name path; do
    [[ -n "$name" && -n "$path" && -d "$path" ]] || continue
    [[ "$(cd "$path" && pwd -P)" == "$vault_real" ]] || continue
    # Two registered vaults can share a folder name, and `vault=` cannot tell
    # them apart. Only a name no other vault uses targets this path.
    [[ "$(cut -f1 <<<"$listing" | grep -cxF -- "$name")" -eq 1 ]] || return 1
    printf '%s' "$name"
    return 0
  done <<<"$listing"
  return 1
}

# Registers and opens the folder at real path $1, as "Open folder as vault"
# does. The CLI has no command for this, so it sends Obsidian's undocumented
# `vault-open` IPC from whichever vault is open; the call touches no vault
# content. Never use an obsidian://open URL here: for an unregistered folder
# Obsidian shows a native "Vault not found" dialog that blocks every CLI call
# until someone dismisses it.
register_obsidian_vault() {
  local vault_real="$1"
  local path_json

  path_json="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$vault_real")"
  "$OBSIDIAN_BIN" eval \
    code="require('electron').ipcRenderer.sendSync('vault-open', $path_json, false)" \
    >/dev/null 2>&1
}

# A newly registered vault opens in restricted mode, so none of its community
# plugins load until someone clicks "Trust author and enable plugins". This is
# that click, applied only to the vault this run just registered.
trust_obsidian_vault() {
  local vault_name="$1"

  "$OBSIDIAN_BIN" vault="$vault_name" eval code="app.plugins.setEnable(true)" >/dev/null 2>&1
}

# Sets OBSIDIAN_VAULT_NAME for the vault at $1, registering and trusting the
# folder in Obsidian when needed, or leaves it empty when the CLI is missing or
# unreachable (the reload is then skipped with a warning). Exits when the
# folder cannot be registered under a name of its own.
require_obsidian_vault() {
  local vault_path="$1"
  local vault_real status=0 attempt

  OBSIDIAN_VAULT_NAME=""
  [[ -x "$OBSIDIAN_BIN" ]] || return 0
  vault_real="$(cd "$vault_path" && pwd -P)"
  OBSIDIAN_VAULT_NAME="$(resolve_obsidian_vault_name "$vault_real")" || status=$?
  case "$status" in
    0) return 0 ;;
    2) OBSIDIAN_VAULT_NAME="" && return 0 ;;
  esac

  # The CLI addresses vaults by folder name, so a second vault with a taken
  # name could never be targeted. Check before registering it.
  if "$OBSIDIAN_BIN" vaults verbose 2>/dev/null |
    awk -F'\t' -v name="${vault_real##*/}" '$1 == name { found = 1 } END { exit !found }'; then
    cat >&2 <<EOF
error: another registered Obsidian vault is already named "${vault_real##*/}",
so the CLI could not target $vault_path. Nothing was changed. Rename the
folder, then re-run.
EOF
    exit 1
  fi

  echo "==> Registering $vault_path as an Obsidian vault"
  register_obsidian_vault "$vault_real" || true
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    status=0
    OBSIDIAN_VAULT_NAME="$(resolve_obsidian_vault_name "$vault_real")" || status=$?
    # The new vault's window answers CLI calls only once it has loaded, and
    # trusting it any earlier is silently dropped.
    if [[ "$status" -eq 0 && -n "$("$OBSIDIAN_BIN" vault="$OBSIDIAN_VAULT_NAME" vault 2>/dev/null)" ]]; then
      echo "==> Trusting the new vault's plugins"
      trust_obsidian_vault "$OBSIDIAN_VAULT_NAME" || true
      return 0
    fi
    sleep 1
  done

  cat >&2 <<EOF
error: could not register $vault_path as an Obsidian vault. A reload aimed at
it would reach another vault instead, so nothing was deployed. Open it in
Obsidian with "Open folder as vault", then re-run.
EOF
  exit 1
}
