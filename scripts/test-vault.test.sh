#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

FIXTURE_ROOT="$TEST_ROOT/repo"
VAULT_ROOT="$TEST_ROOT/vault"
FAKE_BIN="$TEST_ROOT/bin"
mkdir -p "$FIXTURE_ROOT/scripts" "$VAULT_ROOT/.obsidian" "$FAKE_BIN"
cp "$REPO_ROOT/scripts/test-vault.sh" "$FIXTURE_ROOT/scripts/test-vault.sh"
cp "$REPO_ROOT/scripts/obsidian-vault.sh" "$FIXTURE_ROOT/scripts/obsidian-vault.sh"

cat >"$FIXTURE_ROOT/manifest.json" <<'EOF'
{
  "id": "copilot",
  "name": "Copilot",
  "version": "4.0.0-preview-260629",
  "description": "Test fixture"
}
EOF
printf 'clean bundle\n' >"$FIXTURE_ROOT/main.js"
printf 'clean styles\n' >"$FIXTURE_ROOT/styles.css"
printf 'tracked\n' >"$FIXTURE_ROOT/source.txt"
printf 'main.js\nstyles.css\n' >"$FIXTURE_ROOT/.gitignore"

DEPLOY_CALL_LOG="$TEST_ROOT/deploy-calls.log"
cat >"$FAKE_BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "npm $*" >>"$DEPLOY_CALL_LOG"
exit 0
EOF
REGISTRY="$TEST_ROOT/registry.tsv"
printf 'vault\t%s\n' "$VAULT_ROOT" >"$REGISTRY"
cat >"$FAKE_BIN/obsidian" <<'EOF'
#!/usr/bin/env bash
echo "obsidian $*" >>"$DEPLOY_CALL_LOG"
if [[ "$1" == "vaults" ]]; then
  cat "$REGISTRY"
elif [[ "$1" == vault=* && "${2:-}" == "vault" && -z "${RENDERER_CLOSED:-}" ]]; then
  awk -F'\t' -v name="${1#vault=}" \
    '$1 == name { print "name\t" $1; print "path\t" $2; exit }' "$REGISTRY"
elif [[ "$1" == "eval" && "$2" == *vault-open* && -z "${REFUSE_REGISTER:-}" ]]; then
  path="$(printf '%s' "$2" | sed -E "s/.*'vault-open', \"([^\"]*)\".*/\1/")"
  printf '%s\t%s\n' "${path##*/}" "$path" >>"$REGISTRY"
fi
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' >"$FAKE_BIN/sleep"
chmod +x "$FAKE_BIN/npm" "$FAKE_BIN/obsidian" "$FAKE_BIN/sleep"

git -C "$FIXTURE_ROOT" init -q
git -C "$FIXTURE_ROOT" config user.email "test@example.com"
git -C "$FIXTURE_ROOT" config user.name "Test"
git -C "$FIXTURE_ROOT" config commit.gpgsign false
git -C "$FIXTURE_ROOT" add .gitignore manifest.json scripts/obsidian-vault.sh scripts/test-vault.sh source.txt
git -C "$FIXTURE_ROOT" commit -qm "fixture"

DEPLOY_STDERR="$TEST_ROOT/deploy-stderr.log"
run_deploy() {
  : >"$DEPLOY_CALL_LOG"
  PATH="$FAKE_BIN:$PATH" \
    COPILOT_TEST_VAULT_PATH="$VAULT_ROOT" \
    OBSIDIAN_BIN="$FAKE_BIN/obsidian" \
    DEPLOY_CALL_LOG="$DEPLOY_CALL_LOG" \
    REGISTRY="$REGISTRY" \
    bash "$FIXTURE_ROOT/scripts/test-vault.sh" >/dev/null 2>"$DEPLOY_STDERR"
}

assert_manifest() {
  local state="$1"
  ARTIFACT_DIR="$VAULT_ROOT/.obsidian/plugins/copilot" \
    BUILD_COMMIT="$COMMIT" \
    BUILD_STATE="$state" \
    node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const hash = crypto.createHash("sha256");
    for (const file of ["main.js", "styles.css"]) {
      hash.update(file);
      hash.update("\0");
      hash.update(fs.readFileSync(path.join(process.env.ARTIFACT_DIR, file)));
      hash.update("\0");
    }
    const bundleSha = hash.digest("hex").slice(0, 12);
    const buildTag = [
      process.env.BUILD_COMMIT,
      process.env.BUILD_STATE,
      bundleSha,
    ].join("-");
    const manifest = require(path.join(process.env.ARTIFACT_DIR, "manifest.json"));
    const expectedVersion =
      `4.0.0-preview-260629+dev.${process.env.BUILD_COMMIT}.${process.env.BUILD_STATE}.${bundleSha}`;
    if (manifest.version !== expectedVersion) {
      throw new Error(`expected ${expectedVersion}, received ${manifest.version}`);
    }
    if (manifest.name !== `Copilot [${buildTag}]`) {
      throw new Error(`unexpected build name: ${manifest.name}`);
    }
    if (!manifest.description.includes(`dev build: ${buildTag}`)) {
      throw new Error(`build tag missing from description: ${manifest.description}`);
    }
  '
}

COMMIT="$(git -C "$FIXTURE_ROOT" rev-parse --short=8 HEAD)"
mkdir -p "$VAULT_ROOT/.obsidian/plugins/copilot"
ln -s "$FIXTURE_ROOT/main.js" "$VAULT_ROOT/.obsidian/plugins/copilot/main.js"
ln -s "$FIXTURE_ROOT/styles.css" "$VAULT_ROOT/.obsidian/plugins/copilot/styles.css"
run_deploy
assert_manifest clean

for action in plugin:disable plugin:enable; do
  if ! grep -qxF "obsidian vault=vault $action id=copilot" "$DEPLOY_CALL_LOG"; then
    echo "expected $action to name the registered test vault" >&2
    exit 1
  fi
done
if grep -q "setEnable" "$DEPLOY_CALL_LOG"; then
  echo "changed restricted mode in a vault it did not register" >&2
  exit 1
fi
MANIFESTS_LINE="$(grep -n -m1 -xF "obsidian vault=vault eval code=app.plugins.loadManifests()" "$DEPLOY_CALL_LOG" | cut -d: -f1)"
ENABLE_LINE="$(grep -n -m1 -xF "obsidian vault=vault plugin:enable id=copilot" "$DEPLOY_CALL_LOG" | cut -d: -f1)"
if [[ -z "$MANIFESTS_LINE" || "$MANIFESTS_LINE" -ge "$ENABLE_LINE" ]]; then
  echo "enabled the plugin before rescanning plugin manifests" >&2
  exit 1
fi

for artifact in main.js styles.css; do
  if [[ -L "$VAULT_ROOT/.obsidian/plugins/copilot/$artifact" ]]; then
    echo "expected $artifact to be copied, not symlinked" >&2
    exit 1
  fi
done
DEPLOYED_MAIN="$VAULT_ROOT/.obsidian/plugins/copilot/main.js"
printf 'changed after deployment\n' >"$FIXTURE_ROOT/main.js"
if [[ "$(cat "$DEPLOYED_MAIN")" != "clean bundle" ]]; then
  echo "deployed main.js changed when the worktree artifact changed" >&2
  exit 1
fi
if [[ "$(node -p "require('$FIXTURE_ROOT/manifest.json').version")" != "4.0.0-preview-260629" ]]; then
  echo "test-vault changed the source manifest version" >&2
  exit 1
fi

STORIES_LINE="$(grep -n -m1 '^npm run gallery:stories$' "$DEPLOY_CALL_LOG" | cut -d: -f1)"
BUILD_LINE="$(grep -n -m1 '^npm run build$' "$DEPLOY_CALL_LOG" | cut -d: -f1)"
if [[ -z "$STORIES_LINE" || -z "$BUILD_LINE" || "$BUILD_LINE" -le "$STORIES_LINE" ]]; then
  echo "built the plugin before regenerating the gallery story index" >&2
  exit 1
fi

printf 'dirty\n' >>"$FIXTURE_ROOT/source.txt"
printf 'dirty bundle\n' >"$FIXTURE_ROOT/main.js"
run_deploy
assert_manifest dirty

GALLERY_ID="copilot-component-gallery"
GALLERY_PLUGIN_DIR="$VAULT_ROOT/.obsidian/plugins/$GALLERY_ID"
mkdir -p "$FIXTURE_ROOT/dev/gallery"
cat >"$FIXTURE_ROOT/dev/gallery/manifest.json" <<EOF
{
  "id": "$GALLERY_ID",
  "name": "Gallery",
  "version": "0.0.1"
}
EOF

run_deploy
if grep -q "gallery:vault" "$DEPLOY_CALL_LOG"; then
  echo "rebuilt the gallery when the vault has no gallery plugin installed" >&2
  exit 1
fi
if grep -qi "gallery" "$DEPLOY_STDERR"; then
  echo "warned about the gallery when the vault has no gallery plugin installed" >&2
  exit 1
fi

ln -s "$FIXTURE_ROOT/dev/gallery" "$GALLERY_PLUGIN_DIR"
run_deploy
if ! grep -q "npm run gallery:vault" "$DEPLOY_CALL_LOG"; then
  echo "did not rebuild the gallery deployed from this worktree" >&2
  exit 1
fi
GALLERY_DEPLOY_LINE="$(grep -n -m1 '^npm run gallery:vault$' "$DEPLOY_CALL_LOG" | cut -d: -f1)"
FIRST_RELOAD_LINE="$(grep -n -m1 '^obsidian .*plugin:' "$DEPLOY_CALL_LOG" | cut -d: -f1)"
if [[ -z "$GALLERY_DEPLOY_LINE" || -z "$FIRST_RELOAD_LINE" || "$FIRST_RELOAD_LINE" -le "$GALLERY_DEPLOY_LINE" ]]; then
  echo "reloaded Obsidian before both plugins were deployed" >&2
  exit 1
fi

FOREIGN_GALLERY="$TEST_ROOT/other-worktree/dev/gallery"
mkdir -p "$FOREIGN_GALLERY"
rm "$GALLERY_PLUGIN_DIR"
ln -s "$FOREIGN_GALLERY" "$GALLERY_PLUGIN_DIR"
run_deploy
if ! grep -q "npm run gallery:vault" "$DEPLOY_CALL_LOG"; then
  echo "did not take over a gallery deployed from another worktree" >&2
  exit 1
fi

rm -r "$FOREIGN_GALLERY"
run_deploy
if ! grep -q "npm run gallery:vault" "$DEPLOY_CALL_LOG"; then
  echo "did not take over a gallery whose worktree no longer exists" >&2
  exit 1
fi

if ! RENDERER_CLOSED=1 run_deploy; then
  echo "refused a registered vault whose window is not open yet" >&2
  exit 1
fi
if grep -q "vault-open" "$DEPLOY_CALL_LOG" ||
  ! grep -qxF "obsidian vault=vault plugin:enable id=copilot" "$DEPLOY_CALL_LOG"; then
  echo "expected a registered vault with no open window to deploy without re-registering" >&2
  exit 1
fi

mkdir -p "$TEST_ROOT/other-vault"
printf 'other\t%s\n' "$TEST_ROOT/other-vault" >"$REGISTRY"
run_deploy
if ! grep -q "vault-open" "$DEPLOY_CALL_LOG"; then
  echo "did not register the unregistered vault" >&2
  exit 1
fi
if ! grep -qxF "obsidian vault=vault eval code=app.plugins.setEnable(true)" "$DEPLOY_CALL_LOG"; then
  echo "did not enable plugins in the newly registered vault" >&2
  exit 1
fi
for action in plugin:disable plugin:enable; do
  if ! grep -qxF "obsidian vault=vault $action id=copilot" "$DEPLOY_CALL_LOG"; then
    echo "expected $action to name the newly registered vault" >&2
    exit 1
  fi
done

DEPLOYED_BEFORE="$(cat "$DEPLOYED_MAIN")"
printf 'other\t%s\n' "$TEST_ROOT/other-vault" >"$REGISTRY"
if REFUSE_REGISTER=1 run_deploy; then
  echo "deployed into a vault Obsidian would not register" >&2
  exit 1
fi
if ! grep -q "could not register $VAULT_ROOT" "$DEPLOY_STDERR"; then
  echo "expected the refusal to name the unregistered vault" >&2
  exit 1
fi
if grep -q "plugin:" "$DEPLOY_CALL_LOG" || grep -q "^npm " "$DEPLOY_CALL_LOG"; then
  echo "built or reloaded after failing to register the vault" >&2
  exit 1
fi
if [[ "$(cat "$DEPLOYED_MAIN")" != "$DEPLOYED_BEFORE" ]]; then
  echo "changed the plugin files of a vault it could not register" >&2
  exit 1
fi

mkdir -p "$TEST_ROOT/elsewhere/vault"
printf 'vault\t%s\n' "$TEST_ROOT/elsewhere/vault" >"$REGISTRY"
if run_deploy; then
  echo "deployed into a vault whose name another vault already uses" >&2
  exit 1
fi
if ! grep -q 'already named "vault"' "$DEPLOY_STDERR"; then
  echo "expected the refusal to name the taken vault name" >&2
  exit 1
fi
if grep -q "vault-open" "$DEPLOY_CALL_LOG" || grep -q "^npm " "$DEPLOY_CALL_LOG"; then
  echo "registered or built a vault whose name is taken" >&2
  exit 1
fi

: >"$REGISTRY"
run_deploy
if grep -q "plugin:" "$DEPLOY_CALL_LOG"; then
  echo "reloaded although the CLI listed no vaults" >&2
  exit 1
fi
if ! grep -q "could not reach Obsidian" "$DEPLOY_STDERR"; then
  echo "expected a warning when the CLI lists no vaults" >&2
  exit 1
fi

echo "test-vault deployment tests passed"
