import { describe, expect, test } from "vitest";

import { createExchangeExport } from "@/features/export/exchangeExport";
import { parseExchangeImport } from "./exchangeImport";
import type { HttpExchange } from "@/generated/contracts";

describe("exchange import", () => {
  test("accepts the complete local exchange export envelope", () => {
    const exchange = {
      id: "exchange-1",
      source: { instanceId: "source-1" },
      request: { method: "GET", url: "https://api.example.test/soap", headers: [], query: [], body: null, raw: null },
      response: { statusCode: 200, headers: [], body: null, raw: null },
    } as unknown as HttpExchange;

    const imported = parseExchangeImport(JSON.stringify(createExchangeExport(exchange, "2026-08-17T00:00:00.000Z")));

    expect(imported.exchange).toStrictEqual(exchange);
    expect(imported.exportedAt).toBe("2026-08-17T00:00:00.000Z");
  });

  test("rejects a JSON file that is not an HTTP Inspector exchange export", () => {
    expect(() => parseExchangeImport("{\"format\":\"other\"}")).toThrow("HTTP Inspector exchange export");
  });
});
