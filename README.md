# [Real World Insurance Vault](https://app.nexusmutual.io/vault/)

[![CI](https://github.com/NexusMutual/rwi-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/NexusMutual/rwi-vault/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/NexusMutual/rwi-vault/badge.svg)](https://coveralls.io/github/NexusMutual/rwi-vault)

The Real World Insurance Vault (“RWI Vault”) allows sophisticated investors to earn yield on their USDC.

The Vault is deployed on Ethereum mainnet with infrastructure based on the ERC-7540 standard. The underlying returns are sourced by providing solvency capital and reserves off-chain to back regulated insurance policies.

[Read more in the docs](https://docs.nexusmutual.io/rwi-vault/).

## Getting started

- **Requirements**: Node.js `>=22.13.0 <22.18.0`, pinned to v22.17.1 by `.nvmrc`. pnpm 11 sets the floor; Node 22.18+, 23.x and 24.x fail `pnpm test` due to a Mocha/`require(esm)` loader bug.
- **Install**: `pnpm install`
- **Build**: `pnpm exec hardhat build`
- **Test**: `pnpm test`

## Deployed addresses and ABIs

Published addresses and contract ABIs for integrators are shipped as [`@nexusmutual/rwi-vault-deployments`](https://www.npmjs.com/package/@nexusmutual/rwi-vault-deployments) on npm.

The source for that package lives in this repo under `deployments/`. After a mainnet deployment run `pnpm run deployments:build` from the repository root to regenerate the package artifacts from Ignition outputs and contract artifacts.

## Releasing

The deployments package is published by the **Release** workflow, run from the Actions tab. Dispatch it and pick a channel:

- **next** builds a release candidate from `dev` — the next version carrying an `-rc.N` suffix — and publishes it under the `next` tag. It commits nothing, so it can be run repeatedly.
- **latest** fast-forwards `master` to `dev`, commits the version bump there, publishes under the `latest` tag, creates the git tag and GitHub release, rebases the bump back onto `dev`, and opens a version bump PR in `services`.

Both take the version from [Conventional Commits](https://www.conventionalcommits.org/) since the last tag. Commits typed `docs`, `style`, `test` or `ci` do not produce a release.

A major version comes from `!` after the type (`feat!:`, `feat(api)!:`) or a `BREAKING CHANGE:` footer. The `!` form needs a space and a description after the colon; `feat!:no space` reads as an ordinary commit.

Any line starting with `BREAKING CHANGE:` counts, wherever it sits in the message. Indent the line when writing about the syntax, so that a commit describing it keeps its own type.

Each channel builds the package and runs lint and tests before publishing, and the publish step uploads that same build — what reaches npm is what was tested.

### Required setup

The release runs against a `production` [environment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) holding two secrets:

| Secret | Purpose |
|---|---|
| `DEPLOYER_APP_ID` | identifies the deployer GitHub App |
| `DEPLOYER_APP_PK` | private key for that app |

Every job that needs them declares `environment: production`, which is where these secrets are expected to live.

The deployer GitHub App (`infra-deployooor`) also needs to be installed on this repository and listed as a bypass actor on the branch ruleset, since the release pushes a version bump to `master` and rebases `dev`.

npm needs no token. Publishing authenticates through [trusted publishing](https://docs.npmjs.com/trusted-publishers), which is why the publish job requests `id-token: write`. The package is registered on npm against this repository, `.github/workflows/release.yml` and the `production` environment, so **renaming the file or the environment stops publishing** until the npm setting is updated to match. npm answers such a mismatch with a 404 rather than an authentication error. Both channels publish from the one file for the same reason: trusted publishing authorises a workflow file, not a repository.

## Audits

- [Nexus Mutual RWI Vault Smart Contract Audit](https://iosiro.com/audits/nexus-mutual-rwi-vault-smart-contract-audit) — iosiro, September 2025 to March 2026, covering the initial audit and four follow-up changes
- [Check the docs for a full list of Nexus Mutual security audits](https://docs.nexusmutual.io/resources/audits-and-security)
