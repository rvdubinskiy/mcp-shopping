import { request } from "undici";
import * as cheerio from "cheerio";

export interface ProductRating {
  value: number;
  count?: number;
}

export interface ProductOffer {
  title: string;
  priceText: string;
  currency?: string;
  priceValue?: number;
  url: string;
  imageUrl?: string;
  seller?: string;
  rating?: ProductRating;
  delivery?: string;
  location?: string;
}

export interface SearchOptions {
  /**
   * Maximum number of products to return. The server enforces a hard cap of 20 items
   * in order to keep the result readable inside ChatGPT conversations.
   */
  limit?: number;
  /**
   * Optional Yandex `lr` region identifier. When omitted the Turkish market (Istanbul – 11508)
   * is used by default.
   */
  regionId?: number;
  /**
   * Abort signal propagated from the MCP runtime so the fetch request can be cancelled when
   * the user aborts the tool invocation.
   */
  signal?: AbortSignal;
}

const DEFAULT_REGION_ID = 11508; // Istanbul region ensures we stay on the Turkish catalog.
const DEFAULT_LIMIT = 12;

export async function searchYandexShopping(
  query: string,
  options: SearchOptions = {}
): Promise<ProductOffer[]> {
  if (!query.trim()) {
    throw new Error("Search query must not be empty.");
  }

  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 20);
  const envRegion = process.env.MCP_YANDEX_REGION;
  const regionFromEnv = envRegion ? Number.parseInt(envRegion, 10) : undefined;
  const resolvedEnvRegion =
    typeof regionFromEnv === "number" && Number.isFinite(regionFromEnv) ? regionFromEnv : undefined;
  const regionId = options.regionId ?? resolvedEnvRegion ?? DEFAULT_REGION_ID;

  const url = new URL("https://yandex.com/shopping/search");
  url.searchParams.set("text", query);
  url.searchParams.set("lr", regionId.toString());
  url.searchParams.set("noreask", "1");

  const response = await request(url, {
    method: "GET",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.6",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: options.signal,
  });

  if (response.statusCode !== 200) {
    const bodyText = await response.body.text();
    throw new Error(
      `Yandex Shopping returned HTTP ${response.statusCode}. Response snippet: ${bodyText.slice(0, 200)}`
    );
  }

  const html = await response.body.text();

  const products = extractOffersFromHtml(html);

  if (!products.length) {
    throw new Error(
      "Could not parse any product offers from Yandex Shopping. The markup might have changed."
    );
  }

  return products.slice(0, limit);
}

function extractOffersFromHtml(html: string): ProductOffer[] {
  const offersFromJson = tryParseOffersFromEmbeddedJson(html);
  if (offersFromJson.length) {
    return offersFromJson;
  }

  return tryParseOffersFromMarkup(html);
}

function tryParseOffersFromEmbeddedJson(html: string): ProductOffer[] {
  const matches = Array.from(
    html.matchAll(/<script[^>]+>\s*window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*<\/script>/gs)
  );

  for (const match of matches) {
    const raw = stripTrailingSemicolon(match[1]);
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const offers = extractOffersFromStateTree(data);
      if (offers.length) {
        return offers;
      }
    } catch (error) {
      // Ignore JSON parse errors and try the next block.
      continue;
    }
  }

  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (nextDataMatch) {
    try {
      const json = JSON.parse(nextDataMatch[1]);
      const offers = extractOffersFromStateTree(json as Record<string, unknown>);
      if (offers.length) {
        return offers;
      }
    } catch {
      // Ignore parsing issues for __NEXT_DATA__.
    }
  }

  return [];
}

function extractOffersFromStateTree(state: Record<string, unknown>): ProductOffer[] {
  const offers: ProductOffer[] = [];

  const iterate = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(iterate);
      return;
    }

    if (value && typeof value === "object") {
      const maybeOffer = toOffer(value as Record<string, unknown>);
      if (maybeOffer) {
        offers.push(maybeOffer);
      }

      Object.values(value).forEach(iterate);
    }
  };

  iterate(state);

  return deduplicateOffers(offers);
}

function toOffer(node: Record<string, unknown>): ProductOffer | null {
  const entity = node.entity as string | undefined;
  const type = node.entityType as string | undefined;
  if (entity !== "product" && type !== "product") {
    return null;
  }

  const title =
    (node.title as string | undefined) ||
    (node.name as string | undefined) ||
    (node.label as string | undefined);

  const price = extractPrice(node);
  const url = extractUrl(node);
  if (!title || !price || !url) {
    return null;
  }

  const offer: ProductOffer = {
    title: sanitizeWhitespace(title),
    priceText: price.text,
    currency: price.currency,
    priceValue: price.value,
    url,
    imageUrl: extractImage(node),
    seller: extractSeller(node),
    rating: extractRating(node),
    delivery: extractDelivery(node),
    location: extractLocation(node),
  };

  return offer;
}

function extractPrice(node: Record<string, unknown>):
  | { text: string; currency?: string; value?: number }
  | null {
  const priceNode = node.price || node.offerPrice || node.minPrice || node.maxPrice || node.prices;
  if (!priceNode) {
    return null;
  }

  if (typeof priceNode === "string") {
    return { text: sanitizeWhitespace(priceNode) };
  }

  if (typeof priceNode === "number") {
    return { text: formatPriceValue(priceNode), value: priceNode };
  }

  if (Array.isArray(priceNode)) {
    for (const item of priceNode) {
      const result = extractPrice(item as Record<string, unknown>);
      if (result) {
        return result;
      }
    }
  }

  if (priceNode && typeof priceNode === "object") {
    const value = typeof priceNode.value === "number" ? priceNode.value : undefined;
    const currency = typeof priceNode.currency === "string" ? priceNode.currency : undefined;
    const text =
      typeof priceNode.text === "string"
        ? sanitizeWhitespace(priceNode.text)
        : value
        ? formatPriceValue(value, currency)
        : undefined;

    if (text) {
      return { text, currency, value };
    }
  }

  return null;
}

function extractUrl(node: Record<string, unknown>): string | undefined {
  const rawUrl =
    (node.url as string | undefined) ||
    (node.link as string | undefined) ||
    (node.productUrl as string | undefined) ||
    (node.slug as string | undefined);

  if (!rawUrl) {
    return undefined;
  }

  if (rawUrl.startsWith("http")) {
    return rawUrl;
  }

  return `https://yandex.com${rawUrl}`;
}

function extractImage(node: Record<string, unknown>): string | undefined {
  const image = node.image || node.thumbnail || node.preview || node.images;

  if (typeof image === "string") {
    return image;
  }

  if (Array.isArray(image)) {
    for (const item of image) {
      const src = extractImage(item as Record<string, unknown>);
      if (src) {
        return src;
      }
    }
  }

  if (image && typeof image === "object") {
    const src = (image as Record<string, unknown>).url as string | undefined;
    if (src) {
      return src;
    }
  }

  return undefined;
}

function extractSeller(node: Record<string, unknown>): string | undefined {
  const shop = node.shop || node.seller || node.merchant;
  if (!shop) {
    return undefined;
  }

  if (typeof shop === "string") {
    return sanitizeWhitespace(shop);
  }

  if (shop && typeof shop === "object") {
    const name = (shop as Record<string, unknown>).name as string | undefined;
    if (name) {
      return sanitizeWhitespace(name);
    }
  }

  return undefined;
}

function extractRating(node: Record<string, unknown>): ProductRating | undefined {
  const rating = node.rating || node.ratingData || node.shopRating;
  if (!rating || typeof rating !== "object") {
    return undefined;
  }

  const value = Number((rating as Record<string, unknown>).valueOf ?? (rating as Record<string, unknown>).value);
  if (!Number.isFinite(value)) {
    return undefined;
  }

  const votes = Number((rating as Record<string, unknown>).count ?? (rating as Record<string, unknown>).reviews);

  return {
    value: Number(value.toFixed(2)),
    count: Number.isFinite(votes) ? Math.round(votes) : undefined,
  };
}

function extractDelivery(node: Record<string, unknown>): string | undefined {
  const delivery = node.delivery || node.deliveryInfo || node.deliveryText;
  if (!delivery) {
    return undefined;
  }

  if (typeof delivery === "string") {
    return sanitizeWhitespace(delivery);
  }

  if (delivery && typeof delivery === "object") {
    const text = (delivery as Record<string, unknown>).text as string | undefined;
    if (text) {
      return sanitizeWhitespace(text);
    }
  }

  return undefined;
}

function extractLocation(node: Record<string, unknown>): string | undefined {
  const region = node.region || node.location || node.shopRegion;
  if (!region) {
    return undefined;
  }

  if (typeof region === "string") {
    return sanitizeWhitespace(region);
  }

  if (region && typeof region === "object") {
    const name = (region as Record<string, unknown>).name as string | undefined;
    if (name) {
      return sanitizeWhitespace(name);
    }
  }

  return undefined;
}

function tryParseOffersFromMarkup(html: string): ProductOffer[] {
  const $ = cheerio.load(html);
  const items: ProductOffer[] = [];

  $("[data-zone-name='product-snippet']").each((_, element) => {
    const container = $(element);
    const title = container.find("a[data-zone-name='title']").text().trim();
    const priceText = container.find("span[aria-hidden='true']").first().text().trim();
    const link = container.find("a[data-zone-name='title']").attr("href");

    if (!title || !priceText || !link) {
      return;
    }

    const offer: ProductOffer = {
      title,
      priceText,
      url: normalizeUrl(link),
      imageUrl: container.find("img").first().attr("src") || undefined,
      seller: container.find(".bOOdY span").first().text().trim() || undefined,
      delivery: container.find("[data-zone-name='delivery']").text().trim() || undefined,
    };

    items.push(offer);
  });

  return deduplicateOffers(items);
}

function normalizeUrl(url: string): string {
  if (url.startsWith("http")) {
    return url;
  }
  return `https://yandex.com${url}`;
}

function stripTrailingSemicolon(json: string): string {
  return json.replace(/[;\s]+$/, "");
}

function deduplicateOffers(offers: ProductOffer[]): ProductOffer[] {
  const seen = new Set<string>();
  const unique: ProductOffer[] = [];

  for (const offer of offers) {
    const key = `${offer.title.toLowerCase()}|${offer.priceText}|${offer.url}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(offer);
    }
  }

  return unique;
}

function formatPriceValue(value: number, currency?: string): string {
  const formatter = new Intl.NumberFormat("tr-TR", {
    style: currency ? "currency" : "decimal",
    currency: currency ?? "TRY",
    maximumFractionDigits: 2,
  });

  return formatter.format(value);
}

function sanitizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
