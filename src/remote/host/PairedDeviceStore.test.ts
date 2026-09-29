import { PairedDeviceStore, type SecretSlot } from "@/remote/host/PairedDeviceStore";

function makeStore(initial: string | null = null) {
  let raw = initial;
  let now = 1_000;
  const slot: SecretSlot = { read: () => raw, write: (value) => (raw = value) };
  return {
    store: new PairedDeviceStore(slot, () => now),
    raw: () => raw,
    tick(ms: number) {
      now += ms;
    },
  };
}

describe("PairedDeviceStore", () => {
  describe("create()", () => {
    it("records a device with its name and creation time and returns a token for it", () => {
      const { store } = makeStore();

      const { device, token } = store.create("Zero's iPhone");

      expect(device).toMatchObject({ name: "Zero's iPhone", createdAt: 1_000, lastSeenAt: null });
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(store.list()).toEqual([device]);
    });

    it("issues a distinct token and id per device", () => {
      const { store } = makeStore();

      const first = store.create("A");
      const second = store.create("B");

      expect(second.token).not.toBe(first.token);
      expect(second.device.id).not.toBe(first.device.id);
    });

    it("never writes the token itself to storage, only its hash", () => {
      const { store, raw } = makeStore();

      const { token } = store.create("A");

      expect(raw()).not.toContain(token);
    });

    it("falls back to a default name when the phone sends a blank one", () => {
      const { store } = makeStore();

      expect(store.create("  \u0007 ").device.name).toBe("Phone");
    });

    it("strips control characters and limits the name to 60 characters", () => {
      const { store } = makeStore();

      const { device } = store.create(`a\u0000b${"x".repeat(100)}`);

      expect(device.name).toHaveLength(60);
      expect(device.name.startsWith("ab")).toBe(true);
    });

    it("notifies subscribers", () => {
      const { store } = makeStore();
      const listener = jest.fn();
      store.subscribe(listener);

      store.create("A");

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("authenticate()", () => {
    it("returns the device that owns a token", () => {
      const { store } = makeStore();
      store.create("A");
      const { device, token } = store.create("B");

      expect(store.authenticate(token)).toEqual(device);
    });

    it("rejects an unknown token", () => {
      const { store } = makeStore();
      store.create("A");

      expect(store.authenticate("not-a-token")).toBeNull();
    });

    it("rejects any token when no device is paired", () => {
      const { store } = makeStore();

      expect(store.authenticate("anything")).toBeNull();
    });

    it("rejects a token after its device was revoked", () => {
      const { store } = makeStore();
      const { device, token } = store.create("A");

      store.revoke(device.id);

      expect(store.authenticate(token)).toBeNull();
    });

    it("does not expose the token hash on the returned device", () => {
      const { store } = makeStore();
      const { token } = store.create("A");

      expect(Object.keys(store.authenticate(token) ?? {}).sort()).toEqual([
        "createdAt",
        "id",
        "lastSeenAt",
        "name",
      ]);
    });
  });

  describe("markSeen()", () => {
    it("records when a device was last seen", () => {
      const { store, tick } = makeStore();
      const { device } = store.create("A");
      tick(5_000);

      store.markSeen(device.id);

      expect(store.list()[0].lastSeenAt).toBe(6_000);
    });

    it("ignores a device that is not paired", () => {
      const { store, raw } = makeStore();
      const before = raw();

      store.markSeen("ghost");

      expect(raw()).toBe(before);
    });
  });

  describe("revoke()", () => {
    it("removes a device and reports that it existed", () => {
      const { store } = makeStore();
      const { device } = store.create("A");

      expect(store.revoke(device.id)).toBe(true);
      expect(store.list()).toEqual([]);
    });

    it("reports false for a device that is not paired", () => {
      const { store } = makeStore();

      expect(store.revoke("ghost")).toBe(false);
    });

    it("keeps the other devices", () => {
      const { store } = makeStore();
      const keep = store.create("Keep");
      const drop = store.create("Drop");

      store.revoke(drop.device.id);

      expect(store.list()).toEqual([keep.device]);
      expect(store.authenticate(keep.token)).toEqual(keep.device);
    });
  });

  describe("list()", () => {
    it("returns the same frozen empty list each time while no device is paired", () => {
      const { store } = makeStore();

      expect(store.list()).toBe(store.list());
      expect(Object.isFrozen(store.list())).toBe(true);
    });

    it("returns the same array until storage changes", () => {
      const { store } = makeStore();
      store.create("A");

      expect(store.list()).toBe(store.list());
    });

    it("survives a restart: a new store over the same storage sees the paired device and its token", () => {
      const { store, raw } = makeStore();
      const { device, token } = store.create("A");

      const reopened = makeStore(raw()).store;

      expect(reopened.list()).toEqual([device]);
      expect(reopened.authenticate(token)).toEqual(device);
    });

    it.each([
      ["corrupt JSON", "{not json"],
      ["a JSON array", "[]"],
      ["a payload without devices", JSON.stringify({ version: 1 })],
    ])("treats %s as no paired devices", (_label, raw) => {
      expect(makeStore(raw).store.list()).toEqual([]);
    });

    it("drops malformed entries and keeps the valid ones", () => {
      const good = { id: "d", name: "A", tokenHash: "00", createdAt: 1, lastSeenAt: null };
      const raw = JSON.stringify({ version: 1, devices: [good, { id: 5 }, null] });

      expect(
        makeStore(raw)
          .store.list()
          .map((device) => device.id)
      ).toEqual(["d"]);
    });
  });

  describe("subscribe()", () => {
    it("stops notifying after unsubscribing", () => {
      const { store } = makeStore();
      const listener = jest.fn();
      store.subscribe(listener)();

      store.create("A");

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
