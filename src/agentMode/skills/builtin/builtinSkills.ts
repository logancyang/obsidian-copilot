import type { BackendId } from "@/agentMode/session/types";

/**
 * Plugin-shipped ("builtin") Agent Mode skills that wrap Copilot Plus relay
 * capabilities (web search, PDF, YouTube, X). Unlike user-authored skills,
 * these are seeded into the canonical skills folder by the plugin (see
 * `seedBuiltinSkills`) and refreshed when `version` bumps.
 *
 * Each skill ships a `SKILL.md` (instructions the agent reads) plus two
 * runnable scripts: a POSIX `sh` script (run with `curl`) and an equivalent
 * Node `.mjs` script. Both read the Copilot Plus license + relay base URL from
 * env vars the plugin injects at spawn time (see `buildCopilotPlusEnv`) and call
 * the Brevilabs relay directly — no key is embedded in the skill files. A
 * missing/invalid license makes the script exit non-zero with an upgrade prompt
 * the agent relays to the user.
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

const UPGRADE_MESSAGE =
  "This is a Copilot Plus feature and needs an active license. Tell the user that web/PDF/YouTube/X tools require Copilot Plus, and to upgrade or renew at https://www.obsidiancopilot.com (then add their license key in Settings → Copilot Plus).";

/** Wrap a string as a single-quoted shell literal (safe for embedding in `sh`). */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Shared preamble every script uses: resolves env, defines the relay caller,
 * and exits with the upgrade prompt when the license/relay config is absent.
 * Kept inline in each `.sh` (scripts can't share an import once symlinked into
 * agent dirs).
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
UPGRADE=${shSingleQuote(UPGRADE_MESSAGE)}

die() {
  printf '%s\\n' "$1" >&2
  exit "\${2:-2}"
}

[ -n "$KEY" ] && [ -n "$BASE" ] || die "$UPGRADE"

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
  [ $? -eq 0 ] || die "Could not reach the Copilot relay." 1
  code=$(printf '%s' "$resp" | tail -n1)
  out=$(printf '%s' "$resp" | sed '$d')
  case "$code" in
    401|403) die "$UPGRADE" ;;
    2*) printf '%s\\n' "$out" ;;
    *) die "Request failed (HTTP $code): $out" 1 ;;
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
 * same 401/403 → upgrade-prompt mapping, same non-zero exits. If the runtime is
 * older than Node 18 (`fetch` undefined) it exits with a "update Node" message
 * rather than failing obscurely.
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
const UPGRADE = ${JSON.stringify(UPGRADE_MESSAGE)};

function die(message, code = 2) {
  process.stderr.write(String(message) + "\\n");
  process.exit(code);
}

if (!KEY || !BASE) die(UPGRADE);

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
    die("Could not reach the Copilot relay.", 1);
  }
  const out = await resp.text();
  if (resp.status === 401 || resp.status === 403) die(UPGRADE);
  if (resp.status >= 200 && resp.status < 300) {
    process.stdout.write(out + "\\n");
  } else {
    die("Request failed (HTTP " + resp.status + "): " + out, 1);
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
 * Build a skill that maps a single positional argument onto one relay
 * endpoint (the web/YouTube/X tools are identical apart from the endpoint,
 * argument name, and copy). PDF is hand-written below because it reads a
 * local file and base64-encodes it before calling the relay.
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
  const version = 3;
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

## If it reports a license problem

If the script exits with a message about Copilot Plus, do NOT retry. Tell the
user this capability needs an active Copilot Plus license and where to upgrade
or renew — then continue without it.
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

const READ_PDF_VERSION = 4;
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

## If it reports a license problem

If the script exits with a message about Copilot Plus, do NOT retry. Tell the
user this capability needs an active Copilot Plus license and where to upgrade
or renew — then continue without it.
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
  READ_PDF,
  YOUTUBE_TRANSCRIPT,
  FETCH_X,
];

const MIYO_SEARCH_VERSION = 1;

/**
 * Vault semantic search via the local Miyo desktop app's `miyo` CLI.
 *
 * Unlike the Plus relay skills above, this ships **no helper script**: the
 * `miyo` binary the Miyo app installs IS the runnable. The skill is a prose
 * instruction that tells the agent to call `miyo search` / `miyo files`
 * directly in its own shell, which works under both POSIX shells and Windows
 * PowerShell with no bash dependency, no MCP server, and no key handed to the
 * agent (the CLI talks to a loopback service it discovers itself).
 *
 * Gated on Miyo being in use: the host only seeds this skill when
 * `shouldUseMiyo(...)` is true (see `seedManagedBuiltins` in `agentMode/index`),
 * and prunes the seeded copy when Miyo is turned off — matching the issue's
 * "surface only when Miyo is installed/running" intent.
 *
 * Binary resolution is documented PATH-first with an absolute-path fallback,
 * because Obsidian-launched shells often inherit a reduced PATH that misses the
 * `~/.miyo/bin` entry the Miyo installer adds. The absolute install locations
 * mirror the Miyo desktop app's `cli-installer.ts`:
 *   - macOS / Linux: `~/.miyo/bin/miyo`
 *   - Windows:       `%LOCALAPPDATA%\\Miyo\\bin\\miyo\\miyo.exe`
 */
export const MIYO_SEARCH_SKILL: BuiltinSkill = {
  name: "miyo-search",
  version: MIYO_SEARCH_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: miyo-search
description: Search the user's Obsidian vault with Miyo local semantic search. Use when the user wants to find notes, recall what they wrote about a topic, or ground an answer in their own vault — prefer this over reading files blindly for meaning-based recall. Needs the Miyo desktop app installed and running.
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${MIYO_SEARCH_VERSION}"
---

# Miyo vault search

Search the user's indexed Obsidian vault through Miyo, a local companion app
that runs semantic search over their notes on their own machine. Use it to find
relevant notes by meaning (not just filename) and to browse what Miyo has
indexed. All calls are local — no network, no API key.

## How to run

Miyo ships a \`miyo\` command-line tool. Run it directly in your shell. First
try it on the PATH:

\`\`\`bash
miyo search "<what to look for>" --json
\`\`\`

If the shell reports the command is not found (Obsidian-launched shells
sometimes inherit a reduced PATH that misses Miyo's install dir), call the
binary by its absolute install path instead:

- macOS / Linux:

  \`\`\`bash
  ~/.miyo/bin/miyo search "<what to look for>" --json
  \`\`\`

- Windows (PowerShell):

  \`\`\`powershell
  & "$env:LOCALAPPDATA\\Miyo\\bin\\miyo\\miyo.exe" search "<what to look for>" --json
  \`\`\`

- Windows (cmd):

  \`\`\`bat
  "%LOCALAPPDATA%\\Miyo\\bin\\miyo\\miyo.exe" search "<what to look for>" --json
  \`\`\`

Always pass \`--json\` and read the JSON the command prints to stdout yourself.
Do not pipe the output through other tools (no \`jq\`, no \`|\`) — those differ
between shells.

### Useful commands

- Semantic search, capped at N results:

  \`\`\`bash
  miyo search "<query>" -n 10 --json
  \`\`\`

- Browse indexed files, with optional filters:

  \`\`\`bash
  miyo files --json
  miyo files --title "<text>" --json
  miyo files --path "<folder or path fragment>" --mtime-after 2024-01-01 --json
  \`\`\`

The CLI finds the running Miyo service on its own (loopback). Only pass
\`--url <url>\` if the user explicitly tells you Miyo runs on another machine.

## Reading the results

\`miyo search --json\` prints \`{ "results": [ { "path": ..., "content": ... } ], "count": N }\`.
\`miyo files --json\` prints \`{ "files": [ { "path": ..., "title": ..., "mtime": ... } ], "total": N }\`.
Cite the \`path\` of any note you use so the user can open it.

## If Miyo is not available

- **Command not found / not recognized:** you already tried the absolute path
  above and it is still missing — the Miyo desktop app is not installed on this
  machine. Tell the user to install and open Miyo, then try again. Do not retry
  in a loop.
- **The command runs but reports it cannot reach the service** (for example
  "Is the Miyo app running?"): the Miyo app is installed but not running. Tell
  the user to open the Miyo app, then continue without vault search if they
  can't. Do not retry repeatedly.
`,
  files: [],
};

/**
 * The builtin skills the host should seed into the canonical folder. The Plus
 * relay skills are always included; the Miyo skill is gated on Miyo being in
 * use (the host passes \`includeMiyo = shouldUseMiyo(...)\`). Kept pure so the
 * gating decision stays in the host layer (the skills layer must not import
 * \`@/miyo\`), while the composition is unit-testable here.
 */
export function managedBuiltinSkills(includeMiyo: boolean): readonly BuiltinSkill[] {
  return includeMiyo ? [...BUILTIN_SKILLS, MIYO_SEARCH_SKILL] : BUILTIN_SKILLS;
}
