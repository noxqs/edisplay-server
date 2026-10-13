// Generic OAuth 2.0 authorization-code + PKCE flow for AI providers (Gemini/Claude).
//
// Provider-agnostic by design: endpoints/scopes live in PROVIDERS, while the
// client id/secret come from config (env). See the plan's "Claude OAuth" caveat —
// Anthropic's standard developer auth is an API key; this mirrors the Claude Code
// /ant PKCE login shape, so the anthropic endpoints below may need adjusting to a
// real registered client, and API calls made with the token must send
// `Authorization: Bearer <token>` + `anthropic-beta: oauth-2025-04-20`.
import { randomBytes, createHash } from "node:crypto";
import type { OAuthConfig, OAuthProviderConfig } from "./config.js";
import type { OAuthCredentialRepo, OAuthProvider } from "./repositories/oauthCredentials.js";

interface ProviderEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra query params on the authorize request (e.g. Google's offline access). */
  authorizeParams?: Record<string, string>;
  /** Optional endpoint to fetch a human-readable account label after token exchange. */
  userInfoUrl?: string;
  /** Reads the display label (e.g. email) out of the userinfo JSON. */
  accountFrom?: (info: Record<string, unknown>) => string | null;
}

const PROVIDERS: Record<OAuthProvider, ProviderEndpoints> = {
  anthropic: {
    // Mirrors the Claude Code / `ant auth login` PKCE flow so inference runs
    // against the user's Claude subscription (their plan) rather than metered
    // API billing. Endpoints are overridable assumptions, not a documented
    // developer-API OAuth product.
    authorizeUrl: process.env.ANTHROPIC_OAUTH_AUTHORIZE_URL?.trim() || "https://claude.ai/oauth/authorize",
    tokenUrl: process.env.ANTHROPIC_OAUTH_TOKEN_URL?.trim() || "https://console.anthropic.com/v1/oauth/token",
    scopes: ["org:create_api_key", "user:profile", "user:inference"],
  },
};

interface PendingAuth {
  provider: OAuthProvider;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class OAuthService {
  private pending = new Map<string, PendingAuth>();

  constructor(
    private readonly cfg: OAuthConfig,
    private readonly creds: OAuthCredentialRepo,
  ) {}

  private clientFor(_provider: OAuthProvider): OAuthProviderConfig {
    return this.cfg.anthropic;
  }

  isConfigured(provider: OAuthProvider): boolean {
    return !!this.clientFor(provider).clientId;
  }

  /** Build the provider authorize URL and remember the PKCE verifier under `state`. */
  startAuthorize(provider: OAuthProvider, redirectUri: string): string {
    const client = this.clientFor(provider);
    if (!client.clientId) throw new Error(`${provider} OAuth is not configured`);
    const ep = PROVIDERS[provider];

    const state = base64url(randomBytes(24));
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());

    this.sweep();
    this.pending.set(state, { provider, codeVerifier, redirectUri, createdAt: Date.now() });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: redirectUri,
      scope: ep.scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      ...(ep.authorizeParams ?? {}),
    });
    return `${ep.authorizeUrl}?${params.toString()}`;
  }

  /** Exchange the callback `code` for tokens and persist them. Returns the provider. */
  async handleCallback(code: string, state: string): Promise<OAuthProvider> {
    const entry = this.pending.get(state);
    if (!entry) throw new Error("Unknown or expired OAuth state");
    this.pending.delete(state);
    if (Date.now() - entry.createdAt > STATE_TTL_MS) throw new Error("OAuth state expired");

    const { provider, codeVerifier, redirectUri } = entry;
    const client = this.clientFor(provider);
    const ep = PROVIDERS[provider];

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: client.clientId,
      code_verifier: codeVerifier,
    });
    if (client.clientSecret) body.set("client_secret", client.clientSecret);

    const res = await fetch(ep.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
    }
    const tok = (await res.json()) as TokenResponse;

    const account = await this.fetchAccount(provider, tok.access_token);
    this.creds.upsert(provider, {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? null,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
      scope: tok.scope ?? ep.scopes.join(" "),
      account,
    });
    return provider;
  }

  /** Return a live access token, refreshing if it's expired/near-expiry. Null if not connected. */
  async validAccessToken(provider: OAuthProvider): Promise<string | null> {
    const row = this.creds.get(provider);
    if (!row?.access_token) return null;
    const fresh = !row.expires_at || row.expires_at - Date.now() > REFRESH_SKEW_MS;
    if (fresh) return row.access_token;
    if (!row.refresh_token) return row.access_token; // best effort; may already be expired
    return this.refresh(provider, row.refresh_token);
  }

  private async refresh(provider: OAuthProvider, refreshToken: string): Promise<string | null> {
    const client = this.clientFor(provider);
    const ep = PROVIDERS[provider];
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.clientId,
    });
    if (client.clientSecret) body.set("client_secret", client.clientSecret);

    const res = await fetch(ep.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const tok = (await res.json()) as TokenResponse;
    this.creds.upsert(provider, {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? refreshToken,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
      scope: tok.scope ?? null,
    });
    return tok.access_token;
  }

  private async fetchAccount(provider: OAuthProvider, accessToken: string): Promise<string | null> {
    const ep = PROVIDERS[provider];
    if (!ep.userInfoUrl || !ep.accountFrom) return null;
    try {
      const res = await fetch(ep.userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return null;
      return ep.accountFrom((await res.json()) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.createdAt > STATE_TTL_MS) this.pending.delete(k);
  }
}
