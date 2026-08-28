import {
  getAgentHomeReleaseUpdatePrototype,
  setAgentHomeReleaseUpdatePrototype,
  subscribeAgentHomeReleaseUpdatePrototype,
} from "@/components/release-update/agentHomeReleaseUpdatePrototypeStore";

describe("agentHomeReleaseUpdatePrototypeStore", () => {
  beforeEach(() => {
    setAgentHomeReleaseUpdatePrototype(false);
  });

  describe("getAgentHomeReleaseUpdatePrototype()", () => {
    it("returns whether the preview is visible", () => {
      setAgentHomeReleaseUpdatePrototype(true);

      expect(getAgentHomeReleaseUpdatePrototype()).toBe(true);
    });
  });

  describe("setAgentHomeReleaseUpdatePrototype()", () => {
    it("updates the current prototype and notifies subscribers", () => {
      const listener = jest.fn();
      const unsubscribe = subscribeAgentHomeReleaseUpdatePrototype(listener);

      setAgentHomeReleaseUpdatePrototype(true);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(getAgentHomeReleaseUpdatePrototype()).toBe(true);
      unsubscribe();
    });
  });

  describe("subscribeAgentHomeReleaseUpdatePrototype()", () => {
    it("stops notifying a listener after it unsubscribes", () => {
      const listener = jest.fn();
      const unsubscribe = subscribeAgentHomeReleaseUpdatePrototype(listener);
      unsubscribe();

      setAgentHomeReleaseUpdatePrototype(true);

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
