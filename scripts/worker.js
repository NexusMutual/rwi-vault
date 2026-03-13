import { parentPort, workerData } from "node:worker_threads";

import { getCreate2Address, solidityPackedKeccak256 } from "ethers";

if (parentPort === null) {
  throw new Error("Salt search worker requires a parent port");
}

const {
  registryAddress,
  initCodeHash,
  contract,
  targetPrefix,
  startNonce,
  endNonce,
  step,
} = workerData;

let nonce = BigInt(startNonce);
const maxNonce = endNonce === undefined ? undefined : BigInt(endNonce);
const increment = BigInt(step);
const prefix = String(targetPrefix).toLowerCase();

while (maxNonce === undefined || nonce <= maxNonce) {
  const salt = solidityPackedKeccak256(["string", "uint256"], [contract, nonce]);
  const address = getCreate2Address(registryAddress, salt, initCodeHash);

  if (address.toLowerCase().startsWith(prefix)) {
    parentPort.postMessage({
      contract,
      salt,
      address,
      nonce: nonce.toString(),
    });
    break;
  }

  nonce += increment;
}
