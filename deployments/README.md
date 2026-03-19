# RWI Vault Deployments

This package contains ABIs, deployed addresses, and contract types for the deployed RWI Vault contracts.

## Usage

### Variables

`addresses`:
Contains addresses for `RWIRegistry`, `RWIVault`, and `Locks`.

```ts
import { addresses } from "@nexusmutual/rwi-vault-deployments";

console.log(addresses.RWIVault);
```

`abis`:
A map containing ABI definitions for all exported contracts.

```ts
import { abis } from "@nexusmutual/rwi-vault-deployments";

console.log(abis.RWIRegistry);
```

### Exported JSON Files

Addresses and ABIs are also exported as JSON under:

- `dist/data/addresses.json`
- `dist/data/abis/index.json`
- `dist/data/abis/RWIRegistry.json`
- `dist/data/abis/RWIVault.json`
- `dist/data/abis/Locks.json`

## Building

Run:

```shell
npm run deployments:build
```

This will:

- read `ignition/deployments/mainnet-<id>/deployed_addresses.json`,
- generate ABI exports from existing artifacts,
- copy contract type declarations from existing generated ethers types,
- build package outputs in `deployments/dist`.

By default, `<id>` is `1`. You can override it by setting `MAINNET_DEPLOYMENT_ID`.
