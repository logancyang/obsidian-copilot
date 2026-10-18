import { OpenArtifactsClient, OpenArtifactsClientError } from "@/openArtifacts/OpenArtifactsClient";
import { OPENARTIFACTS_API_ORIGIN } from "@/openArtifacts/constants";
import type { OpenArtifactsDocument } from "@/openArtifacts/types";
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";

jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
}));

const DOC_ID = "9f2k4mvq7t0xbz3n";
const DOCUMENT: OpenArtifactsDocument = {
  title: "Architecture",
  html: "<!doctype html><html><body>Review</body></html>",
  byteLength: 52,
};

function response(status: number, json?: unknown): RequestUrlResponse {
  return {
    status,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json,
    text: json === undefined ? "" : JSON.stringify(json),
  };
}

async function expectClientError(
  promise: Promise<unknown>,
  expected: {
    message: string;
    code: string;
    status: number | null;
    retryable: boolean;
  }
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected OpenArtifactsClientError");
  } catch (error) {
    expect(error).toBeInstanceOf(OpenArtifactsClientError);
    expect(error).toMatchObject(expected);
  }
}

describe("OpenArtifactsClient", () => {
  const mockedRequestUrl = requestUrl as jest.MockedFunction<typeof requestUrl>;

  beforeEach(() => {
    mockedRequestUrl.mockReset();
  });

  describe("OpenArtifactsClientError", () => {
    describe("constructor()", () => {
      it("retains the server-facing fields needed by the UI", () => {
        const error = new OpenArtifactsClientError("Try again.", "internal", 500, true);

        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({
          name: "OpenArtifactsClientError",
          message: "Try again.",
          code: "internal",
          status: 500,
          retryable: true,
        });
      });
    });
  });

  describe("OpenArtifactsClient", () => {
    describe("publish()", () => {
      it("posts only title and HTML to the fixed endpoint and returns the server URL verbatim", async () => {
        const returnedUrl = `https://openartifacts.site/d/${DOC_ID}?from=server#exact`;
        mockedRequestUrl.mockResolvedValue(
          response(201, { docId: DOC_ID, url: returnedUrl, version: 1 })
        );

        const receipt = await new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license");

        expect(receipt).toEqual({ docId: DOC_ID, url: returnedUrl, version: 1 });
        expect(mockedRequestUrl).toHaveBeenCalledWith({
          url: `${OPENARTIFACTS_API_ORIGIN}/api/v1/docs`,
          method: "POST",
          headers: { Authorization: "Bearer decrypted-license" },
          contentType: "application/json",
          body: JSON.stringify({ title: DOCUMENT.title, html: DOCUMENT.html }),
          throw: false,
        });
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
      });

      it.each([
        [
          "an invalid license",
          401,
          "unauthorized",
          "That license key is not valid for publishing.",
          false,
        ],
        [
          "an ineligible plan",
          401,
          "unauthorized",
          "Publishing is currently limited to lifetime license holders.",
          false,
        ],
        ["an oversized document", 413, "too_large", "That push is too large to accept.", false],
        ["a quota limit", 429, "quota_exceeded", "You have used all of today's pushes.", false],
        [
          "a license validation outage",
          500,
          "internal",
          "License validation is temporarily unavailable.",
          true,
        ],
      ])(
        "preserves the structured error for %s",
        async (_case, status, code, message, retryable) => {
          mockedRequestUrl.mockResolvedValue(response(status, { error: { code, message } }));

          await expectClientError(
            new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license"),
            {
              message,
              code,
              status,
              retryable,
            }
          );
        }
      );

      it("rejects malformed error envelopes without exposing their raw body", async () => {
        mockedRequestUrl.mockResolvedValue(response(401, { message: "no envelope" }));

        await expectClientError(new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license"), {
          message: "OpenArtifacts returned an invalid response (HTTP 401).",
          code: "malformed_response",
          status: 401,
          retryable: false,
        });
      });

      it.each([
        [
          "invalid doc id",
          { docId: "UPPERCASE", url: "https://openartifacts.site/d/x", version: 1 },
        ],
        ["non-HTTPS URL", { docId: DOC_ID, url: "http://openartifacts.site/d/x", version: 1 }],
        [
          "retired document host",
          { docId: DOC_ID, url: `https://symposium.site/d/${DOC_ID}`, version: 1 },
        ],
        [
          "unrelated HTTPS host",
          { docId: DOC_ID, url: `https://example.com/d/${DOC_ID}`, version: 1 },
        ],
        [
          "mismatched document URL",
          { docId: DOC_ID, url: "https://openartifacts.site/d/0123456789abcdef", version: 1 },
        ],
        [
          "non-integer version",
          { docId: DOC_ID, url: "https://openartifacts.site/d/x", version: 1.5 },
        ],
      ])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/337 treats a successful POST with %s as ambiguous",
        async (_case, receipt) => {
          mockedRequestUrl.mockResolvedValue(response(201, receipt));

          await expectClientError(
            new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license"),
            {
              message:
                "OpenArtifacts may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.",
              code: "ambiguous_publish",
              status: 201,
              retryable: false,
            }
          );
        }
      );

      it("https://github.com/Brevilabs/OpenArtifacts/issues/94 sends the client header only on a create that asks for the account-link offer", async () => {
        const receipt = {
          docId: DOC_ID,
          url: `https://openartifacts.site/d/${DOC_ID}`,
          version: 1,
        };
        mockedRequestUrl.mockResolvedValue(response(201, receipt));
        const client = new OpenArtifactsClient();

        await client.publish(DOCUMENT, "decrypted-license", undefined, true);
        await client.publish(DOCUMENT, "decrypted-license", "invited", true);
        await client.publish(DOCUMENT, "decrypted-license", "invited");
        mockedRequestUrl.mockResolvedValue(response(200, { ...receipt, version: 2 }));
        await client.update(DOC_ID, DOCUMENT, "decrypted-license");

        const headers = mockedRequestUrl.mock.calls.map(([options]) => [
          (options as RequestUrlParam).url,
          (options as RequestUrlParam).headers,
        ]);
        const authorization = { Authorization: "Bearer decrypted-license" };
        const offer = { ...authorization, "x-openartifacts-client": "obsidian-copilot" };
        expect(headers).toEqual([
          [`${OPENARTIFACTS_API_ORIGIN}/api/v1/docs`, offer],
          [`${OPENARTIFACTS_API_ORIGIN}/api/v1/private-docs`, offer],
          [`${OPENARTIFACTS_API_ORIGIN}/api/v1/private-docs`, authorization],
          [`${OPENARTIFACTS_API_ORIGIN}/api/v1/docs/${DOC_ID}`, authorization],
        ]);
      });

      it("https://github.com/Brevilabs/OpenArtifacts/issues/94 returns the server's guidance and drops it when malformed", async () => {
        const receipt = {
          docId: DOC_ID,
          url: `https://openartifacts.site/d/${DOC_ID}`,
          version: 1,
        };
        const guidance = { message: "Link your account.", url: "https://openartifacts.ai/account" };
        const client = new OpenArtifactsClient();

        mockedRequestUrl.mockResolvedValue(response(201, { ...receipt, guidance }));
        await expect(client.publish(DOCUMENT, "decrypted-license")).resolves.toEqual({
          ...receipt,
          guidance,
        });

        for (const malformed of [
          { message: "", url: guidance.url },
          { message: guidance.message, url: "http://openartifacts.ai/account" },
          { message: guidance.message },
          { url: guidance.url },
          "Link your account.",
        ]) {
          mockedRequestUrl.mockResolvedValue(response(201, { ...receipt, guidance: malformed }));
          await expect(client.publish(DOCUMENT, "decrypted-license")).resolves.toEqual(receipt);
        }
      });

      it("treats an unexpected successful POST status as ambiguous", async () => {
        mockedRequestUrl.mockResolvedValue(response(200));

        await expectClientError(new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license"), {
          message:
            "OpenArtifacts may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.",
          code: "ambiguous_publish",
          status: 200,
          retryable: false,
        });
      });

      it("marks a request failure as ambiguous and non-retryable", async () => {
        mockedRequestUrl.mockRejectedValue(new Error("socket failed"));

        await expectClientError(new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license"), {
          message:
            "OpenArtifacts may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.",
          code: "ambiguous_publish",
          status: null,
          retryable: false,
        });
      });
    });

    describe("update()", () => {
      it("puts the next version at the existing document route", async () => {
        const receipt = {
          docId: DOC_ID,
          url: `https://openartifacts.site/d/${DOC_ID}`,
          version: 2,
        };
        mockedRequestUrl.mockResolvedValue(response(200, receipt));

        await expect(
          new OpenArtifactsClient().update(DOC_ID, DOCUMENT, "decrypted-license")
        ).resolves.toEqual(receipt);
        expect(mockedRequestUrl).toHaveBeenCalledWith({
          url: `${OPENARTIFACTS_API_ORIGIN}/api/v1/docs/${DOC_ID}`,
          method: "PUT",
          headers: { Authorization: "Bearer decrypted-license" },
          contentType: "application/json",
          body: JSON.stringify({ title: DOCUMENT.title, html: DOCUMENT.html }),
          throw: false,
        });
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
      });

      it("returns not_found without an implicit POST or retired-API fallback", async () => {
        mockedRequestUrl.mockResolvedValue(
          response(404, {
            error: { code: "not_found", message: `No doc with id ${DOC_ID}.` },
          })
        );

        await expectClientError(
          new OpenArtifactsClient().update(DOC_ID, DOCUMENT, "decrypted-license"),
          {
            message: `No doc with id ${DOC_ID}.`,
            code: "not_found",
            status: 404,
            retryable: false,
          }
        );
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
        expect(mockedRequestUrl).toHaveBeenCalledWith(
          expect.objectContaining({
            method: "PUT",
            url: `${OPENARTIFACTS_API_ORIGIN}/api/v1/docs/${DOC_ID}`,
          })
        );
        expect((mockedRequestUrl.mock.calls[0][0] as RequestUrlParam).url).not.toContain(
          "api.symposium.md"
        );
      });

      it("rejects a receipt for a different document identity", async () => {
        mockedRequestUrl.mockResolvedValue(
          response(200, {
            docId: "0123456789abcdef",
            url: "https://openartifacts.site/d/0123456789abcdef",
            version: 2,
          })
        );

        await expectClientError(
          new OpenArtifactsClient().update(DOC_ID, DOCUMENT, "decrypted-license"),
          {
            message: "OpenArtifacts returned an invalid response (HTTP 200).",
            code: "malformed_response",
            status: 200,
            retryable: false,
          }
        );
      });

      it("keeps a malformed PUT receipt distinct from ambiguous creation", async () => {
        mockedRequestUrl.mockResolvedValue(
          response(200, {
            docId: DOC_ID,
            url: "http://openartifacts.site/d/x",
            version: 2,
          })
        );

        await expectClientError(
          new OpenArtifactsClient().update(DOC_ID, DOCUMENT, "decrypted-license"),
          {
            message: "OpenArtifacts returned an invalid response (HTTP 200).",
            code: "malformed_response",
            status: 200,
            retryable: false,
          }
        );
      });

      it("keeps a PUT transport failure retryable because the document id is stable", async () => {
        mockedRequestUrl.mockRejectedValue(new Error("socket failed"));

        await expectClientError(
          new OpenArtifactsClient().update(DOC_ID, DOCUMENT, "decrypted-license"),
          {
            message: "Could not reach OpenArtifacts. Please try again.",
            code: "network",
            status: null,
            retryable: true,
          }
        );
      });
    });

    describe("delete()", () => {
      it("deletes the existing document without sending a body", async () => {
        mockedRequestUrl.mockResolvedValue(response(204));

        await expect(
          new OpenArtifactsClient().delete(DOC_ID, "decrypted-license")
        ).resolves.toBeUndefined();
        expect(mockedRequestUrl).toHaveBeenCalledWith({
          url: `${OPENARTIFACTS_API_ORIGIN}/api/v1/docs/${DOC_ID}`,
          method: "DELETE",
          headers: { Authorization: "Bearer decrypted-license" },
          throw: false,
        });
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
      });

      it("treats structured 404 not_found as an idempotent success", async () => {
        mockedRequestUrl.mockResolvedValue(
          response(404, {
            error: { code: "not_found", message: `No doc with id ${DOC_ID}.` },
          })
        );

        await expect(
          new OpenArtifactsClient().delete(DOC_ID, "decrypted-license")
        ).resolves.toBeUndefined();
      });

      it.each([
        [
          "a different 404 code",
          response(404, { error: { code: "unauthorized", message: "Invalid key." } }),
          {
            message: "Invalid key.",
            code: "unauthorized",
            status: 404,
            retryable: false,
          },
        ],
        [
          "an unstructured 404",
          response(404, { message: "missing" }),
          {
            message: "OpenArtifacts returned an invalid response (HTTP 404).",
            code: "malformed_response",
            status: 404,
            retryable: false,
          },
        ],
        [
          "an unexpected 200",
          response(200),
          {
            message: "OpenArtifacts returned an invalid response (HTTP 200).",
            code: "malformed_response",
            status: 200,
            retryable: false,
          },
        ],
      ])(
        "rejects %s instead of treating it as deleted",
        async (_case, serverResponse, expected) => {
          mockedRequestUrl.mockResolvedValue(serverResponse);

          await expectClientError(
            new OpenArtifactsClient().delete(DOC_ID, "decrypted-license"),
            expected
          );
        }
      );
    });

    describe("private sharing", () => {
      const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/707";
      const sent = (index: number) => mockedRequestUrl.mock.calls[index][0] as RequestUrlParam;
      const PAGE_URL = `https://openartifacts.site/d/${DOC_ID}`;
      const ACCESS = {
        docId: DOC_ID,
        url: PAGE_URL,
        linkAccess: "invited",
        email: true,
        people: [{ email: "a@b.co", role: "comment", addedAt: 1785000000000 }],
        requests: [{ email: "bob@other.com", requestedAt: 1785000100000 }],
      };
      const PRIVATE_URL = `${OPENARTIFACTS_API_ORIGIN}/api/v1/private-docs`;

      describe("publish()", () => {
        it(`${ISSUE} creates a private page with one POST to the private route and no linkAccess field`, async () => {
          mockedRequestUrl.mockResolvedValue(
            response(201, { docId: DOC_ID, url: PAGE_URL, version: 1, linkAccess: "invited" })
          );

          await expect(
            new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license", "invited")
          ).resolves.toEqual({ docId: DOC_ID, url: PAGE_URL, version: 1, linkAccess: "invited" });

          expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
          expect(sent(0)).toMatchObject({ url: PRIVATE_URL, method: "POST" });
          expect(JSON.parse(sent(0).body as string)).toEqual({
            title: DOCUMENT.title,
            html: DOCUMENT.html,
          });
        });

        it.each([
          ["a JSON not_found body", response(404, { error: { code: "not_found", message: "x" } })],
          ["a body that is not JSON", response(404)],
        ])(
          `${ISSUE} reports an unsupported server for %s and creates nothing`,
          async (_case, serverResponse) => {
            mockedRequestUrl.mockResolvedValue(serverResponse);

            await expectClientError(
              new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license", "invited"),
              {
                message:
                  "This OpenArtifacts server does not support private documents. Nothing was published.",
                code: "private_unsupported",
                status: 404,
                retryable: false,
              }
            );
            expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
            expect(sent(0).url).toBe(PRIVATE_URL);
            expect(sent(0).method).toBe("POST");
          }
        );

        it(`${ISSUE} treats a network error on the private create as an ambiguous publish`, async () => {
          mockedRequestUrl.mockRejectedValue(new Error("offline"));

          await expect(
            new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license", "invited")
          ).rejects.toMatchObject({ code: "ambiguous_publish", retryable: false });
          expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
        });

        it(`${ISSUE} treats a malformed 2xx from the private route as an ambiguous publish`, async () => {
          mockedRequestUrl.mockResolvedValue(response(201, { docId: "nope" }));

          await expect(
            new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license", "invited")
          ).rejects.toMatchObject({ code: "ambiguous_publish" });
        });

        it(`${ISSUE} publishes a public page to the public route when no access is requested`, async () => {
          mockedRequestUrl.mockResolvedValue(
            response(201, { docId: DOC_ID, url: PAGE_URL, version: 1 })
          );

          await new OpenArtifactsClient().publish(DOCUMENT, "decrypted-license");

          expect(sent(0).url).toBe(`${OPENARTIFACTS_API_ORIGIN}/api/v1/docs`);
        });
      });

      describe("access calls", () => {
        it("reads and changes the link access on the access route", async () => {
          const client = new OpenArtifactsClient();
          mockedRequestUrl.mockResolvedValue(response(200, ACCESS));

          await client.getAccess(DOC_ID, "k");
          await client.setLinkAccess(DOC_ID, "invited", "k");

          const base = `${OPENARTIFACTS_API_ORIGIN}/api/v1/docs/${DOC_ID}/access`;
          expect(
            mockedRequestUrl.mock.calls.map((_call, i) => [sent(i).method, sent(i).url])
          ).toEqual([
            ["GET", base],
            ["PUT", base],
          ]);
          expect(JSON.parse(sent(1).body as string)).toEqual({ linkAccess: "invited" });
        });

        it(`${ISSUE} rejects with private_unavailable when any access route answers 404`, async () => {
          const client = new OpenArtifactsClient();
          mockedRequestUrl.mockResolvedValue(response(404));
          const expected = {
            message: "Not found, or this server does not support private documents.",
            code: "private_unavailable",
            status: 404,
            retryable: false,
          };

          await expectClientError(client.getAccess(DOC_ID, "k"), expected);
          await expectClientError(client.setLinkAccess(DOC_ID, "invited", "k"), expected);
        });

        it("returns the Access the server answered", async () => {
          mockedRequestUrl.mockResolvedValue(response(200, ACCESS));

          await expect(new OpenArtifactsClient().getAccess(DOC_ID, "k")).resolves.toEqual(ACCESS);
        });

        it.each([
          ["a null person", { ...ACCESS, people: [null] }],
          ["a person without an email", { ...ACCESS, people: [{ role: "comment", addedAt: 1 }] }],
          [
            "an unsupported role",
            { ...ACCESS, people: [{ email: "a@b.co", role: "owner", addedAt: 1 }] },
          ],
          [
            "a nonnumeric invitation time",
            { ...ACCESS, people: [{ email: "a@b.co", role: "view", addedAt: "yesterday" }] },
          ],
          ["a null request", { ...ACCESS, requests: [null] }],
          ["a request without an email", { ...ACCESS, requests: [{ requestedAt: 1 }] }],
          ["a request without a time", { ...ACCESS, requests: [{ email: "a@b.co" }] }],
          ["a missing requests array", { ...ACCESS, requests: undefined }],
          ["a missing email flag", { ...ACCESS, email: undefined }],
          ["a non-canonical url", { ...ACCESS, url: "https://evil.example/d/" + DOC_ID }],
          ["a url for another document", { ...ACCESS, url: "https://openartifacts.site/d/x" }],
        ])(`${ISSUE} rejects %s as malformed`, async (_case, body) => {
          mockedRequestUrl.mockResolvedValue(response(200, body));

          await expect(new OpenArtifactsClient().getAccess(DOC_ID, "k")).rejects.toMatchObject({
            code: "malformed_response",
          });
        });
      });

      describe("openAsOwner()", () => {
        it("opens a page as its owner and returns the grant url", async () => {
          mockedRequestUrl.mockResolvedValue(
            response(200, { url: "https://x.openartifacts.site/d/g?grant=1", expiresAt: 1 })
          );

          await expect(new OpenArtifactsClient().openAsOwner(DOC_ID, "k")).resolves.toBe(
            "https://x.openartifacts.site/d/g?grant=1"
          );
          expect(sent(0)).toMatchObject({
            url: `${OPENARTIFACTS_API_ORIGIN}/api/v1/docs/${DOC_ID}/open`,
            method: "POST",
          });
        });

        it(`${ISSUE} falls back to the canonical url when the server has no open route`, async () => {
          mockedRequestUrl.mockResolvedValue(response(404));

          await expect(new OpenArtifactsClient().openAsOwner(DOC_ID, "k")).resolves.toBe(PAGE_URL);
        });

        it("still throws on other failures", async () => {
          mockedRequestUrl.mockResolvedValue(
            response(500, { error: { code: "internal", message: "Try again." } })
          );

          await expect(new OpenArtifactsClient().openAsOwner(DOC_ID, "k")).rejects.toMatchObject({
            status: 500,
          });
        });
      });

      describe("errorFromResponse()", () => {
        it("keeps the server upgrade link from a privateSharing account refusal", async () => {
          mockedRequestUrl.mockResolvedValue(
            response(402, {
              error: {
                code: "limit_reached",
                message: "Private sharing needs a paid plan.",
                limit: "privateSharing",
                upgrade_url: "https://openartifacts.ai/account",
              },
            })
          );

          await expect(
            new OpenArtifactsClient().setLinkAccess(DOC_ID, "invited", "k")
          ).rejects.toMatchObject({ status: 402, upgradeUrl: "https://openartifacts.ai/account" });
        });

        it(`${ISSUE} points a license-key privateSharing refusal at the Copilot pricing page`, async () => {
          mockedRequestUrl.mockResolvedValue(
            response(402, {
              error: {
                code: "limit_reached",
                message: "Your Copilot plan does not include private sharing.",
                limit: "privateSharing",
              },
            })
          );

          const error = await new OpenArtifactsClient()
            .publish(DOCUMENT, "decrypted-license", "invited")
            .catch((caught: unknown) => caught);

          expect(error).toBeInstanceOf(OpenArtifactsClientError);
          expect((error as OpenArtifactsClientError).message).toBe(
            "Your Copilot plan does not include private sharing."
          );
          const upgrade = new URL((error as OpenArtifactsClientError).upgradeUrl as string);
          expect(upgrade.origin + upgrade.pathname).toBe("https://www.obsidiancopilot.com/pricing");
          expect(upgrade.searchParams.get("utm_medium")).toBe("openartifacts_private_sharing");
        });

        it(`${ISSUE} ignores a non-https server upgrade link and other 402 limits`, async () => {
          mockedRequestUrl.mockResolvedValueOnce(
            response(402, {
              error: {
                code: "limit_reached",
                message: "Private sharing needs a paid plan.",
                limit: "privateSharing",
                upgrade_url: "http://insecure.example/account",
              },
            })
          );
          const insecure = await new OpenArtifactsClient()
            .setLinkAccess(DOC_ID, "invited", "k")
            .catch((caught: unknown) => caught);
          expect((insecure as OpenArtifactsClientError).upgradeUrl).toContain(
            "utm_medium=openartifacts_private_sharing"
          );

          mockedRequestUrl.mockResolvedValueOnce(
            response(402, {
              error: { code: "limit_reached", message: "Limit.", limit: "documents" },
            })
          );
          const other = await new OpenArtifactsClient()
            .setLinkAccess(DOC_ID, "invited", "k")
            .catch((caught: unknown) => caught);
          expect((other as OpenArtifactsClientError).upgradeUrl).toBeUndefined();
        });
      });
    });
  });
});
