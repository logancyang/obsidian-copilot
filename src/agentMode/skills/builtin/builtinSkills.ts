import type { BackendId } from "@/agentMode/session/types";

/**
 * Plugin-shipped ("builtin") Agent Mode skills that wrap Copilot Plus relay
 * capabilities (web search, web fetch, PDF, YouTube, X). Unlike user-authored
 * skills, these are seeded into the canonical skills folder by the plugin (see
 * `seedBuiltinSkills`) and refreshed when `version` bumps.
 *
 * Each skill ships a `SKILL.md` (instructions the agent reads) plus two
 * runnable scripts: a POSIX `sh` script (run with `curl`) and an equivalent
 * Node `.mjs` script. Both read the Copilot Plus license + relay base URL from
 * env vars the plugin injects at spawn time (see `buildCopilotPlusEnv`) and call
 * the Brevilabs relay directly — no key is embedded in the skill files. When no
 * license is configured (free user) or the relay rejects it, the script exits
 * non-zero with a message that tells the agent to fall back to its own
 * equivalent built-in capability — never to block the user — with only an
 * occasional, gentle upsell.
 *
 * Why ship both an `sh` and a Node script: `sh` + `curl` is preferred because
 * the script runs in the *agent's* shell, where `sh`, `curl`, `sed`, and
 * `base64` live in `/usr/bin` and are reachable regardless of the user's node
 * setup (Obsidian launches with a minimal PATH that usually excludes nvm/Volta/
 * Homebrew node). But Windows has no `sh` unless Git Bash is installed, so each
 * skill also ships a Node fallback. SKILL.md tells the agent to try `sh` first,
 * fall back to `node <script>.mjs`, and — if neither runtime exists — prompt the
 * user to install Node.js. Scripts need neither extra imports nor an executable
 * bit.
 */
export interface BuiltinSkill {
  /** Folder name + SKILL.md `name`. Kebab-case, Copilot-branded. */
  readonly name: string;
  /**
   * Bump when `skillMd` or any script changes so seeded copies refresh.
   * Stamped into `metadata.copilot-builtin-version` in the seeded SKILL.md.
   */
  readonly version: number;
  /** Agents the skill fans out to (→ `metadata.copilot-enabled-agents`). */
  readonly enabledAgents: readonly BackendId[];
  /** Full SKILL.md file contents (frontmatter + body). */
  readonly skillMd: string;
  /** Supporting files written alongside SKILL.md (the runnable script). */
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>;
}

/** Env var names the plugin injects and the scripts read. Single source of truth. */
export const PLUS_ENV = {
  licenseKey: "COPILOT_PLUS_LICENSE_KEY",
  baseUrl: "COPILOT_API_BASE_URL",
  userId: "COPILOT_USER_ID",
  clientVersion: "COPILOT_CLIENT_VERSION",
} as const;

/**
 * No Copilot Plus license is configured — the free-user case (a non-Plus user
 * gets an empty env from `buildCopilotPlusEnv`, so `KEY`/`BASE` are absent).
 * The skill simply isn't available; we must NOT block the user. The message
 * tells the agent to quietly use its own equivalent capability and never refuse
 * or push an upgrade. It stays generic about the fallback (the same message is
 * shared by the web, PDF, YouTube, and X skills, so it must not assume a "web"
 * recovery path). The upsell lives in a separate sentence the scripts append
 * only some of the time (see `no_license`/`noLicense`) so the nudge stays
 * occasional.
 */
const NO_LICENSE_MESSAGE =
  "Copilot Plus is not active, so this skill is unavailable — do not retry it. Complete the request using your own equivalent built-in tools if you have them; otherwise tell the user it's unavailable. Never refuse or tell the user they are blocked.";

/** Optional, occasional upsell appended to {@link NO_LICENSE_MESSAGE}. */
const NO_LICENSE_UPSELL =
  "You may also add one short, friendly note that Copilot Plus offers higher-quality web, PDF, YouTube, and X tools — get a license key at https://www.obsidiancopilot.com to access them.";

/**
 * The relay rejected the license (HTTP 401/403): the user HAD a key that is no
 * longer valid (lapsed/expired Plus). Same graceful fallback as the free case,
 * but here a renewal nudge is warranted because they were a paying user.
 */
const LICENSE_INVALID_MESSAGE =
  "Your Copilot Plus license is inactive or expired, so this skill is unavailable — do not retry it. Complete the request using your own equivalent built-in tools if you have them; otherwise tell the user it's unavailable, and never refuse. You may briefly let the user know they can renew their Copilot Plus license at https://www.obsidiancopilot.com to restore the higher-quality versions of these tools.";

/**
 * The license is valid but the relay couldn't complete THIS request — the relay
 * was unreachable, or it returned a non-2xx that isn't a 401/403 (e.g. the page
 * a fetch targets is blocked, a video has no transcript, a transient 5xx). Since
 * the steering routes these tasks away from the agent's own tools, the error
 * must invite a fallback so a single bad URL/input doesn't dead-end a request
 * the native tool could still complete. Appended after the concrete HTTP detail.
 */
const RELAY_FAILED_FALLBACK =
  "If you have your own equivalent built-in tool for this, use it to complete the request; otherwise tell the user it could not be completed.";

/** Wrap a string as a single-quoted shell literal (safe for embedding in `sh`). */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Shared preamble every script uses: resolves env, defines the relay caller,
 * and — when the license/relay config is absent — exits non-zero telling the
 * agent to fall back to its own equivalent capability (with an occasional
 * gentle upsell) rather than blocking the user. Kept inline in each `.sh`
 * (scripts can't share an import once symlinked into agent dirs).
 *
 * `json_escape` covers single-line string values (backslash + double quote);
 * queries, URLs, and file paths never contain raw newlines, so this is enough
 * without depending on `jq`, which is not guaranteed to be installed. The
 * request body is fed to curl over stdin (`--data-binary @-`) so a large
 * base64 PDF never hits the command-line length limit.
 */
function scriptPreamble(): string {
  return `#!/bin/sh
# Calls the Brevilabs relay with curl and prints the JSON result to stdout.
# Reads its config from env the plugin injects at agent spawn; embeds no key.
BASE="\${${PLUS_ENV.baseUrl}:-}"
KEY="\${${PLUS_ENV.licenseKey}:-}"
USER_ID="\${${PLUS_ENV.userId}:-}"
CLIENT_VERSION="\${${PLUS_ENV.clientVersion}:-}"
NO_LICENSE=${shSingleQuote(NO_LICENSE_MESSAGE)}
NO_LICENSE_UPSELL=${shSingleQuote(NO_LICENSE_UPSELL)}
LICENSE_INVALID=${shSingleQuote(LICENSE_INVALID_MESSAGE)}
RELAY_FAILED_FALLBACK=${shSingleQuote(RELAY_FAILED_FALLBACK)}

die() {
  printf '%s\\n' "$1" >&2
  exit "\${2:-2}"
}

# No Copilot Plus license configured (free user). Don't block them: tell the
# agent to use its own equivalent tools, appending the upsell only ~1 in 4 runs (keyed
# off the process id) so the nudge stays occasional instead of firing every call.
no_license() {
  msg="$NO_LICENSE"
  [ $(( $$ % 4 )) -eq 0 ] && msg="$msg $NO_LICENSE_UPSELL"
  die "$msg"
}

[ -n "$KEY" ] && [ -n "$BASE" ] || no_license

# JSON-escape a single-line string: backslash first, then double quote.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g'
}

# relay ENDPOINT JSON_BODY -> prints the response body, mapping HTTP status.
relay() {
  resp=$(printf '%s' "$2" | curl -sS -w '\\n%{http_code}' \\
    -X POST "$BASE$1" \\
    -H 'Content-Type: application/json' \\
    -H "Authorization: Bearer $KEY" \\
    -H "X-Client-Version: $CLIENT_VERSION" \\
    --data-binary @-)
  [ $? -eq 0 ] || die "Could not reach the Copilot relay. $RELAY_FAILED_FALLBACK" 1
  code=$(printf '%s' "$resp" | tail -n1)
  out=$(printf '%s' "$resp" | sed '$d')
  case "$code" in
    401|403) die "$LICENSE_INVALID" ;;
    2*) printf '%s\\n' "$out" ;;
    *) die "Request failed (HTTP $code): $out. $RELAY_FAILED_FALLBACK" 1 ;;
  esac
}
`;
}

/**
 * Node equivalent of {@link scriptPreamble}, shipped alongside each `.sh` so
 * Windows users (no `sh` unless Git Bash is installed) still have a runnable
 * script. Uses Node's global `fetch` (Node 18+) and the built-in `node:` core
 * modules only — no npm deps, so it runs from a bare vault folder. The `.mjs`
 * extension forces ESM regardless of any ambient `package.json`, which lets the
 * per-skill tail use top-level `await`.
 *
 * Behaviour mirrors the shell script exactly: same env vars, same relay call,
 * same no-license / 401/403 → fall-back-to-your-own-tools mapping, same
 * non-zero exits. If the runtime is older than Node 18 (`fetch` undefined) it
 * exits with a "update Node" message rather than failing obscurely.
 */
function nodeScriptPreamble(): string {
  return `#!/usr/bin/env node
// Node fallback for the matching .sh script — for platforms that can't run sh
// (e.g. Windows without Git Bash). Calls the Brevilabs relay and prints the
// JSON result to stdout. Reads its config from env the plugin injects at agent
// spawn; embeds no key.
const BASE = process.env.${PLUS_ENV.baseUrl} || "";
const KEY = process.env.${PLUS_ENV.licenseKey} || "";
const USER_ID = process.env.${PLUS_ENV.userId} || "";
const CLIENT_VERSION = process.env.${PLUS_ENV.clientVersion} || "";
const NO_LICENSE = ${JSON.stringify(NO_LICENSE_MESSAGE)};
const NO_LICENSE_UPSELL = ${JSON.stringify(NO_LICENSE_UPSELL)};
const LICENSE_INVALID = ${JSON.stringify(LICENSE_INVALID_MESSAGE)};
const RELAY_FAILED_FALLBACK = ${JSON.stringify(RELAY_FAILED_FALLBACK)};

function die(message, code = 2) {
  process.stderr.write(String(message) + "\\n");
  process.exit(code);
}

// No Copilot Plus license configured (free user). Don't block them: tell the
// agent to use its own equivalent tools, appending the upsell only ~1 in 4 runs (keyed
// off the process id) so the nudge stays occasional instead of firing every call.
function noLicense() {
  let msg = NO_LICENSE;
  if (process.pid % 4 === 0) msg += " " + NO_LICENSE_UPSELL;
  die(msg);
}

if (!KEY || !BASE) noLicense();

// relay(endpoint, body) -> prints the response body, mapping HTTP status.
async function relay(endpoint, body) {
  if (typeof fetch !== "function") {
    die("This fallback needs Node 18 or newer (global fetch). Ask the user to update Node.js.", 1);
  }
  let resp;
  try {
    resp = await fetch(BASE + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + KEY,
        "X-Client-Version": CLIENT_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch {
    die("Could not reach the Copilot relay. " + RELAY_FAILED_FALLBACK, 1);
  }
  const out = await resp.text();
  if (resp.status === 401 || resp.status === 403) die(LICENSE_INVALID);
  if (resp.status >= 200 && resp.status < 300) {
    process.stdout.write(out + "\\n");
  } else {
    die("Request failed (HTTP " + resp.status + "): " + out + ". " + RELAY_FAILED_FALLBACK, 1);
  }
}
`;
}

/**
 * The SKILL.md "How to run" section shared by every builtin skill. Documents
 * the `sh` → `node` → install-Node fallback chain so the agent never dead-ends
 * on a platform that lacks one runtime. `extraNote` appends a skill-specific
 * sentence (e.g. PDF's "pass an absolute path") before the trailing line.
 */
function howToRunSection(opts: {
  shFile: string;
  nodeFile: string;
  argPlaceholder: string;
  extraNote?: string;
}): string {
  const dir = "/absolute/path/to/this/skill/directory";
  return `## How to run

Find the absolute path to this SKILL.md file on disk, then run the script that
sits next to it. Prefer the POSIX shell version:

\`\`\`bash
sh "${dir}/${opts.shFile}" "${opts.argPlaceholder}"
\`\`\`

If your platform can't run \`sh\` (for example, Windows without Git Bash), run
the Node version that sits in the same folder instead:

\`\`\`bash
node "${dir}/${opts.nodeFile}" "${opts.argPlaceholder}"
\`\`\`

If neither \`sh\` nor \`node\` is available, tell the user to install Node.js
from https://nodejs.org and run the command again.${opts.extraNote ? ` ${opts.extraNote}` : ""}

Both scripts print the result to stdout.`;
}

/**
 * The SKILL.md "if Copilot Plus isn't active" section shared by every builtin
 * relay skill. Mirrors the scripts' runtime behaviour: when Plus is unavailable
 * the agent must fall back to its own tools rather than block the user, and the
 * upgrade/renewal nudge is gentle and occasional (driven by the script message,
 * not repeated on the agent's own initiative).
 */
const LICENSE_PROBLEM_SECTION = `## If Copilot Plus is not active

If the script exits saying Copilot Plus is unavailable, do NOT retry it. Do what
the message says: fall back to your own equivalent built-in capability to handle
the request when you have one (otherwise tell the user it's unavailable) — never
refuse or block the user. Only mention upgrading or renewing Copilot Plus when
the script's message explicitly invites it, and keep any such note short and
friendly.`;

/**
 * Build a skill that maps a single positional argument onto one relay
 * endpoint (the web search/fetch, YouTube, and X tools are identical apart from
 * the endpoint, argument name, and copy). PDF is hand-written below because it
 * reads a local file and base64-encodes it before calling the relay.
 */
function relaySkill(opts: {
  name: string;
  /** SKILL.md `description` — the agent's "when to use" signal. */
  description: string;
  heading: string;
  intro: string;
  endpoint: string;
  /** Relay body key + usage-doc placeholder, e.g. `["query", "<your search query>"]`. */
  arg: [key: string, placeholder: string];
  scriptFile: string;
}): BuiltinSkill {
  const [argKey, argPlaceholder] = opts.arg;
  const nodeScriptFile = opts.scriptFile.replace(/\.sh$/, ".mjs");
  const version = 4;
  return {
    name: opts.name,
    version,
    enabledAgents: ["claude", "codex", "opencode"],
    skillMd: `---
name: ${opts.name}
description: ${opts.description}
license: Copilot Plus
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${version}"
---

# ${opts.heading}

${opts.intro}

${howToRunSection({ shFile: opts.scriptFile, nodeFile: nodeScriptFile, argPlaceholder })}

${LICENSE_PROBLEM_SECTION}
`,
    files: [
      {
        path: opts.scriptFile,
        content: `${scriptPreamble()}
ARG="$*"
[ -n "$ARG" ] || die "Usage: sh ${opts.scriptFile} <${argKey}>" 1
relay "${opts.endpoint}" "{\\"${argKey}\\":\\"$(json_escape "$ARG")\\",\\"user_id\\":\\"$(json_escape "$USER_ID")\\"}"
`,
      },
      {
        path: nodeScriptFile,
        content: `${nodeScriptPreamble()}
const ARG = process.argv.slice(2).join(" ");
if (!ARG) die("Usage: node ${nodeScriptFile} <${argKey}>", 1);
await relay("${opts.endpoint}", { ${argKey}: ARG, user_id: USER_ID });
`,
      },
    ],
  };
}

const WEB_SEARCH = relaySkill({
  name: "copilot-web-search",
  description:
    "Search the web for current information using Copilot Plus. Use when the user asks to search online, look something up on the internet, or needs up-to-date facts beyond the vault. Prefer reading the vault for anything about the user's own notes. Requires an active Copilot Plus license.",
  heading: "Copilot web search",
  intro: "Search the web through Copilot Plus and return results for the user's query.",
  endpoint: "/websearch",
  arg: ["query", "<your search query>"],
  scriptFile: "web-search.sh",
});

const WEB_FETCH = relaySkill({
  name: "copilot-web-fetch",
  description:
    "Fetch and read the full contents of a specific web page (URL) as clean Markdown using Copilot Plus. Use when the user shares a link or asks you to open, read, or summarize a particular page — not for an open-ended web search. Requires an active Copilot Plus license; without it, use your own fetch tool instead.",
  heading: "Copilot web fetch",
  intro: "Fetch a web page's contents as Markdown through Copilot Plus.",
  endpoint: "/url4llm",
  arg: ["url", "<url-to-fetch>"],
  scriptFile: "web-fetch.sh",
});

const READ_PDF_VERSION = 5;
const READ_PDF: BuiltinSkill = {
  name: "copilot-read-pdf",
  version: READ_PDF_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: copilot-read-pdf
description: Extract the full text of a PDF as Markdown using Copilot Plus. Use when the user wants to read, summarize, or quote a PDF file (in the vault or an absolute path). Requires an active Copilot Plus license.
license: Copilot Plus
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${READ_PDF_VERSION}"
---

# Copilot read PDF

Convert a PDF file to Markdown text through Copilot Plus so you can read,
summarize, or quote it.

${howToRunSection({
  shFile: "read-pdf.sh",
  nodeFile: "read-pdf.mjs",
  argPlaceholder: "<path-to-file.pdf>",
  extraNote: "Pass an absolute path to the PDF file.",
})}

${LICENSE_PROBLEM_SECTION}
`,
  files: [
    {
      path: "read-pdf.sh",
      content: `${scriptPreamble()}
FILE=\${1:-}
[ -n "$FILE" ] || die "Usage: sh read-pdf.sh <path-to-file.pdf>" 1
[ -f "$FILE" ] && [ -r "$FILE" ] || die "Could not read file: $FILE" 1

# Mirror brevilabsClient.ts pdf4llm: JSON body with base64-encoded pdf field.
PDF=$(base64 < "$FILE" | tr -d '\\n')
relay "/pdf4llm" "{\\"pdf\\":\\"$PDF\\",\\"user_id\\":\\"$(json_escape "$USER_ID")\\"}"
`,
    },
    {
      path: "read-pdf.mjs",
      content: `${nodeScriptPreamble()}
const FILE = process.argv[2] || "";
if (!FILE) die("Usage: node read-pdf.mjs <path-to-file.pdf>", 1);
let PDF;
try {
  // Mirror brevilabsClient.ts pdf4llm: JSON body with base64-encoded pdf field.
  const { readFileSync } = await import("node:fs");
  PDF = readFileSync(FILE).toString("base64");
} catch {
  die("Could not read file: " + FILE, 1);
}
await relay("/pdf4llm", { pdf: PDF, user_id: USER_ID });
`,
    },
  ],
};

const YOUTUBE_TRANSCRIPT = relaySkill({
  name: "copilot-youtube-transcript",
  description:
    "Fetch the transcript of a YouTube video using Copilot Plus. Use when the user shares a YouTube URL and wants its contents, a summary, or quotes. Requires an active Copilot Plus license.",
  heading: "Copilot YouTube transcript",
  intro: "Fetch a YouTube video's transcript through Copilot Plus.",
  endpoint: "/youtube4llm",
  arg: ["url", "<youtube-url>"],
  scriptFile: "youtube-transcript.sh",
});

const FETCH_X = relaySkill({
  name: "copilot-fetch-x",
  description:
    "Fetch the content of an X (Twitter) post using Copilot Plus. Use when the user shares an x.com or twitter.com URL and wants its text or context. Requires an active Copilot Plus license.",
  heading: "Copilot fetch X",
  intro: "Fetch the content of an X (Twitter) post through Copilot Plus.",
  endpoint: "/twitter4llm",
  arg: ["url", "<x-or-twitter-url>"],
  scriptFile: "fetch-x.sh",
});

/** All plugin-shipped Copilot Plus relay skills, in display order. */
export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  WEB_SEARCH,
  WEB_FETCH,
  READ_PDF,
  YOUTUBE_TRANSCRIPT,
  FETCH_X,
];

const MIYO_SEARCH_VERSION = 2;
const MIYO_CHAT_SEARCH_VERSION = 1;

/**
 * Shared POSIX fragments for the Miyo wrappers. `die()` prints to stderr and
 * exits; the resolver finds the `miyo` binary itself — leading with the
 * absolute install path (`~/.miyo/bin/miyo`) because Obsidian-launched shells
 * often inherit a reduced PATH that misses it — so each wrapper runs ONE
 * deterministic command instead of a PATH-first/absolute-fallback procedure the
 * agent has to reason through. That determinism is what makes smaller models
 * invoke the scripts reliably.
 */
const MIYO_DIE_SH = `die() {
  printf '%s\\n' "$1" >&2
  exit "\${2:-2}"
}`;

const MIYO_RESOLVE_SH = `# Absolute install path first (Obsidian shells often miss Miyo's bin on PATH).
if [ -x "$HOME/.miyo/bin/miyo" ]; then
  MIYO="$HOME/.miyo/bin/miyo"
elif command -v miyo >/dev/null 2>&1; then
  MIYO=miyo
else
  die "Miyo CLI not found (no ~/.miyo/bin/miyo and 'miyo' not on PATH). The Miyo desktop app is not installed — tell the user to install and open Miyo, then retry. Do not retry in a loop." 3
fi`;

/**
 * Windows resolver fragment: finds the exe under `%LOCALAPPDATA%` (where the
 * Miyo installer copies it) first, then PATH. `cmd` is always present and
 * runnable from cmd or PowerShell (no Git Bash or Node needed — a
 * managed-opencode Windows session may lack both).
 */
const MIYO_RESOLVE_CMD = `set "MIYO=%LOCALAPPDATA%\\Miyo\\bin\\miyo\\miyo.exe"
if not exist "%MIYO%" (
  set "MIYO="
  where miyo >nul 2>&1 && set "MIYO=miyo"
)
if not defined MIYO (
  echo Miyo CLI not found. The Miyo desktop app is not installed - tell the user to install and open Miyo, then retry. Do not retry in a loop. 1>&2
  exit /b 3
)`;

/**
 * POSIX (macOS/Linux) vault-search wrapper; Windows uses the `.cmd` below.
 * Resolves the `miyo` binary, then runs one `miyo search … --json` over the
 * whole vault. A single deterministic command is what makes smaller models
 * invoke it reliably.
 */
const MIYO_SEARCH_SH = `#!/bin/sh
# Semantic vault search via the local Miyo CLI; prints Miyo's JSON to stdout.
# Resolves the miyo binary so the agent never has to deal with PATH.
${MIYO_DIE_SH}

QUERY="$*"
[ -n "$QUERY" ] || die "Usage: sh miyo-search.sh <query>" 1

${MIYO_RESOLVE_SH}

OUT=$("$MIYO" search "$QUERY" -n 10 --json 2>&1) || die "Miyo search failed — the Miyo app may not be running. Tell the user to open Miyo, then continue without vault search if they can't. Details: $OUT" 1
printf '%s\\n' "$OUT"
`;

/** Windows vault-search wrapper; macOS/Linux uses the `.sh` above. */
const MIYO_SEARCH_CMD = `@echo off
setlocal enableextensions
rem Semantic vault search via the local Miyo CLI; prints Miyo's JSON to stdout.
if "%~1"=="" (
  echo Usage: miyo-search.cmd "query" 1>&2
  exit /b 1
)
${MIYO_RESOLVE_CMD}
"%MIYO%" search %* -n 10 --json
`;

/**
 * POSIX (macOS/Linux) chat-search wrapper. Takes the query as the first
 * argument and forwards any remaining arguments (e.g. `--path "Folder"`)
 * straight to `miyo search`, so the agent can scope the search to the synced
 * chat folders without the wrapper knowing their names.
 */
const MIYO_CHAT_SEARCH_SH = `#!/bin/sh
# Semantic search over the user's synced AI chats via the local Miyo CLI.
# Pass the query first; extra args (e.g. --path "Folder") forward to miyo search.
${MIYO_DIE_SH}

QUERY="$1"
[ -n "$QUERY" ] || die "Usage: sh miyo-chat-search.sh <query> [--path FOLDER ...]" 1
shift

${MIYO_RESOLVE_SH}

OUT=$("$MIYO" search "$QUERY" "$@" -n 10 --json 2>&1) || die "Miyo search failed — the Miyo app may not be running. Tell the user to open Miyo, then retry. Details: $OUT" 1
printf '%s\\n' "$OUT"
`;

/**
 * POSIX folders wrapper for the chat-search skill: lists the indexed folders so
 * the agent can find the chat-sync folders (`"origin": "chat_sync"`) to scope
 * the search to. Same binary resolution as the search wrappers.
 */
const MIYO_FOLDERS_SH = `#!/bin/sh
# List the user's indexed Miyo folders as JSON; prints Miyo's JSON to stdout.
${MIYO_DIE_SH}

${MIYO_RESOLVE_SH}

OUT=$("$MIYO" folders --json 2>&1) || die "Miyo is not running — the app may be closed. Tell the user to open Miyo, then retry. Details: $OUT" 1
printf '%s\\n' "$OUT"
`;

/**
 * Windows chat-search wrapper; macOS/Linux uses the `.sh` above. `%*` forwards
 * every argument — the query and any `--path "Folder"` filters — to
 * `miyo search`.
 */
const MIYO_CHAT_SEARCH_CMD = `@echo off
setlocal enableextensions
rem Semantic search over the user's synced AI chats via the local Miyo CLI.
if "%~1"=="" (
  echo Usage: miyo-chat-search.cmd "query" [--path "Folder" ...] 1>&2
  exit /b 1
)
${MIYO_RESOLVE_CMD}
"%MIYO%" search %* -n 10 --json
`;

/** Windows folders wrapper — the `.cmd` counterpart of `MIYO_FOLDERS_SH`. */
const MIYO_FOLDERS_CMD = `@echo off
setlocal enableextensions
rem List the user's indexed Miyo folders as JSON; prints Miyo's JSON to stdout.
${MIYO_RESOLVE_CMD}
"%MIYO%" folders --json
`;

/**
 * Vault semantic search via the local Miyo desktop app's `miyo` CLI.
 *
 * Ships a runnable wrapper per OS — `.sh` for macOS/Linux, `.cmd` for Windows —
 * rather than prose telling the agent to construct the command. Each resolves
 * the binary across the absolute install path and PATH, so the agent runs ONE
 * deterministic command (no Node, no shell/OS branching to reason through).
 * Smaller models were giving up after the old PATH-first prose attempt failed in
 * Obsidian's reduced-PATH shells.
 *
 * Scoped to the vault at large; searching the user's saved AI chat history is a
 * separate skill (`MIYO_CHAT_SEARCH_SKILL`) so each has a focused "when to use"
 * signal. Both are gated on Miyo being in use: the host only seeds them when
 * `shouldUseMiyo(...)` is true (see `seedManagedBuiltins` in `agentMode/index`),
 * and prunes the seeded copies when Miyo is turned off — matching the issue's
 * "surface only when Miyo is installed/running" intent.
 */
export const MIYO_SEARCH_SKILL: BuiltinSkill = {
  name: "miyo-search",
  version: MIYO_SEARCH_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: miyo-search
description: Semantic (meaning-based) search over the user's Obsidian vault via the local Miyo app. For any vault-search intent, use it when builtin grep search is too slow or doesn't surface enough relevant notes, or when the user explicitly asks for Miyo search. To search the user's saved AI chat history (ChatGPT / Claude) instead, use the miyo-chat-search skill. Needs the Miyo desktop app installed and running.
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${MIYO_SEARCH_VERSION}"
---

# Miyo vault search

Search the user's indexed Obsidian vault through Miyo, the user's own companion
app for semantic search over their notes. It finds relevant notes by meaning
(not just filename). Searches go only to the user's own Miyo service — the local
app by default, or the remote Miyo server they configured in settings — never a
third-party API, and no API key.

When to use it: for any vault-search intent, reach for Miyo when your builtin
\`grep\` search is too slow or doesn't surface enough relevant notes, or when
the user explicitly asks for Miyo search. To search the user's saved AI chat
history (past ChatGPT / Claude conversations) instead, use the
\`miyo-chat-search\` skill.

## How to run

Find the absolute path to this SKILL.md file on disk, then run the script next
to it that matches the operating system, passing the user's full question as the
query. No extra runtime is needed — \`sh\` (macOS/Linux) and \`cmd\` (Windows) are
always present.

On macOS or Linux:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/miyo-search.sh" "<the user's question>"
\`\`\`

On Windows, run the \`.cmd\` wrapper. In PowerShell you must prefix it with the
call operator \`&\` (PowerShell treats a quoted path on its own as a string and
won't run it); from cmd, run the quoted path without the \`&\`:

\`\`\`powershell
& "/absolute/path/to/this/skill/directory/miyo-search.cmd" "<the user's question>"
\`\`\`

The script locates the Miyo binary itself and prints JSON to stdout — you do
not need to know where Miyo is installed or which shell you are in. Run the
script as your single search step; do not fall back to other search tools
unless it reports that Miyo is unavailable. Read the JSON straight from stdout;
do not pipe it through other tools (no \`jq\`, no \`|\`).

## Reading the results

The script prints \`{ "results": [ { "path": ..., "content": ... } ], "count": N }\`.
Cite the \`path\` of any note you use so the user can open it.

## If it reports a problem

The script exits with a clear message when Miyo can't be used:

- **Not installed** (CLI not found): the Miyo desktop app isn't installed on
  this machine. Tell the user to install and open Miyo, then try again. Do not
  retry in a loop.
- **Not running** (search failed / can't reach the service): the app is
  installed but not running. Tell the user to open Miyo, then continue without
  vault search if they can't.
`,
  files: [
    { path: "miyo-search.sh", content: MIYO_SEARCH_SH },
    { path: "miyo-search.cmd", content: MIYO_SEARCH_CMD },
  ],
};

/**
 * Search the user's saved AI chat history (ChatGPT / Claude) via the local Miyo
 * CLI. A sibling of `MIYO_SEARCH_SKILL`, split out so each has a focused
 * "when to use" signal — vault notes vs. past AI conversations.
 *
 * Two scripts, two steps: `miyo-folders.*` lists the indexed folders so the
 * agent can identify the chat folders by `"origin": "chat_sync"` (not by
 * hardcoded names — the user may rename them), and `miyo-chat-search.*` runs a
 * search scoped to those folders via repeatable `--path` filters it forwards to
 * `miyo search`. Gated on Miyo being in use, exactly like the vault skill.
 */
export const MIYO_CHAT_SEARCH_SKILL: BuiltinSkill = {
  name: "miyo-chat-search",
  version: MIYO_CHAT_SEARCH_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: miyo-chat-search
description: Semantic (meaning-based) search over the user's saved AI chat history — past ChatGPT and Claude conversations synced into Miyo. Use it whenever the user asks about something from an earlier AI chat (e.g. "what did ChatGPT say about…", "find the Claude thread where we discussed…", "search my old chats for…"). For searching the rest of the vault, use the miyo-search skill instead. Needs the Miyo desktop app installed and running.
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${MIYO_CHAT_SEARCH_VERSION}"
---

# Miyo AI chat search

Search the user's saved AI chat history through Miyo, the user's own companion
app. Miyo can sync the user's ChatGPT and Claude conversations into the vault as
notes; this skill finds the relevant conversations by meaning (not just
filename). Searches go only to the user's own Miyo service — the local app by
default, or the remote Miyo server they configured — never a third-party API.

When to use it: whenever the user asks about something from a past AI chat —
"what did ChatGPT suggest about X", "find the Claude thread where we discussed
Y", "search my old chats for Z". To search the rest of the vault (not chat
history), use the \`miyo-search\` skill instead.

## How it works

Synced chat history lives in dedicated folders Miyo creates — these carry
\`"origin": "chat_sync"\` in the folder listing (commonly named "ChatGPT chats"
and "Claude AI chats"). Searching is two steps: find those folders, then run a
search scoped to them.

Find the absolute path to this SKILL.md file on disk and run the scripts next to
it that match the operating system. No extra runtime is needed — \`sh\`
(macOS/Linux) and \`cmd\` (Windows) are always present, and each script locates
the Miyo binary itself, so you never deal with PATH.

### 1. List the folders to find the chat folders

On macOS or Linux:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/miyo-folders.sh"
\`\`\`

On Windows (PowerShell needs the call operator \`&\`):

\`\`\`powershell
& "/absolute/path/to/this/skill/directory/miyo-folders.cmd"
\`\`\`

It prints \`{ "folders": [ { "path": ..., "origin": ... }, ... ] }\`. The chat
folders are the ones whose \`origin\` is \`"chat_sync"\`. Match on \`origin\`, not
the name — the user may have renamed them, and unrelated folders may have
similar names. Collect each chat folder's \`path\`.

### 2. Search, scoped to the chat folders

Pass one \`--path "<folder>"\` filter per chat folder \`path\` from step 1 (repeat
\`--path\` to cover several at once):

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/miyo-chat-search.sh" "<the user's question>" --path "ChatGPT chats" --path "Claude AI chats"
\`\`\`

On Windows:

\`\`\`powershell
& "/absolute/path/to/this/skill/directory/miyo-chat-search.cmd" "<the user's question>" --path "ChatGPT chats" --path "Claude AI chats"
\`\`\`

If the user only cares about ChatGPT or only Claude, pass just that folder's
\`--path\`. Read the JSON straight from stdout; do not pipe it through other tools
(no \`jq\`, no \`|\`).

## Reading the results

Each search prints \`{ "results": [ { "path": ..., "content": ... } ], "count": N }\`.
Each \`path\` is a saved conversation; cite it so the user can open the original
chat.

## If it reports a problem

The scripts exit with a clear message when Miyo can't be used:

- **Not installed** (CLI not found): the Miyo desktop app isn't installed on
  this machine. Tell the user to install and open Miyo, then try again. Do not
  retry in a loop.
- **Not running** (folders / search failed): the app is installed but not
  running. Tell the user to open Miyo, then try again.
`,
  files: [
    { path: "miyo-chat-search.sh", content: MIYO_CHAT_SEARCH_SH },
    { path: "miyo-chat-search.cmd", content: MIYO_CHAT_SEARCH_CMD },
    { path: "miyo-folders.sh", content: MIYO_FOLDERS_SH },
    { path: "miyo-folders.cmd", content: MIYO_FOLDERS_CMD },
  ],
};

/**
 * The builtin skills the host should seed into the canonical folder. The Plus
 * relay skills are always included; the Miyo skills (vault search + chat search)
 * are gated on Miyo being in use (the host passes
 * \`includeMiyo = shouldUseMiyo(...)\`). Kept pure so the gating decision stays
 * in the host layer (the skills layer must not import \`@/miyo\`), while the
 * composition is unit-testable here.
 */
export function managedBuiltinSkills(includeMiyo: boolean): readonly BuiltinSkill[] {
  return includeMiyo
    ? [...BUILTIN_SKILLS, MIYO_SEARCH_SKILL, MIYO_CHAT_SEARCH_SKILL]
    : BUILTIN_SKILLS;
}
