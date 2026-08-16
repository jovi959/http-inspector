import { useEffect } from "react";

import type { HttpExchange } from "@/generated/contracts";

interface RecomposeContextMenuProps {
  readonly exchange: HttpExchange;
  readonly x: number;
  readonly y: number;
  onClose(): void;
  onRecompose(exchange: HttpExchange): void;
}

/** A focused one-action menu keeps request replay discoverable directly from both primary views. */
export function RecomposeContextMenu({ exchange, x, y, onClose, onRecompose }: RecomposeContextMenuProps) {
  useEffect(() => {
    const close = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);
  return (
    <div className="recompose-context-menu" role="menu" style={{ left: x, top: y }} onPointerDown={(event) => event.stopPropagation()}>
      <button autoFocus role="menuitem" type="button" onClick={() => onRecompose(exchange)}>Recompose &amp; replay</button>
    </div>
  );
}
