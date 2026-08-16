import type { ExchangeState } from "@/generated/contracts";

export interface StatusPresentation {
  readonly accessibleLabel: string;
  readonly label: string;
  readonly tone: "live" | "success" | "redirect" | "warning" | "error" | "neutral";
  readonly tooltip: string;
}

/** Separates lifecycle meaning from HTTP response code meaning. */
export function getStatusPresentation(state: ExchangeState, statusCode: number | null): StatusPresentation {
  if (state === "inFlight") return exchangeStatus("In flight", "live", "The request has not reached a terminal capture state.");
  if (state === "failed") return exchangeStatus("Failed", "error", "The request failed before it completed.");
  if (state === "cancelled") return exchangeStatus("Cancelled", "neutral", "The request was cancelled.");
  if (state === "incomplete") return exchangeStatus("Incomplete", "warning", "The source disconnected or did not provide a terminal event.");
  if (statusCode !== null && statusCode >= 500) return exchangeStatus(`${statusCode} Server error`, "error", "The server returned a 5xx response.");
  if (statusCode !== null && statusCode >= 400) return exchangeStatus(`${statusCode} Client error`, "warning", "The server returned a 4xx response.");
  if (statusCode !== null && statusCode >= 300) return exchangeStatus(`${statusCode} Redirect`, "redirect", "The server returned a redirect response.");
  return exchangeStatus(statusCode === null ? "Completed" : `${statusCode} Complete`, "success", "The exchange completed successfully.");
}

export interface ConnectionPresentation {
  readonly label: string;
  readonly tone: "connected" | "connecting" | "disconnected" | "error";
  readonly tooltip: string;
}

/** Keeps the capture-health wording independent from protocol and UI adapters. */
export function getConnectionPresentation(state: ConnectionPresentation["tone"]): ConnectionPresentation {
  if (state === "connected") return { label: "Connected", tone: state, tooltip: "The inspector is receiving capture-service updates." };
  if (state === "connecting") return { label: "Connecting", tone: state, tooltip: "The inspector is establishing its capture-service connection." };
  if (state === "disconnected") return { label: "Disconnected", tone: state, tooltip: "The capture-service connection is unavailable and will be retried." };
  return { label: "Capture service error", tone: state, tooltip: "The capture service reported an error. Retry the connection when it is available." };
}

function exchangeStatus(label: string, tone: StatusPresentation["tone"], tooltip: string): StatusPresentation {
  return { accessibleLabel: `${label}. ${tooltip}`, label, tone, tooltip };
}
