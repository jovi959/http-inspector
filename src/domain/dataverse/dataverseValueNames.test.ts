import { describe, expect, test } from "vitest";

import { createDataverseMap, renderDataverseClassDiagram } from "./dataverseMap";
import { maximumDataverseMapZoom, minimumDataverseMapZoom, stepDataverseMapZoom } from "./dataverseMapZoom";
import { createDataverseValueDescriber, formatDataverseValueLabel, normalizeDataverseValue } from "./dataverseValueNames";
import type { DataverseValueNameIndex } from "./dataverseValueNames";

const index: DataverseValueNameIndex = {
  roots: ["/repo"],
  scannedAtEpochSeconds: 0,
  filesScanned: 3,
  entries: {
    "100000001": [
      { name: "Assignment.AssignedToQueue", file: "Codes.cs", line: 4 },
      { name: "ReviewStatus.Reviewing", file: "Codes.cs", line: 9 },
    ],
    "100000033": [{ name: "Categories.PrimaryCategoryCode", file: "Codes.cs", line: 12 }],
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee": [{ name: "Stages.ReviewStage", file: "Stages.cs", line: 2 }],
    "0": [
      { name: "Defaults.Empty", file: "Codes.cs", line: 20 },
      { name: "StatusCode.Active", file: "Codes.cs", line: 21 },
    ],
  },
};

describe("Dataverse value names", () => {
  test("normalizes GUIDs and integers to the index's keys and ignores other text", () => {
    expect(normalizeDataverseValue("{AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE}")).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(normalizeDataverseValue("0100000033")).toBe("100000033");
    expect(normalizeDataverseValue("-5")).toBe("-5");
    expect(normalizeDataverseValue("null")).toBeNull();
    expect(normalizeDataverseValue("TEST_USER")).toBeNull();
  });

  test("ranks names that match the filtered field first", () => {
    const describe = createDataverseValueDescriber(index);

    expect(describe("field_assignto", "100000001")).toEqual(["Assignment.AssignedToQueue", "ReviewStatus.Reviewing"]);
    expect(describe("field_review_status", "100000001")).toEqual(["ReviewStatus.Reviewing", "Assignment.AssignedToQueue"]);
    expect(describe("_field_stage_value", "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE")).toEqual(["Stages.ReviewStage"]);
    expect(describe("field_title", "unknown")).toEqual([]);
  });

  test("ranks constants from test classes after the real ones", () => {
    const describe = createDataverseValueDescriber({
      ...index,
      entries: { "100000044": [{ name: "AlphaServiceTests.ReviewStageId", file: "Tests.cs", line: 1 }, { name: "Stages.ReviewStage", file: "Stages.cs", line: 3 }] },
    });

    expect(describe("_field_stage_value", "100000044")).toEqual(["Stages.ReviewStage", "AlphaServiceTests.ReviewStageId"]);
  });

  test("names small numbers only when the name matches the field", () => {
    const describe = createDataverseValueDescriber(index);

    expect(describe("statuscode", "0")).toEqual(["StatusCode.Active"]);
    expect(describe("field_count", "0")).toEqual([]);
  });

  test("labels a value with its single best name", () => {
    expect(formatDataverseValueLabel("100000033", [])).toBe("100000033");
    expect(formatDataverseValueLabel("100000033", ["A.One"])).toBe("100000033 · A.One");
    expect(formatDataverseValueLabel("100000001", ["A.One", "B.Two", "C.Three", "D.Four"])).toBe("100000001 · A.One");
  });

  test("shows source names on filter value nodes only when a describer is given", () => {
    const filter = "field_category eq 100000033 and (field_assignto eq 100000001 or field_assignto eq 100000002) and relation_workflow/any(p: p/_field_stage eq aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee)";
    const map = createDataverseMap({ method: "GET", url: `/saas/d365/v9.2/sample_records?$select=field_title&$filter=${filter}` })!;

    const named = renderDataverseClassDiagram(map, null, createDataverseValueDescriber(index)).split("\n");
    const plain = renderDataverseClassDiagram(map).split("\n");

    expect(named).toEqual(expect.arrayContaining([
      "    class V1[\"100000033 · Categories.PrimaryCategoryCode\"]",
      "    class V2A[\"100000001 · Assignment.AssignedToQueue\"]",
      "    class V2B[\"100000002\"]",
      "    class V3[\"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee · Stages.ReviewStage\"]",
    ]));
    expect(plain).toEqual(expect.arrayContaining(["    class V1[\"100000033\"]", "    class V2A[\"100000001\"]"]));
  });
});

describe("Dataverse Map zoom", () => {
  test("zooms in steps of 20% up to 800% and down to 40%", () => {
    expect(stepDataverseMapZoom(1, 1)).toBe(1.2);
    expect(stepDataverseMapZoom(2.5, 1)).toBe(3);
    let zoom = 1;
    for (let step = 0; step < 20; step++) zoom = stepDataverseMapZoom(zoom, 1);
    expect(zoom).toBe(maximumDataverseMapZoom);
    expect(maximumDataverseMapZoom).toBe(8);
    for (let step = 0; step < 40; step++) zoom = stepDataverseMapZoom(zoom, -1);
    expect(zoom).toBe(minimumDataverseMapZoom);
  });
});
