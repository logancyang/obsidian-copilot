import type { BackendId } from "@/agentMode/session/types";
import {
  SYMPOSIUM_AGENT_HANDOFF_DIR,
  SYMPOSIUM_MAX_HTML_BYTES,
  SYMPOSIUM_WORKSPACE_ROOT_ENV,
} from "@/symposium/constants";
import { OBSIDIAN_SKILLS } from "./obsidianSkills";

/**
 * Plugin-shipped ("builtin") Agent Mode skills. Unlike user-authored skills,
 * these are seeded into the canonical skills folder by the plugin (see
 * `seedBuiltinSkills`) and refreshed when `version` bumps. A builtin may be
 * executable (the Copilot Plus relay skills below) or knowledge-only (the
 * Obsidian format and CLI skills).
 *
 * The Copilot Plus skills each ship a `SKILL.md` plus one runnable script per
 * OS: a POSIX `sh` script for macOS/Linux and a Windows `.cmd` wrapper that
 * drives an adjacent PowerShell `.ps1`. All read the Copilot Plus license +
 * relay base URL from env vars the plugin injects at spawn time (see
 * `buildBuiltinSkillEnv`) and call the Brevilabs relay directly — no key is
 * embedded in the skill files.
 *
 * Why one script per OS (and no Node): every runtime here is guaranteed present
 * without any install. On macOS/Linux the agent's shell has `sh`, `curl`, `sed`,
 * and `base64` in `/usr/bin`. On Windows, `cmd` and Windows PowerShell 5.1 ship
 * with the OS, so the `.cmd` → `.ps1` pair runs in a bare PowerShell with no Git
 * Bash and no Node. This matters because Obsidian launches with a reduced PATH
 * that usually excludes nvm/Volta/Homebrew node — a managed-opencode Windows
 * session frequently has neither `sh` nor `node`, which is why the earlier
 * `sh` → `node` fallback dead-ended (see the PDF report in #2634). Scripts need
 * no extra imports and no executable bit.
 */
export interface BuiltinSkill {
  /** Folder name + SKILL.md `name`. */
  readonly name: string;
  /**
   * Bump when `skillMd` or any support file changes so seeded copies refresh.
   * Stamped into `metadata.copilot-builtin-version` in the seeded SKILL.md.
   */
  readonly version: number;
  /** Agents the skill fans out to (→ `metadata.copilot-enabled-agents`). */
  readonly enabledAgents: readonly BackendId[];
  /** Full SKILL.md file contents (frontmatter + body). */
  readonly skillMd: string;
  /** Supporting scripts, references, or notices written alongside SKILL.md. */
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
 * gets no relay entries from `buildBuiltinSkillEnv`, so `KEY`/`BASE` are absent).
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

/** Wrap a string as a single-quoted PowerShell literal (`'` doubled to escape). */
function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Windows (PowerShell) equivalent of {@link scriptPreamble}, run by the `.cmd`
 * launcher each skill ships. Targets Windows PowerShell 5.1 — which ships with
 * the OS, so it needs no Git Bash and no Node, the two runtimes a reduced-PATH
 * managed-opencode session often lacks. Uses only the .NET BCL + built-in
 * cmdlets (`Invoke-WebRequest`, `[System.Convert]`), so it runs from a bare
 * vault folder.
 *
 * Behaviour mirrors the shell script exactly: same env vars, same relay call,
 * same no-license / 401/403 → fall-back-to-your-own-tools mapping, same
 * non-zero exits.
 */
function powershellPreamble(): string {
  return `# Windows (PowerShell) sibling of the matching .sh script, launched by the .cmd
# wrapper next to it. Calls the Brevilabs relay and prints the JSON result to
# stdout. Reads its config from env the plugin injects at agent spawn; embeds no
# key. Targets Windows PowerShell 5.1 (.NET BCL only) so it needs no Node.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Emit stdout/stderr as UTF-8: Windows PowerShell 5.1 defaults Console.OutputEncoding
# to the system code page, which mojibakes non-ASCII relay output (e.g. Japanese
# results, fetched pages, transcripts) before the agent reads it. The removed Node
# fallback wrote UTF-8; match that. $OutputEncoding governs the pipeline too.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$BASE = [Environment]::GetEnvironmentVariable('${PLUS_ENV.baseUrl}')
$KEY = [Environment]::GetEnvironmentVariable('${PLUS_ENV.licenseKey}')
$USER_ID = [Environment]::GetEnvironmentVariable('${PLUS_ENV.userId}')
$CLIENT_VERSION = [Environment]::GetEnvironmentVariable('${PLUS_ENV.clientVersion}')
if ($null -eq $USER_ID) { $USER_ID = '' }
if ($null -eq $CLIENT_VERSION) { $CLIENT_VERSION = '' }
$NO_LICENSE = ${psSingleQuote(NO_LICENSE_MESSAGE)}
$NO_LICENSE_UPSELL = ${psSingleQuote(NO_LICENSE_UPSELL)}
$LICENSE_INVALID = ${psSingleQuote(LICENSE_INVALID_MESSAGE)}
$RELAY_FAILED_FALLBACK = ${psSingleQuote(RELAY_FAILED_FALLBACK)}

function Die($message, $code = 2) {
  [Console]::Error.WriteLine([string]$message)
  exit $code
}

# No Copilot Plus license configured (free user). Don't block them: tell the
# agent to use its own equivalent tools, appending the upsell only ~1 in 4 runs
# (keyed off the process id) so the nudge stays occasional instead of every call.
function NoLicense {
  $msg = $NO_LICENSE
  if (($PID % 4) -eq 0) { $msg = "$msg $NO_LICENSE_UPSELL" }
  Die $msg
}

if (-not $KEY -or -not $BASE) { NoLicense }

# Invoke-Relay endpoint body -> prints the response body, mapping HTTP status.
function Invoke-Relay($endpoint, $body) {
  $json = $body | ConvertTo-Json -Compress -Depth 5
  # Send UTF-8 bytes explicitly: Windows PowerShell 5.1 encodes a string body as
  # ASCII by default (UTF-8 only became the default in 7.4), which would corrupt
  # non-ASCII queries/URLs. A byte[] body is sent verbatim, matching curl.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  try {
    $resp = Invoke-WebRequest -Uri "$BASE$endpoint" -Method Post -ContentType 'application/json; charset=utf-8' \`
      -Headers @{ Authorization = "Bearer $KEY"; 'X-Client-Version' = $CLIENT_VERSION } \`
      -Body $bytes -UseBasicParsing
    $code = [int]$resp.StatusCode
    $out = $resp.Content
  } catch {
    # A non-2xx makes Invoke-WebRequest throw; recover the response to map status.
    $r = $null
    try { $r = $_.Exception.Response } catch {}
    if (-not $r) { Die "Could not reach the Copilot relay. $RELAY_FAILED_FALLBACK" 1 }
    $code = [int]$r.StatusCode
    $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
    $out = $reader.ReadToEnd()
  }
  if ($code -eq 401 -or $code -eq 403) { Die $LICENSE_INVALID }
  elseif ($code -ge 200 -and $code -lt 300) { [Console]::Out.WriteLine($out) }
  else { Die "Request failed (HTTP $code): $out. $RELAY_FAILED_FALLBACK" 1 }
}
`;
}

/**
 * The Windows `.cmd` entry point each relay skill ships. A bare quoted path is a
 * string (not a command) in PowerShell, so the agent runs this `.cmd`, which in
 * turn launches the adjacent `.ps1` with an absolute `powershell.exe` path
 * (System32 stays on PATH even in the reduced shells where `node` is missing)
 * and `-ExecutionPolicy Bypass` so an unsigned script still runs. `%~dp0`
 * resolves the script's own folder, so the `.ps1` is found wherever the skill
 * dir is symlinked. `%*` forwards every argument verbatim.
 */
function cmdLauncher(ps1File: string): string {
  return `@echo off
setlocal
set "PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
if not exist "%PS%" set "PS=powershell"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0${ps1File}" %*
exit /b %errorlevel%
`;
}

/**
 * The SKILL.md "How to run" section shared by every builtin skill. Ships one
 * runnable script per OS — `sh` for macOS/Linux, a `.cmd` wrapper for Windows —
 * each backed by a runtime that is always present (no Git Bash, no Node), so the
 * agent never dead-ends on a missing runtime. `extraNote` appends a
 * skill-specific sentence (e.g. PDF's "pass an absolute path") at the end.
 */
function howToRunSection(opts: {
  shFile: string;
  cmdFile: string;
  argPlaceholder: string;
  extraNote?: string;
}): string {
  const dir = "/absolute/path/to/this/skill/directory";
  return `## How to run

Find the absolute path to this SKILL.md file on disk, then run the script next
to it that matches the operating system. No extra runtime is needed — \`sh\`
(macOS/Linux) and \`cmd\`/PowerShell (Windows) are always present.

On macOS or Linux:

\`\`\`bash
sh "${dir}/${opts.shFile}" "${opts.argPlaceholder}"
\`\`\`

On Windows, run the \`.cmd\` wrapper. In PowerShell you must prefix it with the
call operator \`&\` (PowerShell treats a quoted path on its own as a string and
won't run it); from cmd, run the quoted path without the \`&\`:

\`\`\`powershell
& "${dir}/${opts.cmdFile}" "${opts.argPlaceholder}"
\`\`\`
${opts.extraNote ? `\n${opts.extraNote}\n` : ""}
Both print the result to stdout.`;
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
  const cmdFile = opts.scriptFile.replace(/\.sh$/, ".cmd");
  const ps1File = opts.scriptFile.replace(/\.sh$/, ".ps1");
  const version = 5;
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

${howToRunSection({ shFile: opts.scriptFile, cmdFile, argPlaceholder })}

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
        path: cmdFile,
        content: cmdLauncher(ps1File),
      },
      {
        path: ps1File,
        content: `${powershellPreamble()}
$ARG = ($args -join ' ')
if (-not $ARG) { Die "Usage: ${ps1File} <${argKey}>" 1 }
Invoke-Relay "${opts.endpoint}" @{ ${argKey} = $ARG; user_id = $USER_ID }
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

const READ_PDF_VERSION = 6;
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
  cmdFile: "read-pdf.cmd",
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
      path: "read-pdf.cmd",
      content: cmdLauncher("read-pdf.ps1"),
    },
    {
      path: "read-pdf.ps1",
      content: `${powershellPreamble()}
$FILE = if ($args.Count -ge 1) { $args[0] } else { '' }
if (-not $FILE) { Die "Usage: read-pdf.ps1 <path-to-file.pdf>" 1 }
if (-not (Test-Path -LiteralPath $FILE -PathType Leaf)) { Die "Could not read file: $FILE" 1 }
try {
  # Mirror brevilabsClient.ts pdf4llm: JSON body with base64-encoded pdf field.
  $PDF = [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($FILE))
} catch {
  Die "Could not read file: $FILE" 1
}
Invoke-Relay "/pdf4llm" @{ pdf = $PDF; user_id = $USER_ID }
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

const SYMPOSIUM_PUBLISH_VERSION = 8;
const SYMPOSIUM_PUBLISH: BuiltinSkill = {
  name: "symposium-publish",
  version: SYMPOSIUM_PUBLISH_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: symposium-publish
description: Publish, update, or withdraw an existing Markdown note through Symposium's host-owned review flow. Use when the user asks to publish, share, update, delete, remove, or withdraw a Symposium page.
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${SYMPOSIUM_PUBLISH_VERSION}"
---

# Publish Markdown to Symposium

Require one existing Markdown source file. When the user asks to delete, remove, or
withdraw its current Symposium page, do not generate HTML. Run the host wrapper with
only the vault-relative source-note path. Obsidian reads the note's current identity
and opens its existing management modal; the user alone chooses Update or Delete.
Never tell the user to delete the page at its public URL.

For publishing or updating, finish a complete, self-contained,
passive HTML document before asking Obsidian to review it. Render source-specific
content such as Mermaid and Obsidian Bases into static HTML or SVG, embed images,
and include no scripts, frames, forms, handlers, redirects, or external assets. Treat
YAML frontmatter as note metadata: never render the raw frontmatter block as page
content. The exact UTF-8 HTML must not exceed \`${SYMPOSIUM_MAX_HTML_BYTES}\` bytes.

Write those final bytes to a new unique \`.html\` file under
\`${SYMPOSIUM_WORKSPACE_ROOT_ENV}/${SYMPOSIUM_AGENT_HANDOFF_DIR}/\`, creating that
directory first when it does not exist. Do not show a prose substitute or ask
for confirmation in chat. Instead run the host wrapper with exactly two
vault-relative paths: the source note and the staged HTML.

On macOS or Linux:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/symposium-publish.sh" "Notes/source.md" "${SYMPOSIUM_AGENT_HANDOFF_DIR}/unique.html"
\`\`\`

For withdrawal, omit the staged-HTML argument:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/symposium-publish.sh" "Notes/source.md"
\`\`\`

On Windows, use the \`.cmd\` wrapper (prefix it with \`&\` in PowerShell):

\`\`\`powershell
& "/absolute/path/to/this/skill/directory/symposium-publish.cmd" "Notes/source.md" "${SYMPOSIUM_AGENT_HANDOFF_DIR}/unique.html"
\`\`\`

Omit the staged-HTML argument on Windows for withdrawal as well.

With only the source path, the wrapper blocks while Obsidian shows its host-owned
Update/Delete management modal. With a staged HTML path, it blocks while Obsidian
consumes the artifact and shows its source, title, and a link to a sandboxed
local-browser rendering of the exact captured page. Obsidian rejects active or
externally loaded content, prevents navigation from the browser preview, removes the
original artifact, removes its temporary browser preview after review, and alone reads
the current note identity to choose whether confirmation publishes or updates; never
choose an action or document id.

- \`cancelled\`: stop. No request was sent.
- \`regenerate\`: create a new complete artifact and run the wrapper again. The
  previous confirmation never applies to regenerated bytes.
- \`published\` or \`updated\`: return the host-provided public URL verbatim.
- \`deleted\`: report that the host withdrew the page and removed its note identity.
- \`failed\`: if the host says to edit the staged file, address every listed issue in
  that same file and retry exactly once. Otherwise, or if that retry fails, stop and
  report the exact host message. Never invent a cause, change unrelated styling, create
  another filename, bypass the review, or publish directly.
`,
  files: [
    {
      path: "symposium-publish.sh",
      content: `#!/bin/sh
SOURCE=\${1:-}
STAGED_HTML=\${2:-}
case "$#" in
  1) ;;
  2) ;;
  *)
    printf '%s\\n' "Usage: sh symposium-publish.sh <source-note-path> [staged-html-path]" >&2
    exit 1
    ;;
esac
[ -n "$SOURCE" ] && { [ "$#" -eq 1 ] || [ -n "$STAGED_HTML" ]; } || {
  printf '%s\\n' "Usage: sh symposium-publish.sh <source-note-path> [staged-html-path]" >&2
  exit 1
}

OBSIDIAN_CLI=\${COPILOT_OBSIDIAN_CLI:-}
WORKSPACE_ROOT=\${${SYMPOSIUM_WORKSPACE_ROOT_ENV}:-}
[ -n "$WORKSPACE_ROOT" ] || {
  printf '%s\\n' "The owning Obsidian workspace is unavailable." >&2
  exit 1
}

[ -n "$OBSIDIAN_CLI" ] || {
  printf '%s\\n' "A compatible Obsidian CLI is unavailable." >&2
  exit 1
}

cd "$WORKSPACE_ROOT" || {
  printf '%s\\n' "The owning Obsidian workspace is unavailable." >&2
  exit 1
}
VAULT_NAME=\${WORKSPACE_ROOT%/}
VAULT_NAME=\${VAULT_NAME##*/}
[ -n "$VAULT_NAME" ] || {
  printf '%s\\n' "The owning Obsidian vault is unavailable." >&2
  exit 1
}

SOURCE_B64=$(printf '%s' "$SOURCE" | base64 | tr -d '\\r\\n')
if [ "$#" -eq 1 ]; then
  CODE="(()=>{const decode=(value)=>new TextDecoder().decode(Uint8Array.from(atob(value),(char)=>char.charCodeAt(0)));const bridge=app.plugins.plugins.copilot?.symposiumAgentBridge;if(!bridge)throw new Error('Copilot Symposium host is unavailable.');return bridge.reviewAgentManage(decode('$SOURCE_B64')).then(JSON.stringify);})()"
else
  HTML_B64=$(printf '%s' "$STAGED_HTML" | base64 | tr -d '\\r\\n')
  CODE="(()=>{const decode=(value)=>new TextDecoder().decode(Uint8Array.from(atob(value),(char)=>char.charCodeAt(0)));const bridge=app.plugins.plugins.copilot?.symposiumAgentBridge;if(!bridge)throw new Error('Copilot Symposium host is unavailable.');return bridge.reviewAgentPublish(decode('$SOURCE_B64'),decode('$HTML_B64')).then(JSON.stringify);})()"
fi

CLI_OUTPUT=$("$OBSIDIAN_CLI" "vault=$VAULT_NAME" eval "code=$CODE") || exit $?
CLI_RESULT=$(printf '%s\\n' "$CLI_OUTPUT" | sed -n '/^=> {/p' | sed -n '$p')
case "$CLI_RESULT" in
  "=> {"*)
    OUTCOME=\${CLI_RESULT#"=> "}
    printf '%s\\n' "$OUTCOME"
    exit 0
    ;;
  *)
    printf '%s\\n' "Copilot could not complete the Symposium review." >&2
    exit 1
    ;;
esac
`,
    },
    {
      path: "symposium-publish.cmd",
      content: cmdLauncher("symposium-publish.ps1"),
    },
    {
      path: "symposium-publish.ps1",
      content: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$SOURCE = if ($args.Count -ge 1) { $args[0] } else { '' }
$STAGED_HTML = if ($args.Count -ge 2) { $args[1] } else { '' }
if (($args.Count -ne 1 -and $args.Count -ne 2) -or -not $SOURCE -or ($args.Count -eq 2 -and -not $STAGED_HTML)) {
  [Console]::Error.WriteLine('Usage: symposium-publish.ps1 <source-note-path> [staged-html-path]')
  exit 1
}

$OBSIDIAN_CLI = [Environment]::GetEnvironmentVariable('COPILOT_OBSIDIAN_CLI')
$WORKSPACE_ROOT = [Environment]::GetEnvironmentVariable('${SYMPOSIUM_WORKSPACE_ROOT_ENV}')
if (-not $WORKSPACE_ROOT) {
  [Console]::Error.WriteLine('The owning Obsidian workspace is unavailable.')
  exit 1
}

$EXIT_CODE = 0
try {
  if (-not $OBSIDIAN_CLI) { throw 'A compatible Obsidian CLI is unavailable.' }
  Set-Location -LiteralPath $WORKSPACE_ROOT
  $VAULT_NAME = Split-Path -Leaf (Get-Location).Path
  if (-not $VAULT_NAME) { throw 'The owning Obsidian vault is unavailable.' }
  $SOURCE_B64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($SOURCE))
  if ($args.Count -eq 1) {
    $CODE = "(()=>{const decode=(value)=>new TextDecoder().decode(Uint8Array.from(atob(value),(char)=>char.charCodeAt(0)));const bridge=app.plugins.plugins.copilot?.symposiumAgentBridge;if(!bridge)throw new Error('Copilot Symposium host is unavailable.');return bridge.reviewAgentManage(decode('$SOURCE_B64')).then(JSON.stringify);})()"
  } else {
    $HTML_B64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($STAGED_HTML))
    $CODE = "(()=>{const decode=(value)=>new TextDecoder().decode(Uint8Array.from(atob(value),(char)=>char.charCodeAt(0)));const bridge=app.plugins.plugins.copilot?.symposiumAgentBridge;if(!bridge)throw new Error('Copilot Symposium host is unavailable.');return bridge.reviewAgentPublish(decode('$SOURCE_B64'),decode('$HTML_B64')).then(JSON.stringify);})()"
  }

  $CLI_OUTPUT = & $OBSIDIAN_CLI "vault=$VAULT_NAME" 'eval' "code=$CODE"
  if ($LASTEXITCODE -ne 0) { throw 'Copilot could not complete the Symposium review.' }
  $CLI_RESULT = [string](@($CLI_OUTPUT | Where-Object { ([string]$_).StartsWith('=> {') })[-1])
  if (-not $CLI_RESULT.StartsWith('=> {')) {
    throw 'Copilot could not complete the Symposium review.'
  }
  $OUTCOME = $CLI_RESULT.Substring(3)
  [Console]::Out.Write($OUTCOME)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  $EXIT_CODE = 1
}
exit $EXIT_CODE
`,
    },
  ],
};

/** All always-seeded plugin-shipped skills, in display order. */
export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  WEB_SEARCH,
  WEB_FETCH,
  READ_PDF,
  YOUTUBE_TRANSCRIPT,
  FETCH_X,
  SYMPOSIUM_PUBLISH,
  ...OBSIDIAN_SKILLS,
];

const MIYO_SEARCH_VERSION = 2;
const MIYO_PARSE_VERSION = 1;

/** Shared by both Miyo wrappers; the host script must define `die` before it. */
const MIYO_POSIX_RESOLVER = `# Absolute install path first (Obsidian shells often miss Miyo's bin on PATH).
if [ -x "$HOME/.miyo/bin/miyo" ]; then
  MIYO="$HOME/.miyo/bin/miyo"
elif command -v miyo >/dev/null 2>&1; then
  MIYO=miyo
else
  die "Miyo CLI not found (no ~/.miyo/bin/miyo and 'miyo' not on PATH). The Miyo desktop app is not installed — tell the user to install Miyo, then retry. Do not retry in a loop." 3
fi`;

const MIYO_WINDOWS_RESOLVER = `set "MIYO=%LOCALAPPDATA%\\Miyo\\bin\\miyo\\miyo.exe"
if not exist "%MIYO%" (
  set "MIYO="
  where miyo >nul 2>&1 && set "MIYO=miyo"
)
if not defined MIYO (
  echo Miyo CLI not found. The Miyo desktop app is not installed - tell the user to install Miyo, then retry. Do not retry in a loop. 1>&2
  exit /b 3
)`;

/**
 * POSIX (macOS/Linux) wrapper for the Miyo CLI; Windows uses the `.cmd` below.
 * Resolves the `miyo` binary itself — leading with the absolute install path
 * (`~/.miyo/bin/miyo`) because Obsidian-launched shells often inherit a reduced
 * PATH that misses it — then runs one `miyo search … --json` and prints the
 * JSON. A single deterministic command (vs. a PATH-first/absolute-fallback
 * procedure the agent has to reason through) is what makes smaller models invoke
 * it reliably.
 */
const MIYO_SEARCH_SH = `#!/bin/sh
# Semantic vault search via the local Miyo CLI; prints Miyo's JSON to stdout.
# Resolves the miyo binary so the agent never has to deal with PATH.
die() {
  printf '%s\\n' "$1" >&2
  exit "\${2:-2}"
}

QUERY="$*"
[ -n "$QUERY" ] || die "Usage: sh miyo-search.sh <query>" 1

${MIYO_POSIX_RESOLVER}

OUT=$("$MIYO" search "$QUERY" -n 10 --json 2>&1) || die "Miyo search failed — the Miyo app may not be running. Tell the user to open Miyo, then continue without vault search if they can't. Details: $OUT" 1
printf '%s\\n' "$OUT"
`;

/**
 * Windows wrapper for the Miyo CLI; macOS/Linux uses the `.sh` above. `cmd` is
 * always present and runnable from cmd or PowerShell (no Git Bash or Node
 * needed — a managed-opencode Windows session may lack both). Resolves the exe
 * under `%LOCALAPPDATA%` (where the Miyo installer copies it) first, then PATH.
 */
const MIYO_SEARCH_CMD = `@echo off
setlocal enableextensions
rem Semantic vault search via the local Miyo CLI; prints Miyo's JSON to stdout.
if "%~1"=="" (
  echo Usage: miyo-search.cmd "query" 1>&2
  exit /b 1
)
${MIYO_WINDOWS_RESOLVER}
"%MIYO%" search %* -n 10 --json
`;

const MIYO_PARSE_SH = `#!/bin/sh
# Parse one local PDF or EPUB through the Miyo CLI and print Markdown/text.
die() {
  printf '%s\\n' "$1" >&2
  exit "\${2:-2}"
}

FILE="$1"
[ -n "$FILE" ] || die "Usage: sh miyo-parse.sh <file>" 1

${MIYO_POSIX_RESOLVER}

"$MIYO" parse "$FILE"
`;

const MIYO_PARSE_CMD = `@echo off
setlocal enableextensions
rem Parse one local PDF or EPUB through the Miyo CLI and print Markdown/text.
if "%~1"=="" (
  echo Usage: miyo-parse.cmd "file" 1>&2
  exit /b 1
)
${MIYO_WINDOWS_RESOLVER}
"%MIYO%" parse "%~1"
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
 * The host seeds this skill only when the dedicated Miyo search-skill setting
 * is enabled (see `seedManagedBuiltins` in `agentMode/index`) and prunes the
 * managed copy when the setting is turned off.
 */
export const MIYO_SEARCH_SKILL: BuiltinSkill = {
  name: "miyo-search",
  version: MIYO_SEARCH_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: miyo-search
description: Semantic (meaning-based) search over the user's Obsidian vault via the local Miyo app. For any vault-search intent, use it when builtin grep search is too slow or doesn't surface enough relevant notes, or when the user explicitly asks for Miyo search. Needs the Miyo desktop app installed and running.
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
the user explicitly asks for Miyo search.

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
 * Parses local PDF and EPUB files through the standalone Miyo CLI.
 *
 * This skill is gated by the Document Processor setting. Unlike the Plus PDF
 * relay, it keeps document contents local and deliberately fails closed: the
 * instructions forbid silently switching to a cloud parser if Miyo fails.
 */
export const MIYO_PARSE_SKILL: BuiltinSkill = {
  name: "miyo-parse",
  version: MIYO_PARSE_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: miyo-parse
description: Parse a local PDF or EPUB file into Markdown/text with the local Miyo CLI. Use this for document reading when Miyo is the selected Document Processor. The file can be anywhere on the filesystem and does not need to be indexed or copied into the vault.
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${MIYO_PARSE_VERSION}"
---

# Parse a document locally with Miyo

Use Miyo to extract Markdown/text from one PDF or EPUB. Parsing runs locally,
works for files anywhere on the filesystem, and does not require the Miyo
service to be running.

## How to run

Find the absolute path to this SKILL.md file, then run the adjacent wrapper
with exactly one quoted file path.

On macOS or Linux:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/miyo-parse.sh" "/absolute/path/to/document.pdf"
\`\`\`

On Windows PowerShell:

\`\`\`powershell
& "/absolute/path/to/this/skill/directory/miyo-parse.cmd" "C:\\absolute\\path\\to\\document.pdf"
\`\`\`

The wrapper prints the parsed Markdown/text to stdout. Use that output to
answer the user's question.

## If it reports a problem

Report the error clearly and stop parsing that document. Never fall back to
\`copilot-read-pdf\` or any other cloud document parser: selecting Miyo is an
explicit local-processing choice. Do not retry in a loop.

If it reports that the Miyo CLI is not installed, say that pointing Copilot at a
remote Miyo server does not help here, and that the user's options are to
install Miyo on this machine or switch Settings → Copilot → Miyo → Document
Processor to Plus.
`,
  files: [
    { path: "miyo-parse.sh", content: MIYO_PARSE_SH },
    { path: "miyo-parse.cmd", content: MIYO_PARSE_CMD },
  ],
};

/** Every builtin the host may seed, gated or not — the universe it reconciles. */
const ALL_MANAGED_SKILLS: readonly BuiltinSkill[] = [
  ...BUILTIN_SKILLS,
  MIYO_SEARCH_SKILL,
  MIYO_PARSE_SKILL,
];

/**
 * Splits the managed builtins into what to write and what to remove, so the host
 * can't seed a gate without pruning its opposite.
 *
 * Miyo-owned documents drop `copilot-read-pdf` outright instead of merely
 * steering away from it: that choice is fail-closed (see
 * `resolveDocProcessorBackend`), and a cloud PDF skill left on disk is one
 * ignored instruction away from uploading a document the user kept local.
 *
 * @param gates `search` mirrors `enableMiyoSearchSkill`, `documents` mirrors
 *   `docProcessorBackend === "miyo"`.
 */
export function planManagedBuiltins(gates: { search: boolean; documents: boolean }): {
  seed: readonly BuiltinSkill[];
  prune: readonly string[];
} {
  const seed: readonly BuiltinSkill[] =
    !gates.search && !gates.documents
      ? BUILTIN_SKILLS
      : [
          ...(gates.documents
            ? BUILTIN_SKILLS.filter((skill) => skill !== READ_PDF)
            : BUILTIN_SKILLS),
          ...(gates.search ? [MIYO_SEARCH_SKILL] : []),
          ...(gates.documents ? [MIYO_PARSE_SKILL] : []),
        ];
  return {
    seed,
    prune: ALL_MANAGED_SKILLS.filter((skill) => !seed.includes(skill)).map((skill) => skill.name),
  };
}
