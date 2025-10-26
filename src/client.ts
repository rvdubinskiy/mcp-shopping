import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client";
import { renderProductCards } from "./lib/cardRenderer.js";
import { searchYandexShopping, type ProductOffer } from "./lib/yandex.js";

interface CliArguments {
  query: string;
  limit?: number;
}

async function readCliArguments(): Promise<CliArguments> {
  const [queryArg, limitArg] = process.argv.slice(2);

  if (queryArg) {
    return {
      query: queryArg,
      limit: limitArg ? Number.parseInt(limitArg, 10) : undefined,
    };
  }

  const rl = createInterface({ input, output });
  const query = (await rl.question("Введите поисковый запрос: ")).trim();
  const limitText = (await rl.question("Максимальное количество товаров (опционально): ")).trim();
  rl.close();

  return {
    query,
    limit: limitText ? Number.parseInt(limitText, 10) : undefined,
  };
}

async function callMcpServer(args: CliArguments): Promise<string> {
  const serverPath = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/server.js");

  if (!existsSync(serverPath)) {
    throw new Error("Собранный MCP сервер не найден. Выполните `npm run build`.");
  }

  const client = new Client({
    transport: {
      type: "stdio",
      command: process.execPath,
      args: [serverPath],
    },
  });

  await client.connect();

  try {
    const response = await client.callTool({
      name: "search_yandex_shopping",
      input: {
        query: args.query,
        limit: args.limit,
      },
    });

    const textContent = response.content.find((item) => item.type === "text");
    if (textContent && "text" in textContent && textContent.text) {
      return textContent.text;
    }

    const jsonContent = response.content.find((item) => item.type === "json");
    if (jsonContent && "json" in jsonContent) {
      return renderProductCards(jsonContent.json as ProductOffer[]);
    }

    throw new Error("Ответ MCP сервера не содержит поддерживаемый формат контента.");
  } finally {
    await client.close();
  }
}

async function runCli(): Promise<void> {
  const args = await readCliArguments();

  if (!args.query) {
    throw new Error("Поисковый запрос не может быть пустым.");
  }

  try {
    const cards = await callMcpServer(args);
    console.log(cards);
  } catch (error) {
    console.warn("Не удалось использовать локальный MCP сервер. Выполняю прямой поиск…");
    const offers = await searchYandexShopping(args.query, { limit: args.limit });
    console.log(renderProductCards(offers));
  }
}

runCli().catch((error) => {
  console.error(`Ошибка: ${(error as Error).message}`);
  process.exitCode = 1;
});
