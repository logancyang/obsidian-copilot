import { PAIRING_TTL_MS, PairingWindow } from "@/remote/host/PairingWindow";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";

function makeWindow(secrets: string[] = ["secret-one", "secret-two"]) {
  let now = 1_000_000;
  const queue = [...secrets];
  const pairing = new PairingWindow({
    now: () => now,
    generateSecret: () => queue.shift() ?? "fallback",
  });
  return {
    pairing,
    advance(ms: number) {
      now += ms;
      jest.advanceTimersByTime(ms);
    },
  };
}

describe("PairingWindow", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe("start()", () => {
    it("opens a pairing whose secret expires after the time to live", () => {
      const { pairing } = makeWindow();

      const active = pairing.start();

      expect(active).toEqual({ secret: "secret-one", expiresAt: 1_000_000 + PAIRING_TTL_MS });
      expect(pairing.getActive()).toEqual(active);
    });

    it("replaces the previous secret so an earlier QR code stops working", () => {
      const { pairing } = makeWindow();
      pairing.start();

      pairing.start();

      expect(pairing.consume("secret-one")).toBe(false);
      expect(pairing.consume("secret-two")).toBe(true);
    });

    it("notifies subscribers that a pairing is now in progress", () => {
      const { pairing } = makeWindow();
      const listener = jest.fn();
      pairing.subscribe(listener);

      pairing.start();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("generates a different high-entropy secret each time when none is injected", () => {
      const pairing = new PairingWindow();

      const first = pairing.start().secret;
      const second = pairing.start().secret;

      expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(second).not.toBe(first);
    });
  });

  describe("consume()", () => {
    it("accepts the active secret once", () => {
      const { pairing } = makeWindow();
      pairing.start();

      expect(pairing.consume("secret-one")).toBe(true);
    });

    it("rejects a secret that was already used (https://github.com/Brevilabs/obsidian-copilot-private/issues/610)", () => {
      const { pairing } = makeWindow();
      pairing.start();
      pairing.consume("secret-one");

      expect(pairing.consume("secret-one")).toBe(false);
      expect(pairing.getActive()).toBeNull();
    });

    it("rejects a wrong secret and keeps the pairing open so a stray connection cannot cancel it", () => {
      const { pairing } = makeWindow();
      pairing.start();

      expect(pairing.consume("guess")).toBe(false);
      expect(pairing.consume("secret-one")).toBe(true);
    });

    it("rejects the right secret after the time to live passed (https://github.com/Brevilabs/obsidian-copilot-private/issues/610)", () => {
      const { pairing, advance } = makeWindow();
      pairing.start();

      advance(PAIRING_TTL_MS);

      expect(pairing.consume("secret-one")).toBe(false);
    });

    it("rejects any secret when no pairing was started", () => {
      const { pairing } = makeWindow();

      expect(pairing.consume("secret-one")).toBe(false);
    });

    it("rejects a secret that differs in length without throwing", () => {
      const { pairing } = makeWindow();
      pairing.start();

      expect(pairing.consume("s")).toBe(false);
    });
  });

  describe("cancel()", () => {
    it("closes the pairing, invalidates its secret and notifies subscribers", () => {
      const { pairing } = makeWindow();
      pairing.start();
      const listener = jest.fn();
      pairing.subscribe(listener);

      pairing.cancel();

      expect(pairing.getActive()).toBeNull();
      expect(pairing.consume("secret-one")).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not notify when no pairing is open", () => {
      const { pairing } = makeWindow();
      const listener = jest.fn();
      pairing.subscribe(listener);

      pairing.cancel();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("getActive()", () => {
    it(`stays expired when the clock is corrected backward after expiry was observed (${ISSUE})`, () => {
      let now = 1_000_000;
      const pairing = new PairingWindow({ now: () => now, generateSecret: () => "secret-one" });
      pairing.start();
      now += PAIRING_TTL_MS + 1;
      expect(pairing.getActive()).toBeNull();

      now -= PAIRING_TTL_MS;

      expect(pairing.getActive()).toBeNull();
      expect(pairing.consume("secret-one")).toBe(false);
    });

    it("reports no pairing once the time to live passed and notifies subscribers at expiry", () => {
      const { pairing, advance } = makeWindow();
      pairing.start();
      const listener = jest.fn();
      pairing.subscribe(listener);

      advance(PAIRING_TTL_MS);

      expect(pairing.getActive()).toBeNull();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("subscribe()", () => {
    it("stops notifying a listener after it unsubscribes", () => {
      const { pairing } = makeWindow();
      const listener = jest.fn();
      pairing.subscribe(listener)();

      pairing.start();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("dispose()", () => {
    it("cancels the expiry timer and drops subscribers", () => {
      const { pairing, advance } = makeWindow();
      const listener = jest.fn();
      pairing.subscribe(listener);
      pairing.start();
      listener.mockClear();

      pairing.dispose();
      advance(PAIRING_TTL_MS);

      expect(listener).not.toHaveBeenCalled();
      expect(pairing.getActive()).toBeNull();
    });
  });
});
