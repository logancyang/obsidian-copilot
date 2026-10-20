import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { check, evaluate, isProductionFile, parseGateComment } from "./ready-gate-check.mjs";

const HEAD = "head000";
const E2E1_SHA = "sha1111";
const URL = "https://github.com/user-attachments/assets/aaaa-bbbb";

const e2eGate = (sha, overrides = {}) => ({
  status: "pass",
  sha,
  na_reason: null,
  checklist: [{ step: "Open chat", expected: "Chat renders", status: "pass", evidence: [URL] }],
  errors_clean: true,
  video: null,
  ...overrides,
});

const greenBlock = () => ({
  version: 1,
  head: HEAD,
  gates: {
    e2e1: e2eGate(E2E1_SHA),
    codex: { status: "pass", source: "bot", after_sha: E2E1_SHA },
    simplify: { status: "pass", sha: HEAD, commits: ["simp111"], review_url: "https://x/y" },
    e2e2: e2eGate(HEAD),
  },
});

const greenFacts = () => ({
  headSha: HEAD,
  srcChangedSince: { [E2E1_SHA]: false },
  botReviews: [{ id: 1, atOrAfterBase: true }],
  botThreads: [{ replied: true }],
  botThumbsUpAfterBase: false,
  fallbackComments: [],
  simplifyNet: { simp111: -4 },
});

const fallbackComment = (findings, answered) => ({
  afterBase: true,
  body: `Codex (local fallback)\n\n<!-- codex-fallback:v1 {"findings":${findings},"answered":${answered}} -->`,
});

const asComment = (body, extra = {}) => ({
  body,
  html_url: "https://github.com/o/r/pull/1#issuecomment-1",
  author_association: "MEMBER",
  created_at: "2026-01-02T00:00:00Z",
  ...extra,
});

function fakeApi(comments) {
  return {
    request: async (method, path) => {
      if (path === "/pulls/1") return { number: 1, head: { sha: HEAD } };
      throw new Error(`unexpected request ${method} ${path}`);
    },
    pages: async (path) => {
      if (path === "/issues/1/comments") return comments;
      throw new Error(`unexpected pages ${path}`);
    },
  };
}

describe("ready-gate-check", () => {
  describe("evaluate()", () => {
    it("reports success when all four gates verify", () => {
      const verdict = evaluate(greenBlock(), greenFacts());
      assert.equal(verdict.state, "success");
      assert.equal(verdict.description, "all gates pass");
    });

    it("stays pending and names a stale e2e1 gate", () => {
      const verdict = evaluate(greenBlock(), {
        ...greenFacts(),
        srcChangedSince: { [E2E1_SHA]: true },
      });
      assert.equal(verdict.state, "pending");
      assert.equal(verdict.description, "stale: e2e1");
    });

    it("keeps e2e2 valid when it is behind HEAD but only non-src files changed", () => {
      const block = greenBlock();
      block.gates.e2e2 = e2eGate("old2222");
      const verdict = evaluate(block, {
        ...greenFacts(),
        srcChangedSince: { [E2E1_SHA]: false, old2222: false },
      });
      assert.equal(verdict.state, "success");
    });

    it("lists missing codex and stale e2e1 in the description", () => {
      const block = greenBlock();
      block.gates.codex = { status: "pending" };
      const verdict = evaluate(block, { ...greenFacts(), srcChangedSince: { [E2E1_SHA]: true } });
      assert.equal(verdict.state, "pending");
      assert.equal(verdict.description, "missing: codex · stale: e2e1");
    });

    it("fails only when a gate records a failure", () => {
      const block = greenBlock();
      block.gates.e2e2 = e2eGate(HEAD, { status: "fail" });
      const verdict = evaluate(block, greenFacts());
      assert.equal(verdict.state, "failure");
      assert.match(verdict.description, /^failed: e2e2/);
    });

    it("rejects a bot review whose thread has no human reply", () => {
      const verdict = evaluate(greenBlock(), {
        ...greenFacts(),
        botThreads: [{ replied: true }, { replied: false }],
      });
      assert.equal(verdict.results.codex, "missing");
    });

    it("ignores bot reviews older than the e2e1 sha", () => {
      const verdict = evaluate(greenBlock(), {
        ...greenFacts(),
        botReviews: [{ id: 1, atOrAfterBase: false }],
      });
      assert.equal(verdict.results.codex, "missing");
    });

    it("accepts a bot thumbs-up after e2e1 when there is no qualifying review", () => {
      const verdict = evaluate(greenBlock(), {
        ...greenFacts(),
        botReviews: [],
        botThreads: [],
        botThumbsUpAfterBase: true,
      });
      assert.equal(verdict.results.codex, "ok");
    });

    it("accepts a local fallback comment whose findings are all answered", () => {
      const block = greenBlock();
      block.gates.codex.source = "local-fallback";
      const verdict = evaluate(block, {
        ...greenFacts(),
        botReviews: [],
        botThreads: [],
        fallbackComments: [fallbackComment(3, 3)],
      });
      assert.equal(verdict.state, "success");
    });

    it("rejects a local fallback comment with unanswered findings", () => {
      const verdict = evaluate(greenBlock(), {
        ...greenFacts(),
        botReviews: [],
        botThreads: [],
        fallbackComments: [fallbackComment(3, 2)],
      });
      assert.equal(verdict.results.codex, "missing");
    });

    it("rejects a simplify gate whose commits add production lines", () => {
      const verdict = evaluate(greenBlock(), {
        ...greenFacts(),
        simplifyNet: { simp111: 5 },
      });
      assert.equal(verdict.results.simplify, "missing");
    });

    it("rejects a simplify commit that is not part of the PR", () => {
      const verdict = evaluate(greenBlock(), { ...greenFacts(), simplifyNet: {} });
      assert.equal(verdict.results.simplify, "missing");
    });

    it("rejects an na e2e gate without a reason", () => {
      const block = greenBlock();
      block.gates.e2e2 = { status: "na", sha: HEAD, na_reason: "  ", checklist: [] };
      assert.equal(evaluate(block, greenFacts()).results.e2e2, "missing");
    });

    it("accepts an na e2e gate with a reason", () => {
      const block = greenBlock();
      block.gates.e2e2 = { status: "na", na_reason: "no user-visible surface: docs only" };
      assert.equal(evaluate(block, greenFacts()).results.e2e2, "ok");
    });

    it("rejects evidence that is not a GitHub attachment URL", () => {
      const block = greenBlock();
      block.gates.e2e2 = e2eGate(HEAD, {
        checklist: [
          { step: "s", expected: "e", status: "pass", evidence: ["https://example.com/a.png"] },
        ],
      });
      assert.equal(evaluate(block, greenFacts()).results.e2e2, "missing");
    });

    it("truncates the description to 140 characters", () => {
      const verdict = evaluate({ gates: {} }, greenFacts());
      assert.ok(verdict.description.length <= 140);
    });
  });

  describe("parseGateComment()", () => {
    it("parses the hidden JSON block", () => {
      const body = `## Ready gate\n\n<!-- ready-gate:v1\n${JSON.stringify(greenBlock())}\n-->`;
      assert.equal(parseGateComment(body).ok, true);
    });

    it("reports malformed JSON as unreadable", () => {
      assert.equal(parseGateComment("<!-- ready-gate:v1\n{oops\n-->").ok, false);
    });
  });

  describe("isProductionFile()", () => {
    it("excludes tests, docs, lockfiles and generated output", () => {
      for (const file of [
        "src/a.test.ts",
        "src/__tests__/a.ts",
        "src/__mocks__/a.ts",
        "README.md",
        "docs/a.mdx",
        "designdocs/a.txt",
        "package-lock.json",
        "main.js",
        "dist/x.js",
      ]) {
        assert.equal(isProductionFile(file), false, file);
      }
    });

    it("includes source files", () => {
      assert.equal(isProductionFile("src/main.ts"), true);
    });
  });

  describe("check()", () => {
    it("stays pending when no ready-gate comment exists", async () => {
      const { verdict } = await check({ api: fakeApi([asComment("hello")]), prNumber: 1 });
      assert.equal(verdict.state, "pending");
      assert.equal(verdict.description, "ready-gate comment missing");
    });

    it("stays pending when the latest comment has malformed JSON", async () => {
      const comments = [asComment("<!-- ready-gate:v1\n{oops\n-->")];
      const { verdict, targetUrl } = await check({ api: fakeApi(comments), prNumber: 1 });
      assert.equal(verdict.description, "ready-gate comment unreadable");
      assert.equal(targetUrl, comments[0].html_url);
    });

    it("ignores marker comments from untrusted authors", async () => {
      const comments = [asComment("<!-- ready-gate:v1\n{}\n-->", { author_association: "NONE" })];
      const { verdict } = await check({ api: fakeApi(comments), prNumber: 1 });
      assert.equal(verdict.description, "ready-gate comment missing");
    });
  });
});
