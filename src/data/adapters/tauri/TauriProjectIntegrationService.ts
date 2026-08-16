import { invoke } from "@tauri-apps/api/core";

import type { ProjectIntegrationService } from "@/data/ports/ProjectIntegrationService";
import type { IntegrationCapabilities, IntegrationCatalog, IntegrationOperationResult, IntegrationPreview, ProjectSelection } from "@/features/projectIntegration/model";

export class TauriProjectIntegrationService implements ProjectIntegrationService {
  capabilities(): Promise<IntegrationCapabilities> { return invoke("integration_capabilities"); }
  chooseBash(): Promise<IntegrationCapabilities | null> { return invoke("integration_choose_bash"); }
  chooseProject(): Promise<ProjectSelection | null> { return invoke("integration_choose_project"); }
  selectProject(path: string): Promise<ProjectSelection> { return invoke("integration_select_project", { request: { path } }); }
  preview(selectionToken: string, endpoint: string, projectFile?: string): Promise<IntegrationPreview> {
    return invoke("integration_preview", { request: { selectionToken, endpoint, projectFile: projectFile ?? null } });
  }
  list(): Promise<IntegrationCatalog> { return invoke("integration_list"); }
  apply(previewToken: string): Promise<IntegrationOperationResult> { return invoke("integration_apply", { request: { previewToken } }); }
  remove(integrationId: string): Promise<IntegrationOperationResult> { return invoke("integration_remove", { request: { integrationId } }); }
  recover(integrationId: string): Promise<IntegrationOperationResult> { return invoke("integration_recover", { request: { integrationId } }); }
}
