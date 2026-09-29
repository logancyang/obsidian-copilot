import { readTailscaleAddress, selectTailscaleAddress } from "@/remote/host/tailscaleAddress";

const iface = (address: string, overrides: Record<string, unknown> = {}) => ({
  address,
  family: "IPv4",
  internal: false,
  ...overrides,
});

describe("tailscaleAddress", () => {
  describe("selectTailscaleAddress()", () => {
    it.each([
      ["macOS utun", "utun4"],
      ["Linux tailscale0", "tailscale0"],
      ["Windows Tailscale", "Tailscale"],
    ])("returns the address on the %s adapter", (_label, name) => {
      expect(selectTailscaleAddress({ [name]: [iface("100.118.223.39")] })).toBe("100.118.223.39");
    });

    it("skips other adapters when the Tailscale adapter is present", () => {
      expect(
        selectTailscaleAddress({
          lo0: [iface("127.0.0.1", { internal: true })],
          en0: [iface("192.168.1.20")],
          utun3: [iface("100.100.1.2")],
        })
      ).toBe("100.100.1.2");
    });

    it("returns null when there is no Tailscale adapter", () => {
      expect(selectTailscaleAddress({ en0: [iface("192.168.1.20")] })).toBeNull();
    });

    it("returns null for an empty interface list", () => {
      expect(selectTailscaleAddress({})).toBeNull();
    });

    it("ignores a carrier-grade NAT address on a non-Tailscale adapter so a LAN or hotspot address is never bound (https://github.com/Brevilabs/obsidian-copilot-private/issues/610)", () => {
      expect(selectTailscaleAddress({ en0: [iface("100.72.5.9")] })).toBeNull();
    });

    it("ignores addresses on the Tailscale adapter outside 100.64.0.0/10", () => {
      expect(selectTailscaleAddress({ utun2: [iface("10.1.2.3")] })).toBeNull();
    });

    it("ignores the adapter's IPv6 address and internal entries", () => {
      expect(
        selectTailscaleAddress({
          utun2: [
            { address: "fd7a:115c:a1e0::1", family: "IPv6", internal: false },
            iface("100.90.0.1", { internal: true }),
          ],
        })
      ).toBeNull();
    });

    it("accepts the numeric family Node 18.0 to 18.3 reports", () => {
      expect(selectTailscaleAddress({ utun2: [iface("100.90.0.1", { family: 4 })] })).toBe(
        "100.90.0.1"
      );
    });

    it("chooses deterministically when several Tailscale adapters exist", () => {
      expect(
        selectTailscaleAddress({ utun9: [iface("100.64.0.9")], utun10: [iface("100.64.0.10")] })
      ).toBe("100.64.0.10");
    });
  });

  describe("readTailscaleAddress()", () => {
    it("reads this machine's interfaces and returns an address or null", () => {
      const address = readTailscaleAddress();

      expect(address === null || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)).toBe(
        true
      );
    });
  });
});
