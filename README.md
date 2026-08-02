# [Real World Insurance Vault](https://app.nexusmutual.io/vault/)

The Real World Insurance Vault (“RWI Vault”) allows sophisticated investors to earn yield on their USDC.

The Vault is deployed on Ethereum mainnet with infrastructure based on the ERC-7540 standard. The underlying returns are sourced by providing solvency capital and reserves off-chain to back regulated insurance policies.

[Read more in the docs](https://docs.nexusmutual.io/rwi-vault/).

## Getting started

- **Requirements**: Node.js `>=22.10.0 <22.18.0` (tested through v22.17.1; Node 22.18+, 23.x, and 24.x fail `npm test` due to a Mocha/`require(esm)` loader bug)
- **Install**: `npm install`
- **Build**: `npx hardhat build`
- **Test**: `npm test`

## Deployed addresses and ABIs

Published addresses and contract ABIs for integrators are shipped as [`@nexusmutual/rwi-vault-deployments`](https://www.npmjs.com/package/@nexusmutual/rwi-vault-deployments) on npm.

The source for that package lives in this repo under `deployments/`. After a mainnet deployment run `npm run deployments:build` from the repository root to regenerate the package artifacts from Ignition outputs and contract artifacts.

## Audits

- [Nexus Mutual RWI Vault Smart Contract Audit](https://iosiro.com/audits/nexus-mutual-rwi-vault-smart-contract-audit) — iosiro, September 2025 to March 2026, covering the initial audit and four follow-up changes
- [Check the docs for a full list of Nexus Mutual security audits](https://docs.nexusmutual.io/resources/audits-and-security)
