# [Real World Insurance Vault](https://app.nexusmutual.io/vault/)

[![CI](https://github.com/NexusMutual/rwi-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/NexusMutual/rwi-vault/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/NexusMutual/rwi-vault/badge.svg)](https://coveralls.io/github/NexusMutual/rwi-vault)

The Real World Insurance Vault (“RWI Vault”) allows sophisticated investors to earn yield on their USDC.

The Vault is deployed on Ethereum mainnet with infrastructure based on the ERC-7540 standard. The underlying returns are sourced by providing solvency capital and reserves off-chain to back regulated insurance policies.

[Read more in the docs](https://docs.nexusmutual.io/rwi-vault/).

## Getting started

- **Requirements**: Node.js `>=22.10.0 <22.18.0` (tested through v22.17.1; Node 22.18+, 23.x, and 24.x fail `pnpm test` due to a Mocha/`require(esm)` loader bug)
- **Install**: `pnpm install`
- **Build**: `pnpm exec hardhat build`
- **Test**: `pnpm test`

## Deployed addresses and ABIs

Published addresses and contract ABIs for integrators are shipped as [`@nexusmutual/rwi-vault-deployments`](https://www.npmjs.com/package/@nexusmutual/rwi-vault-deployments) on npm.

The source for that package lives in this repo under `deployments/`. After a mainnet deployment run `pnpm run deployments:build` from the repository root to regenerate the package artifacts from Ignition outputs and contract artifacts.

## Releasing

Two manually triggered workflows publish the deployments package. Run them from the Actions tab.

- **Release Next** publishes a release candidate (`1.2.0-rc1`) under the `next` tag. It commits nothing, so it can be run repeatedly.
- **Release** bumps the version on `dev`, fast-forwards `master` to it, publishes under the `latest` tag, then creates the git tag and GitHub release.

Both take the version from [Conventional Commits](https://www.conventionalcommits.org/) since the last tag. Commits typed `docs`, `style`, `test` or `ci` do not produce a release.

### Required setup

Both workflows run against a `production` [environment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) holding three secrets:

| Secret | Purpose |
|---|---|
| `DEPLOYER_APP_ID` | identifies the deployer GitHub App |
| `DEPLOYER_APP_PK` | private key for that app |
| `NPM_TOKEN` | publishes to npm |

Every job that needs them declares `environment: production`, which is where these secrets are expected to live.

The deployer GitHub App (`infra-deployooor`) also needs to be installed on this repository and listed as a bypass actor on the branch ruleset, since the release pushes a version bump to `dev` and fast-forwards `master`.

## Audits

- [Nexus Mutual RWI Vault Smart Contract Audit](https://iosiro.com/audits/nexus-mutual-rwi-vault-smart-contract-audit) — iosiro, September 2025 to March 2026, covering the initial audit and four follow-up changes
- [Check the docs for a full list of Nexus Mutual security audits](https://docs.nexusmutual.io/resources/audits-and-security)
