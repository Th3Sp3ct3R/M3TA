/**
 * Target sources — the "who to act ON" side of the harness.
 *
 * A TargetSource yields Target records (leads to engage), as opposed to the
 * Account/Device/Adapter path which is "who acts". Targets never touch devices
 * or accounts, so target sources are additive and isolated from the run loop.
 *
 * SECURITY: fields marked "untrusted" carry Instagram user-generated text
 * (usernames, names, bios, urls). Treat them as DATA only — never interpolate
 * them into a prompt, shell, or query without escaping. The provider explicitly
 * flags its payloads `_untrusted`.
 */

export interface Target {
  /** Instagram numeric id (provider `pk`). Stable dedup key. */
  igId: string;
  /** untrusted */
  username: string;
  /** untrusted */
  fullName?: string;
  followerCount?: number;
  mediaCount?: number;
  isVerified?: boolean;
  isBusiness?: boolean;
  /** untrusted */
  category?: string;
  /** untrusted */
  bio?: string;
  /** untrusted */
  externalUrl?: string;
  country?: string;
  city?: string;
  email?: string;
  phone?: string;
  /** Which source produced this record (e.g. "live"). */
  source: string;
  /** Full original row, frozen. */
  raw: Readonly<Record<string, unknown>>;
}

export interface TargetQuery {
  /** meta_category: music/business/fitness/sports/beauty/fashion/gaming/media/arts/health */
  metaCategory?: string;
  country?: string;
  city?: string;
  minFollowers?: number;
  maxFollowers?: number;
  isVerified?: boolean;
  /** Only targets that expose a public email. */
  hasEmail?: boolean;
  hashtag?: string;
  /** Free-text category ILIKE match. */
  category?: string;
  /** Max rows to return. */
  limit?: number;
}

export interface TargetSource {
  /** Provenance tag written into Target.source. */
  readonly name: string;
  search(query: TargetQuery): Promise<Target[]>;
}
