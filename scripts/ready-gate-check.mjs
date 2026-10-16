import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const CONTEXT = "ready-gate";
const MARKER = "<!-- ready-gate:v1";
const FALLBACK_TITLE = "Codex (local fallback)";
const BOT_PREFIX = "chatgpt-codex-connector";
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const ATTACHMENT = /^https:\/\/github\.com\/user-attachments\/\S+$/;
const NON_PRODUCTION = [
  /(^|\/)[^/]*\.test\.[^/]*$/,
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /\.md$/,
  /^(docs|designdocs)\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
  /(^|\/)(dist|build)\//,
  /\.map$/,
  /^(main\.js|styles\.css)$/,
];

export function isProductionFile(filename) {
  return !NON_PRODUCTION.some((pattern) => pattern.test(filename));
}

export function isAttachmentUrl(url) {
  return typeof url === "string" && ATTACHMENT.test(url);
}

export function parseGateComment(body) {
  const start = body.indexOf(MARKER);
  const end = start === -1 ? -1 : body.indexOf("-->", start);
  if (end === -1) return { ok: false };
  try {
    const block = JSON.parse(body.slice(start + MARKER.length, end));
    const valid = block?.version === 1 && block.gates && typeof block.gates === "object";
    return valid ? { ok: true, block } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export function codexBaseSha(block) {
  const gates = block.gates;
  return gates.e2e1?.sha || gates.codex?.after_sha || null;
}

export function isSrcChange(filename) {
  return filename.startsWith("src/");
}

function evaluateE2e(gate, facts) {
  if (!gate) return "missing";
  if (gate.status === "fail") return "failed";
  if (gate.status === "na") return gate.na_reason?.trim() ? "ok" : "missing";
  if (gate.status !== "pass") return "missing";
  if (!gate.sha || !Array.isArray(gate.checklist) || gate.checklist.length === 0) return "missing";
  const evidence = gate.checklist.flatMap((item) => item.evidence ?? []);
  const itemsPass = gate.checklist.every(
    (item) => item.status === "pass" && (item.evidence ?? []).length > 0
  );
  const urlsValid = evidence.every(isAttachmentUrl) && (!gate.video || isAttachmentUrl(gate.video));
  if (!itemsPass || !urlsValid) return "missing";
  if (gate.errors_clean === false) return "failed";
  if (gate.sha === facts.headSha) return "ok";
  return facts.srcChangedSince[gate.sha] === false ? "ok" : "stale";
}

function evaluateCodex(gate, facts) {
  if (!gate) return "missing";
  if (gate.status === "fail") return "failed";
  if (gate.status !== "pass") return "missing";
  const qualifying = facts.botReviews.filter((review) => review.atOrAfterBase);
  if (qualifying.length > 0) {
    return facts.botThreads.every((thread) => thread.replied) ? "ok" : "missing";
  }
  if (facts.botThumbsUpAfterBase) return "ok";
  const fallback = facts.fallbackComments
    .filter((comment) => comment.afterBase && comment.body.startsWith(FALLBACK_TITLE))
    .pop();
  const counts = fallback?.body.match(/<!-- codex-fallback:v1 (\{[^}]*\}) -->/);
  if (!counts) return "missing";
  try {
    const { findings, answered } = JSON.parse(counts[1]);
    return Number.isInteger(findings) && answered === findings ? "ok" : "missing";
  } catch {
    return "missing";
  }
}

function evaluateSimplify(gate, facts) {
  if (!gate) return "missing";
  if (gate.status === "fail") return "failed";
  if (gate.status !== "pass" || !gate.review_url || !Array.isArray(gate.commits)) return "missing";
  const nets = gate.commits.map((sha) => facts.simplifyNet[sha]);
  if (nets.some((net) => typeof net !== "number")) return "missing";
  return nets.reduce((sum, net) => sum + net, 0) <= 0 ? "ok" : "missing";
}

export function evaluate(block, facts) {
  const gates = block.gates;
  const results = {
    e2e1: evaluateE2e(gates.e2e1, facts),
    codex: evaluateCodex(gates.codex, facts),
    simplify: evaluateSimplify(gates.simplify, facts),
    e2e2: evaluateE2e(gates.e2e2, facts),
  };
  const names = (kind) => Object.keys(results).filter((gate) => results[gate] === kind);
  const missing = names("missing");
  const stale = names("stale");
  const failed = names("failed");
  const parts = [
    failed.length && `failed: ${failed.join(", ")}`,
    missing.length && `missing: ${missing.join(", ")}`,
    stale.length && `stale: ${stale.join(", ")}`,
  ].filter(Boolean);
  const passed = parts.length === 0;
  let state = "pending";
  if (passed) state = "success";
  else if (failed.length > 0) state = "failure";
  return {
    state,
    description: (passed ? "all gates pass" : parts.join(" · ")).slice(0, 140),
    results,
  };
}

export function verdictWithoutGates(reason) {
  return { state: "pending", description: reason, results: {} };
}

function createApi(token, repo) {
  const request = async (method, path, body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const error = new Error(`${method} ${path} -> ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
  const pages = async (path, pick = (data) => data) => {
    const items = [];
    for (let page = 1; ; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = pick(await request("GET", `${path}${separator}per_page=100&page=${page}`));
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  };
  return { request, pages };
}

async function gatherFacts(api, block, pr, comments) {
  const headSha = pr.head.sha;
  const compareCache = new Map();
  const compare = (base) => {
    if (!compareCache.has(base)) {
      compareCache.set(
        base,
        api.request("GET", `/compare/${base}...${headSha}?per_page=1`).catch(() => null)
      );
    }
    return compareCache.get(base);
  };
  const srcChangedSince = {};
  for (const gate of [block.gates.e2e1, block.gates.e2e2]) {
    const sha = gate?.sha;
    if (!sha || sha === headSha || sha in srcChangedSince) continue;
    const result = await compare(sha);
    if (!result || result.status === "diverged") {
      srcChangedSince[sha] = true;
      continue;
    }
    const files = await api.pages(`/compare/${sha}...${headSha}`, (data) => data.files ?? []);
    srcChangedSince[sha] = files.some((file) => isSrcChange(file.filename));
  }

  const base = codexBaseSha(block);
  const isBot = (user) => user?.login?.startsWith(BOT_PREFIX);
  const reviews = await api.pages(`/pulls/${pr.number}/reviews`);
  const botReviews = [];
  for (const review of reviews.filter((r) => isBot(r.user))) {
    const result = base
      ? await api
          .request("GET", `/compare/${base}...${review.commit_id}?per_page=1`)
          .catch(() => null)
      : null;
    botReviews.push({
      id: review.id,
      atOrAfterBase: result?.status === "ahead" || result?.status === "identical",
    });
  }
  const reviewComments = await api.pages(`/pulls/${pr.number}/comments`);
  const botThreads = reviewComments
    .filter((c) => !c.in_reply_to_id && isBot(c.user))
    .map((root) => ({
      replied: reviewComments.some(
        (c) => c.in_reply_to_id === root.id && c.user.type !== "Bot" && !isBot(c.user)
      ),
    }));

  let baseDate = null;
  if (base) {
    const commit = await api.request("GET", `/commits/${base}`).catch(() => null);
    baseDate = commit ? new Date(commit.commit.committer.date) : null;
  }
  const after = (iso) => baseDate !== null && new Date(iso) > baseDate;
  const reactions = await api.pages(`/issues/${pr.number}/reactions`);
  const botThumbsUpAfterBase = reactions.some(
    (r) => isBot(r.user) && r.content === "+1" && after(r.created_at)
  );
  const fallbackComments = comments
    .filter((c) => TRUSTED_ASSOCIATIONS.has(c.author_association))
    .map((c) => ({ body: c.body, afterBase: after(c.created_at) }));

  const simplifyNet = {};
  const prCommits = new Set((await api.pages(`/pulls/${pr.number}/commits`)).map((c) => c.sha));
  for (const sha of block.gates.simplify?.commits ?? []) {
    if (!prCommits.has(sha)) continue;
    const files = await api.pages(`/commits/${sha}`, (data) => data.files ?? []);
    simplifyNet[sha] = files
      .filter((file) => isProductionFile(file.filename))
      .reduce((sum, file) => sum + file.additions - file.deletions, 0);
  }
  return {
    headSha,
    srcChangedSince,
    botReviews,
    botThreads,
    botThumbsUpAfterBase,
    fallbackComments,
    simplifyNet,
  };
}

export async function check({ api, prNumber }) {
  const pr = await api.request("GET", `/pulls/${prNumber}`);
  const comments = await api.pages(`/issues/${prNumber}/comments`);
  const gateComment = comments
    .filter((c) => TRUSTED_ASSOCIATIONS.has(c.author_association) && c.body.includes(MARKER))
    .pop();
  const targetUrl = gateComment?.html_url;
  if (!gateComment) {
    return { pr, targetUrl, verdict: verdictWithoutGates("ready-gate comment missing") };
  }
  const parsed = parseGateComment(gateComment.body);
  if (!parsed.ok) {
    return { pr, targetUrl, verdict: verdictWithoutGates("ready-gate comment unreadable") };
  }
  const facts = await gatherFacts(api, parsed.block, pr, comments);
  return { pr, targetUrl, verdict: evaluate(parsed.block, facts) };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1];
  };
  const repo = option("--repo", process.env.GITHUB_REPOSITORY);
  const prNumber = option("--pr", process.env.PR_NUMBER);
  const token =
    process.env.GITHUB_TOKEN ||
    (dryRun ? execFileSync("gh", ["auth", "token"]).toString().trim() : "");
  if (!repo || !prNumber || !token) {
    throw new Error("usage: ready-gate-check.mjs --repo OWNER/NAME --pr N [--dry-run]");
  }
  const api = createApi(token, repo);
  const { pr, targetUrl, verdict } = await check({ api, prNumber });
  if (dryRun) {
    console.log(
      JSON.stringify({ pr: Number(prNumber), head: pr.head.sha, targetUrl, ...verdict }, null, 2)
    );
    return;
  }
  try {
    await api.request("POST", `/statuses/${pr.head.sha}`, {
      state: verdict.state,
      context: CONTEXT,
      description: verdict.description,
      ...(targetUrl ? { target_url: targetUrl } : {}),
    });
  } catch (error) {
    if (error.status === 403 && process.env.GITHUB_EVENT_NAME?.startsWith("pull_request_review")) {
      console.log(
        `Skipping ${CONTEXT} status: read-only token on ${process.env.GITHUB_EVENT_NAME}`
      );
      return;
    }
    throw error;
  }
  console.log(`${CONTEXT}: ${verdict.state} (${verdict.description})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
