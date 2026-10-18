import type { BackendId } from "@/agentMode";
import type { CopilotSettings } from "@/settings/model";
import {
  OPENARTIFACTS_AGENT_HANDOFF_DIR,
  OPENARTIFACTS_API_ORIGIN,
  OPENARTIFACTS_MAX_HTML_BYTES,
  OPENARTIFACTS_THEMES_DIR,
  OPENARTIFACTS_CLIENT_HEADER,
  OPENARTIFACTS_CLIENT_ID,
  OPENARTIFACTS_LINK_OFFER_MARKER,
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
  { name: "copilot-read-pdf" },
];

export const PLUS_ENV = {
  licenseKey: "COPILOT_PLUS_LICENSE_KEY",
  baseUrl: "COPILOT_API_BASE_URL",
  userId: "COPILOT_USER_ID",
  clientVersion: "COPILOT_CLIENT_VERSION",
} as const;

export const MIYO_SEARCH_SCOPE_ENV = "COPILOT_MIYO_SEARCH_SCOPE";
export const MIYO_SEARCH_FOLDER_ENV = "COPILOT_MIYO_SEARCH_FOLDER";
export const MIYO_SEARCH_EXTRA_FOLDERS_ENV = "COPILOT_MIYO_SEARCH_EXTRA_FOLDERS";
export const MIYO_SEARCH_EXTRA_FOLDER_ARGS_ENV = "COPILOT_MIYO_SEARCH_EXTRA_FOLDER_ARGS";
export const SELF_HOST_WEB_SEARCH_ENV = "COPILOT_SELF_HOST_WEB_SEARCH";
export const SELF_HOST_WEB_SEARCH_URL_ENV = "COPILOT_SELF_HOST_WEB_SEARCH_URL";
export const SELF_HOST_WEB_SEARCH_TOKEN_ENV = "COPILOT_SELF_HOST_WEB_SEARCH_TOKEN";

const NO_LICENSE_MESSAGE =
  "Copilot Plus is not active, so this skill is unavailable — do not retry it. Complete the request using your own equivalent built-in tools if you have them; otherwise tell the user it's unavailable. Never refuse or tell the user they are blocked.";

const NO_LICENSE_UPSELL = `You may also add one short, friendly note that Copilot Plus offers higher-quality web, YouTube, and X tools — get a license key at ${createProductUrl(PRODUCT_URLS.COPILOT_PRICING, "skill_no_license")} to access them.`;

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
  const version = 10;
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

const OPENARTIFACTS_PUBLISH_VERSION = 9;
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
description: Publish an existing Markdown note or local HTML file, update a published Markdown note, or withdraw an OpenArtifacts page. Also make a page private or public, add or remove the people who can open it, and see and answer access requests. Use when the user asks to publish, share, update, delete, remove, or withdraw an OpenArtifacts page, or to change who can open one.
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

Give the user a clickable Markdown link to the exact HTML file under review, as plain text
in your reply (not in inline code or a code block). Percent-encode the target (\`%20\` for
spaces, UTF-8 percent-encoding for non-ASCII characters). For a file inside the vault, such as
a generated handoff, link its vault-root path:
\`[page name.html](/.openartifacts/handoffs/page%20name.html)\`. Use the absolute path,
such as \`[page.html](/Users/me/page.html)\`, only for a file outside the vault. Never put a
drive letter or other \`:\` in the target; Obsidian treats such links as external. If a file
outside the vault has such a path (for example on Windows), give its absolute path as plain
text instead. Copilot opens the link in the default browser. Also say that, subject to any relative-asset warning above, opening it in
a browser shows the page as it will be uploaded; OpenArtifacts adds its own top bar, with a
Share button, and a footer byline when it serves the page.

For a new page, end the review message with this line, word for word:

"Who should be able to open it? Reply **publish** for anyone with the link, or name people, for example **publish for alice@acme.com**, to share it only with them."

If the user's request already said who (for
example "publish this privately for Alice" or "publish this publicly"), confirm that choice
instead of asking: "It will be published privately for {emails}. Reply publish to go ahead." or
"It will be published for anyone with the link. Reply publish to go ahead." Never guess an
address: if the user names a person without one, ask for it. An update to a page that is
already published never asks and keeps who can open it. Then end your turn.

Never publish in the same turn that generated the HTML. Publish only when a later
message from the user clearly asks to publish this page. A reply of "publish" approves what
the review message offered: a public page after the question, or the confirmed choice after
a confirmation. "publish for alice@acme.com" (several addresses may follow, separated by
commas) or a request for a private page approves a private one. Treat anything else as feedback
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

If the user named people or asked for a private page, create the new page private by adding
\`--private\` right after \`publish\`, then add each person with one \`share\` call per address:

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" publish --private "/absolute/path/to/page.html" "Page title"
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" share <docId> add alice@acme.com
\`\`\`

Otherwise publish exactly as above, with no flag. Updating a page never changes who can open
it. Never tell the user a page is private unless the \`--private\` publish succeeded.

On Windows, use the \`.cmd\` wrapper (prefix with \`&\` in PowerShell):

\`\`\`powershell
& "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.cmd" publish "$env:${OPENARTIFACTS_WORKSPACE_ROOT_ENV}/${OPENARTIFACTS_AGENT_HANDOFF_DIR}/unique.html" "Note title" [docId]
\`\`\`

For an existing HTML file on Windows, replace the handoff path with the original absolute
\`.html\` path and omit the \`docId\`.

Success returns the same server receipt for either input, \`{"docId", "url", "version"}\`, plus \`"linkAccess"\` on a create when the server reports it (a private publish also prints a \`manageUrl\`).

### Record the page in the note

For a Markdown note, do this right after a successful publish, before any \`share\` call and
before you reply. Never skip it: it is what makes the next publish of this note update the same
page instead of creating a new one.

1. Set the note's \`openartifacts\` frontmatter property to the receipt's \`url\`. Create the
   frontmatter block if the note has none, and keep every other property.
2. Remove a \`symposium\` property whose link has the same document id.
3. Delete the generated HTML file from \`${OPENARTIFACTS_AGENT_HANDOFF_DIR}/\`.

Then read the note's frontmatter again and check that \`openartifacts\` is the url. For an
existing HTML file, leave the source file unchanged and skip this.

### Report

Report a private publish as:

"Published privately: {url}. Only you and {addresses} can open it."

Use "Only you can open it." when nobody was named. Say an email was sent only when the \`share\`
output shows \`"email": true\`; otherwise tell the user the server sent no email and that they
should send the invitees the link. Invitees sign in with the address that was invited. End the
report with this line, using the \`manageUrl\` the wrapper printed:

"Manage who can open it: {manageUrl}"

Report a public create as "Published: {url}. Anyone with the link can open it." Report an update as "Updated: {url}." and do not say who can open it; an update keeps who could open it before.

If a create receipt has a \`guidance\` object, add one more line as the very last line of the report, after the "Manage who can open it" line on a private publish: "{guidance.message} [Link account]({guidance.url})". Use \`guidance.message\` exactly as the receipt gives it.

If an \`add\` fails after a private publish, the page is private. Report the url, who can open
it, and the failed address with the wrapper's message.

If \`publish --private\` says "This OpenArtifacts server does not support private documents. Nothing was published.", relay it and do not publish publicly unless the user asks. On a
\`402\` with \`privateSharing\`, say private sharing needs a paid plan and that nothing was
published or changed, and that replying **publish** publishes it for anyone with the link. Never
do that automatically.

On failure the wrapper prints the HTTP status and the server's message to stderr and
exits 1. Report that message verbatim. Do not retry on your own, invent a cause, strip
styling, or publish another way. For a 401, the license key was refused or the plan
cannot publish; point the user at Copilot Settings. For \`not_found\` on an update, stop;
do not create a replacement page unless the user explicitly asks.

## 4. Change who can open a page

Act only when the user asks, and make one change per \`share\` call. Take the \`docId\` the
way step 5 does: from an OpenArtifacts link the user supplies, the receipt URL reported earlier,
or the note's \`openartifacts\` property. On Windows, use the \`.cmd\` wrapper the same way.

\`\`\`bash
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" share <docId> link invited      # "make it private"
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" share <docId> link anyone       # "make it public"
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" share <docId> add alice@acme.com
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" share <docId> remove alice@acme.com
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" share <docId> decline bob@other.com
sh "/absolute/path/to/this/skill/directory/${OPENARTIFACTS_PUBLISH_USAGE}.sh" share <docId>
\`\`\`

- After \`link invited\` makes a public page private, say: "People who opened it while it was public may have kept a copy."
- After \`link anyone\`, say that anyone with the link can now open it, and that the list of
  invited people is kept in case the user switches back.
- When the user asks who has access, run \`share <docId>\` and report \`people\` and the pending
  \`requests\`, with the \`manageUrl\`. Approve a request with \`add <email>\` and decline it with
  \`decline <email>\`, only when the user says so.
- Tell the user that invitees sign in with the address that was invited.
- Private sharing needs a paid plan for making a page private and for adding people. On a
  \`402\` with \`privateSharing\`, say so and that nothing was changed.
- If \`share\` says "Not found, or this server does not support private documents.", relay it and
  do not guess.

## 5. Withdraw

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
  printf '%s\n' "Usage: sh ${OPENARTIFACTS_PUBLISH_USAGE}.sh publish [--private] <html-file> <title> [docId]" >&2
  printf '%s\n' "       sh ${OPENARTIFACTS_PUBLISH_USAGE}.sh unshare <docId>" >&2
  printf '%s\n' "       sh ${OPENARTIFACTS_PUBLISH_USAGE}.sh share <docId> [add|remove|decline <email> | link anyone|invited]" >&2
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
PRIVATE=
SHARE_ACTION=
SHARE_VALUE=
if [ "$COMMAND" = publish ] && [ "$2" = --private ]; then
  PRIVATE=1
  shift 2
  set -- publish "$@"
fi
case "$COMMAND" in
  publish)
    [ "$#" -eq 3 ] || { [ "$#" -eq 4 ] && [ -z "$PRIVATE" ]; } || usage
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
  share)
    # One change per call: an address added (which also approves its request), removed or
    # declined, or the link setting. Never a whole list.
    # https://github.com/Brevilabs/obsidian-copilot-private/issues/707
    [ "$#" -ge 2 ] && [ "$#" -le 4 ] || usage
    DOC_ID=$2
    SHARE_ACTION=list
    if [ "$#" -ge 3 ]; then
      [ "$#" -eq 4 ] || usage
      SHARE_ACTION=$3
      SHARE_VALUE=$4
      case "$SHARE_ACTION" in
        add|remove|decline) ;;
        link)
          case "$SHARE_VALUE" in
            anyone|invited) ;;
            *) usage ;;
          esac
          ;;
        *) usage ;;
      esac
    fi
    ;;
  *)
    usage
    ;;
esac
if [ -n "$DOC_ID" ] && ! printf '%s' "$DOC_ID" | grep -Eq '^[0-9abcdefghjkmnpqrstvwxyz]{16}$'; then
  printf '%s\n' "Invalid OpenArtifacts document id: $DOC_ID" >&2
  exit 1
fi
EMAIL_PATH=
case "$SHARE_ACTION" in
  add|remove|decline)
    # The address goes into a URL path, so refuse anything that could change the path.
    case "$SHARE_VALUE" in
      ''|*[[:space:][:cntrl:]/?#%]*)
        printf '%s\n' "Invalid email address: $SHARE_VALUE" >&2
        exit 1
        ;;
    esac
    EMAIL_PATH=$(printf '%s' "$SHARE_VALUE" | sed 's/@/%40/g; s/+/%2B/g')
    ;;
esac

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
WORKSPACE_ROOT=$${OPENARTIFACTS_WORKSPACE_ROOT_ENV}
OFFER_MARKER="$WORKSPACE_ROOT/${OPENARTIFACTS_LINK_OFFER_MARKER}"
OFFER_ASKED=
if [ "$COMMAND" = publish ] && [ -z "$DOC_ID" ] && [ -n "$WORKSPACE_ROOT" ] && [ ! -e "$OFFER_MARKER" ]; then
  OFFER_ASKED=1
  printf '${OPENARTIFACTS_CLIENT_HEADER}: ${OPENARTIFACTS_CLIENT_ID}\n' >> "$HEADERS"
fi

if [ "$COMMAND" = unshare ]; then
  STATUS=$(curl -sS -o "$RESPONSE" -w '%{http_code}' -X DELETE -H "@$HEADERS" "$API_HOST/api/v1/docs/$DOC_ID")
  CURL_STATUS=$?
elif [ "$COMMAND" = share ]; then
  ACCESS_URL="$API_HOST/api/v1/docs/$DOC_ID/access"
  case "$SHARE_ACTION" in
    list)
      STATUS=$(curl -sS -g -o "$RESPONSE" -w '%{http_code}' -H "@$HEADERS" "$ACCESS_URL")
      ;;
    add)
      STATUS=$(curl -sS -g -o "$RESPONSE" -w '%{http_code}' -X PUT -H "@$HEADERS" -H 'Content-Length: 0' "$ACCESS_URL/people/$EMAIL_PATH")
      ;;
    remove)
      STATUS=$(curl -sS -g -o "$RESPONSE" -w '%{http_code}' -X DELETE -H "@$HEADERS" "$ACCESS_URL/people/$EMAIL_PATH")
      ;;
    decline)
      STATUS=$(curl -sS -g -o "$RESPONSE" -w '%{http_code}' -X DELETE -H "@$HEADERS" "$ACCESS_URL/requests/$EMAIL_PATH")
      ;;
    link)
      printf '{"linkAccess":"%s"}' "$SHARE_VALUE" > "$BODY"
      STATUS=$(curl -sS -g -o "$RESPONSE" -w '%{http_code}' -X PUT -H "@$HEADERS" -H 'Content-Type: application/json; charset=utf-8' --data-binary "@$BODY" "$ACCESS_URL")
      ;;
  esac
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
  elif [ -n "$PRIVATE" ]; then
    # A private create is its own route, with the same body as a public one. A server without
    # private sharing answers 404 and creates nothing; there is no fallback to a public page.
    # https://github.com/Brevilabs/obsidian-copilot-private/issues/707
    METHOD=POST
    URL="$API_HOST/api/v1/private-docs"
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
# Any 404 from the private route or the access routes means the server cannot do this, and
# nothing was created or changed.
# https://github.com/Brevilabs/obsidian-copilot-private/issues/707
if [ "$STATUS" = 404 ] && [ -n "$PRIVATE" ]; then
  printf '%s\n' "This OpenArtifacts server does not support private documents. Nothing was published." >&2
  exit 1
fi
if [ "$STATUS" = 404 ] && [ "$COMMAND" = share ]; then
  printf '%s\n' "Not found, or this server does not support private documents." >&2
  exit 1
fi
case "$STATUS" in
  2??)
    if [ "$COMMAND" = unshare ]; then
      printf '{"docId":"%s","status":"unshared"}\n' "$DOC_ID"
    elif [ "$COMMAND" = share ] || [ -n "$PRIVATE" ]; then
      # The share page is on the API host, so it is built here rather than taken from the url.
      # One key is appended to the server's JSON; a JSON string never holds a raw newline.
      JSON=$(tr -d '\r\n' < "$RESPONSE")
      NEW_ID=$(printf '%s' "$JSON" | sed -n 's/.*"docId" *: *"\([0-9a-z]*\)".*/\1/p')
      case "$JSON" in
        *\}) [ -z "$NEW_ID" ] || JSON=$(printf '%s' "$JSON" | sed 's/}$//')",\"manageUrl\":\"$API_HOST/share/$NEW_ID\"}" ;;
      esac
      printf '%s\n' "$JSON"
    else
      cat "$RESPONSE"
      printf '\n'
    fi
    # touch, not a redirection: a failed redirection on a special built-in exits a POSIX shell.
    if [ -n "$OFFER_ASKED" ] && grep -q '"guidance"' "$RESPONSE"; then
      { mkdir -p "$(dirname "$OFFER_MARKER")" && touch "$OFFER_MARKER"; } 2>/dev/null || :
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
  [Console]::Error.WriteLine('Usage: ${OPENARTIFACTS_PUBLISH_USAGE}.ps1 publish [--private] <html-file> <title> [docId]')
  [Console]::Error.WriteLine('       ${OPENARTIFACTS_PUBLISH_USAGE}.ps1 unshare <docId>')
  [Console]::Error.WriteLine('       ${OPENARTIFACTS_PUBLISH_USAGE}.ps1 share <docId> [add|remove|decline <email> | link anyone|invited]')
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
$PRIVATE = $false
$SHARE_ACTION = ''
$SHARE_VALUE = ''
if ($COMMAND -eq 'publish' -and $args.Count -ge 2 -and [string]$args[1] -eq '--private') {
  $PRIVATE = $true
  $args = @($args[0]) + @($args | Select-Object -Skip 2)
}
switch ($COMMAND) {
  'publish' {
    if ($args.Count -ne 3 -and $args.Count -ne 4) { Show-Usage }
    if ($PRIVATE -and $args.Count -eq 4) { Show-Usage }
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
  'share' {
    # One change per call: an address added (which also approves its request), removed or
    # declined, or the link setting. Never a whole list.
    # https://github.com/Brevilabs/obsidian-copilot-private/issues/707
    if ($args.Count -lt 2 -or $args.Count -gt 4 -or $args.Count -eq 3) { Show-Usage }
    $DOC_ID = [string]$args[1]
    $SHARE_ACTION = 'list'
    if ($args.Count -eq 4) {
      $SHARE_ACTION = [string]$args[2]
      $SHARE_VALUE = [string]$args[3]
      if ($SHARE_ACTION -cnotin @('add', 'remove', 'decline', 'link')) { Show-Usage }
      if ($SHARE_ACTION -ceq 'link' -and $SHARE_VALUE -cnotin @('anyone', 'invited')) { Show-Usage }
    }
  }
  default { Show-Usage }
}
if ($DOC_ID -and $DOC_ID -notmatch '^[0-9abcdefghjkmnpqrstvwxyz]{16}$') {
  [Console]::Error.WriteLine("Invalid OpenArtifacts document id: $DOC_ID")
  exit 1
}
$EMAIL_PATH = ''
if ($SHARE_ACTION -cin @('add', 'remove', 'decline')) {
  # The address goes into a URL path, so refuse anything that could change the path.
  if (-not $SHARE_VALUE -or $SHARE_VALUE -match '[\s\x00-\x1f\x7f/?#%]') {
    [Console]::Error.WriteLine("Invalid email address: $SHARE_VALUE")
    exit 1
  }
  $EMAIL_PATH = [Uri]::EscapeDataString($SHARE_VALUE)
}

# The server's JSON with the share page appended. The share page is on the API host, so it
# is built here rather than taken from the url. A JSON string never holds a raw newline.
function Add-ManageUrl([string]$Json) {
  $text = $Json.Trim()
  $match = [regex]::Match($text, '"docId"\s*:\s*"([0-9a-z]+)"')
  if ($text.EndsWith('}') -and $match.Success) {
    return $text.Substring(0, $text.Length - 1) + ',"manageUrl":"' + $API_HOST + '/share/' + $match.Groups[1].Value + '"}'
  }
  return $text
}

$headers = @{ Authorization = "Bearer $KEY" }
$WORKSPACE_ROOT = [Environment]::GetEnvironmentVariable('${OPENARTIFACTS_WORKSPACE_ROOT_ENV}')
$OFFER_MARKER = if ($WORKSPACE_ROOT) { Join-Path $WORKSPACE_ROOT '${OPENARTIFACTS_LINK_OFFER_MARKER}' } else { '' }
$OFFER_ASKED = $COMMAND -eq 'publish' -and -not $DOC_ID -and $OFFER_MARKER -and -not (Test-Path -LiteralPath $OFFER_MARKER)
if ($OFFER_ASKED) { $headers['${OPENARTIFACTS_CLIENT_HEADER}'] = '${OPENARTIFACTS_CLIENT_ID}' }
try {
  if ($COMMAND -eq 'share') {
    $accessUri = "$API_HOST/api/v1/docs/$DOC_ID/access"
    $response = switch ($SHARE_ACTION) {
      'add' { Invoke-WebRequest -UseBasicParsing -Method Put -Uri "$accessUri/people/$EMAIL_PATH" -Headers $headers }
      'remove' { Invoke-WebRequest -UseBasicParsing -Method Delete -Uri "$accessUri/people/$EMAIL_PATH" -Headers $headers }
      'decline' { Invoke-WebRequest -UseBasicParsing -Method Delete -Uri "$accessUri/requests/$EMAIL_PATH" -Headers $headers }
      'link' {
        $linkBody = [System.Text.Encoding]::UTF8.GetBytes('{"linkAccess":"' + $SHARE_VALUE + '"}')
        Invoke-WebRequest -UseBasicParsing -Method Put -Uri $accessUri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $linkBody
      }
      default { Invoke-WebRequest -UseBasicParsing -Method Get -Uri $accessUri -Headers $headers }
    }
    [Console]::Out.WriteLine((Add-ManageUrl ([string]$response.Content)))
  } elseif ($COMMAND -eq 'unshare') {
    $null = Invoke-WebRequest -UseBasicParsing -Method Delete -Uri "$API_HOST/api/v1/docs/$DOC_ID" -Headers $headers
    [Console]::Out.WriteLine('{"docId":"' + $DOC_ID + '","status":"unshared"}')
  } else {
    $html = [System.IO.File]::ReadAllText($HTML_FILE, (New-Object System.Text.UTF8Encoding($false)))
    $payload = @{ title = $TITLE; html = $html }
    $body = $payload | ConvertTo-Json -Compress -Depth 2
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $method = if ($DOC_ID) { 'Put' } else { 'Post' }
    # A private create is its own route, with the same body as a public one. A server without
    # private sharing answers 404 and creates nothing; there is no fallback to a public page.
    # https://github.com/Brevilabs/obsidian-copilot-private/issues/707
    $uri = if ($DOC_ID) { "$API_HOST/api/v1/docs/$DOC_ID" } elseif ($PRIVATE) { "$API_HOST/api/v1/private-docs" } else { "$API_HOST/api/v1/docs" }
    $response = Invoke-WebRequest -UseBasicParsing -Method $method -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes
    if ($PRIVATE) {
      [Console]::Out.WriteLine((Add-ManageUrl ([string]$response.Content)))
    } else {
      [Console]::Out.WriteLine([string]$response.Content)
    }
    if ($OFFER_ASKED -and ([string]$response.Content) -match '"guidance"') {
      try {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OFFER_MARKER) -ErrorAction Stop | Out-Null
        New-Item -ItemType File -Force -Path $OFFER_MARKER -ErrorAction Stop | Out-Null
      } catch {}
    }
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
  if ($status -eq 404 -and $PRIVATE) {
    [Console]::Error.WriteLine('This OpenArtifacts server does not support private documents. Nothing was published.')
    exit 1
  }
  if ($status -eq 404 -and $COMMAND -eq 'share') {
    [Console]::Error.WriteLine('Not found, or this server does not support private documents.')
    exit 1
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
  YOUTUBE_TRANSCRIPT,
  FETCH_X,
  OPENARTIFACTS_PUBLISH,
  ...OBSIDIAN_SKILLS,
];

const MIYO_SEARCH_VERSION = 6;
const MIYO_SEARCH_SH_FILE = "miyo-search.sh";
const MIYO_SEARCH_CMD_FILE = "miyo-search.cmd";
const MIYO_PARSE_VERSION = 3;

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
[ -n "$QUERY" ] || die "Usage: sh ${MIYO_SEARCH_SH_FILE} <query>" 1

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
    # Ticked folders go first and the vault last, because a Miyo that searches one
    # folder keeps only the last --folder. No folder name contains "/".
    # https://github.com/logancyang/obsidian-copilot/issues/3508
    set -f
    IFS=/
    set --
    for NAME in \${${MIYO_SEARCH_EXTRA_FOLDERS_ENV}:-}; do
      [ -z "$NAME" ] || set -- "$@" --folder "$NAME"
    done
    unset IFS
    set +f
    OUT=$("$MIYO" search "$QUERY" -n 10 "$@" --folder "$${MIYO_SEARCH_FOLDER_ENV}" --json 2>&1)
    STATUS=$?
    # A ticked folder this Miyo lacks fails the whole search, so retry with the vault alone.
    # https://github.com/logancyang/obsidian-copilot/issues/3508
    if [ "$STATUS" -ne 0 ] && [ $# -gt 0 ]; then
      SKIPPED=$OUT
      OUT=$("$MIYO" search "$QUERY" -n 10 --folder "$${MIYO_SEARCH_FOLDER_ENV}" --json 2>&1)
      STATUS=$?
      [ "$STATUS" -ne 0 ] || printf '%s\n' "Miyo search skipped the extra Miyo folders ticked in Copilot settings and searched only the active vault. Details: $SKIPPED" >&2
    fi
    [ "$STATUS" -eq 0 ] || die "Miyo search could not enforce Current vault scope. Update Miyo, open it, and retry. Do not run an unrestricted search. Details: $OUT" 1
    ;;
  *)
    die "Miyo search received an invalid Search scope. Do not retry or run an unrestricted search." 4
    ;;
esac
printf '%s\\n' "$OUT"
`;

const MIYO_SEARCH_CMD = `@echo off
setlocal enableextensions disabledelayedexpansion
rem Semantic vault search via the local Miyo CLI; prints Miyo's JSON to stdout.
if "%~1"=="" (
  echo Usage: ${MIYO_SEARCH_CMD_FILE} "query" 1>&2
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
rem Copilot quotes the ticked folders, which go before the vault because a Miyo that
rem searches one folder keeps only the last --folder. The agent's words follow --, so
rem they stay query text and cannot add a --folder. A ticked folder this Miyo lacks
rem fails the whole search, so a failure retries with the vault alone.
rem https://github.com/logancyang/obsidian-copilot/issues/3508
"%MIYO%" search -n 10 %${MIYO_SEARCH_EXTRA_FOLDER_ARGS_ENV}% --folder "%${MIYO_SEARCH_FOLDER_ENV}%" --json -- %*
if not errorlevel 1 exit /b 0
if not defined ${MIYO_SEARCH_EXTRA_FOLDER_ARGS_ENV} (
  echo Miyo search could not enforce Current vault scope. Update Miyo, open it, and retry. Do not run an unrestricted search. 1>&2
  exit /b 1
)
"%MIYO%" search -n 10 --folder "%${MIYO_SEARCH_FOLDER_ENV}%" --json -- %*
if errorlevel 1 (
  echo Miyo search could not enforce Current vault scope. Update Miyo, open it, and retry. Do not run an unrestricted search. 1>&2
  exit /b 1
)
echo Miyo search skipped the extra Miyo folders ticked in Copilot settings and searched only the active vault. 1>&2
exit /b 0
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
description: Semantic (meaning-based) search over the user's Obsidian vault via the local Miyo app. Use it for every request that might be answered from the user's notes, alongside grep for exact terms. Needs the Miyo desktop app installed and running.
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

When to use it: for every request that might be answered from the user's
notes, alongside \`grep\`/glob for any exact names, terms, tags or quoted
phrases in the request. Miyo finds notes that match by meaning even when the
wording or title differs; grep finds exact strings.

${howToRunSection({
  shFile: MIYO_SEARCH_SH_FILE,
  cmdFile: MIYO_SEARCH_CMD_FILE,
  argPlaceholder: "<the user's question>",
  extraNote: "Pass the user's full question as the query.",
})}

The script locates the Miyo binary itself — you do not need to know where Miyo
is installed or which shell you are in. Combine its results with your keyword
search results by note path. If Miyo reports that it is unavailable, continue
with keyword search.

Search scope comes from Copilot settings. **Current vault** applies Miyo's exact
folder boundary for the active vault and any other Miyo folders ticked in Copilot
settings, including from Project chats.
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
    { path: MIYO_SEARCH_SH_FILE, content: MIYO_SEARCH_SH },
    { path: MIYO_SEARCH_CMD_FILE, content: MIYO_SEARCH_CMD },
  ],
};

export const MIYO_PARSE_SKILL: BuiltinSkill = {
  name: "miyo-parse",
  version: MIYO_PARSE_VERSION,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: miyo-parse
description: Parse a local PDF or EPUB file into Markdown/text with the local Miyo CLI. Use this for document reading when Miyo document processing is on. The file can be anywhere on the filesystem and does not need to be indexed or copied into the vault.
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

Report the error to the user, then read the file with any other tool you
have. Do not run \`miyo parse\` again on that file.
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
          ...BUILTIN_SKILLS,
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

// The switch defaults on, so it only takes effect while Miyo is connected.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/716
export function isMiyoSearchSkillActive(
  settings: Pick<CopilotSettings, "enableMiyo" | "enableMiyoSearchSkill">
): boolean {
  return settings.enableMiyo === true && settings.enableMiyoSearchSkill === true;
}

export function isBuiltinSkillEnabledFor(
  settings: CopilotSettings,
  skillName: string,
  agentId: string
): boolean {
  const pref = settings.agentMode.skills.builtinPreferences?.[skillName];
  if (pref?.disabled || pref?.disabledAgents?.includes(agentId)) return false;
  return planManagedBuiltins({
    search: isMiyoSearchSkillActive(settings),
    documents: settings.enableMiyoDocumentProcessing,
  }).seed.some((skill) => skill.name === skillName);
}
