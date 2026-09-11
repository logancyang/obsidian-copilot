import {
  ContextDeliveryCursor,
  EMPTY_CONTEXT_DELIVERY,
} from "@/agentMode/session/ContextDeliveryCursor";

describe("ContextDeliveryCursor", () => {
  describe("ContextDeliveryCursor", () => {
    describe("selectUndelivered()", () => {
      it("returns every candidate entry while the backend has received nothing", () => {
        const cursor = new ContextDeliveryCursor();

        expect(cursor.selectUndelivered(["m1", "m2"])).toEqual(["m1", "m2"]);
      });

      it("keeps the caller's order and drops entries an accepted prompt already carried", () => {
        const cursor = new ContextDeliveryCursor();
        cursor.markDelivered(["m2"]);

        expect(cursor.selectUndelivered(["m1", "m2", "m3"])).toEqual(["m1", "m3"]);
      });

      it("withholds entries whose delivery is uncertain instead of resending them", () => {
        const cursor = new ContextDeliveryCursor();
        cursor.markUncertain(["m1"]);

        expect(cursor.selectUndelivered(["m1", "m2"])).toEqual(["m2"]);
      });

      it("hands back one frozen empty slice when nothing is left to deliver", () => {
        const cursor = new ContextDeliveryCursor();
        cursor.markDelivered(["m1"]);

        const first = cursor.selectUndelivered(["m1"]);
        expect(first).toEqual([]);
        expect(cursor.selectUndelivered(["m1"])).toBe(first);
      });
    });

    describe("markDelivered()", () => {
      it("records the accepted entries in the persistable state", () => {
        const cursor = new ContextDeliveryCursor();

        cursor.markDelivered(["m1", "m2"]);

        expect(cursor.getState()).toEqual({ delivered: ["m1", "m2"], uncertain: [] });
      });

      it("clears an earlier doubt when the same entry is later confirmed accepted", () => {
        const cursor = new ContextDeliveryCursor();
        cursor.markUncertain(["m1"]);

        cursor.markDelivered(["m1"]);

        expect(cursor.isUncertain("m1")).toBe(false);
        expect(cursor.getState()).toEqual({ delivered: ["m1"], uncertain: [] });
      });

      it("keeps the state reference stable when re-recording an already delivered entry", () => {
        const cursor = new ContextDeliveryCursor();
        cursor.markDelivered(["m1"]);
        const state = cursor.getState();

        cursor.markDelivered(["m1"]);

        expect(cursor.getState()).toBe(state);
      });
    });

    describe("markUncertain()", () => {
      it("records an unconfirmed prompt so the entry is reported as in doubt", () => {
        const cursor = new ContextDeliveryCursor();

        cursor.markUncertain(["m1"]);

        expect(cursor.isUncertain("m1")).toBe(true);
        expect(cursor.getState()).toEqual({ delivered: [], uncertain: ["m1"] });
      });

      it("does not cast doubt on an entry the backend already accepted", () => {
        const cursor = new ContextDeliveryCursor();
        cursor.markDelivered(["m1"]);

        cursor.markUncertain(["m1"]);

        expect(cursor.isUncertain("m1")).toBe(false);
        expect(cursor.getState()).toEqual({ delivered: ["m1"], uncertain: [] });
      });
    });

    describe("getState()", () => {
      it("reports the shared frozen empty state for a cursor that never moved", () => {
        expect(new ContextDeliveryCursor().getState()).toBe(EMPTY_CONTEXT_DELIVERY);
      });
    });

    describe("restore()", () => {
      it("adopts a saved cursor so reopened conversations do not re-deliver known context", () => {
        const cursor = new ContextDeliveryCursor();

        cursor.restore({ delivered: ["m1"], uncertain: ["m2"] });

        expect(cursor.selectUndelivered(["m1", "m2", "m3"])).toEqual(["m3"]);
        expect(cursor.isUncertain("m2")).toBe(true);
      });

      it("replaces any state the cursor had accumulated before the restore", () => {
        const cursor = new ContextDeliveryCursor();
        cursor.markDelivered(["old"]);

        cursor.restore({ delivered: ["m1"], uncertain: [] });

        expect(cursor.getState()).toEqual({ delivered: ["m1"], uncertain: [] });
      });

      it("treats an entry saved as both delivered and uncertain as delivered", () => {
        const cursor = new ContextDeliveryCursor();

        cursor.restore({ delivered: ["m1"], uncertain: ["m1"] });

        expect(cursor.isUncertain("m1")).toBe(false);
        expect(cursor.getState()).toEqual({ delivered: ["m1"], uncertain: [] });
      });
    });
  });
});
