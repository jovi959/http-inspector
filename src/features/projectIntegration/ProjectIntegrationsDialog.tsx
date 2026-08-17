import { useCallback, useEffect, useState } from "react";

import type { ProjectIntegrationService } from "@/data/ports/ProjectIntegrationService";
import type { IntegrationCapabilities, IntegrationPreview, IntegrationRecord, ProjectSelection } from "@/features/projectIntegration/model";

interface ProjectIntegrationsDialogProps {
  readonly service: ProjectIntegrationService;
  readonly endpoint: string;
  onActiveCountChange(count: number): void;
  onClose(): void;
}

export function ProjectIntegrationsDialog({ service, endpoint, onActiveCountChange, onClose }: ProjectIntegrationsDialogProps) {
  const [capabilities, setCapabilities] = useState<IntegrationCapabilities | null>(null);
  const [records, setRecords] = useState<readonly IntegrationRecord[]>([]);
  const [selection, setSelection] = useState<ProjectSelection | null>(null);
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<IntegrationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const nextCapabilities = await service.capabilities();
      setCapabilities(nextCapabilities);
      const catalog = nextCapabilities.available ? await service.list() : { integrations: [] };
      setRecords(catalog.integrations);
      onActiveCountChange(catalog.integrations.filter((record) => record.active).length);
      setError(null);
    } catch (reason) {
      setCapabilities(unavailableCapabilities());
      setError(errorMessage(reason));
    }
  }, [onActiveCountChange, service]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await operation(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const inspectSelection = async (nextSelection: ProjectSelection, projectFile?: string) => {
    setSelection(nextSelection);
    setPreview(await service.preview(nextSelection.selectionToken, endpoint, projectFile));
  };

  return (
    <div className="integration-dialog-backdrop" role="presentation">
      <section aria-labelledby="project-integrations-title" aria-modal="true" className="integration-dialog" role="dialog">
        <header className="integration-dialog-header">
          <div><p className="eyebrow">Project tooling</p><h2 id="project-integrations-title">Project integrations</h2></div>
          <button aria-label="Close project integrations" className="toolbar-button" type="button" onClick={onClose}>Close</button>
        </header>
        <div className="integration-dialog-body">
          <RuntimeSummary capabilities={capabilities} />
          {error && <p className="integration-error" role="alert">{error}</p>}
          {capabilities?.runtime === "tauri" && capabilities.reasonCode === "bashUnavailable" && <section className="integration-card integration-bash-picker">
            <h3>Locate Git Bash</h3>
            <p>Choose <code>git-bash.exe</code> or <code>bin\\bash.exe</code>. The selected Bash is verified, saved for this application, and used only for reversible integration scripts.</p>
            <button className="primary-button" disabled={busy} type="button" onClick={() => void run(async () => {
              const nextCapabilities = await service.chooseBash();
              if (nextCapabilities) {
                setCapabilities(nextCapabilities);
                await refresh();
              }
            })}>Choose Git Bash…</button>
          </section>}
          {capabilities?.available && <section className="integration-card">
            <h3>Integrate a .NET project</h3>
            <p>The adapter package is already inside this application. Integration adds a reversible project-scoped private feed, package reference, and one host-wide capture registration for supported .NET HTTP clients.</p>
            {capabilities.folderSelection === "nativePicker" ? (
              <button className="primary-button" disabled={busy} type="button" onClick={() => void run(async () => {
                const chosen = await service.chooseProject();
                if (chosen) await inspectSelection(chosen);
              })}>Choose project folder…</button>
            ) : (
              <form className="integration-path-form" onSubmit={(event) => { event.preventDefault(); void run(async () => inspectSelection(await service.selectProject(path))); }}>
                <label>Absolute path on this service machine<input required value={path} onChange={(event) => setPath(event.target.value)} placeholder="/absolute/path/to/project" /></label>
                <button className="primary-button" disabled={busy} type="submit">Inspect path</button>
              </form>
            )}
          </section>}
          {preview && <PreviewCard preview={preview} busy={busy} onProjectChoice={(projectFile) => selection && void run(() => inspectSelection(selection, projectFile))} onApply={() => preview.previewToken && void run(async () => {
            await service.apply(preview.previewToken!);
            setPreview(null);
            setSelection(null);
            await refresh();
          })} />}
          <section className="integration-card">
            <div className="integration-section-heading"><div><h3>Integrated projects</h3><p>Receipt-backed entries persist across app restarts.</p></div><button className="toolbar-button" disabled={busy || !capabilities?.available} type="button" onClick={() => void run(refresh)}>Refresh</button></div>
            {records.length === 0 ? <p className="integration-empty">No projects are currently integrated.</p> : records.map((record) => <IntegrationRow key={record.integrationId} record={record} busy={busy} onRemove={() => void run(async () => { await service.remove(record.integrationId); await refresh(); })} onRecover={() => void run(async () => { await service.recover(record.integrationId); await refresh(); })} />)}
          </section>
        </div>
      </section>
    </div>
  );
}

function RuntimeSummary({ capabilities }: { readonly capabilities: IntegrationCapabilities | null }) {
  if (!capabilities) return <p className="integration-runtime">Checking runtime capabilities…</p>;
  const label = capabilities.runtime === "tauri" ? "Standalone desktop application" : capabilities.runtime === "hostedLocal" ? "Hosted local service" : "Unavailable runtime";
  return <div className={`integration-runtime ${capabilities.available ? "is-available" : "is-unavailable"}`}><strong>{label}</strong><span>{capabilities.available ? `${capabilities.adapterId} ${capabilities.adapterVersion} · ${capabilities.packageId} ${capabilities.packageVersion} · ${capabilities.bashPath}` : reasonLabel(capabilities.reasonCode)}</span></div>;
}

function PreviewCard({ preview, busy, onProjectChoice, onApply }: { readonly preview: IntegrationPreview; readonly busy: boolean; onProjectChoice(projectFile: string): void; onApply(): void; }) {
  return <section className="integration-card integration-preview"><h3>Review exact changes</h3><dl><div><dt>Project</dt><dd>{preview.projectRoot}</dd></div><div><dt>Endpoint</dt><dd>{preview.endpoint}</dd></div><div><dt>Package</dt><dd>{preview.package.id} {preview.package.version}</dd></div><div><dt>Private feed</dt><dd>{preview.package.feed}</dd></div><div><dt>Strategy</dt><dd>{preview.strategy}</dd></div></dl>
    {preview.choiceRequired ? <label>Multiple projects found<select defaultValue="" onChange={(event) => event.target.value && onProjectChoice(event.target.value)}><option disabled value="">Choose a .csproj</option>{preview.choices.map((choice) => <option key={choice.projectFile} value={choice.projectFile}>{choice.label}</option>)}</select></label> : <><ul>{preview.operations.map((operation) => <li key={operation}>{operation}</li>)}</ul><CoveragePreview coverage={preview.coverage} /><button className="primary-button" disabled={busy || !preview.previewToken} type="button" onClick={onApply}>Confirm and integrate</button></>}
  </section>;
}

function CoveragePreview({ coverage }: { readonly coverage: IntegrationPreview["coverage"] }) {
  if (coverage.length === 0) return null;
  return <div className="integration-coverage"><h4>Detected client coverage</h4>{coverage.map((item) => <article key={item.family}><strong>{item.family} · {item.count}</strong><span>{item.bridge}{item.sourceEditsRequired ? " · additional source edits required" : " · covered by host registration"}</span><p>{item.note}</p>{item.locations.length > 0 && <ul>{item.locations.map((location) => <li key={location}>{location}</li>)}</ul>}</article>)}</div>;
}

function IntegrationRow({ record, busy, onRemove, onRecover }: { readonly record: IntegrationRecord; readonly busy: boolean; onRemove(): void; onRecover(): void; }) {
  const attention = record.state === "cleanupRequired" || record.state === "missingProject" || record.receiptStatus === "invalidReceipt";
  return <article className={`integration-row ${attention ? "needs-attention" : ""}`}><div><strong>{record.projectRoot || "Unknown project"}</strong><span>{record.state} · {record.strategy}{record.payloadAvailable ? "" : " · payload missing"}</span></div><div>{attention && <button className="toolbar-button" disabled={busy} type="button" onClick={onRecover}>Recover</button>}<button className="toolbar-button" disabled={busy || record.state === "missingProject"} type="button" onClick={onRemove}>Remove</button></div></article>;
}

function unavailableCapabilities(): IntegrationCapabilities { return { available: false, runtime: "unavailable", transport: "none", folderSelection: "none", reasonCode: "hostedIntegrationUnavailable", bashPath: null, adapterId: "dotnet-httpclient", adapterVersion: "1.3.3", payloadDigest: "", packageId: "HttpInspector.Adapter", packageVersion: "1.3.3" }; }
function reasonLabel(code: string | null): string { return code === "bashUnavailable" ? "Bash or Git Bash was not found. Capture and replay are unaffected." : code === "payloadUnavailable" ? "The embedded adapter payload could not be prepared." : "Start the loopback service with --project-integration local to enable project changes."; }
function errorMessage(reason: unknown): string { if (reason instanceof Error) return reason.message; if (typeof reason === "object" && reason !== null && "message" in reason) return String(reason.message); return "Project integration failed."; }
