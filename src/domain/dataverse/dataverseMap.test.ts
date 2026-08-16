import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { createDataverseMap, createDataverseResponseRecords, isDataverseRequest, renderDataverseClassDiagram } from "./dataverseMap";

const requestUrl = readFixture("odata-incidents.url");
const actionRequestUrl = readFixture("odata-incidents-action-request.url");
const expectedDiagram = readFixture("odata-incidents.mmd", false);

describe("Dataverse Map", () => {
  test("recognizes a versioned Dataverse request only when it selects columns", () => {
    expect(isDataverseRequest(requestUrl)).toBe(true);
    expect(isDataverseRequest("/saas/d365/v9.2/sample_records?$filter=field_status%20eq%200")).toBe(false);
    expect(isDataverseRequest("/saas/d365/sample_records?$select=field_title")).toBe(false);
  });

  test("parses the selected columns, stable filter branches, and nested expands", () => {
    const map = createDataverseMap({ method: "GET", url: requestUrl });

    expect(map).toMatchObject({
      requestLabel: "GET /saas/d365/v9.2/sample_records",
      entityName: "sample_records",
      selectedColumns: ["field_assignment", "field_title", "_field_owner", "field_category", "_field_project", "_field_schedule"],
      filters: [
        { kind: "comparison", field: "field_category", operator: "=", value: "1001" },
        { kind: "comparison", field: "_field_project", operator: "!=", value: "null" },
        { kind: "comparison", field: "_field_schedule", operator: "!=", value: "null" },
        { kind: "anyOf", field: "field_assignment", operator: "=", values: ["2001", "2002"] },
        { kind: "any", relationship: "relation_workflow", field: "_field_stage", operator: "!=", value: "22222222-3333-4444-8555-666666666666" },
        { kind: "notAny", relationship: "relation_workflow", field: "field_status", operator: "!=", value: "0" },
        { kind: "contains", field: "relation_owner/field_login", value: "TEST_USER" },
      ],
      expansions: expect.arrayContaining([
        expect.objectContaining({ name: "relation_account", selectedColumns: ["field_account_id", "field_name", "field_account_number", "field_trade"] }),
        expect.objectContaining({ name: "relation_schedule", expansions: [expect.objectContaining({ name: "relation_classification" })] }),
      ]),
    });
  });

  test("generates the agreed class-diagram source from the parsed request", () => {
    const map = createDataverseMap({ method: "GET", url: requestUrl });

    expect(renderDataverseClassDiagram(map!)).toBe(expectedDiagram);
  });

  test("renders empty-string filters and nested Action Request expands with valid Mermaid labels", () => {
    const map = createDataverseMap({ method: "GET", url: actionRequestUrl });
    const diagram = renderDataverseClassDiagram(map!);

    expect(map).toMatchObject({
      selectedColumns: ["field_assignment", "field_created_at", "_field_owner", "field_request_due_at", "field_priority", "field_request_started_at", "_field_contractor_contact", "field_request_assigned_at"],
      filters: expect.arrayContaining([
        { kind: "comparison", field: "relation_request/field_request_number", operator: "!=", value: "" },
      ]),
      expansions: expect.arrayContaining([
        expect.objectContaining({
          name: "relation_request",
          expansions: expect.arrayContaining([
            expect.objectContaining({ name: "relation_center" }),
            expect.objectContaining({ name: "relation_group" }),
          ]),
        }),
      ]),
    });
    expect(diagram).toContain('class V3["(empty)"]');
    expect(diagram).not.toContain('[""]');
    expect(diagram).toContain("relation_request --> relation_center : EXPAND");
    expect(diagram).toContain("relation_request --> relation_group : EXPAND");
  });

  test("extracts captured OData records and renders their values in the matching entity cards", () => {
    const response = createDataverseResponseRecords(JSON.stringify({
      value: [{
        field_title: "First incident",
        field_category: 1001,
        relation_account: { field_name: "Northwind", field_account_number: "ACC-101" },
        relation_schedule: { field_schedule_id: "work-1", relation_classification: { field_name: "Construction" } },
      }],
    }));
    const map = createDataverseMap({ method: "GET", url: requestUrl });

    expect(response).toMatchObject({ records: [expect.objectContaining({ field_title: "First incident" })], error: null });
    expect(renderDataverseClassDiagram(map!, response.records[0])).toContain("        field_title = First incident");
    expect(renderDataverseClassDiagram(map!, response.records[0])).toContain("        field_name = Northwind");
    expect(renderDataverseClassDiagram(map!, response.records[0])).toContain("        field_schedule_id = work-1");
    expect(renderDataverseClassDiagram(map!, response.records[0])).toContain("        field_name = Construction");
  });

  test("reports malformed and non-collection Dataverse response content without inventing records", () => {
    expect(createDataverseResponseRecords("not json")).toMatchObject({ records: [], error: "The captured response is not valid JSON." });
    expect(createDataverseResponseRecords(JSON.stringify({ field_title: "single record" }))).toMatchObject({ records: [], error: "The captured response does not contain an OData value array." });
  });
});

function readFixture(name: string, trim = true): string {
  const fixture = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
  return trim ? fixture.trim() : fixture;
}
