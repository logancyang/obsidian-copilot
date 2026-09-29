import { PairedDesktopStore, type PairedDesktop } from "@/remote/client/PairedDesktopStore";

const desktop = (overrides: Partial<PairedDesktop> = {}): PairedDesktop => ({
  id: "d1",
  host: "100.118.223.39",
  port: 52341,
  token: "device-token",
  desktopName: "Studio Mac",
  vaultName: "Work notes",
  pairedAt: 1_000,
  ...overrides,
});

function makeStore(initial: string | null = null) {
  let raw = initial;
  const writes: string[] = [];
  const store = new PairedDesktopStore({
    read: () => raw,
    write: (value) => {
      raw = value;
      writes.push(value);
    },
  });
  return { store, raw: () => raw, writes };
}

describe("PairedDesktopStore", () => {
  describe("add()", () => {
    it("stores a desktop with its token so the phone can reconnect later", () => {
      const { store } = makeStore();

      store.add(desktop());

      expect(store.list()).toEqual([desktop()]);
    });

    it("keeps several desktops paired for the same vault", () => {
      const { store } = makeStore();

      store.add(desktop({ id: "a", host: "100.64.0.1" }));
      store.add(desktop({ id: "b", host: "100.64.0.2" }));

      expect(store.list().map((entry) => entry.id)).toEqual(["a", "b"]);
    });

    it("replaces an earlier pairing at the same address so re-pairing never duplicates a desktop", () => {
      const { store } = makeStore();
      store.add(desktop({ id: "old", token: "old-token" }));

      store.add(desktop({ id: "new", token: "new-token" }));

      expect(store.list()).toEqual([desktop({ id: "new", token: "new-token" })]);
    });

    it("keeps a desktop on the same host but another port as a separate vault window", () => {
      const { store } = makeStore();

      store.add(desktop({ id: "a", port: 50001 }));
      store.add(desktop({ id: "b", port: 50002 }));

      expect(store.list()).toHaveLength(2);
    });

    it("notifies subscribers", () => {
      const { store } = makeStore();
      const listener = jest.fn();
      store.subscribe(listener);

      store.add(desktop());

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("remove()", () => {
    it("forgets the desktop and its token", () => {
      const { store, raw } = makeStore();
      store.add(desktop());

      store.remove("d1");

      expect(store.list()).toEqual([]);
      expect(raw()).not.toContain("device-token");
    });

    it("leaves other desktops paired", () => {
      const { store } = makeStore();
      store.add(desktop({ id: "a", host: "100.64.0.1" }));
      store.add(desktop({ id: "b", host: "100.64.0.2" }));

      store.remove("a");

      expect(store.list().map((entry) => entry.id)).toEqual(["b"]);
    });
  });

  describe("list()", () => {
    it("returns the same frozen empty list while nothing is paired", () => {
      const { store } = makeStore();

      expect(store.list()).toBe(store.list());
      expect(Object.isFrozen(store.list())).toBe(true);
    });

    it("returns the same array until storage changes", () => {
      const { store } = makeStore();
      store.add(desktop());

      expect(store.list()).toBe(store.list());
    });

    it("survives a restart: a store over the same storage sees the paired desktop", () => {
      const { store, raw } = makeStore();
      store.add(desktop());

      expect(makeStore(raw()).store.list()).toEqual([desktop()]);
    });

    it.each([
      ["corrupt JSON", "{oops"],
      ["a payload without desktops", JSON.stringify({ version: 1 })],
    ])("treats %s as nothing paired", (_label, raw) => {
      expect(makeStore(raw).store.list()).toEqual([]);
    });

    it("drops malformed entries and keeps valid ones", () => {
      const raw = JSON.stringify({ version: 1, desktops: [desktop(), { id: "x" }, null] });

      expect(makeStore(raw).store.list()).toEqual([desktop()]);
    });

    it("reports nothing paired, instead of throwing, when secure storage cannot be read", () => {
      const store = new PairedDesktopStore({
        read: () => {
          throw new Error("keychain unavailable");
        },
        write: () => {},
      });

      expect(store.list()).toEqual([]);
    });
  });

  describe("subscribe()", () => {
    it("stops notifying after unsubscribing", () => {
      const { store } = makeStore();
      const listener = jest.fn();
      store.subscribe(listener)();

      store.add(desktop());

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
