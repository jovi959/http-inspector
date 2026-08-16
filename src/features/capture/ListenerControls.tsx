import { useEffect, useState } from "react";

import type { CaptureListenerController, CaptureListenerStatus } from "@/data/ports/CaptureListener";

const DEFAULT_CAPTURE_PORT = "53662";

interface ListenerControlsProps {
  readonly listener: CaptureListenerController;
  onChanged(): void;
}

/** Lets native users choose a bind mode and recover the listener without restarting the desktop shell. */
export function ListenerControls({ listener, onChanged }: ListenerControlsProps) {
  const [status, setStatus] = useState<CaptureListenerStatus | null>(null);
  const [port, setPort] = useState(DEFAULT_CAPTURE_PORT);
  const [lanEnabled, setLanEnabled] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let disposed = false;
    void listener.getListenerStatus().then((nextStatus) => {
      if (disposed) return;
      setStatus(nextStatus);
      setPort(String(nextStatus.port));
      setLanEnabled(nextStatus.lanEnabled);
    }).catch((error: unknown) => {
      if (!disposed) setStatus(unavailableStatus(error));
    });
    return () => { disposed = true; };
  }, [listener]);

  const startOrRestart = () => {
    const selectedPort = Number(port);
    if (!Number.isInteger(selectedPort) || selectedPort < 0 || selectedPort > 65_535) {
      setStatus({ running: false, bindAddress: null, endpoint: null, port: 0, lanEnabled, errorMessage: "Choose a whole-number port from 0 to 65535." });
      return;
    }
    setPending(true);
    void listener.startListener({ port: selectedPort, lanEnabled }).then((nextStatus) => {
      setStatus(nextStatus);
      onChanged();
    }).catch((error: unknown) => setStatus(unavailableStatus(error))).finally(() => setPending(false));
  };

  const stop = () => {
    setPending(true);
    void listener.stopListener().then((nextStatus) => {
      setStatus(nextStatus);
      onChanged();
    }).catch((error: unknown) => setStatus(unavailableStatus(error))).finally(() => setPending(false));
  };

  const location = status?.running
    ? status.endpoint ?? `Listening on ${status.bindAddress}; use this computer's LAN IP and port ${status.port}.`
    : "Listener stopped";
  return (
    <section className="listener-controls" aria-label="Capture listener">
      <span title={status?.errorMessage ?? location}>{location}</span>
      <label>Port <input aria-label="Capture listener port" inputMode="numeric" min="0" max="65535" type="number" value={port} onChange={(event) => setPort(event.target.value)} /></label>
      <label><input checked={lanEnabled} type="checkbox" onChange={(event) => setLanEnabled(event.target.checked)} /> Enable LAN capture</label>
      <button className="status-retry-button" disabled={pending} type="button" onClick={startOrRestart}>{status?.running ? "Restart" : "Start"}</button>
      {status?.running && <button className="status-retry-button" disabled={pending} type="button" onClick={stop}>Stop</button>}
      {status?.errorMessage && <span className="status-error">{status.errorMessage}</span>}
    </section>
  );
}

function unavailableStatus(error: unknown): CaptureListenerStatus {
  const errorMessage = error instanceof Error ? error.message : "The capture listener is unavailable.";
  return { running: false, bindAddress: null, endpoint: null, port: 0, lanEnabled: false, errorMessage };
}
