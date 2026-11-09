import { maskSecretValues } from "@/connectors/maskSecretValues";

describe("maskSecretValues", () => {
  describe("maskSecretValues()", () => {
    it("replaces every occurrence of each value with ***, the longer value first when one contains another", () => {
      expect(
        maskSecretValues("token tok-22 and tok-2, then tok-22 again", ["tok-2", "tok-22"])
      ).toBe("token *** and ***, then *** again");
    });

    it("masks the last word of a multi-word value too, as a server can echo just the key of a Bearer header (https://github.com/Brevilabs/obsidian-copilot-private/issues/862)", () => {
      expect(
        maskSecretValues("key k-1 sent as Bearer tok-22, then tok-22 again", [
          "k-1",
          "Bearer tok-22",
        ])
      ).toBe("key *** sent as ***, then *** again");
    });

    it("leaves text that holds none of the values unchanged, and ignores an empty value", () => {
      expect(maskSecretValues("It exited with code 1.", ["k-1", ""])).toBe(
        "It exited with code 1."
      );
    });
  });
});
