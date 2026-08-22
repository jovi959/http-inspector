import type { ProjectIntegrationService } from "@/data/ports/ProjectIntegrationService";
import type { IntegrationCapabilities, IntegrationCatalog, IntegrationOperationResult, IntegrationPreview, ProjectSelection } from "@/features/projectIntegration/model";

export class BrowserProjectIntegrationService implements ProjectIntegrationService {
  capabilities(): Promise<IntegrationCapabilities> { return request("/api/project-integrations/capabilities"); }
  chooseBash(): Promise<IntegrationCapabilities | null> { return Promise.resolve(null); }
  chooseProject(): Promise<ProjectSelection | null> { return Promise.resolve(null); }
  selectProject(path: string): Promise<ProjectSelection> { return request("/api/project-integrations/select", { path }); }
  preview(selectionToken: string, endpoint: string, projectFile?: string, databaseResultCapture = false, rawAdoNetResultCapture = false): Promise<IntegrationPreview> {
    return request("/api/project-integrations/preview", { selectionToken, endpoint, projectFile: projectFile ?? null, databaseResultCapture, rawAdoNetResultCapture });
  }
  list(): Promise<IntegrationCatalog> { return request("/api/project-integrations"); }
  apply(previewToken: string): Promise<IntegrationOperationResult> { return request("/api/project-integrations/apply", { previewToken }); }
  remove(integrationId: string): Promise<IntegrationOperationResult> { return request("/api/project-integrations/remove", { integrationId }); }
  recover(integrationId: string): Promise<IntegrationOperationResult> { return request("/api/project-integrations/recover", { integrationId }); }
  forceRemove(integrationId: string): Promise<IntegrationOperationResult> { return request("/api/project-integrations/force-remove", { integrationId }); }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const options: RequestInit = body === undefined ? { method: "GET" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  if (!response.ok) {
    const details = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(details?.message ?? (response.status === 404 ? "Project integration is disabled for this hosted service." : `Project integration failed (${response.status}).`));
  }
  return response.json() as Promise<T>;
}
