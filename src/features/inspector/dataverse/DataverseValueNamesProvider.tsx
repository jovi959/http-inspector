import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { ProjectIntegrationService } from "@/data/ports/ProjectIntegrationService";
import { createDataverseValueDescriber } from "@/domain/dataverse/dataverseMap";
import type { DataverseValueNameIndex } from "@/domain/dataverse/dataverseMap";
import { DataverseValueNamesContext } from "@/features/inspector/dataverse/dataverseValueNamesContext";
import type { DataverseValueNames } from "@/features/inspector/dataverse/dataverseValueNamesContext";
import { useCaptureStore } from "@/state/capture/captureStore";

interface DataverseValueNamesProviderProps {
  readonly service: ProjectIntegrationService;
  readonly children: ReactNode;
}

interface LoadState {
  readonly status: "loading" | "ready" | "unavailable";
  readonly index: DataverseValueNameIndex | null;
  readonly message: string | null;
}

/** Loads the source value-name index once while names are on (the backend caches it); Refresh forces a re-scan. */
export function DataverseValueNamesProvider({ service, children }: DataverseValueNamesProviderProps) {
  const enabled = useCaptureStore((state) => state.showDataverseValueNames);
  const setEnabled = useCaptureStore((state) => state.setShowDataverseValueNames);
  const [load, setLoad] = useState<LoadState | null>(null);
  const latestRequest = useRef(0);

  const fetchIndex = useCallback((refresh: boolean) => {
    const request = ++latestRequest.current;
    // Keep showing the previous names while a refresh runs.
    setLoad((current) => ({ status: "loading", index: current?.index ?? null, message: null }));
    service.valueNames(refresh)
      .then((index) => { if (request === latestRequest.current) setLoad({ status: "ready", index, message: null }); })
      .catch((error: unknown) => {
        if (request === latestRequest.current) setLoad({ status: "unavailable", index: null, message: error instanceof Error ? error.message : String(error) });
      });
  }, [service]);

  const chooseSource = useCallback(() => {
    service.chooseValueNameSource()
      .then((folder) => { if (folder) fetchIndex(true); })
      .catch((error: unknown) => setLoad({ status: "unavailable", index: null, message: error instanceof Error ? error.message : String(error) }));
  }, [service, fetchIndex]);

  useEffect(() => {
    if (enabled && load === null) fetchIndex(false);
  }, [enabled, load, fetchIndex]);

  const value = useMemo<DataverseValueNames>(() => {
    const index = enabled ? load?.index ?? null : null;
    return {
      enabled,
      status: enabled ? load?.status ?? "loading" : "off",
      index,
      message: load?.message ?? null,
      describe: index ? createDataverseValueDescriber(index) : null,
      setEnabled,
      refresh: () => fetchIndex(true),
      chooseSource,
    };
  }, [enabled, load, setEnabled, fetchIndex, chooseSource]);

  return <DataverseValueNamesContext.Provider value={value}>{children}</DataverseValueNamesContext.Provider>;
}
