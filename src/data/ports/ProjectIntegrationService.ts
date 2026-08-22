import type { IntegrationCapabilities, IntegrationCatalog, IntegrationOperationResult, IntegrationPreview, ProjectSelection } from "@/features/projectIntegration/model";

export interface ProjectIntegrationService {
  capabilities(): Promise<IntegrationCapabilities>;
  chooseBash(): Promise<IntegrationCapabilities | null>;
  chooseProject(): Promise<ProjectSelection | null>;
  selectProject(path: string): Promise<ProjectSelection>;
  preview(selectionToken: string, endpoint: string, projectFile?: string, databaseResultCapture?: boolean, rawAdoNetResultCapture?: boolean): Promise<IntegrationPreview>;
  list(): Promise<IntegrationCatalog>;
  apply(previewToken: string): Promise<IntegrationOperationResult>;
  remove(integrationId: string): Promise<IntegrationOperationResult>;
  recover(integrationId: string): Promise<IntegrationOperationResult>;
  forceRemove(integrationId: string): Promise<IntegrationOperationResult>;
}
