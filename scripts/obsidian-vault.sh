# Sourced by the scripts that deploy into $COPILOT_TEST_VAULT_PATH and reload a
# plugin through the Obsidian CLI.
#
# The CLI targets the vault named by `vault=`, else the registered vault
# enclosing $PWD, else whichever vault Obsidian last focused. A folder that was
# never opened as a vault is not registered, so a reload aimed at it silently
# reloads the plugin in some other vault instead. Resolve the target's
# registered name first and pass it on every call.

# Prints the registered name of the vault at real path $1.
# Returns 1 when Obsidian lists vaults but none at that path, and 2 when the
# CLI gives no listing (Obsidian not running or unreachable).
resolve_obsidian_vault_name() {
  local vault_real="$1"
  local listing name path info_path

  listing="$("$OBSIDIAN_BIN" vaults verbose 2>/dev/null)" || return 2
  [[ -n "$listing" ]] || return 2

  while IFS=$'\t' read -r name path; do
    [[ -n "$name" && -n "$path" && -d "$path" ]] || continue
    [[ "$(cd "$path" && pwd -P)" == "$vault_real" ]] || continue
    # Two registered vaults can share a folder name; only use a name that
    # resolves back to this path.
    info_path="$("$OBSIDIAN_BIN" vault="$name" vault 2>/dev/null |
      awk -F'\t' '$1 == "path" { print $2 }')"
    if [[ -n "$info_path" && -d "$info_path" &&
      "$(cd "$info_path" && pwd -P)" == "$vault_real" ]]; then
      printf '%s' "$name"
      return 0
    fi
  done <<<"$listing"
  return 1
}

# Sets OBSIDIAN_VAULT_NAME for the vault at $1, or empty when the CLI is
# missing or unreachable (the reload is then skipped with a warning). Exits
# when Obsidian is reachable but has no vault at that path.
require_obsidian_vault() {
  local vault_path="$1"
  local vault_real status=0

  OBSIDIAN_VAULT_NAME=""
  [[ -x "$OBSIDIAN_BIN" ]] || return 0
  vault_real="$(cd "$vault_path" && pwd -P)"
  OBSIDIAN_VAULT_NAME="$(resolve_obsidian_vault_name "$vault_real")" || status=$?
  case "$status" in
    0) ;;
    2) OBSIDIAN_VAULT_NAME="" ;;
    *)
      cat >&2 <<EOF
error: Obsidian has no vault registered at $vault_path, or another
registered vault shares its folder name. A reload aimed at it would reach
another vault instead, so nothing was changed. Open the folder in Obsidian
with "Open folder as vault" (renaming the folder if its name is taken), then
re-run.
EOF
      exit 1
      ;;
  esac
}
