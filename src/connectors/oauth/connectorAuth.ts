import { COPILOT_OAUTH_CLIENT_METADATA_URL } from "@/constants";
import { requestUrlFetch, ServiceUnreachableError } from "@/connectors/oauth/requestUrlFetch";
import { logWarn } from "@/logger";
import type { KeychainService } from "@/services/keychainService";
import { startLoopbackServer } from "@/utils/loopbackServer";
import {
  auth,
  discoverAuthorizationServerMetadata,
  refreshAuthorization,
  selectClientAuthMethod,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  InvalidClientError,
  InvalidGrantError,
  UnauthorizedClientError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const CLIENT_NAME = "Copilot for Obsidian";
const CALLBACK_PATH = "/callback";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const EXPIRY_MARGIN_MS = 60 * 1000;

export interface ConnectorLoginTarget {
  connectionId: string;
  serverUrl: string;
  serviceName: string;
}

export type LoginFailureReason = "cancelled-on-service" | "timed-out" | "rejected" | "unreachable";

export type LoginOutcome =
  | { status: "connected" }
  | { status: "cancelled" }
  | { status: "failed"; reason: LoginFailureReason };

export interface ConnectorLogin {
  readonly connectionId: string;
  readonly serviceName: string;
  readonly outcome: Promise<LoginOutcome>;
  loginUrl(): string | null;
  cancel(): void;
}

export type AccessTokenResult =
  | { status: "connected"; accessToken: string }
  | { status: "needs-login" }
  | { status: "unreachable" };

type ConnectorKeychain = Pick<
  KeychainService,
  "getVaultId" | "getSecretById" | "setSecretById" | "deleteSecretById"
>;

export interface ConnectorAuthDeps {
  keychain: ConnectorKeychain;
  openUrl: (url: string) => void;
}

interface StoredLogin {
  issuer: string;
  client: OAuthClientInformationMixed;
  tokens: OAuthTokens;
  expiresAt?: number;
  resource?: string;
}

const NEEDS_LOGIN: AccessTokenResult = Object.freeze({ status: "needs-login" });
const UNREACHABLE: AccessTokenResult = Object.freeze({ status: "unreachable" });

export function loginFailureMessage(reason: LoginFailureReason, serviceName: string): string {
  switch (reason) {
    case "cancelled-on-service":
      return `Login was cancelled on ${serviceName}'s page.`;
    case "timed-out":
      return "The login timed out. Try again when you're ready.";
    case "rejected":
      return `${serviceName} didn't accept Copilot's login.`;
    case "unreachable":
      return `Couldn't reach ${serviceName}. Check your connection.`;
  }
}

export class ConnectorAuth {
  private active: ConnectorLogin | null = null;
  private readonly refreshes = new Map<string, Promise<AccessTokenResult>>();

  constructor(private readonly deps: ConnectorAuthDeps) {}

  get activeLogin(): ConnectorLogin | null {
    return this.active;
  }

  login(target: ConnectorLoginTarget): ConnectorLogin {
    if (this.active) {
      throw new Error(`Finish or cancel the ${this.active.serviceName} login first.`);
    }
    const login = startLogin(target, this.deps.openUrl, async (stored) => {
      // Logging in again replaces the stored login; revoke it (after any refresh in flight, as Disconnect
      // does) so the service keeps only the new login's tokens.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/23
      await this.refreshes.get(target.connectionId);
      const replaced = this.read(target.connectionId);
      this.write(target.connectionId, stored);
      if (replaced) {
        void revoke(replaced).catch((error) =>
          logWarn("[Connectors] Couldn't revoke the replaced login.", error)
        );
      }
    });
    this.active = login;
    void login.outcome.then(() => {
      if (this.active === login) this.active = null;
    });
    return login;
  }

  accessToken(
    connectionId: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<AccessTokenResult> {
    const stored = this.read(connectionId);
    if (!stored) return Promise.resolve(NEEDS_LOGIN);
    if (!options.forceRefresh && !isExpired(stored)) {
      return Promise.resolve({ status: "connected", accessToken: stored.tokens.access_token });
    }
    // Callers share one refresh so a refresh token that rotates on use is spent only once.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/23
    let refresh = this.refreshes.get(connectionId);
    if (!refresh) {
      refresh = this.refresh(connectionId, stored).finally(() =>
        this.refreshes.delete(connectionId)
      );
      this.refreshes.set(connectionId, refresh);
    }
    return refresh;
  }

  async disconnect(connectionId: string): Promise<void> {
    // A refresh in flight would spend the stored refresh token and write a new login after this deletes it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/23
    await this.refreshes.get(connectionId);
    const stored = this.read(connectionId);
    if (!stored) return;
    try {
      await revoke(stored);
    } catch (error) {
      logWarn("[Connectors] Couldn't revoke the login; deleting it locally.", error);
    }
    this.deps.keychain.deleteSecretById(this.keychainId(connectionId));
  }

  private async refresh(connectionId: string, stored: StoredLogin): Promise<AccessTokenResult> {
    if (!stored.tokens.refresh_token) return NEEDS_LOGIN;
    try {
      const metadata = await discoverAuthorizationServerMetadata(stored.issuer, {
        fetchFn: requestUrlFetch,
      });
      const tokens = await refreshAuthorization(stored.issuer, {
        metadata,
        clientInformation: stored.client,
        refreshToken: stored.tokens.refresh_token,
        resource: stored.resource,
        fetchFn: requestUrlFetch,
      });
      this.write(connectionId, { ...stored, tokens, expiresAt: expiresAt(tokens) });
      return { status: "connected", accessToken: tokens.access_token };
    } catch (error) {
      if (
        error instanceof InvalidGrantError ||
        error instanceof InvalidClientError ||
        error instanceof UnauthorizedClientError
      ) {
        this.deps.keychain.deleteSecretById(this.keychainId(connectionId));
        return NEEDS_LOGIN;
      }
      logWarn("[Connectors] Couldn't refresh the login.", error);
      return UNREACHABLE;
    }
  }

  private keychainId(connectionId: string): string {
    return `copilot-v${this.deps.keychain.getVaultId()}-connector-${connectionId}`;
  }

  private read(connectionId: string): StoredLogin | null {
    const raw = this.deps.keychain.getSecretById(this.keychainId(connectionId));
    return raw ? (JSON.parse(raw) as StoredLogin) : null;
  }

  private write(connectionId: string, stored: StoredLogin): void {
    this.deps.keychain.setSecretById(this.keychainId(connectionId), JSON.stringify(stored));
  }
}

function startLogin(
  target: ConnectorLoginTarget,
  openUrl: (url: string) => void,
  save: (stored: StoredLogin) => Promise<void>
): ConnectorLogin {
  const state = crypto.randomUUID();
  let redirectUrl = "";
  let authorizationUrl: URL | null = null;
  let client: OAuthClientInformationMixed | undefined;
  let codeVerifier = "";
  let settled = false;
  let settle: (outcome: LoginOutcome) => void = () => {};
  const outcome = new Promise<LoginOutcome>((resolve) => (settle = resolve));

  // The login's client registration and tokens stay in memory until the code exchange succeeds,
  // so a login that does not finish leaves the connection's previous login untouched.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/23
  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return redirectUrl;
    },
    clientMetadataUrl: COPILOT_OAUTH_CLIENT_METADATA_URL,
    get clientMetadata() {
      return {
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    },
    state: () => state,
    clientInformation: () => client,
    saveClientInformation: (information) => {
      client = information;
    },
    tokens: () => undefined,
    saveTokens: (tokens) => {
      if (!client) throw new Error("The login finished without a client registration.");
      return save({
        issuer: tokens.issuer ?? target.serverUrl,
        client,
        tokens,
        expiresAt: expiresAt(tokens),
        resource: authorizationUrl?.searchParams.get("resource") ?? undefined,
      });
    },
    redirectToAuthorization: (url) => {
      // A login cancelled while Copilot was still contacting the service must not open the browser.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/23
      if (settled) return;
      authorizationUrl = url;
      openUrl(url.href);
    },
    saveCodeVerifier: (verifier) => {
      codeVerifier = verifier;
    },
    codeVerifier: () => codeVerifier,
  };

  const server = startLoopbackServer("Connector login", async (request, response) => {
    const url = new URL(request.url ?? "/", redirectUrl);
    if (url.pathname !== CALLBACK_PATH || url.searchParams.get("state") !== state) {
      // Only the service's redirect for this login carries its state; anything else is not an answer.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/23
      response.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get("code");
    let result: LoginOutcome;
    if (!code) {
      const denied = url.searchParams.get("error") === "access_denied";
      result = { status: "failed", reason: denied ? "cancelled-on-service" : "rejected" };
    } else {
      result = await exchange(code);
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", Connection: "close" });
    response.end(resultPage(target.serviceName, result));
    finish(result);
  });
  const timeout = window.setTimeout(
    () => finish({ status: "failed", reason: "timed-out" }),
    LOGIN_TIMEOUT_MS
  );

  function finish(result: LoginOutcome): void {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    server.close();
    settle(result);
  }

  async function exchange(code: string): Promise<LoginOutcome> {
    try {
      await auth(provider, {
        serverUrl: target.serverUrl,
        authorizationCode: code,
        fetchFn: requestUrlFetch,
      });
      return { status: "connected" };
    } catch (error) {
      return loginFailure(error);
    }
  }

  void (async () => {
    try {
      redirectUrl = `${await server.origin}${CALLBACK_PATH}`;
      await auth(provider, { serverUrl: target.serverUrl, fetchFn: requestUrlFetch });
    } catch (error) {
      finish(loginFailure(error));
    }
  })();

  return Object.freeze({
    connectionId: target.connectionId,
    serviceName: target.serviceName,
    outcome,
    loginUrl: () => authorizationUrl?.href ?? null,
    cancel: () => finish({ status: "cancelled" }),
  });
}

function loginFailure(error: unknown): LoginOutcome {
  logWarn("[Connectors] The login didn't finish.", error);
  return {
    status: "failed",
    reason: error instanceof ServiceUnreachableError ? "unreachable" : "rejected",
  };
}

function expiresAt(tokens: OAuthTokens): number | undefined {
  return tokens.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000;
}

function isExpired(stored: StoredLogin): boolean {
  return stored.expiresAt !== undefined && Date.now() >= stored.expiresAt - EXPIRY_MARGIN_MS;
}

async function revoke(stored: StoredLogin): Promise<void> {
  const metadata = await discoverAuthorizationServerMetadata(stored.issuer, {
    fetchFn: requestUrlFetch,
  });
  if (!metadata || !("revocation_endpoint" in metadata) || !metadata.revocation_endpoint) return;
  const { client, tokens } = stored;
  const params = new URLSearchParams({
    token: tokens.refresh_token ?? tokens.access_token,
    token_type_hint: tokens.refresh_token ? "refresh_token" : "access_token",
  });
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  const method = selectClientAuthMethod(
    client,
    metadata.revocation_endpoint_auth_methods_supported ??
      metadata.token_endpoint_auth_methods_supported ??
      []
  );
  if (method === "client_secret_basic") {
    headers.set("Authorization", `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`);
  } else {
    params.set("client_id", client.client_id);
    if (method === "client_secret_post" && client.client_secret) {
      params.set("client_secret", client.client_secret);
    }
  }
  const response = await requestUrlFetch(metadata.revocation_endpoint, {
    method: "POST",
    headers,
    body: params,
  });
  if (!response.ok) logWarn(`[Connectors] Revocation answered HTTP ${response.status}.`);
}

const CONNECTED_BADGES = `<div class="badges" aria-hidden="true">
<div class="tile copilot"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg></div>
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1f8f4e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
<div class="tile service">{initial}</div>
</div>
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function resultPage(serviceName: string, result: LoginOutcome): string {
  const connected = result.status !== "failed";
  const heading = connected
    ? `${serviceName} is connected to Copilot`
    : `${serviceName} login didn't finish`;
  const body = connected
    ? "You can close this tab and go back to Obsidian."
    : `${loginFailureMessage(result.reason, serviceName)} Go back to Obsidian and click Try again.`;
  const badges = connected
    ? CONNECTED_BADGES.replace("{initial}", escapeHtml(serviceName[0] ?? ""))
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>${escapeHtml(heading)}</title>
<style>
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #ffffff; color: #1e1e1e; text-align: center; }
main { padding: 0 40px; }
.badges { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 16px; }
.tile { width: 44px; height: 44px; border-radius: 11px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
.copilot { background: #7350e0; color: #ffffff; }
.service { border: 1px solid #dddddd; font-weight: 700; font-size: 20px; }
h1 { margin: 0 0 12px; font-size: 22px; font-weight: 600; }
p { margin: 0; font-size: 15px; color: #555555; }
</style>
</head>
<body>
<main>
${badges}<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(body)}</p>
</main>
</body>
</html>
`;
}
