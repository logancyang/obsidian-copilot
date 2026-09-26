import fs from "node:fs";
import path from "node:path";

describe("vaultSearch import boundary", () => {
  it("keeps the basic vault search independent of BrevilabsClient (https://github.com/Brevilabs/obsidian-copilot-private/issues/515)", () => {
    const directory = path.join(process.cwd(), "src", "vaultSearch");
    const productionFiles = fs
      .readdirSync(directory)
      .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.(test|stories)\./.test(name));

    for (const file of productionFiles) {
      expect(fs.readFileSync(path.join(directory, file), "utf8")).not.toMatch(
        /from ["'][^"']*BrevilabsClient["']/
      );
    }
  });
});
