import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";

import { App } from "@/app/App";
import { BrowserCaptureDataSource } from "@/data/adapters/browser/BrowserCaptureDataSource";
import { BrowserProjectIntegrationService } from "@/data/adapters/browser/BrowserProjectIntegrationService";
import { FixtureCaptureDataSource } from "@/data/adapters/fixture/FixtureCaptureDataSource";
import { UnavailableProjectIntegrationService } from "@/data/adapters/fixture/UnavailableProjectIntegrationService";
import type { FixtureScenario } from "@/data/adapters/fixture/fixtureScenarios";
import { TauriCaptureDataSource } from "@/data/adapters/tauri/TauriCaptureDataSource";
import { TauriProjectIntegrationService } from "@/data/adapters/tauri/TauriProjectIntegrationService";

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
  createRoot(rootElement).render(createElement(App, { dataSource: source, projectIntegration }));
}
