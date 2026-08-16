import type { ProjectIntegrationService } from "@/data/ports/ProjectIntegrationService";
import type { IntegrationCapabilities, IntegrationCatalog, IntegrationOperationResult, IntegrationPreview, ProjectSelection } from "@/features/projectIntegration/model";

export class UnavailableProjectIntegrationService implements ProjectIntegrationService {
  capabilities(): Promise<IntegrationCapabilities> { return Promise.resolve({ available: false, runtime: "unavailable", transport: "none", folderSelection: "none", reasonCode: "fixtureRuntime", bashPath: null, adapterId: "dotnet-httpclient", adapterVersion: "1.3.2", payloadDigest: "", packageId: "HttpInspector.Adapter", packageVersion: "1.3.2" }); }
  chooseBash(): Promise<IntegrationCapabilities | null> { return Promise.resolve(null); }
  chooseProject(): Promise<ProjectSelection | null> { return Promise.resolve(null); }
  selectProject(): Promise<ProjectSelection> { return unavailable(); }
  preview(): Promise<IntegrationPreview> { return unavailable(); }
  list(): Promise<IntegrationCatalog> { return Promise.resolve({ integrations: [] }); }
  apply(): Promise<IntegrationOperationResult> { return unavailable(); }
  remove(): Promise<IntegrationOperationResult> { return unavailable(); }
  recover(): Promise<IntegrationOperationResult> { return unavailable(); }
}

function unavailable<T>(): Promise<T> { return Promise.reject(new Error("Project integration is unavailable in fixture/static mode.")); }
