/** A storage variable, or a field within a struct. Type names are normalised. */
export type StorageEntry = {
  label: string;
  slot: number;
  offset: number;
  type: string;
  size: number;
};

export type StorageType = {
  encoding: string;
  size: number;
  /** Present for struct types; solc reports the packed field layout. */
  members?: StorageEntry[];
};

export type ContractLayout = {
  /** Top-level storage variables, in declaration order. */
  storage: StorageEntry[];
  /**
   * Every type reachable from `storage`, keyed by normalised type name,
   * including structs held behind a mapping or an array.
   */
  types: Record<string, StorageType>;
};

/** Storage layouts for first-party contracts, keyed by contract name. */
export declare function extractStorageLayout(): Record<string, ContractLayout>;
