import type { BackendId } from "@/agentMode/session/types";

/**
 * Plugin-shipped ("builtin") Agent Mode skills that wrap Copilot Plus relay
 * capabilities (web search, PDF, YouTube, X). Unlike user-authored skills,
 * these are seeded into the canonical skills folder by the plugin (see
 * `seedBuiltinSkills`) and refreshed when `version` bumps.
 *
 * Each skill ships a `SKILL.md` (instructions the agent reads) plus one
 * POSIX `sh` script the agent runs with `curl`. The script reads the Copilot
 * Plus license + relay base URL from env vars the plugin injects at spawn time
 * (see `buildCopilotPlusEnv`) and calls the Brevilabs relay directly — no key
 * is embedded in the skill files. A missing/invalid license makes the script
 * exit non-zero with an upgrade prompt the agent relays to the user.
 *
 * Why `sh` + `curl` rather than a Node script: the script runs in the *agent's*
 * shell, where `node` is not reliably on PATH (Obsidian launches with a minimal
 * PATH that usually excludes nvm/Volta/Homebrew node). `sh`, `curl`, `sed`, and
 * `base64` live in `/usr/bin` (and git-bash on Windows), so they are reachable
 * regardless of the user's node setup. Scripts are POSIX and invoked as
 * `sh "<path>" <arg>`, so they need neither a node runtime nor an executable bit.
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
  const version = 2;
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

## How to run

Find the absolute path to this SKILL.md file on disk, then run the script that
sits next to it:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/${opts.scriptFile}" "${argPlaceholder}"
\`\`\`

The script prints the result to stdout.

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

const READ_PDF_VERSION = 3;
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

## How to run

Find the absolute path to this SKILL.md file on disk, then run the script that
sits next to it:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/read-pdf.sh" "<path-to-file.pdf>"
\`\`\`

Pass an absolute path to the PDF file. The script prints the extracted Markdown
to stdout.

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

/** All plugin-shipped builtin skills, in display order. */
export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  WEB_SEARCH,
  READ_PDF,
  YOUTUBE_TRANSCRIPT,
  FETCH_X,
];
