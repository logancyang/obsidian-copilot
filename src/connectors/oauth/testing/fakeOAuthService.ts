import { requireNodeModule } from "@/utils/desktopRuntime";
import type { RequestUrlParam } from "obsidian";

export const FAKE_SERVICE_ORIGIN = "https://notion.fake";
export const FAKE_SERVER_URL = `${FAKE_SERVICE_ORIGIN}/mcp`;

export interface FakeOAuthServiceOptions {
  supportsClientMetadataDocuments?: boolean;
  issuesClientSecret?: boolean;
  publishesRevocation?: boolean;
  rejectsRegistration?: boolean;
}

export interface FakeRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

interface IssuedCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
}

function json(status: number, body: unknown): FakeResponse {
  return { status, headers: { "content-type": "application/json" }, text: JSON.stringify(body) };
}

export class FakeOAuthService {
  readonly requests: FakeRequest[] = [];
  readonly revokedTokens: string[] = [];
  readonly registrations: Array<Record<string, unknown>> = [];
  unreachable = false;
  refreshFailsEchoingRequest = false;
  private readonly clientSecrets = new Map<string, string | undefined>();
  private readonly codes = new Map<string, IssuedCode>();
  private readonly refreshTokens = new Set<string>();
  private readonly revocationWaiters: Array<(token: string) => void> = [];
  private issued = 0;

  constructor(private readonly options: FakeOAuthServiceOptions = {}) {}

  readonly requestUrl = async (param: RequestUrlParam): Promise<FakeResponse> => {
    if (this.unreachable) throw new Error("net::ERR_INTERNET_DISCONNECTED");
    const url = new URL(param.url);
    const headers = Object.fromEntries(
      Object.entries(param.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])
    );
    const request: FakeRequest = {
      method: param.method ?? "GET",
      path: url.pathname,
      headers,
      body: typeof param.body === "string" ? param.body : "",
    };
    this.requests.push(request);
    return this.route(request);
  };

  requestsTo(path: string): FakeRequest[] {
    return this.requests.filter((request) => request.path === path);
  }

  approve(authorizationUrl: string): string {
    const url = new URL(authorizationUrl);
    const code = `code-${++this.issued}`;
    this.codes.set(code, {
      clientId: url.searchParams.get("client_id") ?? "",
      redirectUri: url.searchParams.get("redirect_uri") ?? "",
      challenge: url.searchParams.get("code_challenge") ?? "",
    });
    return this.redirect(url, { code });
  }

  deny(authorizationUrl: string): string {
    return this.redirect(new URL(authorizationUrl), { error: "access_denied" });
  }

  nextRevocation(): Promise<string> {
    return new Promise((resolve) => this.revocationWaiters.push(resolve));
  }

  rejectRefreshTokens(): void {
    this.refreshTokens.clear();
  }

  private redirect(authorizationUrl: URL, params: Record<string, string>): string {
    const callback = new URL(authorizationUrl.searchParams.get("redirect_uri") ?? "");
    for (const [name, value] of Object.entries(params)) callback.searchParams.set(name, value);
    callback.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "");
    return callback.href;
  }

  private route(request: FakeRequest): FakeResponse {
    const key = `${request.method} ${request.path}`;
    switch (key) {
      case "GET /.well-known/oauth-protected-resource/mcp":
        return json(200, {
          resource: FAKE_SERVER_URL,
          authorization_servers: [FAKE_SERVICE_ORIGIN],
        });
      case "GET /.well-known/oauth-authorization-server":
        return json(200, {
          issuer: FAKE_SERVICE_ORIGIN,
          authorization_endpoint: `${FAKE_SERVICE_ORIGIN}/authorize`,
          token_endpoint: `${FAKE_SERVICE_ORIGIN}/token`,
          registration_endpoint: `${FAKE_SERVICE_ORIGIN}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
          ...(this.options.publishesRevocation && {
            revocation_endpoint: `${FAKE_SERVICE_ORIGIN}/revoke`,
          }),
          ...(this.options.supportsClientMetadataDocuments && {
            client_id_metadata_document_supported: true,
          }),
        });
      case "POST /register":
        return this.register(request);
      case "POST /token":
        return this.token(request);
      case "POST /revoke": {
        const token = new URLSearchParams(request.body).get("token") ?? "";
        this.revokedTokens.push(token);
        this.revocationWaiters.shift()?.(token);
        return { status: 200, headers: {}, text: "" };
      }
      default:
        return json(404, { error: "not_found" });
    }
  }

  private register(request: FakeRequest): FakeResponse {
    if (this.options.rejectsRegistration) return json(403, { error: "access_denied" });
    const metadata = JSON.parse(request.body) as Record<string, unknown>;
    this.registrations.push(metadata);
    const clientId = `client-${++this.issued}`;
    const clientSecret = this.options.issuesClientSecret ? `secret-${this.issued}` : undefined;
    this.clientSecrets.set(clientId, clientSecret);
    return json(201, {
      ...metadata,
      client_id: clientId,
      ...(clientSecret && {
        client_secret: clientSecret,
        token_endpoint_auth_method: "client_secret_basic",
      }),
    });
  }

  private token(request: FakeRequest): FakeResponse {
    const params = new URLSearchParams(request.body);
    const clientId = this.authenticate(request, params);
    if (!clientId) return json(401, { error: "invalid_client" });
    if (params.get("grant_type") === "authorization_code") {
      const issued = this.codes.get(params.get("code") ?? "");
      this.codes.delete(params.get("code") ?? "");
      const challenge = requireNodeModule<typeof import("node:crypto")>("crypto")
        .createHash("sha256")
        .update(params.get("code_verifier") ?? "")
        .digest("base64url");
      if (
        !issued ||
        issued.clientId !== clientId ||
        issued.redirectUri !== params.get("redirect_uri") ||
        issued.challenge !== challenge
      ) {
        return json(400, { error: "invalid_grant" });
      }
      return json(200, this.issueTokens());
    }
    if (this.refreshFailsEchoingRequest) {
      return { status: 500, headers: {}, text: `Server error for ${request.body}` };
    }
    const refreshToken = params.get("refresh_token") ?? "";
    if (!this.refreshTokens.delete(refreshToken)) return json(400, { error: "invalid_grant" });
    return json(200, this.issueTokens());
  }

  private authenticate(request: FakeRequest, params: URLSearchParams): string | null {
    const basic = /^Basic (.+)$/.exec(request.headers.authorization ?? "")?.[1];
    if (basic) {
      const [clientId, secret] = Buffer.from(basic, "base64").toString().split(":");
      return this.clientSecrets.get(clientId) === secret ? clientId : null;
    }
    const clientId = params.get("client_id") ?? "";
    if (clientId.startsWith("https://")) return clientId;
    return this.clientSecrets.has(clientId) && !this.clientSecrets.get(clientId) ? clientId : null;
  }

  private issueTokens(): Record<string, unknown> {
    const refreshToken = `refresh-${++this.issued}`;
    this.refreshTokens.add(refreshToken);
    return {
      access_token: `access-${this.issued}`,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
    };
  }
}
