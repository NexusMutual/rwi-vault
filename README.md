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

The deployments package is published by the **Release** workflow, run from the Actions tab. Dispatch it and pick a channel:

- **next** builds a release candidate (`1.2.0-rc.0`) from `dev` and publishes it under the `next` tag, leaving git untouched. Run it as often as you like.
- **latest** fast-forwards `master` to `dev`, commits the version bump there, publishes under the `latest` tag, creates the git tag and GitHub release, rebases the bump back onto `dev`, and opens a version bump PR in `services`.

Both take the version from [Conventional Commits](https://www.conventionalcommits.org/) since the last tag. A release needs at least one commit typed beyond `docs`, `style`, `test` and `ci`.

Each channel builds the package and runs lint and tests before publishing. The publish step ships that same build.

### Required setup

The release runs against a `production` [environment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) holding two secrets:

| Secret | Purpose |
|---|---|
| `DEPLOYER_APP_ID` | identifies the deployer GitHub App |
| `DEPLOYER_APP_PK` | private key for that app |

Every job that needs them declares `environment: production`. Define these secrets on that environment.

The release pushes a version bump to `master` and rebases `dev`. Install the deployer GitHub App (`infra-deployooor`) on this repository and list it as a bypass actor on the branch ruleset.

Publishing authenticates through [trusted publishing](https://docs.npmjs.com/trusted-publishers). The publish job requests `id-token: write`, and npm registers the package against this repository and `.github/workflows/release.yml`.

Trusted publishing authorises a workflow file, so both channels publish from `release.yml`. Update the npm registration whenever that file is renamed.

## Audits

- [Nexus Mutual RWI Vault Smart Contract Audit](https://iosiro.com/audits/nexus-mutual-rwi-vault-smart-contract-audit) — iosiro, September 2025 to March 2026, covering the initial audit and four follow-up changes
- [Check the docs for a full list of Nexus Mutual security audits](https://docs.nexusmutual.io/resources/audits-and-security)
