import { formatUsageCapError } from "@/utils/usageCapError";

describe("formatUsageCapError", () => {
  const DASH = "https://www.obsidiancopilot.com/en/dashboard/token-usage";

  it("returns null for non-cap errors", () => {
    expect(formatUsageCapError(null)).toBeNull();
    expect(formatUsageCapError(new Error("boom"))).toBeNull();
    expect(formatUsageCapError({ detail: { error: { type: "rate_limit_error" } } })).toBeNull();
    expect(formatUsageCapError("just a string")).toBeNull();
  });

  it("detects the relay 429 shape (detail.error.type) and links the dashboard", () => {
    const err = {
      status: 429,
      detail: {
        error: {
          type: "token_limit_error",
          message: "5-hour usage cap reached. ...",
          dashboard_url: DASH,
          credits_hint: "purchase credits ...",
        },
      },
    };
    const msg = formatUsageCapError(err);
    expect(msg).toContain("usage cap");
    expect(msg).toContain("purchase credits");
    expect(msg).toContain(DASH); // bare URL (plain text, renders in ErrorBlock)
    expect(msg).not.toContain("]("); // not Markdown link syntax
  });

  it("detects a cap error nested under other transport wrappers", () => {
    const err = { error: { error: { error: { dashboard_url: DASH } } } };
    expect(formatUsageCapError(err)).toContain(DASH);
  });

  it("detects via credits_hint alone and falls back to the default dashboard URL", () => {
    const err = { response: { data: { error: { credits_hint: "Enable credits ..." } } } };
    const msg = formatUsageCapError(err);
    expect(msg).toContain(DASH); // fallback when no dashboard_url present
  });

  it("is cycle-safe (does not infinitely recurse on circular errors)", () => {
    const a: Record<string, unknown> = { type: "other" };
    a.self = a;
    expect(formatUsageCapError(a)).toBeNull();
  });
});
