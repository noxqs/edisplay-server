import type { DB } from "../db.js";

export type OAuthProvider = "anthropic";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string | null;
  /** ms epoch when the access token expires; null if unknown. */
  expiresAt?: number | null;
  scope?: string | null;
  /** Display label (e.g. email); never the token itself. */
  account?: string | null;
}

export interface OAuthRow {
  provider: OAuthProvider;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  scope: string | null;
  account: string | null;
  updated_at: number;
}

/** Public, secret-free view returned to the UI. */
export interface OAuthStatus {
  provider: OAuthProvider;
  connected: boolean;
  account: string | null;
  expiresAt: number | null;
}

/**
 * Stores OAuth tokens per provider. Token values are write-only from the API's
 * perspective — status() never returns them, mirroring the Immich hasApiKey pattern.
 */
export class OAuthCredentialRepo {
  constructor(private readonly db: DB) {}

  get(provider: OAuthProvider): OAuthRow | undefined {
    return this.db.prepare("SELECT * FROM oauth_credentials WHERE provider = ?").get(provider) as
      | OAuthRow
      | undefined;
  }

  upsert(provider: OAuthProvider, t: OAuthTokens): void {
    this.db
      .prepare(
        `INSERT INTO oauth_credentials (provider, access_token, refresh_token, expires_at, scope, account, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           access_token = excluded.access_token,
           refresh_token = COALESCE(excluded.refresh_token, oauth_credentials.refresh_token),
           expires_at = excluded.expires_at,
           scope = COALESCE(excluded.scope, oauth_credentials.scope),
           account = COALESCE(excluded.account, oauth_credentials.account),
           updated_at = excluded.updated_at`,
      )
      .run(
        provider,
        t.accessToken,
        t.refreshToken ?? null,
        t.expiresAt ?? null,
        t.scope ?? null,
        t.account ?? null,
        Date.now(),
      );
  }

  delete(provider: OAuthProvider): void {
    this.db.prepare("DELETE FROM oauth_credentials WHERE provider = ?").run(provider);
  }

  statusOf(provider: OAuthProvider): OAuthStatus {
    const row = this.get(provider);
    return {
      provider,
      connected: !!row?.access_token,
      account: row?.account ?? null,
      expiresAt: row?.expires_at ?? null,
    };
  }
}
