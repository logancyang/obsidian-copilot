import { errCode } from "./errorUtils";

describe("errorUtils", () => {
  describe("errCode()", () => {
    it.each([
      ["an error-like object", { code: "ENOENT" }, "ENOENT"],
      [
        "an Error carrying a code property",
        Object.assign(new Error("boom"), { code: "EACCES" }),
        "EACCES",
      ],
    ])("returns the string code of %s", (_label, error, code) => {
      expect(errCode(error)).toBe(code);
    });

    it.each([
      ["an object without a code", { message: "no code here" }],
      ["an object whose code is not a string", { code: 42 }],
      ["null", null],
      ["undefined", undefined],
      ["a string", "ENOENT"],
      ["a number", 42],
    ])("returns null for %s", (_label, error) => {
      expect(errCode(error)).toBeNull();
    });
  });
});
