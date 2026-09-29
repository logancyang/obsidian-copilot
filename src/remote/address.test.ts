import { isTailscaleIPv4 } from "@/remote/address";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";

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
      ["a leading-zero octet the WebSocket URL parser reads as octal (100.63.0.1)", "100.077.0.1"],
      ["a leading-zero first octet", "0100.64.0.1"],
      ["a leading-zero last octet", "100.64.0.01"],
      ["a hexadecimal octet", "100.0x40.0.1"],
      ["a trailing newline", "100.64.0.1\n"],
    ])(`rejects %s (%s) (${ISSUE})`, (_label, address) => {
      expect(isTailscaleIPv4(address)).toBe(false);
    });
  });
});
