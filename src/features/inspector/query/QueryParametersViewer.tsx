import type { QueryEntry } from "@/generated/contracts";

interface QueryParametersViewerProps {
  readonly query: readonly QueryEntry[];
}

/** Renders ordered, duplicate-preserving query parameters separately from request bodies. */
export function QueryParametersViewer({ query }: QueryParametersViewerProps) {
  if (query.length === 0) return <p className="empty-copy">No query parameters.</p>;
  return (
    <section className="query-parameters-viewer">
      <div className="query-parameters-toolbar">{query.length} query parameters</div>
      <table className="query-parameters-table">
        <thead><tr><th scope="col">Name</th><th scope="col">Value</th></tr></thead>
        <tbody>
          {query.map((parameter, index) => (
            <tr key={`${parameter.name}-${index}`}><td>{parameter.name}</td><td>{parameter.value ?? <span className="query-no-value">No value</span>}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
