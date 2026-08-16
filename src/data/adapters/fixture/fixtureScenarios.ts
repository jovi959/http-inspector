import type { HttpExchange } from "@/generated/contracts";

import { fixtureExchanges } from "./fixtureExchanges";

export type FixtureScenario = "standard" | "dataverse" | "exact-raw" | "large-json" | "truncated-json" | "live-edge";

/** Keeps optional development scenarios in the same generated-contract shape as live captures. */
export function exchangesForFixtureScenario(scenario: FixtureScenario): readonly HttpExchange[] {
  if (scenario === "exact-raw") return exactRawFixture;
  if (scenario === "dataverse") return dataverseFixture;
  if (scenario === "large-json") return largeJsonFixture;
  if (scenario === "truncated-json") return truncatedJsonFixture;
  if (scenario === "live-edge") return liveEdgeFixtures;
  return fixtureExchanges.slice(0, 4);
}

const largeJsonFixture = [createLargeJsonFixture()];
const dataverseFixture = [fixtureExchanges[7]!];
const exactRawFixture = [createExactRawFixture()];
const truncatedJsonFixture = [createTruncatedJsonFixture()];
export const liveEdgeArrivalFixture = createLiveEdgeFixture(81);
const liveEdgeFixtures = Array.from({ length: 80 }, (_, index) => createLiveEdgeFixture(index + 1));

function createLargeJsonFixture(): HttpExchange {
  const base = fixtureExchanges[0]!;
  const bodyText = `{"payload":"${"x".repeat(270 * 1024)}","page":1}`;
  const byteLength = new TextEncoder().encode(bodyText).byteLength;
  const requestBody = base.request.body!;
  return {
    ...base,
    id: "11111111-2222-4333-8444-55555555f010",
    arrivalSequence: 1,
    request: {
      ...base.request,
      body: {
        ...requestBody,
        declaredByteLength: byteLength,
        observedByteLength: byteLength,
        capturedByteLength: byteLength,
        content: { kind: "inlineText", value: bodyText },
      },
    },
    sizes: {
      ...base.sizes,
      requestBody: { bytes: byteLength, provenance: "exact" },
      total: { bytes: byteLength + 74, provenance: "exact" },
    },
  };
}

function createExactRawFixture(): HttpExchange {
  const base = fixtureExchanges[0]!;
  const raw = [
    "POST /v1/charges?include=customer HTTP/2",
    "Host: api.example.test",
    "X-Trace-Id: raw-fixture-001",
    "Content-Type: application/json; charset=utf-8",
    "",
    '{"amount":1999,"currency":"cad"}',
  ].join("\r\n");
  const byteLength = new TextEncoder().encode(raw).byteLength;
  return {
    ...base,
    id: "11111111-2222-4333-8444-55555555f012",
    arrivalSequence: 1,
    request: {
      ...base.request,
      raw: {
        availability: "captured",
        mediaType: "message/http",
        charset: "utf-8",
        contentEncoding: null,
        declaredByteLength: byteLength,
        observedByteLength: byteLength,
        capturedByteLength: byteLength,
        sha256: null,
        content: { kind: "inlineText", value: raw },
        truncationReason: null,
      },
    },
    capture: { ...base.capture, requestRaw: "exact" },
  };
}

function createTruncatedJsonFixture(): HttpExchange {
  const base = fixtureExchanges[0]!;
  const requestBody = base.request.body!;
  const capturedByteLength = requestBody.capturedByteLength!;
  return {
    ...base,
    id: "11111111-2222-4333-8444-55555555f011",
    arrivalSequence: 1,
    request: {
      ...base.request,
      body: {
        ...requestBody,
        availability: "truncated",
        declaredByteLength: capturedByteLength + 256,
        observedByteLength: capturedByteLength + 256,
        truncationReason: "Fixture simulates a body capture limit.",
      },
    },
    sizes: {
      ...base.sizes,
      requestBody: { bytes: capturedByteLength, provenance: "exact" },
      total: { bytes: capturedByteLength + 74, provenance: "exact" },
    },
  };
}

function createLiveEdgeFixture(index: number): HttpExchange {
  const base = fixtureExchanges[0]!;
  const timestamp = new Date(Date.parse(base.lifecycle.startedAt) + index * 1_000).toISOString();
  return {
    ...base,
    id: `${base.id.slice(0, -3)}${String(index).padStart(3, "0")}`,
    arrivalSequence: index,
    lifecycle: {
      ...base.lifecycle,
      startedAt: timestamp,
      receivedAt: timestamp,
      lastUpdatedAt: timestamp,
    },
    request: {
      ...base.request,
      url: `${base.request.url}&fixtureRow=${index}`,
    },
  };
}
