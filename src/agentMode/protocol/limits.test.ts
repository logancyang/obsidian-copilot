import { decodedBase64Bytes } from "@/agentMode/protocol/limits";

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
});
