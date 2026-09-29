import { isTailscaleIPv4 } from "@/remote/address";

describe("address", () => {
  describe("isTailscaleIPv4()", () => {
    it.each(["100.64.0.0", "100.118.223.39", "100.127.255.255"])(
      "accepts %s inside 100.64.0.0/10",
      (address) => {
        expect(isTailscaleIPv4(address)).toBe(true);
      }
    );

    it.each([
      ["loopback", "127.0.0.1"],
      ["all interfaces", "0.0.0.0"],
      ["a private LAN address", "192.168.1.20"],
      ["a private 10.x address", "10.0.0.5"],
      ["the address just below the range", "100.63.255.255"],
      ["the address just above the range", "100.128.0.0"],
      ["an octet over 255", "100.64.0.256"],
      ["a hostname", "my-mac.tailnet.ts.net"],
      ["an IPv6 address", "fd7a:115c:a1e0::1"],
      ["a padded address", " 100.64.0.1"],
    ])("rejects %s (%s)", (_label, address) => {
      expect(isTailscaleIPv4(address)).toBe(false);
    });
  });
});
