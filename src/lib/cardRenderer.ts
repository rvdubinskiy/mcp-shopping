import type { ProductOffer } from "./yandex.js";

interface CardRenderOptions {
  /**
   * Maximum width (characters) for each card. This keeps things readable inside ChatGPT.
   */
  width?: number;
}

const DEFAULT_WIDTH = 68;

export function renderProductCards(offers: ProductOffer[], options: CardRenderOptions = {}): string {
  const width = Math.max(40, Math.min(options.width ?? DEFAULT_WIDTH, 90));
  const cardLines = offers.map((offer, index) => renderSingleCard(offer, width, index + 1));
  return cardLines.join("\n\n");
}

function renderSingleCard(offer: ProductOffer, width: number, order: number): string {
  const border = "─".repeat(width - 2);
  const header = centerText(`${order}. ${offer.title}`, width - 4);

  const body: string[] = [];
  body.push(formatRow("Price", offer.priceText, width));

  if (offer.seller) {
    body.push(formatRow("Seller", offer.seller, width));
  }

  if (offer.rating) {
    const ratingText = offer.rating.count
      ? `${offer.rating.value}/5 • ${offer.rating.count} отзывов`
      : `${offer.rating.value}/5`;
    body.push(formatRow("Rating", ratingText, width));
  }

  if (offer.delivery) {
    body.push(formatRow("Delivery", offer.delivery, width));
  }

  if (offer.location) {
    body.push(formatRow("Location", offer.location, width));
  }

  if (offer.imageUrl) {
    body.push(formatRow("Image", offer.imageUrl, width));
  }

  body.push(formatRow("Link", offer.url, width));

  return [
    `┌${border}┐`,
    `│ ${header} │`,
    `├${border}┤`,
    ...body,
    `└${border}┘`,
  ].join("\n");
}

function formatRow(label: string, value: string, width: number): string {
  const labelText = `${label}:`;
  const available = width - 4 - labelText.length;
  const wrapped = wrapText(value, available);
  const [first, ...rest] = wrapped;
  const lines = [`│ ${labelText} ${padRight(first, available)} │`];
  for (const line of rest) {
    lines.push(`│ ${" ".repeat(labelText.length + 1)}${padRight(line, available)} │`);
  }
  return lines.join("\n");
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width && current) {
      lines.push(current);
      current = word;
    } else if (candidate.length > width) {
      lines.push(candidate.slice(0, width));
      current = candidate.slice(width);
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

function padRight(text: string, width: number): string {
  if (text.length >= width) {
    return text;
  }
  return text + " ".repeat(width - text.length);
}

function centerText(text: string, width: number): string {
  if (text.length >= width) {
    return text.slice(0, width);
  }

  const totalPadding = width - text.length;
  const left = Math.floor(totalPadding / 2);
  const right = totalPadding - left;
  return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
}
