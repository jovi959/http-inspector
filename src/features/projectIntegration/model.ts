export type IntegrationRuntime = "tauri" | "hostedLocal" | "unavailable";
export type IntegrationTransport = "ipc" | "sameOriginHttp" | "none";
export type FolderSelection = "nativePicker" | "serviceLocalPath" | "none";

export interface IntegrationCapabilities {
  readonly available: boolean;
  readonly runtime: IntegrationRuntime;
  readonly transport: IntegrationTransport;
  readonly folderSelection: FolderSelection;
  readonly reasonCode: string | null;
  readonly bashPath: string | null;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly payloadDigest: string;
  readonly packageId: string;
  readonly packageVersion: string;
}

export interface ProjectSelection { readonly selectionToken: string; readonly path: string; }
export interface ProjectChoice { readonly projectFile: string; readonly label: string; }
export interface PackageIdentity { readonly id: string; readonly version: string; readonly file: string; readonly digest: string; readonly feed: string; }
export interface IntegrationCoverage { readonly family: string; readonly bridge: string; readonly sourceEditsRequired: boolean; readonly count: number; readonly locations: readonly string[]; readonly note: string; }
export interface DatabaseResultCapturePreview {
  readonly requested: boolean;
  readonly eligible: boolean;
  readonly reason: string | null;
  readonly databaseProjectFile: string | null;
  readonly factoryFile: string | null;
  readonly dapperLocations: readonly string[];
  readonly dapperFiles: readonly string[];
  readonly rawAdoNetResultCapture: RawAdoNetResultCapturePreview;
}

export interface RawAdoNetResultCapturePreview {
  readonly requested: boolean;
  readonly eligible: boolean;
  readonly reason: string | null;
  readonly locations: readonly string[];
  readonly files: readonly string[];
  readonly unsupportedLocations: readonly string[];
}

export interface IntegrationPreview {
  readonly previewToken: string | null;
  readonly choiceRequired: boolean;
  readonly choices: readonly ProjectChoice[];
  readonly projectRoot: string;
  readonly projectFile: string | null;
  readonly compositionFile: string | null;
  readonly strategy: string;
  readonly endpoint: string;
  readonly package: PackageIdentity;
  readonly operations: readonly string[];
  readonly coverage: readonly IntegrationCoverage[];
  readonly databaseResultCapture: DatabaseResultCapturePreview;
}

export interface IntegrationRecord {
  readonly integrationId: string;
  readonly projectRoot: string;
  readonly runId: string;
  readonly state: string;
  readonly strategy: string;
  readonly receiptStatus: string;
  readonly active: boolean;
  readonly payloadAvailable: boolean;
  readonly payloadRoot?: string;
  readonly payloadDigest?: string;
}

export interface IntegrationCatalog { readonly integrations: readonly IntegrationRecord[]; }
export interface IntegrationOperationResult { readonly ok: boolean; readonly active: boolean; readonly projectRoot: string; readonly integrationId: string; readonly runId: string; readonly state: string; }
