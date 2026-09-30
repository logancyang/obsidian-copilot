import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { App } from "obsidian";
import { clearProjectMarkers } from "./projectMarkerCleanup";
import { markersDir } from "./conversionsLocation";

jest.mock("./conversionsLocation", () => ({ markersDir: jest.fn() }));

const mockedMarkersDir = markersDir as jest.MockedFunction<typeof markersDir>;
const app = {} as App;

describe("projectMarkerCleanup", () => {
  describe("clearProjectMarkers()", () => {
    let root: string;

    beforeEach(async () => {
      root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "marker-cleanup-"));
      await fs.promises.mkdir(path.join(root, "markers", "projA"), { recursive: true });
      await fs.promises.mkdir(path.join(root, "markers", "projB"), { recursive: true });
      await fs.promises.mkdir(path.join(root, "remotes"), { recursive: true });
      await fs.promises.writeFile(path.join(root, "markers", "projA", "failed-web-1.json"), "{}");
      await fs.promises.writeFile(path.join(root, "markers", "projB", "failed-web-2.json"), "{}");
      await fs.promises.writeFile(path.join(root, "remotes", "web-1.md"), "snapshot");
    });

    afterEach(async () => {
      await fs.promises.rm(root, { recursive: true, force: true });
      mockedMarkersDir.mockReset();
    });

    it("removes the target project's marker bucket and leaves other projects' markers and snapshots", async () => {
      mockedMarkersDir.mockReturnValue(path.join(root, "markers", "projA"));

      await clearProjectMarkers(app, "project-a");

      expect(fs.existsSync(path.join(root, "markers", "projA"))).toBe(false);
      expect(fs.existsSync(path.join(root, "markers", "projB", "failed-web-2.json"))).toBe(true);
      expect(fs.existsSync(path.join(root, "remotes", "web-1.md"))).toBe(true);
    });

    it("does nothing for a blank project id", async () => {
      await clearProjectMarkers(app, "   ");
      expect(mockedMarkersDir).not.toHaveBeenCalled();
    });
  });
});
