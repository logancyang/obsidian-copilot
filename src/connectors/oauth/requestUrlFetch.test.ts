/**
 * @jest-environment node
 */
import { requestUrlFetch, ServiceUnreachableError } from "@/connectors/oauth/requestUrlFetch";
import * as obsidian from "obsidian";

const setRequestUrlImpl = (
  obsidian as unknown as { __setRequestUrlImpl: (impl: jest.Mock) => void }
).__setRequestUrlImpl;

describe("requestUrlFetch", () => {
  describe("requestUrlFetch()", () => {
    it("returns the service's status, headers and body as a fetch Response", async () => {
      setRequestUrlImpl(
        jest.fn().mockResolvedValue({
          status: 401,
          headers: { "www-authenticate": 'Bearer error="invalid_token"' },
          text: '{"error":"invalid_token"}',
        })
      );

      const response = await requestUrlFetch("https://service.test/.well-known/x");

      expect(response.status).toBe(401);
      expect(response.ok).toBe(false);
      expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
      await expect(response.json()).resolves.toEqual({ error: "invalid_token" });
    });

    it("sends a form body with its content type and method through requestUrl", async () => {
      const requestUrl = jest.fn().mockResolvedValue({ status: 200, headers: {}, text: "{}" });
      setRequestUrlImpl(requestUrl);

      await requestUrlFetch(new URL("https://service.test/token"), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "r1" }),
      });

      expect(requestUrl).toHaveBeenCalledWith({
        url: "https://service.test/token",
        method: "POST",
        headers: { accept: "application/json" },
        contentType: "application/x-www-form-urlencoded",
        body: "grant_type=refresh_token&refresh_token=r1",
        throw: false,
      });
    });

    it("returns an empty body for a 204 answer", async () => {
      setRequestUrlImpl(jest.fn().mockResolvedValue({ status: 204, headers: {}, text: "" }));

      const response = await requestUrlFetch("https://service.test/revoke", { method: "POST" });

      expect(response.status).toBe(204);
      await expect(response.text()).resolves.toBe("");
    });

    it("throws ServiceUnreachableError when the request never reaches the service", async () => {
      setRequestUrlImpl(jest.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED")));

      await expect(requestUrlFetch("https://service.test/token")).rejects.toBeInstanceOf(
        ServiceUnreachableError
      );
    });
  });
});
