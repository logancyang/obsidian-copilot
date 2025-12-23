import { isSortStrategy, RecentUsageManager, sortByStrategy } from "./recentUsageManager";

describe("recentUsageManager", () => {
  describe("isSortStrategy", () => {
    it("returns true for valid strategies", () => {
      expect(isSortStrategy("recent")).toBe(true);
      expect(isSortStrategy("created")).toBe(true);
      expect(isSortStrategy("name")).toBe(true);
      expect(isSortStrategy("manual")).toBe(true);
    });

    it("returns false for invalid strategies", () => {
      expect(isSortStrategy("invalid")).toBe(false);
      expect(isSortStrategy("")).toBe(false);
      expect(isSortStrategy(null)).toBe(false);
      expect(isSortStrategy(undefined)).toBe(false);
      expect(isSortStrategy(123)).toBe(false);
    });
  });

  describe("sortByStrategy", () => {
    interface TestItem {
      name: string;
      createdAt: number;
      lastUsedAt: number | null;
      order?: number;
    }

    const getters = {
      getName: (item: TestItem) => item.name,
      getCreatedAtMs: (item: TestItem) => item.createdAt,
      getLastUsedAtMs: (item: TestItem) => item.lastUsedAt,
      getManualOrder: (item: TestItem) => item.order ?? 0,
    };

    const items: TestItem[] = [
      { name: "Beta", createdAt: 2000, lastUsedAt: 1000, order: 2 },
      { name: "Alpha", createdAt: 1000, lastUsedAt: 3000, order: 1 },
      { name: "Gamma", createdAt: 3000, lastUsedAt: 2000, order: 3 },
    ];

    it("sorts by recent (descending by lastUsedAt)", () => {
      const sorted = sortByStrategy(items, "recent", getters);
      expect(sorted.map((i) => i.name)).toEqual(["Alpha", "Gamma", "Beta"]);
    });

    it("sorts by created (descending by createdAt)", () => {
      const sorted = sortByStrategy(items, "created", getters);
      expect(sorted.map((i) => i.name)).toEqual(["Gamma", "Beta", "Alpha"]);
    });

    it("sorts by name (ascending alphabetically)", () => {
      const sorted = sortByStrategy(items, "name", getters);
      expect(sorted.map((i) => i.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("sorts by manual order (ascending)", () => {
      const sorted = sortByStrategy(items, "manual", getters);
      expect(sorted.map((i) => i.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("falls back to createdAt when lastUsedAt is null for recent strategy", () => {
      const itemsWithNull: TestItem[] = [
        { name: "A", createdAt: 1000, lastUsedAt: null },
        { name: "B", createdAt: 3000, lastUsedAt: null },
        { name: "C", createdAt: 2000, lastUsedAt: 5000 },
      ];
      const sorted = sortByStrategy(itemsWithNull, "recent", getters);
      // C has lastUsedAt=5000, B falls back to createdAt=3000, A falls back to createdAt=1000
      expect(sorted.map((i) => i.name)).toEqual(["C", "B", "A"]);
    });

    it("uses name as tie-breaker when timestamps are equal", () => {
      const itemsWithSameTime: TestItem[] = [
        { name: "Zebra", createdAt: 1000, lastUsedAt: 2000 },
        { name: "Apple", createdAt: 1000, lastUsedAt: 2000 },
        { name: "Mango", createdAt: 1000, lastUsedAt: 2000 },
      ];
      const sorted = sortByStrategy(itemsWithSameTime, "recent", getters);
      expect(sorted.map((i) => i.name)).toEqual(["Apple", "Mango", "Zebra"]);
    });

    it("falls back to name sort when manual strategy but no getManualOrder", () => {
      const gettersWithoutManual = {
        getName: (item: TestItem) => item.name,
        getCreatedAtMs: (item: TestItem) => item.createdAt,
        getLastUsedAtMs: (item: TestItem) => item.lastUsedAt,
        // No getManualOrder
      };
      const sorted = sortByStrategy(items, "manual", gettersWithoutManual);
      expect(sorted.map((i) => i.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    });
  });

  describe("RecentUsageManager", () => {
    describe("touch and shouldPersist", () => {
      it("touch always returns current timestamp and updates memory", () => {
        let currentTime = 1000;
        const manager = new RecentUsageManager({
          nowMs: () => currentTime,
        });

        const ts1 = manager.touch("key1");
        expect(ts1).toBe(1000);
        expect(manager.getLastTouchedAt("key1")).toBe(1000);

        currentTime = 2000; // eslint-disable-line prefer-const
        const ts2 = manager.touch("key1");
        expect(ts2).toBe(2000);
        expect(manager.getLastTouchedAt("key1")).toBe(2000);
      });

      it("shouldPersist returns timestamp on first touch", () => {
        const currentTime = 1000;
        const manager = new RecentUsageManager({
          nowMs: () => currentTime,
          minIntervalMs: 30000,
        });

        manager.touch("key1");
        const result = manager.shouldPersist("key1", null);
        expect(result).toBe(1000);
      });

      it("shouldPersist returns null when throttled (within minIntervalMs)", () => {
        let currentTime = 1000;
        const manager = new RecentUsageManager({
          nowMs: () => currentTime,
          minIntervalMs: 30000,
        });

        manager.touch("key1");
        const firstPersist = manager.shouldPersist("key1", null);
        expect(firstPersist).toBe(1000);
        manager.markPersisted("key1", firstPersist!); // Mark first persistence

        currentTime = 15000; // 15 seconds later
        manager.touch("key1");
        const result = manager.shouldPersist("key1", null);
        expect(result).toBeNull(); // Throttled
      });

      it("shouldPersist returns timestamp after throttle period", () => {
        let currentTime = 1000;
        const manager = new RecentUsageManager({
          nowMs: () => currentTime,
          minIntervalMs: 30000,
        });

        manager.touch("key1");
        const firstPersist = manager.shouldPersist("key1", null);
        expect(firstPersist).toBe(1000);
        manager.markPersisted("key1", firstPersist!); // Mark first persistence at 1000

        currentTime = 35000; // 34 seconds later (past throttle)
        manager.touch("key1");
        const result = manager.shouldPersist("key1", null);
        expect(result).toBe(35000);
      });

      it("shouldPersist considers persisted value for throttling", () => {
        const currentTime = 50000;
        const manager = new RecentUsageManager({
          nowMs: () => currentTime,
          minIntervalMs: 30000,
        });

        // Simulate: persisted value is 40000, current time is 50000
        // 50000 - 40000 = 10000 < 30000, so should be throttled
        manager.touch("key1");
        const result = manager.shouldPersist("key1", 40000);
        expect(result).toBeNull();
      });
    });

    describe("revision and subscribe", () => {
      it("increments revision and notifies subscribers on touch", () => {
        const manager = new RecentUsageManager({ nowMs: () => 1000 });
        const listener = jest.fn();
        const unsubscribe = manager.subscribe(listener);

        const initialRevision = manager.getRevision();
        manager.touch("key1");

        expect(manager.getRevision()).toBe(initialRevision + 1);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        manager.touch("key1");
        expect(listener).toHaveBeenCalledTimes(1); // Not called again after unsubscribe
      });

      it("increments revision on clear", () => {
        const manager = new RecentUsageManager({ nowMs: () => 1000 });
        const listener = jest.fn();
        manager.subscribe(listener);

        manager.touch("key1");
        const revisionAfterTouch = manager.getRevision();

        manager.clear("key1");
        expect(manager.getRevision()).toBe(revisionAfterTouch + 1);
        expect(listener).toHaveBeenCalledTimes(2); // Once for touch, once for clear
      });

      it("does not increment revision on shouldPersist or markPersisted", () => {
        const manager = new RecentUsageManager({ nowMs: () => 1000 });
        manager.touch("key1");
        const revisionAfterTouch = manager.getRevision();

        manager.shouldPersist("key1", null);
        expect(manager.getRevision()).toBe(revisionAfterTouch);

        manager.markPersisted("key1", 1000);
        expect(manager.getRevision()).toBe(revisionAfterTouch);
      });
    });

    describe("getEffectiveLastUsedAt", () => {
      it("returns memory value when it is more recent", () => {
        const currentTime = 5000;
        const manager = new RecentUsageManager({
          nowMs: () => currentTime,
        });

        manager.touch("key1"); // Memory = 5000
        const effective = manager.getEffectiveLastUsedAt("key1", 3000); // Persisted = 3000
        expect(effective).toBe(5000);
      });

      it("returns persisted value when memory is not set", () => {
        const manager = new RecentUsageManager();
        const effective = manager.getEffectiveLastUsedAt("key1", 3000);
        expect(effective).toBe(3000);
      });

      it("returns 0 when both are null/undefined", () => {
        const manager = new RecentUsageManager();
        const effective = manager.getEffectiveLastUsedAt("key1", null);
        expect(effective).toBe(0);
      });
    });

    describe("clear", () => {
      it("clears specific key", () => {
        const currentTime = 1000;
        const manager = new RecentUsageManager({
          nowMs: () => currentTime,
        });

        manager.touch("key1");
        manager.touch("key2");
        manager.clear("key1");

        expect(manager.getLastTouchedAt("key1")).toBeNull();
        expect(manager.getLastTouchedAt("key2")).toBe(1000);
      });

      it("clears all keys when no argument", () => {
        const currentTime = 1000;
        const manager = new RecentUsageManager({
          nowMs: () => currentTime,
        });

        manager.touch("key1");
        manager.touch("key2");
        manager.clear();

        expect(manager.getLastTouchedAt("key1")).toBeNull();
        expect(manager.getLastTouchedAt("key2")).toBeNull();
      });
    });
  });
});
