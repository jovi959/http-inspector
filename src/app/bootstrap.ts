import { createElement, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";

import { App } from "@/app/App";
import { BrowserCaptureDataSource } from "@/data/adapters/browser/BrowserCaptureDataSource";
import { BrowserDatabaseCaptureDataSource } from "@/data/adapters/browser/BrowserDatabaseCaptureDataSource";
import { BrowserProjectIntegrationService } from "@/data/adapters/browser/BrowserProjectIntegrationService";
import { FixtureCaptureDataSource } from "@/data/adapters/fixture/FixtureCaptureDataSource";
import { UnavailableProjectIntegrationService } from "@/data/adapters/fixture/UnavailableProjectIntegrationService";
import { ImportedCaptureDataSource } from "@/data/adapters/import/ImportedCaptureDataSource";
import type { FixtureScenario } from "@/data/adapters/fixture/fixtureScenarios";
import { TauriCaptureDataSource } from "@/data/adapters/tauri/TauriCaptureDataSource";
import { TauriDatabaseCaptureDataSource } from "@/data/adapters/tauri/TauriDatabaseCaptureDataSource";
import { TauriProjectIntegrationService } from "@/data/adapters/tauri/TauriProjectIntegrationService";
import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import type { DatabaseCaptureDataSource } from "@/data/ports/DatabaseCaptureDataSource";
import type { ProjectIntegrationService } from "@/data/ports/ProjectIntegrationService";
import type { HttpExchange } from "@/generated/contracts";

/** Runtime choice occurs once here; feature code receives only the composed data-source port. */
export function bootstrap(rootElement: HTMLElement): void {
  const parameters = new URLSearchParams(window.location.search);
  const requestedFixture = parameters.get("fixture");
  const fixtureScenario: FixtureScenario = requestedFixture === "dataverse" || requestedFixture === "exact-raw" || requestedFixture === "large-json" || requestedFixture === "truncated-json" || requestedFixture === "live-edge" ? requestedFixture : "standard";
  // Fixture overrides all runtimes; otherwise the composition root selects native or hosted I/O once.
  const source = parameters.get("source") === "fixture"
    ? new FixtureCaptureDataSource({ scenario: fixtureScenario })
    : isTauri() ? new TauriCaptureDataSource() : new BrowserCaptureDataSource();
  const projectIntegration = parameters.get("source") === "fixture"
    ? new UnavailableProjectIntegrationService()
    : isTauri() ? new TauriProjectIntegrationService() : new BrowserProjectIntegrationService();
  const databaseDataSource = parameters.get("source") === "fixture"
    ? null
    : isTauri() ? new TauriDatabaseCaptureDataSource() : new BrowserDatabaseCaptureDataSource();
  createRoot(rootElement).render(createElement(RuntimeApp, { source, databaseDataSource, projectIntegration }));
}

interface RuntimeAppProps {
  readonly source: CaptureDataSource;
  readonly databaseDataSource: DatabaseCaptureDataSource | null;
  readonly projectIntegration: ProjectIntegrationService;
}

/** Owns local exchange-import mode so the application can return to its original live source without a reload. */
function RuntimeApp({ source, databaseDataSource, projectIntegration }: RuntimeAppProps) {
  const [importedExchange, setImportedExchange] = useState<HttpExchange | null>(null);
  const dataSource = useMemo(() => importedExchange ? new ImportedCaptureDataSource(importedExchange) : source, [importedExchange, source]);
  return createElement(App, {
    dataSource,
    databaseDataSource,
    isImported: importedExchange !== null,
    projectIntegration,
    onImportedExchange: setImportedExchange,
    onReturnToLiveCapture: () => setImportedExchange(null),
  });
}
