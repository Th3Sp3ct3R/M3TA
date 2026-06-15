// ImageSearch — DIRECT image URLs for a query. The missing capability that
// made "show me pictures of X" a 20-round flail: page-scraping search returns
// article links, and stock-photo sites Cloudflare-wall headless browsers.
// This returns the actual image files in one call.
//
// Backends: DuckDuckGo Images (vqd token + i.js JSON endpoint, keyless) and
// Brave Image Search when ARES_BRAVE_API_KEY is present. Brave first, DDG
// fallback — same chain philosophy as WebSearch.

import { z } from "zod";
import { buildTool } from "./_shared.js";

export interface ImageResult {
  title: string;
  /** Direct image file URL (renderable in <img>). */
  imageUrl: string;
  thumbnailUrl?: string;
  /** The page the image came from (attribution). */
  sourceUrl?: string;
  width?: number;
  height?: number;
}

export interface ImageSearchOutput {
  query: string;
  results: ImageResult[];
  engine: string;
}

const inputSchema = z
  .object({
    query: z.string().min(2).describe("What to find images of."),
    max_results: z.number().int().positive().max(12).default(6),
  })
  .strict();

export function makeImageSearchTool() {
  return buildTool({
    name: "ImageSearch",
    description:
      "Search for IMAGES and get back DIRECT image-file URLs (plus source pages for attribution). Use this whenever the user wants to SEE pictures of something — it is one call, instead of browsing/screenshotting pages. Put the returned imageUrl values in your final reply (markdown: ![title](imageUrl)) so they render inline in the chat.",
    safety: "read-only",
    concurrency: "parallel-safe",
    inputZod: inputSchema,
    activityDescription: (i) => `Finding images of ${i.query.slice(0, 50)}`,

    async call(i, ctx): Promise<{ output: ImageSearchOutput; display: string }> {
      const braveKey = process.env.ARES_BRAVE_API_KEY || process.env.BRAVE_API_KEY || "";
      let results: ImageResult[] = [];
      let engine = "DuckDuckGo Images";
      if (braveKey) {
        try {
          results = await braveImages(i.query, braveKey, ctx.signal);
          engine = "Brave Images";
        } catch {
          results = [];
        }
      }
      if (results.length === 0) {
        results = await duckDuckGoImages(i.query, ctx.signal);
        engine = "DuckDuckGo Images";
      }
      const sliced = results.slice(0, i.max_results);
      return {
        output: { query: i.query, results: sliced, engine },
        display: `${sliced.length} image${sliced.length === 1 ? "" : "s"} from ${engine}`,
      };
    },
  });
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** DDG images: fetch the search page for a vqd token, then hit the JSON API. */
export async function duckDuckGoImages(query: string, signal: AbortSignal): Promise<ImageResult[]> {
  const tokenPage = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
    signal,
    headers: { "user-agent": BROWSER_UA, accept: "text/html" },
  });
  if (!tokenPage.ok) throw new Error(`DDG token page returned ${tokenPage.status}`);
  const html = await tokenPage.text();
  const vqd = html.match(/vqd=["']?([\d-]+)["']?/)?.[1] ?? html.match(/vqd=([\d-]+)/)?.[1];
  if (!vqd) throw new Error("DDG images: could not extract vqd token");

  const api = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`;
  const res = await fetch(api, {
    signal,
    headers: { "user-agent": BROWSER_UA, accept: "application/json", referer: "https://duckduckgo.com/" },
  });
  if (!res.ok) throw new Error(`DDG images API returned ${res.status}`);
  const body = (await res.json()) as { results?: Array<{ title?: string; image?: string; thumbnail?: string; url?: string; width?: number; height?: number }> };
  return (body.results ?? [])
    .filter((r): r is { title?: string; image: string; thumbnail?: string; url?: string; width?: number; height?: number } => Boolean(r.image))
    .map((r) => ({
      title: r.title ?? "",
      imageUrl: r.image,
      thumbnailUrl: r.thumbnail,
      sourceUrl: r.url,
      width: r.width,
      height: r.height,
    }));
}

export async function braveImages(query: string, key: string, signal: AbortSignal): Promise<ImageResult[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=12`, {
    signal,
    headers: { accept: "application/json", "x-subscription-token": key },
  });
  if (!res.ok) throw new Error(`Brave images returned ${res.status}`);
  const body = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; properties?: { url?: string }; thumbnail?: { src?: string } }>;
  };
  return (body.results ?? [])
    .filter((r): r is { title?: string; url?: string; properties: { url: string }; thumbnail?: { src?: string } } => Boolean(r.properties?.url))
    .map((r) => ({
      title: r.title ?? "",
      imageUrl: r.properties.url,
      thumbnailUrl: r.thumbnail?.src,
      sourceUrl: r.url,
    }));
}
