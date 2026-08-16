import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import type { ReplayRequest } from "@/data/ports/CaptureController";
import { useCaptureStore } from "@/state/capture/captureStore";
import type { RecomposeDraft, RecomposeMode, RecomposeWorkingCopy } from "@/state/recompose/recomposeTypes";

import { RecomposeBodyEditor } from "./RecomposeBodyEditor";
import { RecomposeHeadersEditor } from "./RecomposeHeadersEditor";
import { RecomposeUrlEditor } from "./RecomposeUrlEditor";
import { parseEditableRawRequest } from "./recomposeRaw";
import { buildReplayUrl } from "./recomposeUrl";

interface RecomposeEditorProps {
  readonly dataSource: CaptureDataSource;
  readonly draft: RecomposeDraft;
}

const modes: readonly RecomposeMode[] = ["url", "headers", "authentication", "text", "json", "xml", "raw"];

/** Edits a persistent session draft inside the normal inspector workspace. */
export function RecomposeEditor({ dataSource, draft }: RecomposeEditorProps) {
  const setMode = useCaptureStore((state) => state.setRecomposeMode);
  const setWorking = useCaptureStore((state) => state.setRecomposeWorking);
  const setRawText = useCaptureStore((state) => state.setRecomposeRawText);
  const setRawError = useCaptureStore((state) => state.setRecomposeRawError);
  const beginExecution = useCaptureStore((state) => state.beginRecomposeExecution);
  const completeExecution = useCaptureStore((state) => state.completeRecomposeExecution);
  const failExecution = useCaptureStore((state) => state.failRecomposeExecution);
  const revert = useCaptureStore((state) => state.revertRecomposeDraft);
  const cancel = useCaptureStore((state) => state.cancelRecomposeDraft);
  const selectExchange = useCaptureStore((state) => state.selectExchange);
  const openLatestExecution = () => {
    const receipt = draft.latestExecution;
    if (receipt) selectExchange(`${receipt.exchangeKey.sourceInstanceId}::${receipt.exchangeKey.exchangeId}`);
  };

  const execute = () => {
    try {
      let working = draft.working;
      if (draft.selectedMode === "raw" && draft.rawText !== null) {
        const parsed = parseEditableRawRequest(draft.rawText, working);
        if (!parsed.ok) return setRawError(parsed.error);
        working = parsed.working;
        setWorking(working);
      }
      const validationError = validateWorkingCopy(working);
      if (validationError) return failExecution(validationError);
      const request = replayRequest(draft, working);
      beginExecution();
      void Promise.resolve().then(() => dataSource.executeReplay(request)).then(completeExecution).catch((error: unknown) => {
        failExecution(error instanceof Error ? error.message : "Replay could not be scheduled.");
      });
    } catch (error) {
      failExecution(error instanceof Error ? error.message : "Replay could not be prepared.");
    }
  };

  return (
    <section className="inspector panel recompose-workspace" aria-label="Editable replay draft">
      <div className="recompose-request-bar">
        <input aria-label="HTTP method" className="recompose-method" value={draft.working.method} onChange={(event) => setWorking({ ...draft.working, method: event.target.value })} />
        <input aria-label="Request URL without query parameters" className="recompose-base-url" value={draft.working.baseUrl} onChange={(event) => setWorking({ ...draft.working, baseUrl: event.target.value })} />
        <select aria-label="HTTP protocol preference" value={draft.working.protocol} onChange={(event) => setWorking({ ...draft.working, protocol: event.target.value as RecomposeWorkingCopy["protocol"] })}>
          <option value="auto">Auto</option><option value="http11">HTTP/1.1</option><option value="http2">HTTP/2</option>
        </select>
      </div>
      <div className="recompose-editor-content">
        {draft.selectedMode === "url" && <RecomposeUrlEditor working={draft.working} onChange={setWorking} />}
        {draft.selectedMode === "headers" && <RecomposeHeadersEditor authenticationOnly={false} working={draft.working} onChange={setWorking} />}
        {draft.selectedMode === "authentication" && <RecomposeHeadersEditor authenticationOnly working={draft.working} onChange={setWorking} />}
        {(draft.selectedMode === "text" || draft.selectedMode === "json" || draft.selectedMode === "xml" || draft.selectedMode === "raw") && <RecomposeBodyEditor mode={draft.selectedMode} rawError={draft.rawError} rawText={draft.rawText} working={draft.working} onChange={setWorking} onRawError={setRawError} onRawText={setRawText} />}
      </div>
      <nav className="body-view-tabs recompose-mode-tabs" aria-label="Recompose request representation">
        {modes.map((mode) => <button key={mode} className={draft.selectedMode === mode ? "is-active" : ""} type="button" onClick={() => setMode(mode)}>{modeLabel(mode, draft.working)}</button>)}
      </nav>
      <div className="recompose-action-bar">
        <div>{draft.error && <span className="recompose-error">{draft.error}</span>}{draft.latestExecution && <button type="button" onClick={openLatestExecution}>Open latest execution</button>}</div>
        <div><button type="button" onClick={cancel}>Cancel</button><button type="button" onClick={revert}>Revert</button><button className="primary-button" disabled={draft.pending} type="button" onClick={execute}>{draft.pending ? "Executing…" : "Execute"}</button></div>
      </div>
    </section>
  );
}

function replayRequest(draft: RecomposeDraft, working: RecomposeWorkingCopy): ReplayRequest {
  const separator = draft.sourceExchangeId.indexOf("::");
  return {
    method: working.method,
    url: buildReplayUrl(working),
    protocol: working.protocol,
    headers: working.headers.map(({ name, value }) => ({ name, value })),
    body: working.body,
    origin: {
      sourceInstanceId: draft.sourceExchangeId.slice(0, separator),
      exchangeId: draft.sourceExchangeId.slice(separator + 2),
      draftId: draft.id,
      edited: JSON.stringify(working) !== JSON.stringify(draft.baseline),
    },
  };
}

function validateWorkingCopy(working: RecomposeWorkingCopy): string | null {
  if (!working.method.trim()) return "HTTP method is required.";
  try { new URL(buildReplayUrl(working)); } catch { return "Request URL must be an absolute HTTP or HTTPS URL."; }
  if (working.headers.some((header) => !header.name.trim())) return "Every header row requires a name.";
  if (working.bodyUnavailable) return "The source body was unavailable. Supply or clear the body before executing.";
  return null;
}

function modeLabel(mode: RecomposeMode, working: RecomposeWorkingCopy): string {
  if (mode === "url") return "URL";
  if (mode === "xml") return "XML";
  if (mode !== "text") return mode;
  const contentType = working.headers.find((header) => header.name.toLowerCase() === "content-type")?.value.toLowerCase() ?? "";
  if (contentType.includes("json")) return "JSON Text";
  if (contentType.includes("xml") || contentType.includes("soap")) return "XML Text";
  return "Text";
}
