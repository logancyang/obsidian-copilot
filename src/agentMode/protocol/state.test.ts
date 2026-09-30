import { sessionIdOfScope, sessionScope } from "@/agentMode/protocol/state";

describe("state", () => {
  describe("sessionScope()", () => {
    it("prefixes a session id so it cannot collide with the host scope", () => {
      expect(sessionScope("abc")).toBe("session:abc");
    });
  });

  describe("sessionIdOfScope()", () => {
    it("recovers the id from a session scope", () => {
      expect(sessionIdOfScope(sessionScope("a:b"))).toBe("a:b");
    });

    it("returns null for the host scope", () => {
      expect(sessionIdOfScope("host")).toBeNull();
    });
  });
});
