import { useDataverseValueNames } from "@/features/inspector/dataverse/dataverseValueNamesContext";
import type { DataverseValueNames } from "@/features/inspector/dataverse/dataverseValueNamesContext";

/** Toggle and Refresh for source constant names on the Dataverse Map. */
export function DataverseValueNamesControls() {
  const names = useDataverseValueNames();
  if (!names) return null;
  return (
    <div className="dataverse-names-controls">
      <label>
        <input type="checkbox" checked={names.enabled} onChange={(event) => names.setEnabled(event.target.checked)} />
        Source names
      </label>
      <button type="button" disabled={!names.enabled || names.status === "loading"} onClick={names.chooseSource} title="Choose a source folder (e.g. your API repository) to scan">Choose folder…</button>
      <button type="button" disabled={!names.enabled || names.status === "loading"} onClick={names.refresh} title="Scan the source code again">Refresh names</button>
      <span title={names.message ?? names.index?.roots.join("\n") ?? undefined}>{describeStatus(names)}</span>
    </div>
  );
}

function describeStatus(names: DataverseValueNames): string {
  if (names.status === "off") return "Names off";
  if (names.status === "unavailable") return "Source names unavailable";
  if (names.status === "loading") return "Reading source names…";
  if (!names.index || names.index.roots.length === 0) return "No source folder · choose one";
  const valueCount = Object.keys(names.index.entries).length;
  return `${valueCount.toLocaleString()} named values · ${names.index.filesScanned.toLocaleString()} files`;
}
