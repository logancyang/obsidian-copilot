import { errCode } from "./errorUtils";

describe("errCode", () => {
  it("extracts a string code from an error-like object", () => {
    expect(errCode({ code: "ENOENT" })).toBe("ENOENT");
  });

  it("extracts code from a real Error subclass with a code property", () => {
    const err = Object.assign(new Error("boom"), { code: "EACCES" });
    expect(errCode(err)).toBe("EACCES");
  });

  it("returns null when code is missing", () => {
    expect(errCode({ message: "no code here" })).toBeNull();
  });

  it("returns null when code is not a string", () => {
    expect(errCode({ code: 42 })).toBeNull();
  });

  it("returns null for null", () => {
    expect(errCode(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(errCode(undefined)).toBeNull();
  });

  it("returns null for a string error", () => {
    expect(errCode("ENOENT")).toBeNull();
  });

  it("returns null for a number", () => {
    expect(errCode(42)).toBeNull();
  });
});
