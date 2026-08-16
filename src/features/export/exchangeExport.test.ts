import { describe, expect, test } from "vitest";

import { createExchangeExport } from "@/features/export/exchangeExport";
import type { HttpExchange } from "@/generated/contracts";

describe("exchange export", () => {
  test("keeps the complete exchange without redacting headers or bodies", () => {
    const exchange = {
      id: "exchange-1",
      request: {
        method: "GET",
        url: "https://api.example.test/items?secret=kept",
        headers: [{ name: "Authorization", value: "Bearer captured-token", provenance: "adapterReported" }],
        query: [{ name: "secret", value: "kept", provenance: "adapterReported" }],
        body: null,
        raw: null,
      },
      response: { statusCode: 200, headers: [], body: null, raw: null },
      metadata: { note: "kept" },
    } as unknown as HttpExchange;

    const exported = createExchangeExport(exchange, "2026-08-16T00:00:00.000Z");

    expect(exported.format).toBe("http-inspector.exchange-export");
    expect(exported.version).toBe(1);
    expect(exported.exportedAt).toBe("2026-08-16T00:00:00.000Z");
    expect(exported.exchange).toBe(exchange);
    expect(exported.exchange.request.headers[0]?.value).toBe("Bearer captured-token");
    expect(exported.exchange.request.query[0]?.value).toBe("kept");
  });
});
