import { Server } from "@modelcontextprotocol/sdk/server";
import { z } from "zod";
import { renderProductCards } from "./lib/cardRenderer.js";
import { searchYandexShopping } from "./lib/yandex.js";

const searchSchema = z.object({
  query: z.string().min(1, "Query must contain at least one character."),
  limit: z.number().int().min(1).max(20).optional(),
  regionId: z.number().int().optional(),
});

const server = new Server({
  name: "yandex-shopping-mcp",
  version: "0.1.0",
  description: "Searches Yandex Shopping for offers on the Turkish market and renders Google Shopping style cards.",
});

server.registerTool({
  name: "search_yandex_shopping",
  description: "Search for products on Yandex Shopping with a focus on Turkish prices.",
  inputSchema: searchSchema,
  handler: async (input, context) => {
    const offers = await searchYandexShopping(input.query, {
      limit: input.limit,
      regionId: input.regionId,
      signal: context?.signal,
    });

    const cards = renderProductCards(offers);

    return {
      content: [
        {
          type: "text",
          text: cards,
        },
        {
          type: "json",
          json: offers,
        },
      ],
    };
  },
});

await server.start();
