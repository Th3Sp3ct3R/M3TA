import type { Target, TargetQuery, TargetSource } from "./types.js";

/**
 * Minimal Streamable-HTTP MCP client — just enough to call one tool.
 * Handles the initialize handshake, session header, and SSE-or-JSON bodies.
 * Swappable for @modelcontextprotocol/sdk later without touching TargetSource.
 */
export class McpHttpClient {
  private sessionId: string | null = null;

  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly clientInfo = { name: "aza-harness", version: "0.1.0" },
  ) {}

  private parseBody(text: string, ctype: string | null): any {
    if (ctype && ctype.includes("text/event-stream")) {
      const dataLines = text.split(/\r?\n/).filter((l) => l.startsWith("data:"));
      const last = dataLines[dataLines.length - 1];
      return last ? JSON.parse(last.slice(5).trim()) : null;
    }
    return text ? JSON.parse(text) : null;
  }

  private async rpc(method: string, params?: unknown, notification = false): Promise<any> {
    const body: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) body.params = params;
    if (!notification) body.id = `${method}-${Date.now()}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const res = await fetch(this.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (notification) return { status: res.status };

    const json = this.parseBody(await res.text(), res.headers.get("content-type"));
    if (!res.ok || json?.error) {
      const msg = json?.error?.message ?? json?.error ?? `HTTP ${res.status}`;
      throw new Error(`targets MCP ${method} failed: ${msg}`);
    }
    return json;
  }

  private initialized = false;
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: this.clientInfo,
    });
    await this.rpc("notifications/initialized", undefined, true);
    this.initialized = true;
  }

  /** Call a tool and return the parsed JSON text content. */
  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    await this.ensureInitialized();
    const res = await this.rpc("tools/call", { name, arguments: args });
    const text: string = (res?.result?.content ?? [])
      .map((c: { text?: string }) => c.text ?? "")
      .join("");
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text };
    }
  }
}

export interface LiveTargetOptions {
  /** Bearer token; defaults to process.env.TARGETS_MCP_TOKEN. */
  token?: string;
  /** MCP endpoint; defaults to process.env.TARGETS_MCP_ENDPOINT. */
  endpoint?: string;
  /** Inject a client (e.g. a fake) for testing. */
  client?: Pick<McpHttpClient, "callTool">;
}

/** Maps a demographic row into a Target. Keeps untrusted text as data. */
export function mapRowToTarget(row: Record<string, any>): Target {
  return {
    igId: String(row.pk ?? ""),
    username: String(row.username ?? ""),
    fullName: row.full_name || undefined,
    followerCount: typeof row.follower_count === "number" ? row.follower_count : undefined,
    mediaCount: typeof row.media_count === "number" ? row.media_count : undefined,
    isVerified: Boolean(row.is_verified),
    isBusiness: Boolean(row.is_business),
    category: row.category_name || undefined,
    bio: row.biography || undefined,
    externalUrl: row.external_url || undefined,
    country: row.country || undefined,
    city: row.city_name || undefined,
    email: row.public_email || undefined,
    phone: row.contact_phone_number || undefined,
    source: "live",
    raw: Object.freeze({ ...row }),
  };
}

/** Translate a TargetQuery into `search_users_by_demographics` args. */
export function queryToArgs(query: TargetQuery): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (query.metaCategory) args.meta_category = query.metaCategory;
  if (query.country) args.country = query.country;
  if (query.city) args.city = query.city;
  if (query.minFollowers != null) args.min_followers = query.minFollowers;
  if (query.maxFollowers != null) args.max_followers = query.maxFollowers;
  if (query.isVerified != null) args.is_verified = query.isVerified;
  if (query.hasEmail != null) args.has_email = query.hasEmail;
  if (query.hashtag) args.hashtag = query.hashtag;
  if (query.category) args.category = query.category;
  args.limit = query.limit ?? 50;
  return args;
}

/**
 * TargetSource backed by the live HTTP MCP.
 * Zero account burn — pure data query. Live; requires token + endpoint.
 */
export class LiveTargetSource implements TargetSource {
  readonly name = "live";
  private readonly client: Pick<McpHttpClient, "callTool">;

  constructor(opts: LiveTargetOptions = {}) {
    if (opts.client) {
      this.client = opts.client;
    } else {
      const token = opts.token ?? process.env.TARGETS_MCP_TOKEN;
      const endpoint = opts.endpoint ?? process.env.TARGETS_MCP_ENDPOINT;
      if (!token) throw new Error("LiveTargetSource: missing token (set TARGETS_MCP_TOKEN)");
      if (!endpoint) throw new Error("LiveTargetSource: missing endpoint (set TARGETS_MCP_ENDPOINT)");
      this.client = new McpHttpClient(endpoint, token);
    }
  }

  async search(query: TargetQuery): Promise<Target[]> {
    const payload = await this.client.callTool("search_users_by_demographics", queryToArgs(query));
    const rows: Record<string, any>[] = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map(mapRowToTarget);
  }
}
