import fs from "fs";
import path from "path";
import type { SessionScript } from "@/agentMode/session/host/sessionScript";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const FILES = fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".script.json"));

const FORBIDDEN: [string, RegExp][] = [
  ["a home or vault path", /\/Users\/|\/home\/|vault-\d+|zeroliu/i],
  ["an API key", /sk-[A-Za-z0-9]/],
  ["an email address", /[\w.+-]+@[\w-]+\.[\w.]+/],
  ["a real model id", /claude-|gpt-|azure|gemini|opus|sonnet|haiku|copilot-plus/i],
];

describe("fixtures", () => {
  it.each(FILES)(
    "%s is a well-formed script that starts with a send and ends with a stop",
    (file) => {
      const script = JSON.parse(
        fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")
      ) as SessionScript;
      expect(["claude", "codex", "opencode"]).toContain(script.backendId);
      expect(script.steps[0].step).toBe("send");
      expect(script.steps.at(-1)?.step).toBe("end");
    }
  );

  it.each(FILES)("%s carries no path, key, address or model id from the recording", (file) => {
    const raw = fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8");
    for (const [label, pattern] of FORBIDDEN) {
      expect({ label, hit: pattern.exec(raw)?.[0] ?? null }).toEqual({ label, hit: null });
    }
  });
});
