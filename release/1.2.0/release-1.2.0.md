# Release 1.2.0: RWI Vault registry membership add-on

## Github PR

* [feat: add wasAddressUsedForJoining](https://github.com/NexusMutual/rwi-vault/pull/TODO)

## Contracts to be upgraded

* RWIRegistry.sol

> `RWIRegistry` is deployed behind an `UpgradeableProxy` at
> `0xcafeA3066fcB2050871630F76e894959223e1F56`. Deploy the new implementation
> below, then upgrade the proxy from the proxy owner / governor
> (`0x51ad1265C8702c9e96Ea61Fe4088C2e22eD4418e`) via `upgradeTo(<newImplementation>)`.

## Prerequisites

Scripts are run directly with Node (v22.10.0+). Mainnet deploys are signed by the
AWS KMS signer used in `scripts/deploy-mainnet.ts`. Set in `.env`:

* `MAINNET_RPC_URL`
* `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_KMS_KEY_ID`

Build the artifacts before deploying or mining salts:

```bash
npx hardhat build
```

## Contract deployment & verification

#### RWIRegistry.sol

* Constructor Params
  * N/A
* Address brute force command
  * Address: `0xCafeA67428e42490f8cd567dbb18bde8311E149d`
  * Salt: `0x500bcfe2104d6b4d435c0d9c3ad511609d86c95625d4c53a6015c7651b2b2cbd`
  * Nonce: `128966`
```bash
node scripts/find-salt.ts \
  --factory 0xfac7011663910F75CbE1E25539ec2D7529f93C3F \
  --contract RWIRegistry \
  --prefix 0xcafea
```
Copy the resulting `salt` (bytes32) and `address` into
`release/1.2.0/config/deployments.json` and `release/1.2.0/config/create2.json`.

* Deploy command
  * `RWIRegistry` has no constructor, so the CREATE2 init code is just the contract
    bytecode. Deploy the new implementation through the shared CREATE2 factory
    (`0xfac7011663910F75CbE1E25539ec2D7529f93C3F`) at the mined salt/address, signed by
    the AWS KMS deployer. Uses the generic CREATE2 deploy CLI (`scripts/create2/deploy.ts`),
    reading salt/address/constructorArgs from `config/deployments.json`. Add `--dry-run`
    to simulate via `staticCall` without broadcasting.
```bash
HARDHAT_NETWORK=mainnet node scripts/create2/deploy.ts \
  -f 0xfac7011663910F75CbE1E25539ec2D7529f93C3F \
  -c "$(jq -c '.RWIRegistry.constructorArgs' release/1.2.0/config/deployments.json)" \
  -a "$(jq -r '.RWIRegistry.expectedAddress' release/1.2.0/config/deployments.json)" \
  -s "$(jq -r '.RWIRegistry.salt'            release/1.2.0/config/deployments.json)" \
  -k -p 1 -b 0.5 RWIRegistry
```
* Verify command
```bash
npx hardhat verify --network mainnet \
  "$(node -e "const d=require('./release/1.2.0/config/deployments.json');process.stdout.write(String(d.RWIRegistry.expectedAddress))")" \
  --contract contracts/RWIRegistry.sol:RWIRegistry
```

## Proxy upgrade

After the new implementation is deployed and verified, upgrade the registry proxy
from the proxy owner (`0x51ad1265C8702c9e96Ea61Fe4088C2e22eD4418e`):

```
UpgradeableProxy(0xcafeA3066fcB2050871630F76e894959223e1F56).upgradeTo(<RWIRegistry expectedAddress>)
```

Optional one-time backfill (governor only), to apply the one-join-per-address rule
to existing members:

```
RWIRegistry(0xcafeA3066fcB2050871630F76e894959223e1F56).markAddressesUsedForJoining([<member addresses>])
```

## Publish deployments package

Point `MainnetDeploymentModule#registryImplementation` at the new implementation
address in `ignition/deployments/mainnet-1/deployed_addresses.json` (the proxy
address is unchanged), then regenerate the npm package:

```bash
npm run deployments:build
```
