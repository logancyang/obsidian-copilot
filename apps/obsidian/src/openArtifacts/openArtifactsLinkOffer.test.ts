import { isLinkOfferPending, markLinkOfferShown } from "@/openArtifacts/openArtifactsLinkOffer";
import { ensureFolderExists } from "@/utils";
import type { Vault } from "obsidian";

jest.mock("@/utils", () => ({ ensureFolderExists: jest.fn() }));

const MARKER = ".openartifacts/link-offer-shown";

describe("openArtifactsLinkOffer", () => {
  const exists = jest.fn();
  const write = jest.fn();
  const vault = { adapter: { exists, write } } as unknown as Vault;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(ensureFolderExists).mockResolvedValue(undefined);
    write.mockResolvedValue(undefined);
  });

  describe("isLinkOfferPending()", () => {
    it("is pending while the marker file does not exist", async () => {
      exists.mockResolvedValue(false);

      await expect(isLinkOfferPending(vault)).resolves.toBe(true);
      expect(exists).toHaveBeenCalledWith(MARKER);
    });

    it("is not pending once the marker file exists", async () => {
      exists.mockResolvedValue(true);

      await expect(isLinkOfferPending(vault)).resolves.toBe(false);
    });

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 is not pending when the vault cannot be read", async () => {
      exists.mockRejectedValue(new Error("vault unavailable"));

      await expect(isLinkOfferPending(vault)).resolves.toBe(false);
    });
  });

  describe("markLinkOfferShown()", () => {
    it("creates the folder and writes an empty marker file", async () => {
      await markLinkOfferShown(vault);

      expect(ensureFolderExists).toHaveBeenCalledWith(vault, ".openartifacts");
      expect(write).toHaveBeenCalledWith(MARKER, "");
    });

    it("https://github.com/Brevilabs/OpenArtifacts/issues/94 still writes when the hidden folder already exists but cannot be listed", async () => {
      jest.mocked(ensureFolderExists).mockRejectedValue(new Error("EEXIST"));
      exists.mockResolvedValue(true);

      await markLinkOfferShown(vault);

      expect(write).toHaveBeenCalledWith(MARKER, "");
    });

    it("fails when the folder can be neither created nor found", async () => {
      jest.mocked(ensureFolderExists).mockRejectedValue(new Error("read-only"));
      exists.mockResolvedValue(false);

      await expect(markLinkOfferShown(vault)).rejects.toThrow("read-only");
      expect(write).not.toHaveBeenCalled();
    });
  });
});
