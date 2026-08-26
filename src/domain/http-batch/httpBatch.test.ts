import { describe, expect, test } from "vitest";

import { createHttpBatchInspection, parseHttpBatchRequest } from "./httpBatch";

const batchRequest = JSON.stringify({
  requests: [
    { id: "1", method: "GET", url: "systemusers?$select=fullname", headers: { Accept: "application/json" } },
    { id: "2", method: "PATCH", url: "incidents(1)", headers: { "Content-Type": "application/json" }, body: { title: "Updated" } },
  ],
});

describe("HTTP batch inspection", () => {
  test("parses the captured JSON envelope without changing its operations", () => {
    const parsed = parseHttpBatchRequest(batchRequest);

    expect(parsed).toMatchObject({
      isBatch: true,
      operations: [
        { id: "1", index: 0, method: "GET", url: "systemusers?$select=fullname", headers: [{ name: "Accept", value: "application/json" }] },
        { id: "2", index: 1, method: "PATCH", url: "incidents(1)", body: "{\n  \"title\": \"Updated\"\n}" },
      ],
    });
  });

  test("uses batch order when Dataverse omits Content-ID response headers", () => {
    const inspection = createHttpBatchInspection(batchRequest, "multipart/mixed; boundary=batchresponse_123", [
      "--batchresponse_123",
      "Content-Type: application/http",
      "",
      "HTTP/1.1 200 OK",
      "Content-Type: application/json",
      "",
      "{\"value\":[{\"fullname\":\"Jovi\"}]}",
      "--batchresponse_123",
      "Content-Type: application/http",
      "",
      "HTTP/1.1 204 No Content",
      "",
      "",
      "--batchresponse_123--",
    ].join("\r\n"));

    expect(inspection.operations).toMatchObject([
      { request: { id: "1" }, correlation: "batchOrder", response: { statusCode: 200, body: "{\"value\":[{\"fullname\":\"Jovi\"}]}" } },
      { request: { id: "2" }, correlation: "batchOrder", response: { statusCode: 204, body: "" } },
    ]);
    expect(inspection.warnings).toEqual([]);
  });

  test("finds inner changeset responses and keeps an inner error distinct from the outer response", () => {
    const inspection = createHttpBatchInspection(batchRequest, "multipart/mixed; boundary=outer", [
      "--outer",
      "Content-Type: multipart/mixed; boundary=changeset_456",
      "",
      "--changeset_456",
      "Content-Type: application/http",
      "Content-ID: 1",
      "",
      "HTTP/1.1 400 Bad Request",
      "Content-Type: application/json",
      "",
      "{\"error\":\"invalid\"}",
      "--changeset_456--",
      "--outer--",
    ].join("\n"));

    expect(inspection.operations[0]).toMatchObject({ correlation: "contentId", response: { statusCode: 400, reasonPhrase: "Bad Request", body: "{\"error\":\"invalid\"}" } });
    expect(inspection.operations[1]).toMatchObject({ correlation: "unavailable", response: null });
    expect(inspection.warnings).toContain("Only 1 of 2 batch operations had a captured response.");
  });

  test("keeps request operations visible when the outer response is not multipart", () => {
    const inspection = createHttpBatchInspection(batchRequest, "application/json", "{\"error\":\"bad gateway\"}");

    expect(inspection.operations).toHaveLength(2);
    expect(inspection.operations.every((operation) => operation.response === null)).toBe(true);
    expect(inspection.warnings).toContain("The outer response is not multipart, so individual batch responses are unavailable.");
  });
});
