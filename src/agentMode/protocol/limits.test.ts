import {
  checkImageLimits,
  decodedBase64Bytes,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_BYTES_PER_COMMAND,
} from "@/agentMode/protocol/limits";

describe("limits", () => {
  describe("decodedBase64Bytes()", () => {
    it("counts decoded bytes for unpadded input", () => {
      expect(decodedBase64Bytes("QUJD")).toBe(3);
    });

    it("subtracts one byte per padding character", () => {
      expect(decodedBase64Bytes("QUI=")).toBe(2);
      expect(decodedBase64Bytes("QQ==")).toBe(1);
    });

    it("returns zero for empty input", () => {
      expect(decodedBase64Bytes("")).toBe(0);
    });
  });

  describe("checkImageLimits()", () => {
    const png = (bytes: number) => ({ mimeType: "image/png", bytes });

    it("accepts no images and images within every limit", () => {
      expect(checkImageLimits([])).toBeNull();
      expect(
        checkImageLimits([png(10), { mimeType: "image/webp", bytes: MAX_IMAGE_BYTES }])
      ).toBeNull();
    });

    it("rejects more than four images as too large", () => {
      expect(checkImageLimits(Array.from({ length: 5 }, () => png(1)))).toEqual({
        code: "too_large",
        message: "At most 4 images per message",
      });
    });

    it("rejects an unsupported type as invalid", () => {
      expect(checkImageLimits([{ mimeType: "image/bmp", bytes: 1 }])).toEqual({
        code: "invalid",
        message: "Unsupported image type image/bmp",
      });
    });

    it("rejects one oversized image and a total over the per-message budget as too large", () => {
      const tooLarge = { code: "too_large", message: "Image data exceeds the size limit" };
      expect(checkImageLimits([png(MAX_IMAGE_BYTES + 1)])).toEqual(tooLarge);
      const share = MAX_IMAGE_BYTES_PER_COMMAND / 3 + 1;
      expect(checkImageLimits([png(share), png(share), png(share)])).toEqual(tooLarge);
    });
  });
});
