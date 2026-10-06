import type { BackendId } from "@/agentMode";
import type { CopilotSettings } from "@/settings/model";
import {
  OPENARTIFACTS_AGENT_HANDOFF_DIR,
  OPENARTIFACTS_API_ORIGIN,
  OPENARTIFACTS_MAX_HTML_BYTES,
  OPENARTIFACTS_THEMES_DIR,
  OPENARTIFACTS_WORKSPACE_ROOT_ENV,
} from "@/openArtifacts/constants";
import RESEARCH_MEMO_THEME from "openartifacts/skill/openartifacts/themes/research-memo.md";
import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import { OBSIDIAN_SKILLS } from "./obsidianSkills";

export interface BuiltinSkill {
  readonly name: string;
  readonly version: number;
  readonly enabledAgents: readonly BackendId[];
  readonly defaultDisabled?: boolean;
  readonly skillMd: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>;
}

/**
 * Retain retired names so Copilot can remove their managed folders and preferences.
 * https://github.com/logancyang/obsidian-copilot/issues/3022
 */
export const RETIRED_BUILTIN_SKILLS: readonly Pick<BuiltinSkill, "name">[] = [
  { name: "symposium-publish" },
];

export const PLUS_ENV = {
  licenseKey: "COPILOT_PLUS_LICENSE_KEY",
  baseUrl: "COPILOT_API_BASE_URL",
  userId: "COPILOT_USER_ID",
  clientVersion: "COPILOT_CLIENT_VERSION",
} as const;

export const MIYO_SEARCH_SCOPE_ENV = "COPILOT_MIYO_SEARCH_SCOPE";
export const MIYO_SEARCH_FOLDER_ENV = "COPILOT_MIYO_SEARCH_FOLDER";
export const SELF_HOST_WEB_SEARCH_ENV = "COPILOT_SELF_HOST_WEB_SEARCH";
export const SELF_HOST_WEB_SEARCH_URL_ENV = "COPILOT_SELF_HOST_WEB_SEARCH_URL";
export const SELF_HOST_WEB_SEARCH_TOKEN_ENV = "COPILOT_SELF_HOST_WEB_SEARCH_TOKEN";

const NO_LICENSE_MESSAGE =
  "Copilot Plus is not active, so this skill is unavailable — do not retry it. Complete the request using your own equivalent built-in tools if you have them; otherwise tell the user it's unavailable. Never refuse or tell the user they are blocked.";

const NO_LICENSE_UPSELL = `You may also add one short, friendly note that Copilot Plus offers higher-quality web, PDF, YouTube, and X tools — get a license key at ${createProductUrl(PRODUCT_URLS.COPILOT_PRICING, "skill_no_license")} to access them.`;

const LICENSE_INVALID_MESSAGE = `Your Copilot Plus license is inactive or expired, so this skill is unavailable — do not retry it. Complete the request using your own equivalent built-in tools if you have them; otherwise tell the user it's unavailable, and never refuse. You may briefly let the user know they can renew their Copilot Plus license at ${createProductUrl(PRODUCT_URLS.COPILOT_PRICING, "skill_license_invalid")} to restore the higher-quality versions of these tools.`;

const RELAY_FAILED_FALLBACK =
  "If you have your own equivalent built-in tool for this, use it to complete the request; otherwise tell the user it could not be completed.";

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

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

# Decode a response body as UTF-8 whatever its header says: Windows PowerShell 5.1
# decodes .Content as ISO-8859-1 when the server names no charset, mojibaking
# every non-ASCII character. https://github.com/logancyang/obsidian-copilot/issues/3398
function Read-Utf8Body($resp) {
  [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
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
    $out = Read-Utf8Body $resp
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
 * OpenCode exposes a code-execution tool (`execute`) beside its shell tool, and a model handed
 * the bare command passes it there as code, which fails to parse.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/599
 */
const SHELL_TOOL_SENTENCE = `Run it as a shell command with your shell command tool (for example
\`Bash\` in Claude Code, \`shell\` in OpenCode, \`exec_command\` in Codex). The command
is shell syntax, not JavaScript or TypeScript: never pass it as the code of a
code-execution tool.`;

function howToRunSection(opts: {
  shFile: string;
  cmdFile: string;
  argPlaceholder: string;
  extraNote?: string;
}): string {
  const dir = "/absolute/path/to/this/skill/directory";
  return `## How to run

Find the absolute path to this SKILL.md file on disk, then run the script next
to it that matches the operating system. ${SHELL_TOOL_SENTENCE}
No extra runtime is needed — \`sh\` (macOS/Linux) and \`cmd\`/PowerShell (Windows)
are always present.

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

const LICENSE_PROBLEM_SECTION = `## If Copilot Plus is not active

If the script exits saying Copilot Plus is unavailable, do NOT retry it. Do what
the message says: fall back to your own equivalent built-in capability to handle
the request when you have one (otherwise tell the user it's unavailable) — never
refuse or block the user. Only mention upgrading or renewing Copilot Plus when
the script's message explicitly invites it, and keep any such note short and
friendly.`;

function relaySkill(opts: {
  name: string;
  description: string;
  heading: string;
  intro: string;
  endpoint: string;
  arg: [key: string, placeholder: string];
  scriptFile: string;
  license?: string;
  selfHostMode?: "search" | "deny";
  extraInstructions?: string;
  defaultDisabled?: boolean;
}): BuiltinSkill {
  const [argKey, argPlaceholder] = opts.arg;
  const cmdFile = opts.scriptFile.replace(/\.sh$/, ".cmd");
  const ps1File = opts.scriptFile.replace(/\.sh$/, ".ps1");
  const version = 9;
  // Self-host search crosses back into the Obsidian renderer so API keys never enter the
  // agent process.
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
  [Console]::Out.WriteLine((Read-Utf8Body $response))
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
    defaultDisabled: opts.defaultDisabled,
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
  defaultDisabled: true,
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
  defaultDisabled: true,
  extraInstructions: `## Self-Host mode

Self-Host search providers do not provide a common full-page fetch contract. If
the script reports that Self-Host mode is active, never use an agent-native web
fetch tool. Use \`copilot-web-search\` when search results can answer the request;
otherwise tell the user that fetching the page is unavailable.`,
});

const READ_PDF_VERSION = 9;
const READ_PDF: BuiltinSkill = {
  name: "copilot-read-pdf",
  version: READ_PDF_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  defaultDisabled: true,
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

const OPENARTIFACTS_PUBLISH_VERSION = 6;
const OPENARTIFACTS_PUBLISH_USAGE = "openartifacts-publish";
const OPENARTIFACTS_API_HOST_ENV = "OPENARTIFACTS_API_HOST";
const OPENARTIFACTS_DEFAULT_THEME = "research-memo";
const OPENARTIFACTS_MISSING_KEY_MESSAGE =
  "Publishing to OpenArtifacts needs a Copilot Plus license key. Add it in Copilot Settings and try again.";
const OPENARTIFACTS_PUBLISH: BuiltinSkill = {
  name: "openartifacts-publish",
  version: OPENARTIFACTS_PUBLISH_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: openartifacts-publish
description: Publish an existing Markdown note or local HTML file, update a published Markdown note, or withdraw an OpenArtifacts page. Use when the user asks to publish, share, update, delete, remove, or withdraw an OpenArtifacts page.
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${OPENARTIFACTS_PUBLISH_VERSION}"
---

# Publish Markdown or HTML to OpenArtifacts

Copilot supplies everything this skill needs through the environment:
\`$${OPENARTIFACTS_WORKSPACE_ROOT_ENV}\` is the vault root, and \`${PLUS_ENV.licenseKey}\`
is the credential the bundled wrapper sends. Do not read Copilot settings or credential
files, print the key, install anything, or run Node, npm, npx, or the Obsidian CLI.

If \`${PLUS_ENV.licenseKey}\` is unset or empty, stop before generating anything and tell
the user: ${OPENARTIFACTS_MISSING_KEY_MESSAGE}

## 1. Prepare the page

### Existing Markdown note

Read one existing Markdown source note. Treat YAML frontmatter as metadata, never as page
content. Note its \`openartifacts\` property, or on older notes the \`symposium\` property:
an \`https://…/d/<docId>\` value means the note is already published and this task updates
that page; pass that \`docId\` to the wrapper. Compare document ids, not urls: an older
\`symposium.site\` link and an \`openartifacts.site\` link with the same id are the same page.
If either property holds any other value, or the two name different ids, stop and ask the
user before touching them.

Write complete UTF-8 HTML (at most \`${OPENARTIFACTS_MAX_HTML_BYTES}\` bytes) to a new file
under \`$${OPENARTIFACTS_WORKSPACE_ROOT_ENV}/${OPENARTIFACTS_AGENT_HANDOFF_DIR}/\`, creating
the directory if needed. Preserve the note's content; render Obsidian-specific syntax such
as wikilinks, callouts, embeds, Mermaid, and Bases into static HTML or SVG. CSS, scripts,
and external resources are allowed and are published unchanged.

Use the note's file name without \`.md\` as its page title. Convert the filename-derived title to
title case while preserving recognizable acronyms and proper names. Put that title in both the HTML
\`<title>\` and a visible \`<h1>\` above the rendered note body. If the user explicitly asks for no
title, do not add the \`<h1>\`. Keep the HTML \`<title>\` as browser metadata, and preserve any
authored opening heading as note content. Otherwise, if the rendered note body already starts with an
equivalent \`<h1>\` containing the same visible title text, use that heading as the page-body title
and do not add another heading. Preserve all remaining note content below it, and do not edit the
source Markdown to add the heading. Keep normal text wrapping on the \`<h1>\` so long titles wrap
naturally on narrow screens. Never truncate the title, hide its overflow, or apply single-line or
ellipsis styling. The review and publish steps must use this same complete HTML file so its title
and body match in preview and after publishing.

Themes are optional. For a named theme, check
\`$${OPENARTIFACTS_WORKSPACE_ROOT_ENV}/${OPENARTIFACTS_THEMES_DIR}/<name>.md\`, then
\`themes/<name>.md\` next to this skill. Check each path independently. If neither
exists, continue with readable defaults; a missing theme must never block publishing.
The bundled \`${OPENARTIFACTS_DEFAULT_THEME}\` is an optional example.

### Existing HTML file

For an existing local \`.html\` file, confirm that it exists and is at most
\`${OPENARTIFACTS_MAX_HTML_BYTES}\` bytes. Pass that original HTML file path directly to
the wrapper. Treat the file as the complete page: do not convert it to Markdown, and do
not render, rewrite, or copy it into \`${OPENARTIFACTS_AGENT_HANDOFF_DIR}/\`. Use its file
name without \`.html\` as the wrapper title without changing the document's own title or
visible content. Skip the Markdown frontmatter, generated-title, and theme instructions
above. Check the HTML, including inline CSS, for every reference to a local file. Examples
include relative \`src\`, \`href\`, \`srcset\`, \`poster\`, or CSS \`url(...)\` references.
If any exist, keep the file unchanged; name each reference in the review message and say it
will not load on the published page because only the HTML file is uploaded. This warning
does not block publication: let the user make the file self-contained or approve publishing
anyway. The original file remains user-owned; never delete the original HTML file.

## 2. Let the user review

Tell the user the absolute path of the HTML file and that, subject to any relative-asset
warning above, opening it in a browser shows the page as it will be uploaded; OpenArtifacts
adds its own header and footer bylines when it serves the page. Then end your turn.

Never publish in the same turn that generated the HTML. Publish only when a later
message from the user clearly asks to publish this page. Treat anything else as feedback
(revise the generated Markdown handoff and repeat this step; for existing HTML, relay the
feedback and wait for the user to update the file, then repeat steps 1 and 2 before accepting
publication approval) or as a cancellation. When unsure whether a message is an approval,
ask once. Never simulate the user's approval.

## 3. Publish

Run the wrapper next to this SKILL.md with the HTML file, its filename-derived title, and
the existing \`docId\` when updating a Markdown note. ${SHELL_TOOL_SENTENCE}
On macOS or Linux, the Markdown path uses its generated handoff:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" publish "$${OPENARTIFACTS_WORKSPACE_ROOT_ENV}/${OPENARTIFACTS_AGENT_HANDOFF_DIR}/unique.html" "Note title" [docId]
\`\`\`

An existing HTML file uses its original path directly:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" publish "/absolute/path/to/page.html" "Page title"
\`\`\`

On Windows, use the \`.cmd\` wrapper (prefix with \`&\` in PowerShell):

\`\`\`powershell
& "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.cmd" publish "$env:${OPENARTIFACTS_WORKSPACE_ROOT_ENV}/${OPENARTIFACTS_AGENT_HANDOFF_DIR}/unique.html" "Note title" [docId]
\`\`\`

For an existing HTML file on Windows, replace the handoff path with the original absolute
\`.html\` path and omit the \`docId\`.

Success returns the same server receipt, \`{"docId", "url", "version"}\`, for either
input. For a Markdown note, set its \`openartifacts\` frontmatter property to that \`url\`
(create the frontmatter block if needed, keep every other property), remove a \`symposium\`
property whose link has the same document id, and delete the generated HTML file from
\`${OPENARTIFACTS_AGENT_HANDOFF_DIR}/\`. For an existing HTML file, leave the source file
unchanged. Then report the URL. Publishing the same Markdown note again updates the same page.

On failure the wrapper prints the HTTP status and the server's message to stderr and
exits 1. Report that message verbatim. Do not retry on your own, invent a cause, strip
styling, or publish another way. For a 401, the license key was refused or the plan
cannot publish; point the user at Copilot Settings. For \`not_found\` on an update, stop;
do not create a replacement page unless the user explicitly asks.

## 4. Withdraw

For delete, remove, or withdraw requests, take the \`docId\` from an OpenArtifacts link the
user supplies or the receipt URL reported earlier. Otherwise, read it with the same rules as
step 1: \`openartifacts\` first, \`symposium\` on older notes, compared by document id, and
stop to ask on any other value or on two properties naming different ids. If there is no link
or property, say nothing is published. Otherwise tell the user the link will stop working and
that copies people already saved cannot be recalled, then end your turn. On a clear yes, run
the wrapper with \`unshare <docId>\`, remove each \`openartifacts\` or \`symposium\` property
only when that property's own link has the same document id, and report that the page is gone.
Never tell the user to delete the page at its public URL.
`,
  files: [
    { path: `themes/${OPENARTIFACTS_DEFAULT_THEME}.md`, content: RESEARCH_MEMO_THEME },
    {
      path: `${OPENARTIFACTS_PUBLISH_USAGE}.sh`,
      // The JSON string encoder is the whole reason this script exists: agents improvising it
      // each get it subtly wrong.
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

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  WEB_SEARCH,
  WEB_FETCH,
  READ_PDF,
  YOUTUBE_TRANSCRIPT,
  FETCH_X,
  OPENARTIFACTS_PUBLISH,
  ...OBSIDIAN_SKILLS,
];

const MIYO_SEARCH_VERSION = 4;
const MIYO_PARSE_VERSION = 2;

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

${howToRunSection({
  shFile: "miyo-search.sh",
  cmdFile: "miyo-search.cmd",
  argPlaceholder: "<the user's question>",
  extraNote: "Pass the user's full question as the query.",
})}

The script locates the Miyo binary itself — you do not need to know where Miyo
is installed or which shell you are in. Run the script as your single search
step; do not fall back to other search tools unless it reports that Miyo is
unavailable. Read the JSON straight from stdout; do not pipe it through other
tools (no \`jq\`, no \`|\`).

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

${howToRunSection({
  shFile: "miyo-parse.sh",
  cmdFile: "miyo-parse.cmd",
  argPlaceholder: "/absolute/path/to/document.pdf",
  extraNote: "Pass exactly one quoted path to the PDF or EPUB file.",
})} Use that Markdown/text to answer the user's question.

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

export const ALL_MANAGED_SKILLS: readonly BuiltinSkill[] = [
  ...BUILTIN_SKILLS,
  MIYO_SEARCH_SKILL,
  MIYO_PARSE_SKILL,
];

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

// Default-off is stored as an opt-out because older releases drop every other record,
// which would erase opt-ins synced from newer devices:
// https://github.com/Brevilabs/obsidian-copilot-private/issues/629
export const DEFAULT_BUILTIN_PREFERENCES: NonNullable<
  CopilotSettings["agentMode"]["skills"]["builtinPreferences"]
> = Object.freeze(
  Object.fromEntries(
    ALL_MANAGED_SKILLS.filter((skill) => skill.defaultDisabled).map((skill) => [
      skill.name,
      Object.freeze({ disabled: true }),
    ])
  )
);

export function isBuiltinSkillEnabledFor(
  settings: CopilotSettings,
  skillName: string,
  agentId: string
): boolean {
  const pref = settings.agentMode.skills.builtinPreferences?.[skillName];
  if (pref?.disabled || pref?.disabledAgents?.includes(agentId)) return false;
  return planManagedBuiltins({
    search: settings.enableMiyoSearchSkill === true,
    documents: settings.docProcessorBackend === "miyo",
  }).seed.some((skill) => skill.name === skillName);
}
