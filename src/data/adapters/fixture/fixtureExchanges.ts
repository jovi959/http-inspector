import type {
  CaptureFidelity,
  CaptureSource,
  ExchangeFailure,
  ExchangeState,
  ExchangeTiming,
  HttpBody,
  HttpExchange,
  HttpResponse,
} from "@/generated/contracts";

const sessionId = "11111111-2222-4333-8444-55555555a001";
const unavailable = { milliseconds: null, provenance: "unavailable" } as const;
const fixtureFidelity: CaptureFidelity = {
  requestHeaders: "exact", responseHeaders: "exact", requestBody: "exact", responseBody: "exact",
  timing: "measured", sizes: "exact", requestRaw: "unavailable", responseRaw: "unavailable",
};

/** Fixture source identity remains structured so every view uses the production contract shape. */
function createSource(suffix: string, applicationName: string, platform: string): CaptureSource {
  return {
    instanceId: `11111111-2222-4333-8444-55555555b0${suffix}`,
    applicationName,
    serviceName: applicationName.toLowerCase().replaceAll(" ", "-"),
    platform,
    adapterName: `${platform}-capture`,
    adapterVersion: "0.1.0",
    protocolVersion: { major: 1, minor: 0 },
    environment: "development",
    deviceName: null,
    processId: null,
    buildVersion: null,
    baseUrl: "https://api.example.test",
    metadata: {},
  };
}

function textBody(mediaType: string, value: string): HttpBody {
  return {
    availability: "captured", mediaType, charset: "utf-8", contentEncoding: null,
    declaredByteLength: value.length, observedByteLength: value.length, capturedByteLength: value.length,
    sha256: null, content: { kind: "inlineText", value }, truncationReason: null,
  };
}

function pendingBody(): HttpBody {
  return {
    availability: "pending", mediaType: null, charset: null, contentEncoding: null,
    declaredByteLength: null, observedByteLength: null, capturedByteLength: null,
    sha256: null, content: null, truncationReason: null,
  };
}

function timing(total: number | null): ExchangeTiming {
  return {
    requestHeadersSentMs: 1, requestBodyFinishedMs: 2, responseHeadersReceivedMs: total === null ? null : total - 6,
    responseBodyFinishedMs: total, exchangeEndedMs: total, dns: unavailable, connect: unavailable, tls: unavailable,
    queue: { milliseconds: 0, provenance: "measured" }, requestWrite: { milliseconds: 1, provenance: "measured" },
    serverWait: total === null ? unavailable : { milliseconds: Math.max(total - 6, 0), provenance: "measured" },
    responseRead: total === null ? unavailable : { milliseconds: 5, provenance: "measured" },
    total: total === null ? unavailable : { milliseconds: total, provenance: "measured" },
  };
}

interface FixtureExchangeOptions {
  readonly id: string;
  readonly source: CaptureSource;
  readonly state: ExchangeState;
  readonly method: string;
  readonly url: string;
  readonly startedAt: string;
  readonly response?: HttpResponse;
  readonly requestBody?: HttpBody;
  readonly requestHeaders?: HttpExchange["request"]["headers"];
  readonly total?: number | null;
  readonly failure?: ExchangeFailure;
  readonly metadata?: HttpExchange["metadata"];
}

/** Builds display fixtures through the same complete contract required by live adapters. */
function createExchange(options: FixtureExchangeOptions): HttpExchange {
  const parsed = new URL(options.url);
  const total = options.total ?? 40;
  const requestBody = options.requestBody ?? pendingBody();
  const response = options.response ?? null;
  return {
    schemaVersion: { major: 1, minor: 0 }, id: options.id, sessionId, revision: response || options.failure ? 2 : 1,
    arrivalSequence: Number(options.id.slice(-1)), source: options.source, correlation: null,
    lifecycle: { state: options.state, startedAt: options.startedAt, receivedAt: options.startedAt, lastUpdatedAt: options.startedAt },
    request: {
      method: options.method, originalMethod: null, url: options.url, scheme: parsed.protocol.slice(0, -1), host: parsed.host,
      port: parsed.port ? Number(parsed.port) : null, path: parsed.pathname, pathSegments: parsed.pathname.split("/").filter(Boolean),
      fragment: parsed.hash ? parsed.hash.slice(1) : null, query: [...parsed.searchParams].map(([name, value]) => ({ name, value, provenance: "exact" })),
      protocol: "HTTP/2", headers: options.requestHeaders ?? [{ name: "Accept", value: "application/json", provenance: "exact" }], body: requestBody,
      raw: null, remoteAddress: null, localAddress: null,
    },
    response, timing: timing(total),
    sizes: {
      requestHeaders: { bytes: 26, provenance: "exact" }, requestBody: { bytes: requestBody.capturedByteLength, provenance: requestBody.capturedByteLength === null ? "unavailable" : "exact" },
      responseHeaders: { bytes: response ? 48 : null, provenance: response ? "exact" : "unavailable" }, responseBody: { bytes: response?.body?.capturedByteLength ?? null, provenance: response?.body?.capturedByteLength === null ? "unavailable" : "exact" },
      total: { bytes: response ? 100 : 26, provenance: "exact" },
    },
    transport: null, failure: options.failure ?? null, capture: fixtureFidelity, tags: ["fixture"], metadata: options.metadata ?? {},
  };
}

function response(statusCode: number, mediaType: string, value: string): HttpResponse {
  return {
    statusCode, reasonPhrase: reasonPhrase(statusCode), protocol: "HTTP/2", headers: [{ name: "Content-Type", value: mediaType, provenance: "exact" }],
    body: textBody(mediaType, value), raw: null,
  };
}

function reasonPhrase(statusCode: number): string | null {
  if (statusCode === 200) return "OK";
  if (statusCode === 302) return "Found";
  if (statusCode === 404) return "Not Found";
  return null;
}

// Fixtures deliberately cover JSON, SOAP XML, text, errors, in-flight work, and repeated paths.
export const fixtureExchanges: readonly HttpExchange[] = [
  createExchange({ id: "11111111-2222-4333-8444-55555555f001", source: createSource("01", "Flutter Dev", "flutter"), state: "completed", method: "POST", url: "https://api.example.test/v1/documents/search?region=ca", startedAt: "2026-08-13T20:39:49.000Z", requestHeaders: [{ name: "Accept", value: "application/json", provenance: "exact" }, { name: "Authorization", value: "Bearer fixture-access-token", provenance: "exact" }, { name: "Cookie", value: "session=fixture-session; region=ca", provenance: "exact" }, { name: "X-Api-Key", value: "fixture-api-key", provenance: "exact" }], requestBody: textBody("application/json", "{\"searchType\":\"IDNumber\",\"includeClosed\":false,\"page\":1}"), response: response(200, "application/json; charset=utf-8", "{\"items\":[{\"id\":42,\"active\":true}],\"nextPage\":null}"), metadata: { "application.userAction": "search documents" } }),
  createExchange({ id: "11111111-2222-4333-8444-55555555f002", source: createSource("02", "CSharp API", "dotnet"), state: "inFlight", method: "GET", url: "https://api.example.test/v1/work-queue/next", startedAt: "2026-08-13T20:40:11.000Z", total: null }),
  createExchange({ id: "11111111-2222-4333-8444-55555555f003", source: createSource("03", "Flutter Dev", "flutter"), state: "completed", method: "GET", url: "https://api.example.test/v1/documents/42", startedAt: "2026-08-13T20:40:19.000Z", total: 122, response: response(404, "application/json", "{\"error\":\"Document not found\",\"code\":404}") }),
  createExchange({ id: "11111111-2222-4333-8444-55555555f004", source: createSource("04", "CSharp API", "dotnet"), state: "failed", method: "PUT", url: "https://api.example.test/v1/documents/42", startedAt: "2026-08-13T20:40:28.000Z", total: 5_000, requestBody: textBody("application/json", "{\"status\":\"open\",\"priority\":2}"), failure: { category: "timeout", message: "Socket timeout", retryable: true, code: "ETIMEDOUT" } }),
  createExchange({ id: "11111111-2222-4333-8444-55555555f005", source: createSource("05", "Flutter Dev", "flutter"), state: "completed", method: "POST", url: "https://api.example.test/v1/documents/search", startedAt: "2026-08-13T20:40:35.000Z", total: 84, requestBody: textBody("application/json", "{\"page\":2,\"sort\":\"updated\"}"), response: response(200, "application/json", "{\"items\":[,],\"broken\":true}"), metadata: { note: "Malformed JSON fixture" } }),
  createExchange({ id: "11111111-2222-4333-8444-55555555f006", source: createSource("06", "CSharp API", "dotnet"), state: "completed", method: "GET", url: "https://identity.example.test/.well-known/openid-configuration", startedAt: "2026-08-13T20:40:49.000Z", total: 18, response: response(302, "text/plain", "Redirecting to login") }),
  createExchange({ id: "11111111-2222-4333-8444-55555555f007", source: createSource("07", "CSharp SOAP", "dotnet"), state: "completed", method: "POST", url: "https://soap.example.test/DocumentService.svc", startedAt: "2026-08-13T20:41:02.000Z", requestHeaders: [{ name: "Content-Type", value: "text/xml; charset=utf-8", provenance: "exact" }, { name: "SOAPAction", value: "urn:documents:GetDocument", provenance: "exact" }], requestBody: textBody("text/xml; charset=utf-8", "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\"><soapenv:Header><auth:Token xmlns:auth=\"urn:documents:auth\">fixture-token</auth:Token></soapenv:Header><soapenv:Body><doc:GetDocument xmlns:doc=\"urn:documents\"><doc:Id>42</doc:Id></doc:GetDocument></soapenv:Body></soapenv:Envelope>"), response: response(200, "application/soap+xml; charset=utf-8", "<soapenv:Envelope xmlns:soapenv=\"http://www.w3.org/2003/05/soap-envelope\"><soapenv:Body><doc:GetDocumentResponse xmlns:doc=\"urn:documents\"><doc:Id>42</doc:Id><doc:Status>Open</doc:Status></doc:GetDocumentResponse></soapenv:Body></soapenv:Envelope>") }),
  createExchange({ id: "11111111-2222-4333-8444-55555555f008", source: createSource("08", "Dataverse API", "dotnet"), state: "completed", method: "GET", url: "https://dataverse.example.test/saas/d365/v9.2/sample_records?$select=field_title,field_category&$expand=relation_account($select=field_name),relation_schedule($select=field_schedule_id;$expand=relation_classification($select=field_name))", startedAt: "2026-08-13T20:41:18.000Z", total: 96, response: response(200, "application/json; charset=utf-8", "{\"@odata.context\":\"fixture\",\"value\":[{\"field_title\":\"North incident\",\"field_category\":1001,\"relation_account\":{\"field_name\":\"Northwind\"},\"relation_schedule\":{\"field_schedule_id\":\"work-001\",\"relation_classification\":{\"field_name\":\"Construction\"}}},{\"field_title\":\"South incident\",\"field_category\":1002,\"relation_account\":{\"field_name\":\"Contoso\"},\"relation_schedule\":{\"field_schedule_id\":\"work-002\",\"relation_classification\":{\"field_name\":\"Services\"}}}]}" ) }),
];
