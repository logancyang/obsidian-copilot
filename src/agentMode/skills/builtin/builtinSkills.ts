import type { BackendId } from "@/agentMode/session/types";

/**
 * Plugin-shipped ("builtin") Agent Mode skills that wrap Copilot Plus relay
 * capabilities (web search, PDF, YouTube, X). Unlike user-authored skills,
 * these are seeded into the canonical skills folder by the plugin (see
 * `seedBuiltinSkills`) and refreshed when `version` bumps.
 *
 * Each skill ships a `SKILL.md` (instructions the agent reads) plus one
 * Node `.mjs` script the agent runs. The script reads the Copilot Plus
 * license + relay base URL from env vars the plugin injects at spawn time
 * (see `buildCopilotPlusEnv`) and calls the Brevilabs relay directly — no
 * key is embedded in the skill files. A missing/invalid license makes the
 * script exit non-zero with an upgrade prompt the agent relays to the user.
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

/**
 * Shared preamble every script uses: resolves env, and exits with the
 * upgrade prompt when the license/relay config is absent. Kept inline in
 * each `.mjs` (scripts can't share an import once symlinked into agent dirs).
 */
function scriptPreamble(): string {
  return `const BASE = process.env.${PLUS_ENV.baseUrl};
const KEY = process.env.${PLUS_ENV.licenseKey};
const USER_ID = process.env.${PLUS_ENV.userId} ?? "";
const CLIENT_VERSION = process.env.${PLUS_ENV.clientVersion} ?? "";
const UPGRADE = ${JSON.stringify(UPGRADE_MESSAGE)};
function die(msg, code = 2) {
  process.stderr.write(msg + "\\n");
  process.exit(code);
}
if (!KEY || !BASE) die(UPGRADE);

async function relay(endpoint, body) {
  let res;
  try {
    res = await fetch(BASE + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + KEY,
        "X-Client-Version": CLIENT_VERSION,
      },
      body: JSON.stringify({ ...body, user_id: USER_ID }),
    });
  } catch (e) {
    die("Could not reach the Copilot relay: " + (e && e.message ? e.message : String(e)), 1);
  }
  if (res.status === 401 || res.status === 403) die(UPGRADE);
  if (!res.ok) die("Request failed (HTTP " + res.status + "): " + (await res.text()), 1);
  return res.json();
}

function emit(data) {
  process.stdout.write(typeof data === "string" ? data : JSON.stringify(data, null, 2));
  process.stdout.write("\\n");
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
  return {
    name: opts.name,
    version: 1,
    enabledAgents: ["claude", "codex", "opencode"],
    skillMd: `---
name: ${opts.name}
description: ${opts.description}
license: Copilot Plus
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "1"
---

# ${opts.heading}

${opts.intro}

## How to run

Find the absolute path to this SKILL.md file on disk, then run the script that
sits next to it:

\`\`\`bash
node "/absolute/path/to/this/skill/directory/${opts.scriptFile}" "${argPlaceholder}"
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
const arg = process.argv.slice(2).join(" ").trim();
if (!arg) die("Usage: node ${opts.scriptFile} <${argKey}>", 1);
emit(await relay("${opts.endpoint}", { ${argKey}: arg }));
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
  scriptFile: "web-search.mjs",
});

const READ_PDF: BuiltinSkill = {
  name: "copilot-read-pdf",
  version: 2,
  enabledAgents: ["claude", "codex", "opencode"],
  skillMd: `---
name: copilot-read-pdf
description: Extract the full text of a PDF as Markdown using Copilot Plus. Use when the user wants to read, summarize, or quote a PDF file (in the vault or an absolute path). Requires an active Copilot Plus license.
license: Copilot Plus
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "2"
---

# Copilot read PDF

Convert a PDF file to Markdown text through Copilot Plus so you can read,
summarize, or quote it.

## How to run

Find the absolute path to this SKILL.md file on disk, then run the script that
sits next to it:

\`\`\`bash
node "/absolute/path/to/this/skill/directory/read-pdf.mjs" "<path-to-file.pdf>"
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
      path: "read-pdf.mjs",
      content: `${scriptPreamble()}
import { readFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) die("Usage: node read-pdf.mjs <path-to-file.pdf>", 1);

let bytes;
try {
  bytes = await readFile(file);
} catch (e) {
  die("Could not read file '" + file + "': " + (e && e.message ? e.message : String(e)), 1);
}

// Mirror brevilabsClient.ts pdf4llm: JSON body with base64-encoded pdf field.
const pdf = Buffer.from(bytes).toString("base64");
emit(await relay("/pdf4llm", { pdf }));
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
  scriptFile: "youtube-transcript.mjs",
});

const FETCH_X = relaySkill({
  name: "copilot-fetch-x",
  description:
    "Fetch the content of an X (Twitter) post using Copilot Plus. Use when the user shares an x.com or twitter.com URL and wants its text or context. Requires an active Copilot Plus license.",
  heading: "Copilot fetch X",
  intro: "Fetch the content of an X (Twitter) post through Copilot Plus.",
  endpoint: "/twitter4llm",
  arg: ["url", "<x-or-twitter-url>"],
  scriptFile: "fetch-x.mjs",
});

/** All plugin-shipped builtin skills, in display order. */
export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  WEB_SEARCH,
  READ_PDF,
  YOUTUBE_TRANSCRIPT,
  FETCH_X,
];
