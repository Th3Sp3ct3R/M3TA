import type { Target, TargetQuery, TargetSource } from "./types.js";
import { mapRowToTarget } from "./live.js";

/**
 * Fixture rows in the exact live `data[]` shape (from a real response),
 * so mapping is exercised offline. Deliberately varied for filter assertions.
 */
export const TARGET_FIXTURE_ROWS: Record<string, any>[] = [
  {
    pk: "1642647", username: "cayla.craft", full_name: "Executive Coach",
    is_verified: true, is_business: false, follower_count: 119866, media_count: 2874,
    category_name: "Entrepreneur", biography: "I help women close deals.",
    external_url: "https://caylacraft.com", city_name: "", country: "United States",
    public_email: "hi@caylacraft.com", contact_phone_number: "",
  },
  {
    pk: "194045534", username: "richiezav", full_name: "Richard Z",
    is_verified: false, is_business: true, follower_count: 45000, media_count: 800,
    category_name: "Business", biography: "Founder.", external_url: "",
    city_name: "New York", country: "United States",
    public_email: "rich@example.com", contact_phone_number: "",
  },
  {
    pk: "555000111", username: "fitldn", full_name: "Fit London",
    is_verified: true, is_business: false, follower_count: 8200, media_count: 1200,
    category_name: "Fitness", biography: "Coach.", external_url: "",
    city_name: "London", country: "United Kingdom",
    public_email: "", contact_phone_number: "",
  },
  {
    pk: "777222333", username: "bigmusic", full_name: "Big Music",
    is_verified: true, is_business: false, follower_count: 500000, media_count: 400,
    category_name: "Musician", biography: "Sound.", external_url: "https://big.fm",
    city_name: "Los Angeles", country: "United States",
    public_email: "", contact_phone_number: "",
  },
  {
    pk: "888444555", username: "glowbeauty", full_name: "Glow",
    is_verified: false, is_business: true, follower_count: 22000, media_count: 950,
    category_name: "Beauty", biography: "Skincare.", external_url: "",
    city_name: "Toronto", country: "Canada",
    public_email: "glow@example.com", contact_phone_number: "+1000",
  },
];

/** Deterministic, offline TargetSource. Applies the concrete TargetQuery filters. */
export class MockTargetSource implements TargetSource {
  readonly name = "mock";
  private readonly targets: Target[];

  constructor(rows: Record<string, any>[] = TARGET_FIXTURE_ROWS) {
    this.targets = rows.map(mapRowToTarget);
  }

  async search(query: TargetQuery): Promise<Target[]> {
    let out = this.targets.filter((t) => {
      if (query.country && t.country !== query.country) return false;
      if (query.minFollowers != null && (t.followerCount ?? 0) < query.minFollowers) return false;
      if (query.maxFollowers != null && (t.followerCount ?? Infinity) > query.maxFollowers) return false;
      if (query.isVerified != null && Boolean(t.isVerified) !== query.isVerified) return false;
      if (query.hasEmail != null && Boolean(t.email) !== query.hasEmail) return false;
      return true;
    });
    if (query.limit != null) out = out.slice(0, query.limit);
    return out;
  }
}
