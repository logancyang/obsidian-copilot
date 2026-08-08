import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { App } from "obsidian";
import { clearProjectMarkers } from "./projectMarkerCleanup";
import { markersDir } from "./conversionsLocation";

jest.mock("./conversionsLocation", () => ({ markersDir: jest.fn() }));

const mockedMarkersDir = markersDir as jest.MockedFunction<typeof markersDir>;
const app = {} as App;

describe("clearProjectMarkers", () => {
  let root: string;

  beforeEach(async () => {
    // A stand-in cache root with two project marker buckets and a shared snapshot.
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

  it("removes only the target project's bucket, leaving siblings and snapshots", async () => {
    mockedMarkersDir.mockReturnValue(path.join(root, "markers", "projA"));

    await clearProjectMarkers(app, "project-a");

    expect(fs.existsSync(path.join(root, "markers", "projA"))).toBe(false);
    // A sibling project's markers and the shared snapshot cache must survive.
    expect(fs.existsSync(path.join(root, "markers", "projB", "failed-web-2.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "remotes", "web-1.md"))).toBe(true);
  });

  it("is a no-op for a blank project id (never resolves a bucket path)", async () => {
    await clearProjectMarkers(app, "   ");
    expect(mockedMarkersDir).not.toHaveBeenCalled();
  });
});
