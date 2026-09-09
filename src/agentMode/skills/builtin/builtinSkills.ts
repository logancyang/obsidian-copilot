import type { BackendId } from "@/agentMode/session/types";
import {
  OPENARTIFACTS_AGENT_HANDOFF_DIR,
  OPENARTIFACTS_API_ORIGIN,
  OPENARTIFACTS_MAX_HTML_BYTES,
  OPENARTIFACTS_THEMES_DIR,
  OPENARTIFACTS_WORKSPACE_ROOT_ENV,
} from "@/openArtifacts/constants";
import RESEARCH_MEMO_THEME from "openartifacts/skill/openartifacts/themes/research-memo.md";
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
   * Folder name of the managed predecessor this skill replaces. Its
   * `copilot-enabled-agents` choice carries over and the old folder is removed
   * once this one is seeded.
   */
  readonly legacyName?: string;
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

/** Plugin-owned scope inputs consumed by the managed Miyo search wrappers. */
export const MIYO_SEARCH_SCOPE_ENV = "COPILOT_MIYO_SEARCH_SCOPE";
export const MIYO_SEARCH_FOLDER_ENV = "COPILOT_MIYO_SEARCH_FOLDER";
/** Routes managed web skills through the plugin host instead of a hosted relay. */
export const SELF_HOST_WEB_SEARCH_ENV = "COPILOT_SELF_HOST_WEB_SEARCH";
/** Per-lifecycle loopback endpoint for the plugin-owned search channel. */
export const SELF_HOST_WEB_SEARCH_URL_ENV = "COPILOT_SELF_HOST_WEB_SEARCH_URL";
/** Random bearer token authenticating the owning Agent Chat process. */
export const SELF_HOST_WEB_SEARCH_TOKEN_ENV = "COPILOT_SELF_HOST_WEB_SEARCH_TOKEN";

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
SELF_HOST="\${${SELF_HOST_WEB_SEARCH_ENV}:-}"
SELF_HOST_URL="\${${SELF_HOST_WEB_SEARCH_URL_ENV}:-}"
SELF_HOST_TOKEN="\${${SELF_HOST_WEB_SEARCH_TOKEN_ENV}:-}"
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

require_relay() {
  [ -n "$KEY" ] && [ -n "$BASE" ] || no_license
}

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
$SELF_HOST = [Environment]::GetEnvironmentVariable('${SELF_HOST_WEB_SEARCH_ENV}')
$SELF_HOST_URL = [Environment]::GetEnvironmentVariable('${SELF_HOST_WEB_SEARCH_URL_ENV}')
$SELF_HOST_TOKEN = [Environment]::GetEnvironmentVariable('${SELF_HOST_WEB_SEARCH_TOKEN_ENV}')
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

function RequireRelay {
  if (-not $KEY -or -not $BASE) { NoLicense }
}

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
  license?: string;
  selfHostMode?: "search" | "deny";
  extraInstructions?: string;
}): BuiltinSkill {
  const [argKey, argPlaceholder] = opts.arg;
  const cmdFile = opts.scriptFile.replace(/\.sh$/, ".cmd");
  const ps1File = opts.scriptFile.replace(/\.sh$/, ".ps1");
  const version = 6;
  // Self-host search crosses back into the owning Obsidian renderer so API
  // keys never enter the agent process; fetch fails closed because there is no
  // provider-neutral page-fetch contract.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/165
  const selfHostSh =
    opts.selfHostMode === "search"
      ? `if [ "$SELF_HOST" = "1" ]; then
  [ -n "$SELF_HOST_URL" ] && [ -n "$SELF_HOST_TOKEN" ] || die "Copilot self-host web search is unavailable for this session." 1
  HTTP_RESPONSE=$(printf '%s' "$ARG" | curl --noproxy '*' -sS -X POST "$SELF_HOST_URL" \\
    -H "Authorization: Bearer $SELF_HOST_TOKEN" \\
    -H "Content-Type: text/plain; charset=utf-8" \\
    --data-binary @- -w '\\n%{http_code}') || die "Copilot could not complete self-host web search." 1
  HTTP_STATUS=$(printf '%s\\n' "$HTTP_RESPONSE" | tail -n 1)
  RESPONSE_BODY=$(printf '%s\\n' "$HTTP_RESPONSE" | sed '$d')
  case "$HTTP_STATUS" in
    2??) printf '%s\\n' "$RESPONSE_BODY"; exit 0 ;;
    *) [ -n "$RESPONSE_BODY" ] && printf '%s\\n' "$RESPONSE_BODY" >&2; exit 1 ;;
  esac
fi
`
      : opts.selfHostMode === "deny"
        ? `if [ "$SELF_HOST" = "1" ]; then
  die "Self-Host mode does not support fetching a specific page. Do not use a native web-fetch tool; use copilot-web-search when search results are sufficient, otherwise tell the user page fetching is unavailable." 1
fi
`
        : "";
  const selfHostPs1 =
    opts.selfHostMode === "search"
      ? `if ($SELF_HOST -eq '1') {
  if (-not $SELF_HOST_URL -or -not $SELF_HOST_TOKEN) { Die 'Copilot self-host web search is unavailable for this session.' 1 }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $SELF_HOST_URL -Method POST -Headers @{ Authorization = "Bearer $SELF_HOST_TOKEN" } -ContentType 'text/plain; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($ARG))
  } catch {
    if ($_.ErrorDetails.Message) { [Console]::Error.WriteLine($_.ErrorDetails.Message) }
    Die 'Copilot could not complete self-host web search.' 1
  }
  [Console]::Out.WriteLine($response.Content)
  exit 0
}
`
      : opts.selfHostMode === "deny"
        ? `if ($SELF_HOST -eq '1') {
  Die 'Self-Host mode does not support fetching a specific page. Do not use a native web-fetch tool; use copilot-web-search when search results are sufficient, otherwise tell the user page fetching is unavailable.' 1
}
`
        : "";
  return {
    name: opts.name,
    version,
    enabledAgents: ["claude", "codex", "opencode"],
    skillMd: `---
name: ${opts.name}
description: ${opts.description}
license: ${opts.license ?? "Copilot Plus"}
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${version}"
---

# ${opts.heading}

${opts.intro}

${howToRunSection({ shFile: opts.scriptFile, cmdFile, argPlaceholder })}

${LICENSE_PROBLEM_SECTION}
${opts.extraInstructions ? `\n${opts.extraInstructions}\n` : ""}
`,
    files: [
      {
        path: opts.scriptFile,
        content: `${scriptPreamble()}
ARG="$*"
[ -n "$ARG" ] || die "Usage: sh ${opts.scriptFile} <${argKey}>" 1
${selfHostSh}require_relay
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
${selfHostPs1}RequireRelay
Invoke-Relay "${opts.endpoint}" @{ ${argKey} = $ARG; user_id = $USER_ID }
`,
      },
    ],
  };
}

const WEB_SEARCH = relaySkill({
  name: "copilot-web-search",
  description:
    "Search the web for current information using Copilot Plus or the configured Self-Host search provider. Use when the user asks to search online, look something up on the internet, or needs up-to-date facts beyond the vault. Prefer reading the vault for anything about the user's own notes.",
  heading: "Copilot web search",
  intro: "Search the web through Copilot and return results for the user's query.",
  endpoint: "/websearch",
  arg: ["query", "<your search query>"],
  scriptFile: "web-search.sh",
  license: "Copilot Plus or Self-Host",
  selfHostMode: "search",
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
  selfHostMode: "deny",
  extraInstructions: `## Self-Host mode

Self-Host search providers do not provide a common full-page fetch contract. If
the script reports that Self-Host mode is active, never use an agent-native web
fetch tool. Use \`copilot-web-search\` when search results can answer the request;
otherwise tell the user that fetching the page is unavailable.`,
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
require_relay
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
RequireRelay
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

const OPENARTIFACTS_PUBLISH_VERSION = 8;
const OPENARTIFACTS_PUBLISH_USAGE = "openartifacts-publish";
/** Where the wrapper sends requests unless a test or self-host points it elsewhere. */
const OPENARTIFACTS_API_HOST_ENV = "OPENARTIFACTS_API_HOST";
/** Theme design specs come from the openartifacts npm package; a user theme with the
 * same name under `.openartifacts/themes/` in the vault takes precedence. */
const OPENARTIFACTS_DEFAULT_THEME = "research-memo";
const OPENARTIFACTS_MISSING_KEY_MESSAGE =
  "Publishing to OpenArtifacts needs a Copilot Plus license key. Add it in Copilot Settings and try again.";
const OPENARTIFACTS_PUBLISH: BuiltinSkill = {
  name: "openartifacts-publish",
  legacyName: "symposium-publish",
  version: OPENARTIFACTS_PUBLISH_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: openartifacts-publish
description: Publish, update, or withdraw an existing Markdown note as a public OpenArtifacts page. Use when the user asks to publish, share, update, delete, remove, or withdraw an OpenArtifacts page.
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${OPENARTIFACTS_PUBLISH_VERSION}"
---

# Publish Markdown to OpenArtifacts

Copilot supplies everything this skill needs through the environment:
\`$${OPENARTIFACTS_WORKSPACE_ROOT_ENV}\` is the vault root, and \`${PLUS_ENV.licenseKey}\`
is the credential the bundled wrapper sends. Do not read Copilot settings or credential
files, print the key, install anything, or run Node, npm, npx, or the Obsidian CLI.

If \`${PLUS_ENV.licenseKey}\` is unset or empty, stop before generating anything and tell
the user: ${OPENARTIFACTS_MISSING_KEY_MESSAGE}

## 1. Prepare the page

Read one existing Markdown source note. Treat YAML frontmatter as metadata, never as page
content. Note its \`symposium\` property: an \`https://…/d/<docId>\` value means the note is
already published and this task updates that page; pass that \`docId\` to the wrapper. If
the property holds any other value, stop and ask the user before touching it.

Write complete UTF-8 HTML (at most \`${OPENARTIFACTS_MAX_HTML_BYTES}\` bytes) to a new file
under \`$${OPENARTIFACTS_WORKSPACE_ROOT_ENV}/${OPENARTIFACTS_AGENT_HANDOFF_DIR}/\`, creating
the directory if needed. Preserve the note's content; render Obsidian-specific syntax such
as wikilinks, callouts, embeds, Mermaid, and Bases into static HTML or SVG. CSS, scripts,
and external resources are allowed and are published unchanged.

Themes are optional. For a named theme, check
\`$${OPENARTIFACTS_WORKSPACE_ROOT_ENV}/${OPENARTIFACTS_THEMES_DIR}/<name>.md\`, then
\`themes/<name>.md\` next to this skill. Check each path independently. If neither
exists, continue with readable defaults; a missing theme must never block publishing.
The bundled \`${OPENARTIFACTS_DEFAULT_THEME}\` is an optional example.

## 2. Let the user review

Tell the user the absolute path of the HTML file and that opening it in a browser shows
exactly what will be published. Then end your turn.

Never publish in the same turn that generated the HTML. Publish only when a later
message from the user clearly asks to publish this page. Treat anything else as feedback
(revise the same file and repeat this step) or as a cancellation. When unsure whether a
message is an approval, ask once. Never simulate the user's approval.

## 3. Publish

Run the wrapper next to this SKILL.md with the HTML file, the note's title (its file
name without \`.md\`), and the existing \`docId\` when updating. On macOS or Linux:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" publish "$${OPENARTIFACTS_WORKSPACE_ROOT_ENV}/${OPENARTIFACTS_AGENT_HANDOFF_DIR}/unique.html" "Note title" [docId]
\`\`\`

On Windows, use the \`.cmd\` wrapper (prefix with \`&\` in PowerShell):

\`\`\`powershell
& "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.cmd" publish "$env:${OPENARTIFACTS_WORKSPACE_ROOT_ENV}/${OPENARTIFACTS_AGENT_HANDOFF_DIR}/unique.html" "Note title" [docId]
\`\`\`

Success prints the server's JSON, \`{"docId", "url", "version"}\`. Set the note's
\`symposium\` frontmatter property to that \`url\` (create the frontmatter block if needed,
keep every other property), then report the URL. Publishing the same note again updates
the same page.

On failure the wrapper prints the HTTP status and the server's message to stderr and
exits 1. Report that message verbatim. Do not retry on your own, invent a cause, strip
styling, or publish another way. For a 401, the license key was refused or the plan
cannot publish; point the user at Copilot Settings. For \`not_found\` on an update, stop;
do not create a replacement page unless the user explicitly asks.

## 4. Withdraw

For delete, remove, or withdraw requests, read the \`docId\` from the \`symposium\`
property. If there is none, say nothing is published. Otherwise tell the user the link
will stop working and that copies people already saved cannot be recalled, then end your
turn. On a clear yes, run the wrapper with \`unshare <docId>\`, remove the \`symposium\`
property from the note, and report that the page is gone. Never tell the user to delete
the page at its public URL.
`,
  files: [
    { path: `themes/${OPENARTIFACTS_DEFAULT_THEME}.md`, content: RESEARCH_MEMO_THEME },
    {
      path: `${OPENARTIFACTS_PUBLISH_USAGE}.sh`,
      // POSIX sh + curl + awk only. The JSON string encoder is the whole reason this
      // script exists: three agents improvising it would each get it subtly wrong.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/394
      content: String.raw`#!/bin/sh
# Publish one HTML file to OpenArtifacts over HTTPS with the license key Copilot
# supplies in the environment. Needs only sh, curl, and awk.
usage() {
  printf '%s\n' "Usage: sh ${OPENARTIFACTS_PUBLISH_USAGE}.sh publish <html-file> <title> [docId]" >&2
  printf '%s\n' "       sh ${OPENARTIFACTS_PUBLISH_USAGE}.sh unshare <docId>" >&2
  exit 1
}

KEY=$${PLUS_ENV.licenseKey}
[ -n "$KEY" ] || {
  printf '%s\n' "${OPENARTIFACTS_MISSING_KEY_MESSAGE}" >&2
  exit 1
}
API_HOST=$${OPENARTIFACTS_API_HOST_ENV}
[ -n "$API_HOST" ] || API_HOST="${OPENARTIFACTS_API_ORIGIN}"
API_HOST=$(printf '%s' "$API_HOST" | sed 's,/*$,,')

COMMAND=$1
DOC_ID=
case "$COMMAND" in
  publish)
    [ "$#" -eq 3 ] || [ "$#" -eq 4 ] || usage
    HTML_FILE=$2
    TITLE=$3
    [ "$#" -eq 4 ] && DOC_ID=$4
    [ -f "$HTML_FILE" ] || {
      printf '%s\n' "HTML file not found: $HTML_FILE" >&2
      exit 1
    }
    ;;
  unshare)
    [ "$#" -eq 2 ] || usage
    DOC_ID=$2
    ;;
  *)
    usage
    ;;
esac
if [ -n "$DOC_ID" ] && ! printf '%s' "$DOC_ID" | grep -Eq '^[0-9abcdefghjkmnpqrstvwxyz]{16}$'; then
  printf '%s\n' "Invalid OpenArtifacts document id: $DOC_ID" >&2
  exit 1
fi

# stdin -> one JSON string literal. Bytes pass through untouched except the escapes
# JSON requires: backslash, quote, tab, CR, LF, and every other control character as
# \u00XX. Only NUL is dropped (awk cannot carry it, and HTML never contains it). A
# sentinel byte keeps a trailing newline in the file from being lost. Backslashes are
# joined in rather than substituted because awk implementations disagree on
# backslashes inside gsub replacements.
json_string() {
  { cat; printf 'x'; } | LC_ALL=C tr -d '\000' | LC_ALL=C awk '
    BEGIN { ORS = ""; bs = sprintf("%c", 92); printf "\"" }
    NR > 1 { printf "%s\\n", prev }
    {
      n = split($0, parts, /\\/)
      line = parts[1]
      for (i = 2; i <= n; i++) line = line bs bs parts[i]
      gsub(/"/, "\\\"", line)
      gsub(/\t/, "\\t", line)
      gsub(/\r/, "\\r", line)
      for (c = 1; c < 32; c++) {
        if (c != 9 && c != 10 && c != 13) gsub(sprintf("%c", c), sprintf("\\u%04x", c), line)
      }
      prev = line
    }
    END { printf "%s\"", substr(prev, 1, length(prev) - 1) }
  '
}

HEADERS=$(mktemp) || exit 1
BODY=$(mktemp) || exit 1
RESPONSE=$(mktemp) || exit 1
trap 'rm -f "$HEADERS" "$BODY" "$RESPONSE"' EXIT
printf 'Authorization: Bearer %s\n' "$KEY" > "$HEADERS"

if [ "$COMMAND" = unshare ]; then
  STATUS=$(curl -sS -o "$RESPONSE" -w '%{http_code}' -X DELETE -H "@$HEADERS" "$API_HOST/api/v1/docs/$DOC_ID")
  CURL_STATUS=$?
else
  {
    printf '{"title":'
    printf '%s' "$TITLE" | json_string
    printf ',"html":'
    json_string < "$HTML_FILE"
    printf '}'
  } > "$BODY"
  if [ -n "$DOC_ID" ]; then
    METHOD=PUT
    URL="$API_HOST/api/v1/docs/$DOC_ID"
  else
    METHOD=POST
    URL="$API_HOST/api/v1/docs"
  fi
  STATUS=$(curl -sS -o "$RESPONSE" -w '%{http_code}' -X "$METHOD" -H "@$HEADERS" -H 'Content-Type: application/json; charset=utf-8' --data-binary "@$BODY" "$URL")
  CURL_STATUS=$?
fi

if [ "$CURL_STATUS" -ne 0 ]; then
  printf '%s\n' "Could not reach OpenArtifacts at $API_HOST." >&2
  exit 1
fi
# The API answers a structured not_found when the page is already gone, which is the
# outcome asked for. Any other 404 is an error.
if [ "$COMMAND" = unshare ] && [ "$STATUS" = 404 ] && grep -q '"not_found"' "$RESPONSE"; then
  STATUS=204
fi
case "$STATUS" in
  2??)
    if [ "$COMMAND" = unshare ]; then
      printf '{"docId":"%s","status":"unshared"}\n' "$DOC_ID"
    else
      cat "$RESPONSE"
      printf '\n'
    fi
    exit 0
    ;;
  *)
    printf '%s\n' "OpenArtifacts returned HTTP $STATUS" >&2
    cat "$RESPONSE" >&2
    printf '\n' >&2
    exit 1
    ;;
esac
`,
    },
    {
      path: `${OPENARTIFACTS_PUBLISH_USAGE}.cmd`,
      content: cmdLauncher(`${OPENARTIFACTS_PUBLISH_USAGE}.ps1`),
    },
    {
      path: `${OPENARTIFACTS_PUBLISH_USAGE}.ps1`,
      // Windows PowerShell 5.1 and PowerShell 7 both ship ConvertTo-Json and
      // Invoke-WebRequest, so no curl.exe or Node is needed there either.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/394
      content: String.raw`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
# Publish one HTML file to OpenArtifacts over HTTPS with the license key Copilot
# supplies in the environment.

function Show-Usage {
  [Console]::Error.WriteLine('Usage: ${OPENARTIFACTS_PUBLISH_USAGE}.ps1 publish <html-file> <title> [docId]')
  [Console]::Error.WriteLine('       ${OPENARTIFACTS_PUBLISH_USAGE}.ps1 unshare <docId>')
  exit 1
}

$KEY = [Environment]::GetEnvironmentVariable('${PLUS_ENV.licenseKey}')
if (-not $KEY) {
  [Console]::Error.WriteLine('${OPENARTIFACTS_MISSING_KEY_MESSAGE}')
  exit 1
}
$API_HOST = [Environment]::GetEnvironmentVariable('${OPENARTIFACTS_API_HOST_ENV}')
if (-not $API_HOST) { $API_HOST = '${OPENARTIFACTS_API_ORIGIN}' }
$API_HOST = $API_HOST.TrimEnd('/')

$COMMAND = if ($args.Count -ge 1) { [string]$args[0] } else { '' }
$DOC_ID = ''
switch ($COMMAND) {
  'publish' {
    if ($args.Count -ne 3 -and $args.Count -ne 4) { Show-Usage }
    $HTML_FILE = [string]$args[1]
    $TITLE = [string]$args[2]
    if ($args.Count -eq 4) { $DOC_ID = [string]$args[3] }
    if (-not (Test-Path -LiteralPath $HTML_FILE -PathType Leaf)) {
      [Console]::Error.WriteLine("HTML file not found: $HTML_FILE")
      exit 1
    }
  }
  'unshare' {
    if ($args.Count -ne 2) { Show-Usage }
    $DOC_ID = [string]$args[1]
  }
  default { Show-Usage }
}
if ($DOC_ID -and $DOC_ID -notmatch '^[0-9abcdefghjkmnpqrstvwxyz]{16}$') {
  [Console]::Error.WriteLine("Invalid OpenArtifacts document id: $DOC_ID")
  exit 1
}

$headers = @{ Authorization = "Bearer $KEY" }
try {
  if ($COMMAND -eq 'unshare') {
    $null = Invoke-WebRequest -UseBasicParsing -Method Delete -Uri "$API_HOST/api/v1/docs/$DOC_ID" -Headers $headers
    [Console]::Out.WriteLine('{"docId":"' + $DOC_ID + '","status":"unshared"}')
  } else {
    $html = [System.IO.File]::ReadAllText($HTML_FILE, (New-Object System.Text.UTF8Encoding($false)))
    $body = @{ title = $TITLE; html = $html } | ConvertTo-Json -Compress -Depth 2
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $method = if ($DOC_ID) { 'Put' } else { 'Post' }
    $uri = if ($DOC_ID) { "$API_HOST/api/v1/docs/$DOC_ID" } else { "$API_HOST/api/v1/docs" }
    $response = Invoke-WebRequest -UseBasicParsing -Method $method -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes
    [Console]::Out.WriteLine([string]$response.Content)
  }
} catch {
  $status = $null
  $detail = ''
  if ($_.Exception.Response) {
    try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = $null }
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $detail = $reader.ReadToEnd()
    } catch { $detail = '' }
  }
  if (-not $detail -and $_.ErrorDetails) { $detail = [string]$_.ErrorDetails.Message }
  if ($COMMAND -eq 'unshare' -and $status -eq 404 -and $detail -match '"not_found"') {
    # The API's structured not_found means the page is already gone, which is the outcome asked for.
    [Console]::Out.WriteLine('{"docId":"' + $DOC_ID + '","status":"unshared"}')
    exit 0
  }
  if ($status) {
    [Console]::Error.WriteLine("OpenArtifacts returned HTTP $status")
    if ($detail) { [Console]::Error.WriteLine($detail) }
  } elseif ($detail) {
    [Console]::Error.WriteLine($detail)
  } else {
    [Console]::Error.WriteLine("Could not reach OpenArtifacts at $API_HOST. " + $_.Exception.Message)
  }
  exit 1
}
exit 0
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
  OPENARTIFACTS_PUBLISH,
  ...OBSIDIAN_SKILLS,
];

const MIYO_SEARCH_VERSION = 3;
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

# Default closed: only the explicit Unrestricted value may omit Miyo's exact
# pre-retrieval folder boundary.
# https://github.com/Brevilabs/obsidian-copilot-private/issues/121
case "\${${MIYO_SEARCH_SCOPE_ENV}:-current}" in
  unrestricted)
    OUT=$("$MIYO" search "$QUERY" -n 10 --json 2>&1) || die "Miyo search failed — the Miyo app may not be running. Tell the user to open Miyo, then continue without vault search if they can't. Details: $OUT" 1
    ;;
  current)
    [ -n "\${${MIYO_SEARCH_FOLDER_ENV}:-}" ] || die "Miyo search could not enforce Current vault scope because the active vault identity is missing. Do not retry or run an unrestricted search." 4
    OUT=$("$MIYO" search "$QUERY" -n 10 --folder "$${MIYO_SEARCH_FOLDER_ENV}" --json 2>&1) || die "Miyo search could not enforce Current vault scope. Update Miyo, open it, and retry. Do not run an unrestricted search. Details: $OUT" 1
    ;;
  *)
    die "Miyo search received an invalid Search scope. Do not retry or run an unrestricted search." 4
    ;;
esac
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
rem Default closed: only the explicit Unrestricted value may omit Miyo's exact
rem pre-retrieval folder boundary.
rem https://github.com/Brevilabs/obsidian-copilot-private/issues/121
if /I "%${MIYO_SEARCH_SCOPE_ENV}%"=="unrestricted" (
  "%MIYO%" search %* -n 10 --json
  if errorlevel 1 exit /b 1
  exit /b 0
)
if not "%${MIYO_SEARCH_SCOPE_ENV}%"=="" if /I not "%${MIYO_SEARCH_SCOPE_ENV}%"=="current" (
  echo Miyo search received an invalid Search scope. Do not retry or run an unrestricted search. 1>&2
  exit /b 4
)
if not defined ${MIYO_SEARCH_FOLDER_ENV} (
  echo Miyo search could not enforce Current vault scope because the active vault identity is missing. Do not retry or run an unrestricted search. 1>&2
  exit /b 4
)
"%MIYO%" search %* -n 10 --folder "%${MIYO_SEARCH_FOLDER_ENV}%" --json
if errorlevel 1 (
  echo Miyo search could not enforce Current vault scope. Update Miyo, open it, and retry. Do not run an unrestricted search. 1>&2
  exit /b 1
)
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

Search scope comes from Copilot settings. **Current vault** applies Miyo's exact
folder boundary for the active vault, including from Project chats.
**Unrestricted** searches every folder registered with Miyo.

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
