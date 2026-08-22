import { useEffect, useMemo, useState } from "react";

import type { DatabaseCaptureDataSource } from "@/data/ports/DatabaseCaptureDataSource";
import type { DatabaseCommand, DatabaseCommandKey, DatabaseCommandSummary, DatabaseUiDelta } from "@/generated/contracts";
import { StructureDatabaseIcon } from "@/features/structure/StructureTreeIcons";

interface DatabaseWorkspaceProps {
  readonly dataSource: DatabaseCaptureDataSource | null;
  readonly collapsedNodeIds: ReadonlySet<string>;
  onCommandSelected(command: DatabaseCommand | null): void;
  onNodeCollapsedChange(id: string, collapsed: boolean): void;
}

/** Renders a dedicated hierarchy and detail view without widening HTTP capture state. */
export function DatabaseWorkspace({ dataSource, collapsedNodeIds, onCommandSelected, onNodeCollapsedChange }: DatabaseWorkspaceProps) {
  const [summaries, setSummaries] = useState<readonly DatabaseCommandSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<DatabaseCommandKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hierarchy = useMemo(() => groupCommands(summaries), [summaries]);

  useEffect(() => {
    if (!dataSource) {
      setSummaries([]);
      setSelectedKey(null);
      onCommandSelected(null);
      return undefined;
    }
    let disposed = false;
    const apply = (deltas: readonly DatabaseUiDelta[]) => {
      if (!disposed) setSummaries((current) => applyDatabaseDeltas(current, deltas));
    };
    void dataSource.getInitialSnapshot().then((snapshot) => {
      if (!disposed) setSummaries(snapshot);
    }).catch((reason: unknown) => {
      if (!disposed) setError(messageFor(reason));
    });
    const unsubscribe = dataSource.subscribe(apply);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [dataSource, onCommandSelected]);

  if (!dataSource) return <section className="database-workspace panel"><div className="panel-heading"><h2>Database</h2></div><p className="empty-copy">Database capture is unavailable for fixtures.</p></section>;

  return (
    <section className="database-workspace panel">
      <div className="panel-heading"><h2>Database</h2><span>{summaries.length} commands</span></div>
      {error && <p className="database-error">{error}</p>}
      <div className="database-tree" aria-label="Database command hierarchy">
        {hierarchy.length === 0 ? <p className="empty-copy">No database commands have been captured in this session.</p> : hierarchy.map((database) => (
          <details key={database.id} open={!collapsedNodeIds.has(database.id)} onToggle={(event) => onNodeCollapsedChange(database.id, !event.currentTarget.open)}>
            <summary className="database-root-summary"><StructureDatabaseIcon />{database.label}</summary>
            {database.targets.map((target) => (
              <details key={target.target} open={!collapsedNodeIds.has(targetNodeId(database.id, target.target))} onToggle={(event) => onNodeCollapsedChange(targetNodeId(database.id, target.target), !event.currentTarget.open)}>
                <summary>{target.target}</summary>
                {target.commands.map((summary) => <button className={sameKey(selectedKey, summary.key) ? "database-command-row is-selected" : "database-command-row"} key={keyOf(summary.key)} type="button" onClick={() => {
                  setSelectedKey(summary.key);
                  void dataSource.getCommand(summary.key).then(onCommandSelected).catch((reason: unknown) => setError(messageFor(reason)));
                }}><span>{summary.operation.toUpperCase()}</span><span>{summary.durationMs === null ? "pending" : `${summary.durationMs} ms`}</span><span>{summary.lifecycle.state}</span></button>)}
              </details>
            ))}
          </details>
        ))}
      </div>
    </section>
  );
}

export function DatabaseCommandInspector({ command }: { readonly command: DatabaseCommand | null }) {
  const [activeTab, setActiveTab] = useState<"overview" | "query" | "parameters" | "response">("overview");
  useEffect(() => setActiveTab("overview"), [command?.id]);
  if (!command) return <section className="database-command-inspector panel"><div className="panel-heading"><h2>Database command</h2></div><p className="empty-copy">Select a database command to inspect its SQL and parameters.</p></section>;
  return <section className="database-command-inspector panel">
    <div className="database-detail-heading"><strong>{command.primaryTarget}</strong><span>{command.provider}</span></div>
    <nav className="database-tabs" aria-label="Database command detail">
      {(["overview", "query", "parameters", "response"] as const).map((tab) => <button className={activeTab === tab ? "is-active" : ""} key={tab} type="button" onClick={() => setActiveTab(tab)}>{tab}</button>)}
    </nav>
    {activeTab === "overview" && <dl className="database-overview">
      <dt>Database</dt><dd>{command.databaseName}</dd>
      <dt>Server</dt><dd>{command.dataSource ?? "Unavailable"}</dd>
      <dt>Operation</dt><dd>{command.operation}</dd>
      <dt>Command type</dt><dd>{command.commandType}</dd>
      <dt>Lifecycle</dt><dd>{command.lifecycle.state}</dd>
      <dt>Duration</dt><dd>{command.totalDuration.milliseconds === null ? "Unavailable" : `${command.totalDuration.milliseconds} ms`}</dd>
      <dt>Result</dt><dd>{resultSummary(command)}</dd>
      {command.failure && <><dt>Failure</dt><dd>{command.failure.message}</dd></>}
    </dl>}
    {activeTab === "query" && <pre className="database-code">{command.query.value ?? command.query.reason ?? "Query capture is unavailable."}</pre>}
    {activeTab === "parameters" && (command.parameters.availability === "unavailable" ? <p className="empty-copy">{command.parameters.reason ?? "Parameter capture is unavailable."}</p> : <div className="database-parameters"><table><thead><tr><th>Name</th><th>Value</th><th>Type</th><th>Direction</th></tr></thead><tbody>{command.parameters.values.length === 0 ? <tr><td colSpan={4}>No parameters</td></tr> : command.parameters.values.map((parameter, index) => <tr key={`${parameter.name}-${index}`}><td>{parameter.name}</td><td>{parameter.value === undefined ? parameter.reason ?? "Unavailable" : JSON.stringify(parameter.value)}</td><td>{parameter.dbType ?? ""}</td><td>{parameter.direction ?? ""}</td></tr>)}</tbody></table></div>)}
    {activeTab === "response" && <DatabaseResponse command={command} />}
  </section>;
}

function DatabaseResponse({ command }: { readonly command: DatabaseCommand }) {
  const { result } = command;
  if (result.availability !== "captured") return <p className="empty-copy">{result.reason ?? "Result rows are unavailable for this command."}</p>;
  return <div className="database-response">
    <p className="database-response-summary">{result.rowsCaptured ?? result.rows.length} captured of {result.rowsObserved ?? result.rows.length} observed rows{result.truncated ? " · Preview truncated" : ""}{result.reason ? ` · ${result.reason}` : ""}</p>
    {result.columns.length === 0 ? <p className="empty-copy">No tabular result was returned.</p> : <div className="database-results"><table><thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.rows.length === 0 ? <tr><td colSpan={result.columns.length}>No rows</td></tr> : result.rows.map((row, rowIndex) => <tr key={rowIndex}>{result.columns.map((column, columnIndex) => <td key={`${column}-${columnIndex}`}>{formatResultValue(row[columnIndex])}</td>)}</tr>)}</tbody></table></div>}
  </div>;
}

function resultSummary(command: DatabaseCommand): string {
  const { result } = command;
  if (result.availability !== "captured") return result.reason ?? "Unavailable";
  const captured = result.rowsCaptured ?? result.rows.length;
  const observed = result.rowsObserved ?? captured;
  return `${captured}/${observed} rows${result.truncated ? " (truncated)" : ""}`;
}

function formatResultValue(value: unknown): string {
  if (value === null) return "NULL";
  return typeof value === "string" ? value : JSON.stringify(value);
}

interface DatabaseGroup {
  readonly id: string;
  readonly label: string;
  readonly targets: readonly { readonly target: string; readonly commands: readonly DatabaseCommandSummary[] }[];
}

function groupCommands(summaries: readonly DatabaseCommandSummary[]): readonly DatabaseGroup[] {
  const databases = new Map<string, { readonly label: string; readonly targets: Map<string, DatabaseCommandSummary[]> }>();
  for (const summary of summaries) {
    const id = `${summary.sourceName}\u0000${summary.dataSource ?? ""}\u0000${summary.databaseName}`;
    const current = databases.get(id) ?? { label: `${summary.databaseName}${summary.dataSource ? ` · ${summary.dataSource}` : ""}`, targets: new Map<string, DatabaseCommandSummary[]>() };
    const commands = current.targets.get(summary.primaryTarget) ?? [];
    commands.push(summary);
    current.targets.set(summary.primaryTarget, commands);
    databases.set(id, current);
  }
  return [...databases.entries()].map(([id, database]) => ({
    id,
    label: database.label,
    targets: [...database.targets.entries()].map(([target, commands]) => ({ target, commands: [...commands].sort((left, right) => right.arrivalSequence - left.arrivalSequence) })),
  }));
}

function applyDatabaseDeltas(current: readonly DatabaseCommandSummary[], deltas: readonly DatabaseUiDelta[]): readonly DatabaseCommandSummary[] {
  let next = current;
  for (const delta of deltas) {
    if (delta.kind === "reset") next = delta.summaries;
    else if (delta.kind === "upsert") next = [...next.filter((summary) => !sameKey(summary.key, delta.summary.key)), delta.summary];
    else if (delta.kind === "remove") next = next.filter((summary) => !sameKey(summary.key, delta.key));
  }
  return next;
}

function keyOf(key: DatabaseCommandKey): string {
  return `${key.sourceInstanceId}\u0000${key.commandId}`;
}

function targetNodeId(databaseId: string, target: string): string {
  return `${databaseId}\u0000${target}`;
}

function sameKey(left: DatabaseCommandKey | null, right: DatabaseCommandKey): boolean {
  return left?.sourceInstanceId === right.sourceInstanceId && left.commandId === right.commandId;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Database capture is unavailable.";
}
