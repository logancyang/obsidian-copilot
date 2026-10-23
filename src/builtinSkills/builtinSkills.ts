import type { BuiltinPreferences } from "@/settings/builtinSkillPreferences";
import type { CopilotSettings } from "@/settings/model";
import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";
import { OBSIDIAN_SKILLS } from "./obsidianSkills";
import { howToRunSection } from "./howToRunSection";

export interface BuiltinSkill {
  readonly name: string;
  readonly version: number;
  readonly defaultPreference?: BuiltinPreferences[string];
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
  // Search moved to the miyo_search tool. https://github.com/Brevilabs/obsidian-copilot-private/issues/736
  { name: "miyo-search" },
  // Parsing moved to the miyo_parse tool. https://github.com/Brevilabs/obsidian-copilot-private/issues/740
  { name: "miyo-parse" },
  // Publishing moved to the openartifacts_* tools, so turning a skill off can't leave them on. https://github.com/Brevilabs/obsidian-copilot-private/issues/746
  { name: "openartifacts-publish" },
];

export const PLUS_ENV = {
  licenseKey: "COPILOT_PLUS_LICENSE_KEY",
  baseUrl: "COPILOT_API_BASE_URL",
  userId: "COPILOT_USER_ID",
  clientVersion: "COPILOT_CLIENT_VERSION",
} as const;

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
  defaultPreference?: BuiltinPreferences[string];
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
    defaultPreference: opts.defaultPreference,
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
  defaultPreference: { disabled: true },
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
  defaultPreference: { disabled: true },
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

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  WEB_SEARCH,
  WEB_FETCH,
  YOUTUBE_TRANSCRIPT,
  FETCH_X,
  ...OBSIDIAN_SKILLS,
];

// Default-off is stored as an opt-out because older releases drop every other record,
// which would erase opt-ins synced from newer devices:
// https://github.com/Brevilabs/obsidian-copilot-private/issues/629
export const DEFAULT_BUILTIN_PREFERENCES: BuiltinPreferences = Object.freeze(
  Object.fromEntries(
    BUILTIN_SKILLS.flatMap(({ name, defaultPreference }) =>
      defaultPreference ? [[name, Object.freeze(defaultPreference)] as const] : []
    )
  )
);

// The CLI toggle is per device, so an unavailable skill keeps its synced files and loses only its
// agent links and steering here. https://github.com/Brevilabs/obsidian-copilot-private/issues/726
export function builtinSkillUnavailableReason(skillName: string): string | undefined {
  return skillName === "obsidian-cli" && !isObsidianCliEnabled()
    ? "Turn on Command line interface in Obsidian's Settings → General to use this skill."
    : undefined;
}

export function isBuiltinSkillEnabledFor(
  settings: CopilotSettings,
  skillName: string,
  agentId: string
): boolean {
  const pref = settings.agentMode.skills.builtinPreferences?.[skillName];
  if (pref?.disabled || pref?.disabledAgents?.includes(agentId)) return false;
  return BUILTIN_SKILLS.some((skill) => skill.name === skillName);
}
