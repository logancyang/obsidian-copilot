#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

FIXTURE_ROOT="$TEST_ROOT/repo"
VAULT_ROOT="$TEST_ROOT/vault"
FAKE_BIN="$TEST_ROOT/bin"
GALLERY_DIR="$VAULT_ROOT/.obsidian/plugins/copilot-component-gallery"
COPILOT_DIR="$VAULT_ROOT/.obsidian/plugins/copilot"
mkdir -p "$FIXTURE_ROOT/dev/gallery" "$FIXTURE_ROOT/scripts" "$GALLERY_DIR" "$COPILOT_DIR" "$FAKE_BIN"
cp "$REPO_ROOT/scripts/gallery-vault.sh" "$FIXTURE_ROOT/scripts/gallery-vault.sh"

cat >"$FIXTURE_ROOT/dev/gallery/manifest.json" <<'EOF'
{
  "id": "copilot-component-gallery",
  "name": "Copilot Component Gallery (dev)",
  "version": "0.0.1"
}
EOF
printf 'gallery bundle\n' >"$FIXTURE_ROOT/dev/gallery/main.js"
printf 'gallery styles\n' >"$FIXTURE_ROOT/dev/gallery/styles.css"

cat >"$FAKE_BIN/obsidian" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FAKE_BIN/obsidian"

printf 'gallery settings\n' >"$GALLERY_DIR/data.json"
printf 'gallery extra state\n' >"$GALLERY_DIR/state.json"
printf 'copilot settings\n' >"$COPILOT_DIR/data.json"
printf '["copilot","hot-reload"]\n' >"$VAULT_ROOT/.obsidian/community-plugins.json"

run_deploy() {
  COPILOT_TEST_VAULT_PATH="$VAULT_ROOT" \
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

run_deploy

if [[ ! -f "$GALLERY_DIR/.hotreload" || -L "$GALLERY_DIR/.hotreload" ]]; then
  echo "expected gallery deployment to create a regular .hotreload marker" >&2
  exit 1
fi

for artifact in main.js manifest.json styles.css; do
  if [[ ! -L "$GALLERY_DIR/$artifact" ]]; then
    echo "expected $artifact to be symlinked" >&2
    exit 1
  fi
  if [[ "$(readlink "$GALLERY_DIR/$artifact")" != "$FIXTURE_ROOT/dev/gallery/$artifact" ]]; then
    echo "unexpected $artifact symlink target" >&2
    exit 1
  fi
done

assert_file_content "$GALLERY_DIR/data.json" "gallery settings"
assert_file_content "$GALLERY_DIR/state.json" "gallery extra state"
assert_file_content "$COPILOT_DIR/data.json" "copilot settings"
assert_file_content "$VAULT_ROOT/.obsidian/community-plugins.json" '["copilot","hot-reload"]'

printf 'existing marker content\n' >"$GALLERY_DIR/.hotreload"
run_deploy

assert_file_content "$GALLERY_DIR/.hotreload" "existing marker content"
assert_file_content "$GALLERY_DIR/data.json" "gallery settings"
assert_file_content "$GALLERY_DIR/state.json" "gallery extra state"
assert_file_content "$COPILOT_DIR/data.json" "copilot settings"
assert_file_content "$VAULT_ROOT/.obsidian/community-plugins.json" '["copilot","hot-reload"]'

echo "gallery-vault deployment tests passed"
