import { createContext, useContext } from "react";

import type { DataverseValueDescriber, DataverseValueNameIndex } from "@/domain/dataverse/dataverseMap";

export type DataverseValueNamesStatus = "off" | "loading" | "ready" | "unavailable";

/** Source constant names for GUID/integer values in the Dataverse Map, with the user's on/off choice. */
export interface DataverseValueNames {
  readonly enabled: boolean;
  readonly status: DataverseValueNamesStatus;
  readonly index: DataverseValueNameIndex | null;
  readonly message: string | null;
  readonly describe: DataverseValueDescriber | null;
  setEnabled(enabled: boolean): void;
  refresh(): void;
  /** Pick a source folder to scan (kept between sessions), then re-scan. */
  chooseSource(): void;
}

export const DataverseValueNamesContext = createContext<DataverseValueNames | null>(null);

/** Null outside the provider (e.g. isolated renders), which simply shows no names. */
export function useDataverseValueNames(): DataverseValueNames | null {
  return useContext(DataverseValueNamesContext);
}
