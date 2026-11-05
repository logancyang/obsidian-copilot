#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

const USAGE = `Checks that Copilot can start a connector login, up to the service's login page.

Usage:
  node scripts/check-connector-login.mjs              check every catalog entry
  node scripts/check-connector-login.mjs <url>...     check candidate MCP server URLs

Each check discovers the service's OAuth server, gets a client ID (Copilot's client
metadata document where the service supports it, otherwise a registration named
"Copilot for Obsidian" with a loopback redirect), then loads the login link, which
always carries a state value. It never signs in. Registrations it creates stay on
the service.

PASS    the login page loaded.
VERIFY  the service accepted Copilot's client and redirected the login link to a
        page that blocks scripts (403 or 429); open the printed link in a browser
        and check that its login page appears.
FAIL    anything else. Exits with 1 when any check fails.`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_NAME = "Copilot for Obsidian";
const CLIENT_METADATA_URL = "https://www.obsidiancopilot.com/oauth/client-metadata.json";
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 10;
const ERROR_PAGE_TEXT =
  /invalid[_ ](client|redirect|request|scope)|unauthorized[_ ]client|access[_ ]denied/i;
const BOT_CHECK_STATUSES = new Set([403, 429]);

const timedFetch = (url, init = {}) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

async function loadCatalog() {
  const { outputFiles } = await build({
    entryPoints: [path.join(ROOT, "src/connectors/catalog.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    loader: { ".svg": "empty" },
    tsconfig: path.join(ROOT, "tsconfig.json"),
    logLevel: "silent",
  });
  const source = Buffer.from(outputFiles[0].text).toString("base64");
  // eslint-disable-next-line no-unsanitized/method -- the module is the repo's own catalog, bundled above.
  const { CONNECTOR_CATALOG } = await import(`data:text/javascript;base64,${source}`);
  return CONNECTOR_CATALOG.map(({ id, serverUrl }) => ({ label: id, serverUrl }));
}

async function isClientMetadataPublished() {
  try {
    const response = await timedFetch(CLIENT_METADATA_URL);
    return response.ok && (await response.json()).client_id === CLIENT_METADATA_URL;
  } catch {
    return false;
  }
}

async function getLoginLink(serverUrl, redirectUrl, useClientMetadata) {
  let client;
  let loginLink;
  const provider = {
    redirectUrl,
    clientMetadata: {
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    clientMetadataUrl: useClientMetadata ? CLIENT_METADATA_URL : undefined,
    state: () => randomUUID(),
    clientInformation: () => client,
    saveClientInformation: (information) => {
      client = information;
    },
    tokens: () => undefined,
    saveTokens: () => {},
    redirectToAuthorization: (url) => {
      loginLink = url;
    },
    saveCodeVerifier: () => {},
    codeVerifier: () => "",
  };
  await auth(provider, { serverUrl, fetchFn: timedFetch });
  if (!loginLink) throw new Error("no login link after discovery and registration");
  return { client, loginLink };
}

async function openLoginPage(loginLink, redirectUrl) {
  let url = loginLink;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await timedFetch(url, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0" },
    });
    const location = response.headers.get("location");
    if (location) {
      url = new URL(location, url);
      if (url.href.startsWith(redirectUrl)) {
        const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
        throw new Error(`sent back to Copilot without a login: ${error}`);
      }
      continue;
    }
    if (hop > 0 && BOT_CHECK_STATUSES.has(response.status)) {
      return { result: "VERIFY", page: `${response.status} ${url.host}` };
    }
    if (!response.ok) throw new Error(`${url.host} answered ${response.status}`);
    const text = (await response.text())
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ");
    const errorMatch = text.match(ERROR_PAGE_TEXT);
    if (errorMatch) {
      const context = text.slice(Math.max(0, errorMatch.index - 60), errorMatch.index + 80);
      throw new Error(`${url.host} shows an error: ${context.replace(/\s+/g, " ").trim()}`);
    }
    return { result: "PASS", page: `${response.status} ${url.host}` };
  }
  throw new Error(`more than ${MAX_REDIRECTS} redirects`);
}

async function check({ label, serverUrl }, useClientMetadata) {
  const port = 49152 + Math.floor(Math.random() * 16384);
  const redirectUrl = `http://127.0.0.1:${port}/callback`;
  try {
    const { client, loginLink } = await getLoginLink(serverUrl, redirectUrl, useClientMetadata);
    if (!loginLink.searchParams.get("state")) throw new Error("login link has no state");
    const clientKind =
      client.client_id === CLIENT_METADATA_URL ? "metadata-document" : "registered";
    const { result, page } = await openLoginPage(loginLink, redirectUrl);
    const verifyHint = result === "VERIFY" ? ` (blocks scripts; open ${loginLink.href})` : "";
    return {
      label,
      result,
      detail: `client=${clientKind} secret=${client.client_secret ? "yes" : "no"} login=${page}${verifyHint}`,
    };
  } catch (error) {
    return { label, result: "FAIL", detail: String(error?.message ?? error).slice(0, 200) };
  }
}

async function main(args) {
  if (args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const targets =
    args.length > 0 ? args.map((url) => ({ label: url, serverUrl: url })) : await loadCatalog();
  const useClientMetadata = await isClientMetadataPublished();
  console.log(`Checked ${new Date().toISOString()} with client_name "${CLIENT_NAME}"`);
  if (!useClientMetadata) {
    console.log(`${CLIENT_METADATA_URL} is not published; every service uses registration.`);
  }
  const results = await Promise.all(targets.map((target) => check(target, useClientMetadata)));
  const width = Math.max(...results.map((result) => result.label.length));
  for (const { label, result, detail } of results) {
    console.log(`${result.padEnd(6)}  ${label.padEnd(width)}  ${detail}`);
  }
  const count = (result) => results.filter((entry) => entry.result === result).length;
  console.log(
    `${count("PASS")} passed, ${count("VERIFY")} to open in a browser, ${count("FAIL")} failed`
  );
  if (count("FAIL") > 0) process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
