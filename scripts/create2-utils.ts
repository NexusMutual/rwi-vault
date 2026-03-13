import { cpus } from "node:os";
import { Worker } from "node:worker_threads";

import { artifacts } from "hardhat";
import { getCreateAddress, getCreate2Address, Interface, keccak256 } from "ethers";

export const DEFAULT_CREATE2_PREFIX = "0xcafea";

export type SaltSearchResult = {
  contract: string;
  salt: string;
  address: string;
  nonce: string;
};

type WorkerResultMessage = SaltSearchResult;

export async function getUpgradeableProxyInitCodeHash(initialOwner: string, implementationAddress: string): Promise<string> {
  return getArtifactInitCodeHash("UpgradeableProxy", [initialOwner, implementationAddress]);
}

export async function getArtifactDeploymentData(contractName: string, constructorArgs: readonly unknown[] = []): Promise<string> {
  const artifact = await artifacts.readArtifact(contractName);
  const contractInterface = new Interface(artifact.abi);
  return `${artifact.bytecode}${contractInterface.encodeDeploy(constructorArgs).slice(2)}`;
}

export async function getArtifactInitCodeHash(contractName: string, constructorArgs: readonly unknown[] = []): Promise<string> {
  return keccak256(await getArtifactDeploymentData(contractName, constructorArgs));
}

export function predictContractAddress(deployer: string, nonce: number): string {
  return getCreateAddress({ from: deployer, nonce });
}

export function predictProxyAddress(
  registryAddress: string,
  salt: string,
  initCodeHash: string,
): string {
  return getCreate2Address(registryAddress, salt, initCodeHash);
}

export function predictCreate2Address(
  deployerAddress: string,
  salt: string,
  initCodeHash: string,
): string {
  return getCreate2Address(deployerAddress, salt, initCodeHash);
}

export async function findSalt(params: {
  registryAddress: string;
  initCodeHash: string;
  contract: string;
  targetPrefix?: string;
  workers?: number;
  startNonce?: bigint;
  endNonce?: bigint;
}): Promise<SaltSearchResult> {
  const workerCount = Math.max(1, params.workers ?? cpus().length);
  const targetPrefix = (params.targetPrefix ?? DEFAULT_CREATE2_PREFIX).toLowerCase();
  const startNonce = params.startNonce ?? 0n;
  const endNonce = params.endNonce;

  return new Promise((resolve, reject) => {
    const spawnedWorkers: Worker[] = [];
    let settled = false;
    let exitCount = 0;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      void Promise.allSettled(spawnedWorkers.map((worker) => worker.terminate())).finally(callback);
    };

    for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
      const workerStartNonce = startNonce + BigInt(workerIndex);

      if (endNonce !== undefined && workerStartNonce > endNonce) {
        continue;
      }

      const worker = new Worker(new URL("./worker.js", import.meta.url), {
        workerData: {
          registryAddress: params.registryAddress,
          initCodeHash: params.initCodeHash,
          contract: params.contract,
          targetPrefix,
          startNonce: workerStartNonce,
          endNonce,
          step: BigInt(workerCount),
        },
      });

      worker.on("message", (result: WorkerResultMessage) => {
        finish(() => resolve(result));
      });

      worker.on("error", (error) => {
        finish(() => reject(error));
      });

      worker.on("exit", (code) => {
        exitCount += 1;

        if (!settled && code !== 0) {
          finish(() => reject(new Error(`Salt search worker exited with code ${code}`)));
          return;
        }

        if (!settled && exitCount === spawnedWorkers.length) {
          finish(() => reject(new Error("Salt search workers exited without finding a salt")));
        }
      });

      spawnedWorkers.push(worker);
    }

    if (spawnedWorkers.length === 0) {
      reject(new Error("Salt search range is empty"));
    }
  });
}
