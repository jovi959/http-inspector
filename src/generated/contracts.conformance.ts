import type { CaptureMessage, CaptureUiDelta, ExchangeState } from "@/generated/contracts";

// The compiler must force this list to change whenever a generated discriminant changes.
export function assertExhaustiveCaptureMessage(message: CaptureMessage): void {
  switch (message.type) {
    case "exchange.started":
    case "exchange.completed":
    case "exchange.failed":
    case "exchange.cancelled":
    case "exchange.snapshot":
    case "database.command.started":
    case "database.command.completed":
    case "database.command.failed":
    case "database.command.cancelled":
    case "database.command.snapshot":
    case "heartbeat":
      return;
    default: {
      const unexpected: never = message;
      return unexpected;
    }
  }
}

// This type-only switch provides the same drift detection for UI delta and lifecycle registries.
export function assertExhaustiveUiDelta(delta: CaptureUiDelta, state: ExchangeState): void {
  switch (delta.kind) {
    case "upsert":
    case "remove":
    case "reset":
    case "status":
    case "detailInvalidated":
      break;
    default: {
      const unexpected: never = delta;
      return unexpected;
    }
  }
  switch (state) {
    case "inFlight":
    case "completed":
    case "failed":
    case "cancelled":
    case "incomplete":
      return;
    default: {
      const unexpected: never = state;
      return unexpected;
    }
  }
}
