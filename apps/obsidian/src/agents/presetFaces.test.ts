import {
  findUsedPresetIds,
  loadPresetFaces,
  PRESET_FACES_URL,
  readAgentFaces,
  type PresetFace,
} from "@/agents/presetFaces";
import { createFakeAgentVault } from "@/agents/testing/fakeAgentVault";
import { webpBytes } from "@/agents/testing/webpBytes";
import * as obsidian from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/939";

const setRequestUrlImpl = (
  obsidian as unknown as { __setRequestUrlImpl: (impl: jest.Mock) => void }
).__setRequestUrlImpl;

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

const KAI_URL = "https://images.brevilabs.com/newsletters/copilot-plugin/agent-faces/kai-1a2b.webp";
const NORA_URL =
  "https://images.brevilabs.com/newsletters/copilot-plugin/agent-faces/nora-3c4d.webp";

function serveCdn(files: Record<string, unknown>): jest.Mock {
  const request = jest.fn(async ({ url }: { url: string }) => {
    if (!(url in files)) throw new Error(`Request failed, status 404`);
    const body = files[url];
    return body instanceof ArrayBuffer ? { arrayBuffer: body } : { json: body };
  });
  setRequestUrlImpl(request);
  return request;
}

describe("presetFaces", () => {
  describe("loadPresetFaces()", () => {
    it("downloads the face list from the Brevilabs CDN, then each face's bytes", async () => {
      const request = serveCdn({
        [PRESET_FACES_URL]: {
          faces: [
            { id: "kai", alt: "Smiling face with round glasses", url: KAI_URL },
            { id: "nora", alt: "Face with a peace sign", url: NORA_URL },
          ],
        },
        [KAI_URL]: webpBytes(1, 2),
        [NORA_URL]: webpBytes(3, 4),
      });

      const faces = await loadPresetFaces();

      expect(request.mock.calls.map(([options]: [{ url: string }]) => options.url)).toEqual([
        PRESET_FACES_URL,
        KAI_URL,
        NORA_URL,
      ]);
      expect(faces).toEqual([
        { id: "kai", alt: "Smiling face with round glasses", bytes: webpBytes(1, 2) },
        { id: "nora", alt: "Face with a peace sign", bytes: webpBytes(3, 4) },
      ]);
    });

    it(`leaves out list entries without an id or url and faces that fail to download (${ISSUE})`, async () => {
      serveCdn({
        [PRESET_FACES_URL]: {
          faces: [
            { id: "kai", url: KAI_URL },
            { id: "gone", url: "https://images.brevilabs.com/gone.webp" },
            { alt: "No id", url: NORA_URL },
            null,
          ],
        },
        [KAI_URL]: webpBytes(1),
        [NORA_URL]: webpBytes(2),
      });

      await expect(loadPresetFaces()).resolves.toEqual([
        { id: "kai", alt: "", bytes: webpBytes(1) },
      ]);
    });

    it(`never requests a face listed outside images.brevilabs.com (${ISSUE})`, async () => {
      const elsewhere = "https://example.com/agent-faces/nora.webp";
      const request = serveCdn({
        [PRESET_FACES_URL]: {
          faces: [
            { id: "kai", url: KAI_URL },
            { id: "nora", url: elsewhere },
            { id: "leo", url: "http://images.brevilabs.com/agent-faces/leo.webp" },
          ],
        },
        [KAI_URL]: webpBytes(1),
        [elsewhere]: webpBytes(2),
      });

      const faces = await loadPresetFaces();

      expect(faces.map((face) => face.id)).toEqual(["kai"]);
      expect(request).not.toHaveBeenCalledWith({ url: elsewhere });
    });

    it(`leaves out a face that is not a WebP image or is over 256 KB (${ISSUE})`, async () => {
      const large = new Uint8Array(256 * 1024 + 1);
      large.set(new Uint8Array(webpBytes()));
      serveCdn({
        [PRESET_FACES_URL]: {
          faces: [
            { id: "kai", url: KAI_URL },
            { id: "nora", url: NORA_URL },
            { id: "leo", url: `${KAI_URL}?large` },
          ],
        },
        [KAI_URL]: webpBytes(1),
        [NORA_URL]: new TextEncoder().encode("<html>Not found</html>").buffer,
        [`${KAI_URL}?large`]: large.buffer,
      });

      await expect(loadPresetFaces()).resolves.toEqual([
        { id: "kai", alt: "", bytes: webpBytes(1) },
      ]);
    });

    it(`requests at most 24 faces however long the list is (${ISSUE})`, async () => {
      const urls = Array.from({ length: 30 }, (_, index) => `${KAI_URL}?${index}`);
      const request = serveCdn({
        [PRESET_FACES_URL]: { faces: urls.map((url, index) => ({ id: `face-${index}`, url })) },
        ...Object.fromEntries(urls.map((url) => [url, webpBytes(1)])),
      });

      const faces = await loadPresetFaces();

      expect(faces).toHaveLength(24);
      expect(request).toHaveBeenCalledTimes(25);
    });

    it(`downloads only the list and the first faces when asked for fewer (${ISSUE})`, async () => {
      const request = serveCdn({
        [PRESET_FACES_URL]: {
          faces: [
            { id: "kai", url: KAI_URL },
            { id: "nora", url: NORA_URL },
          ],
        },
        [KAI_URL]: webpBytes(1),
        [NORA_URL]: webpBytes(2),
      });

      const faces = await loadPresetFaces(1);

      expect(faces).toEqual([{ id: "kai", alt: "", bytes: webpBytes(1) }]);
      expect(request.mock.calls.map(([options]: [{ url: string }]) => options.url)).toEqual([
        PRESET_FACES_URL,
        KAI_URL,
      ]);
    });

    it.each([
      ["the list does not answer", {}],
      ["the list holds no faces", { [PRESET_FACES_URL]: { version: 1 } }],
      ["the list is empty", { [PRESET_FACES_URL]: { faces: [] } }],
      ["no face downloads", { [PRESET_FACES_URL]: { faces: [{ id: "kai", url: KAI_URL }] } }],
    ])(`fails when %s (${ISSUE})`, async (_when, files) => {
      serveCdn(files);

      await expect(loadPresetFaces()).rejects.toThrow();
    });
  });

  describe("readAgentFaces()", () => {
    it("reads the face file of every agent that has one", async () => {
      const vault = createFakeAgentVault();
      vault.writeByHand("copilot/teammates/kai/face.webp", bytes(7, 7));

      const faces = await readAgentFaces(vault.app.vault, [
        { facePath: "copilot/teammates/kai/face.webp" },
        { facePath: "copilot/teammates/faceless/face.webp" },
      ]);

      expect(faces).toEqual([bytes(7, 7)]);
    });
  });

  describe("findUsedPresetIds()", () => {
    it(`marks the presets whose bytes equal an agent's face file (${ISSUE})`, () => {
      const presets: PresetFace[] = [
        { id: "kai", alt: "", bytes: bytes(1, 2) },
        { id: "nora", alt: "", bytes: bytes(3, 4) },
        { id: "leo", alt: "", bytes: bytes(5, 6, 7) },
      ];

      const used = findUsedPresetIds(presets, [bytes(3, 4), bytes(5, 6), bytes(9)]);

      expect([...used]).toEqual(["nora"]);
    });
  });
});
