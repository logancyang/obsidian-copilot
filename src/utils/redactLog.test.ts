import { redactLogText } from "@/utils/redactLog";

describe("redactLog", () => {
  describe("redactLogText()", () => {
    it("replaces a home-directory username in a Unix path but keeps the path shape", () => {
      expect(redactLogText('{"file":"/Users/chaoyang/vault/note.md"}')).toBe(
        '{"file":"/Users/<user>/vault/note.md"}'
      );
      expect(redactLogText("/home/logan/.config/app")).toBe("/home/<user>/.config/app");
    });

    it("replaces a Windows home-directory username", () => {
      expect(redactLogText("C:\\Users\\Logan\\AppData")).toBe("C:\\Users\\<user>\\AppData");
    });

    it("replaces email addresses", () => {
      expect(redactLogText("from logan@brevilabs.com to a@b.co")).toBe("from <email> to <email>");
    });

    it("stays fast on a long run of address-legal characters instead of backtracking over it (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      // A pasted token or a minified log line is one unbroken run; unanchored,
      // this took tens of seconds and froze the renderer.
      const started = Date.now();
      expect(redactLogText("A".repeat(256 * 1024))).toBe("A".repeat(256 * 1024));
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it("replaces an over-long address whole, leaving no part of it behind (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      // The speed fix above must not be bought by capping the parts: a capped
      // quantifier matches only the tail that fits and leaves the overflow in
      // the report as plain text, which is the address this pass exists to
      // remove.
      expect(redactLogText(`${"a".repeat(500)}@example.com`)).toBe("<email>");
      expect(redactLogText(`user@example.${"z".repeat(40)}`)).toBe("<email>");
    });

    it("replaces addresses chained by an address-legal character, not just the first (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      // Two addresses with no ordinary separator are one run, and the run goes
      // whole. Matching per-address instead left the second one in the report,
      // because every position inside the chain has an address character behind
      // it. Every character the local part accepts can glue such a chain, so all
      // of them are listed rather than sampled.
      for (const glue of [".", "-", "+", "_", "%"]) {
        expect(redactLogText(`a@b.com${glue}c@d.com`)).toBe("<email>");
      }
      expect(redactLogText("a@b.com.c@d.com.e@f.com")).toBe("<email>");
      // Separated normally, they stay two addresses and both go.
      expect(redactLogText("a@b.com, c@d.com")).toBe("<email>, <email>");
    });

    it("replaces an address that opens with @, as a fediverse handle does (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      // `@user@host.tld` is a real identity format, and the leading `@` must not
      // be read as "this run has no local part".
      expect(redactLogText("ping @alice@mastodon.social now")).toBe("ping <email> now");
      expect(redactLogText("@@foo@bar.com")).toBe("<email>");
    });

    it("keeps punctuation that follows an address instead of swallowing it (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      // The run a redaction is chosen from extends past the address into the
      // sentence's full stop, which belongs to the prose, not the address.
      expect(redactLogText("write to a@b.com.")).toBe("write to <email>.");
    });

    it("leaves address-shaped text that is not an address alone, so the log stays diagnostic (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      expect(redactLogText("package@1.0.0-beta")).toBe("package@1.0.0-beta");
      expect(redactLogText("a@b")).toBe("a@b");
      expect(redactLogText("@scope")).toBe("@scope");
      expect(redactLogText("@@@@")).toBe("@@@@");
    });

    it("replaces a run holding a valid address even when it ends in an invalid one (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      // Judging the run by its LAST dot alone let the single-letter ending here
      // rule the whole run out, leaving the valid `a@b.com` in front of it in
      // the report. Any dot with two or more letters after it settles it.
      expect(redactLogText("a@b.com@c.d")).toBe("<email>");
      expect(redactLogText("a@b.com@c.d@e.f")).toBe("<email>");
    });

    it("stays fast on a long run that ends just past its trailing punctuation (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      // The tail is walked back from the end rather than matched with a `…$`
      // regex: that regex is anchored only at its end, so a run whose final
      // character is not punctuation makes it retry from every interior
      // position — 4.2 s at this length.
      const started = Date.now();
      const run = `a@${".".repeat(100_000)}a`;
      expect(redactLogText(run)).toBe(run);
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it("replaces provider API keys by their recognizable prefix", () => {
      expect(redactLogText("key sk-ant-abcdef0123456789xyz")).toBe("key <secret>");
      expect(redactLogText("AIzaSyD1234567890abcdefghijk")).toBe("<secret>");
      expect(redactLogText("token ghp_0123456789abcdefghij0")).toBe("token <secret>");
    });

    it("removes a bearer token, whether or not it follows an Authorization field", () => {
      // Bare bearer: the scheme word stays, the token becomes a marker.
      expect(redactLogText("using bearer abcdef0123456789 now")).toBe("using bearer <token> now");
      // In an Authorization header both rules fire; either way the token is gone.
      const header = redactLogText("Authorization: Bearer abcdef0123456789");
      expect(header).not.toContain("abcdef0123456789");
      expect(header).toContain("<token>");
    });

    it("removes a Basic credential, which carries a password in plain base64 (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      // `Basic` is five characters, so the field rule's own value pattern never
      // reaches it — and what follows decodes straight back to `user:password`.
      // A report's description is prefilled into a public GitHub issue before
      // the user has reviewed anything, so a pasted header goes out as typed.
      const header = redactLogText("Authorization: Basic dXNlcjpwYXNzd29yZA==");
      expect(header).not.toContain("dXNlcjpwYXNzd29yZA");
      expect(header).toContain("<redacted>");
      // The shape a pasted curl brings it in as.
      const curl = redactLogText("-H 'Authorization: Basic YWRtaW46czNjcmV0'");
      expect(curl).not.toContain("YWRtaW46czNjcmV0");
      expect(curl).toContain("<redacted>");
      // The spelling the frame log actually holds: it stores SDK and ACP
      // payloads as NDJSON, so headers arrive quoted rather than as raw lines.
      const json = redactLogText('"authorization": "Basic YWRtaW46czNjcmV0"');
      expect(json).not.toContain("YWRtaW46czNjcmV0");
      expect(json).toContain("<redacted>");
      // Anchored to the header name: prose using the word keeps its next word,
      // which an unanchored rule would take and leave the log less diagnostic.
      expect(redactLogText("the basic principle applies")).toBe("the basic principle applies");
      // Four characters, and `u:p` once decoded. The header name and scheme
      // have already established what this is, so there is no length left to
      // qualify it by.
      expect(redactLogText("Authorization: Basic dTpw")).toBe("Authorization: Basic <redacted>");
      // An empty credential ends at its own line. A rule that stepped over the
      // newline would claim the next line's field name as its credential, and
      // the field rule below — which never sees the name it needs — would then
      // leave that field's value in the clear.
      expect(redactLogText("Authorization: Basic \npassword=hunter2000")).toBe(
        "Authorization: Basic \npassword=<redacted>"
      );
    });

    it("redacts a credential too long for a counted quantifier to walk (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      // A log can hold one unbroken multi-megabyte run, and V8 exhausts the
      // regexp stack walking `{n,}` over it — a throw here would take down the
      // whole report, not just this line.
      const huge = `Authorization: Basic ${"A".repeat(16 * 1024 * 1024)}`;

      expect(redactLogText(huge)).toBe("Authorization: Basic <redacted>");
    });

    it("removes AWS secret and session values, whose field names the key/secret rule misses (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", () => {
      expect(redactLogText("aws_secret_access_key=0123456789abcdefghijklmnopqrstuv")).toBe(
        "aws_secret_access_key=<redacted>"
      );
      // Screamed by the convention every AWS credentials file and shell export
      // uses, so the match cannot be case-sensitive.
      expect(redactLogText("AWS_SECRET_ACCESS_KEY=0123456789abcdefghijklmnopqrstuv")).toBe(
        "AWS_SECRET_ACCESS_KEY=<redacted>"
      );
      expect(redactLogText("aws_session_token=FwoGZXIvYXdzEB0aDLexample")).toBe(
        "aws_session_token=<redacted>"
      );
    });

    it("replaces the value of a key/secret/password field in JSON or key=value form", () => {
      expect(redactLogText('"api_key": "s3cr3tvalue123"')).toBe('"api_key": "<redacted>"');
      expect(redactLogText("password=hunter2secret")).toBe("password=<redacted>");
    });

    it("leaves text without private data unchanged", () => {
      const clean = "agent started, 3 tools available, elapsed 42ms";
      expect(redactLogText(clean)).toBe(clean);
    });

    it("is idempotent — re-redacting already-redacted text is a no-op", () => {
      const once = redactLogText("/Users/chaoyang/x and sk-abcdef0123456789");
      expect(redactLogText(once)).toBe(once);
    });
  });
});
