import fs from "fs";
import path from "path";
import type { SessionScript } from "@/agentMode/session/host/sessionScript";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const FILES = fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".script.json"));

const STRUCTURAL_KEYS = new Set([
  "sessionUpdate",
  "type",
  "kind",
  "status",
  "priority",
  "stopReason",
  "toolKind",
  "optionId",
  "vendorToolName",
]);
const USER_CONTENT_KEYS = new Set(["rawInput", "input", "rawOutput", "updatedInput", "answers"]);
const ENUM_SHAPED = /^[A-Za-z][A-Za-z0-9_]*$/;

const FORBIDDEN: [string, RegExp][] = [
  ["a home directory path", /\/Users\/|\/home\/|[A-Za-z]:\\/],
  ["an API key", /sk-[A-Za-z0-9]/],
  ["an email address", /[\w.+-]+@[\w-]+\.[\w.]+/],
  ["a real model id", /claude-|gpt-|azure|gemini|opus|sonnet|haiku/i],
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

  it.each(FILES)("%s keeps recorded text out of structural fields and tool input", (file) => {
    const script = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8"));
    const leaks: string[] = [];
    const walk = (value: unknown, key: string, inUserContent: boolean): void => {
      if (typeof value === "string") {
        if (STRUCTURAL_KEYS.has(key) && (inUserContent || !ENUM_SHAPED.test(value)))
          leaks.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) walk(item, key, inUserContent);
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          walk(v, k, inUserContent || USER_CONTENT_KEYS.has(k));
        }
      }
    };
    walk(script, "", false);
    expect(leaks).toEqual([]);
  });

  it.each(FILES)("%s carries no path, key, address or model id from the recording", (file) => {
    const raw = fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8");
    for (const [label, pattern] of FORBIDDEN) {
      expect({ label, hit: pattern.exec(raw)?.[0] ?? null }).toEqual({ label, hit: null });
    }
  });
});
