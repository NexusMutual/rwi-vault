export const ContractIndexes = {
  C_REGISTRY: 1n << 0n,
  C_GOVERNOR: 1n << 1n,
  C_VAULT: 1n << 2n,
  C_LOCKS: 1n << 3n,
  A_VAULT_OPERATOR: 1n << 4n,
  A_MEMBERSHIP_OPERATOR: 1n << 5n,
};

export const PauseTypes = {
  PAUSE_GLOBAL: 1n << 0n,
  PAUSE_VAULT: 1n << 1n,
  PAUSE_LOCKS: 1n << 2n,
};

export const RequestStatus = {
  PENDING: 0,
  FULFILLED: 1,
  CANCELLED: 2,
};
