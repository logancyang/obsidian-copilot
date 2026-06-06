import * as path from "node:path";
import { COPILOT_APP_DIR_NAME, copilotAppDataDir } from "./appPaths";

describe("copilotAppDataDir", () => {
  it("is ~/.obsidian-copilot under the given home dir", () => {
    expect(copilotAppDataDir("/Users/me")).toBe(path.join("/Users/me", ".obsidian-copilot"));
  });

  it("uses the dotted, obsidian-prefixed namespace (not ~/.copilot)", () => {
    expect(COPILOT_APP_DIR_NAME).toBe(".obsidian-copilot");
    // Guard against a regression to the GitHub-Copilot-CLI-colliding name.
    expect(COPILOT_APP_DIR_NAME).not.toBe(".copilot");
  });
});
