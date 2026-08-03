#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

FIXTURE_ROOT="$TEST_ROOT/repo"
CURRENT_SOURCE="$FIXTURE_ROOT/dev/gallery"
LEGACY_SOURCE="$TEST_ROOT/legacy-gallery"
FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$CURRENT_SOURCE" "$FIXTURE_ROOT/scripts" "$LEGACY_SOURCE" "$FAKE_BIN"
cp "$REPO_ROOT/scripts/gallery-vault.sh" "$FIXTURE_ROOT/scripts/gallery-vault.sh"

cat >"$CURRENT_SOURCE/manifest.json" <<'EOF'
{
  "id": "copilot-component-gallery",
  "name": "Copilot Component Gallery (dev)",
  "version": "0.0.1"
}
EOF
printf 'gallery bundle\n' >"$CURRENT_SOURCE/main.js"
printf 'gallery styles\n' >"$CURRENT_SOURCE/styles.css"
printf 'legacy bundle\n' >"$LEGACY_SOURCE/main.js"
printf 'legacy manifest\n' >"$LEGACY_SOURCE/manifest.json"
printf 'legacy styles\n' >"$LEGACY_SOURCE/styles.css"
printf 'legacy source state\n' >"$LEGACY_SOURCE/source-state.txt"

cat >"$FAKE_BIN/obsidian" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FAKE_BIN/obsidian"

if ! grep -qxF ".hotreload" "$REPO_ROOT/dev/gallery/.gitignore"; then
  echo "expected dev/gallery/.hotreload to be ignored" >&2
  exit 1
fi

prepare_vault() {
  local vault_root="$1"
  mkdir -p "$vault_root/.obsidian/plugins/copilot"
  printf 'copilot settings\n' >"$vault_root/.obsidian/plugins/copilot/data.json"
  printf '["copilot","hot-reload"]\n' >"$vault_root/.obsidian/community-plugins.json"
}

create_legacy_gallery_dir() {
  local gallery_dir="$1"
  mkdir -p "$gallery_dir"
  for artifact in main.js manifest.json styles.css; do
    ln -s "$LEGACY_SOURCE/$artifact" "$gallery_dir/$artifact"
  done
  printf 'legacy marker content\n' >"$gallery_dir/.hotreload"
}

run_deploy() {
  local vault_root="$1"
  COPILOT_TEST_VAULT_PATH="$vault_root" \
    OBSIDIAN_BIN="$FAKE_BIN/obsidian" \
    bash "$FIXTURE_ROOT/scripts/gallery-vault.sh" >/dev/null
}

assert_file_content() {
  local file_path="$1"
  local expected="$2"
  if [[ "$(cat "$file_path")" != "$expected" ]]; then
    echo "unexpected content in $file_path" >&2
    exit 1
  fi
}

assert_symlink_target() {
  local link_path="$1"
  local expected_target="$2"
  if [[ ! -L "$link_path" ]]; then
    echo "expected symlink: $link_path" >&2
    exit 1
  fi
  if [[ "$(readlink "$link_path")" != "$expected_target" ]]; then
    echo "unexpected symlink target for $link_path" >&2
    exit 1
  fi
}

assert_unrelated_vault_state() {
  local vault_root="$1"
  assert_file_content "$vault_root/.obsidian/plugins/copilot/data.json" "copilot settings"
  assert_file_content "$vault_root/.obsidian/community-plugins.json" '["copilot","hot-reload"]'
}

KNOWN_VAULT="$TEST_ROOT/known-vault"
KNOWN_GALLERY="$KNOWN_VAULT/.obsidian/plugins/copilot-component-gallery"
prepare_vault "$KNOWN_VAULT"
create_legacy_gallery_dir "$KNOWN_GALLERY"

run_deploy "$KNOWN_VAULT"

assert_symlink_target "$KNOWN_GALLERY" "$CURRENT_SOURCE"
if [[ ! -f "$CURRENT_SOURCE/.hotreload" || -L "$CURRENT_SOURCE/.hotreload" ]]; then
  echo "expected deployment source to contain a regular .hotreload marker" >&2
  exit 1
fi
assert_file_content "$LEGACY_SOURCE/source-state.txt" "legacy source state"
assert_unrelated_vault_state "$KNOWN_VAULT"

UNEXPECTED_VAULT="$TEST_ROOT/unexpected-vault"
UNEXPECTED_GALLERY="$UNEXPECTED_VAULT/.obsidian/plugins/copilot-component-gallery"
prepare_vault "$UNEXPECTED_VAULT"
create_legacy_gallery_dir "$UNEXPECTED_GALLERY"
printf 'gallery settings that must survive\n' >"$UNEXPECTED_GALLERY/data.json"

if run_deploy "$UNEXPECTED_VAULT" >"$TEST_ROOT/unexpected.stdout" 2>"$TEST_ROOT/unexpected.stderr"; then
  echo "expected deployment to refuse a gallery directory with unexpected state" >&2
  exit 1
fi

if ! grep -q "unexpected entry: $UNEXPECTED_GALLERY/data.json" "$TEST_ROOT/unexpected.stderr"; then
  echo "expected refusal to identify the unexpected gallery entry" >&2
  exit 1
fi
if [[ -L "$UNEXPECTED_GALLERY" || ! -d "$UNEXPECTED_GALLERY" ]]; then
  echo "expected refused gallery directory to remain in place" >&2
  exit 1
fi
for artifact in main.js manifest.json styles.css; do
  assert_symlink_target "$UNEXPECTED_GALLERY/$artifact" "$LEGACY_SOURCE/$artifact"
done
assert_file_content "$UNEXPECTED_GALLERY/.hotreload" "legacy marker content"
assert_file_content "$UNEXPECTED_GALLERY/data.json" "gallery settings that must survive"
assert_unrelated_vault_state "$UNEXPECTED_VAULT"

REPOINT_VAULT="$TEST_ROOT/repoint-vault"
REPOINT_GALLERY="$REPOINT_VAULT/.obsidian/plugins/copilot-component-gallery"
prepare_vault "$REPOINT_VAULT"
ln -s "$LEGACY_SOURCE" "$REPOINT_GALLERY"

run_deploy "$REPOINT_VAULT"

assert_symlink_target "$REPOINT_GALLERY" "$CURRENT_SOURCE"
assert_file_content "$LEGACY_SOURCE/source-state.txt" "legacy source state"
assert_unrelated_vault_state "$REPOINT_VAULT"

echo "gallery-vault deployment tests passed"
