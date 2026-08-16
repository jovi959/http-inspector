export type DataverseComparisonOperator = "=" | "!=" | ">" | ">=" | "<" | "<=";

export type DataverseFilter =
  | { readonly kind: "comparison"; readonly field: string; readonly operator: DataverseComparisonOperator; readonly value: string }
  | { readonly kind: "anyOf"; readonly field: string; readonly operator: DataverseComparisonOperator; readonly values: readonly string[] }
  | { readonly kind: "any"; readonly relationship: string; readonly field: string; readonly operator: DataverseComparisonOperator; readonly value: string }
  | { readonly kind: "notAny"; readonly relationship: string; readonly field: string; readonly operator: DataverseComparisonOperator; readonly value: string }
  | { readonly kind: "contains"; readonly field: string; readonly value: string }
  | { readonly kind: "unsupported"; readonly expression: string };

export interface DataverseExpansion {
  readonly name: string;
  readonly selectedColumns: readonly string[];
  readonly expansions: readonly DataverseExpansion[];
}

export interface DataverseMap {
  readonly requestLabel: string;
  readonly entityName: string;
  readonly selectedColumns: readonly string[];
  readonly filters: readonly DataverseFilter[];
  readonly expansions: readonly DataverseExpansion[];
}

export interface DataverseRequest {
  readonly method: string;
  readonly url: string;
}

export type DataverseRecordValue = string | number | boolean | null | DataverseRecord | readonly DataverseRecordValue[];

export interface DataverseRecord {
  readonly [column: string]: DataverseRecordValue;
}

export interface DataverseResponseRecords {
  readonly records: readonly DataverseRecord[];
  readonly error: string | null;
}
