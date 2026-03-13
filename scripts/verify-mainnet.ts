import "dotenv/config";

import path from "node:path";

import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { readFile } from "node:fs/promises";

type CliArgs = {
  deploymentId: string;
  deployer: string;
};

type DeployedAddresses = {
  temporaryRegistryImplementation: string;
  registryImplementation: string;
  registryProxy: string;
  vaultImplementation: string;
  vaultProxy: string;
  locksImplementation: string;
  locksProxy: string;
};

const MAINNET_USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ASSET_DECIMALS = 6;
const KMS_DEPLOYER_ADDRESS = "0x46842a7D9372bB7DBa08f0729393DEda230a03B5";

function getRequiredArg(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required argument: --${name}`);
  }

  return value.trim();
}

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for argument: --${key}`);
    }

    args.set(key, value);
    index += 1;
  }

  return {
    deploymentId: getRequiredArg(args, "deployment-id"),
    deployer: (args.get("deployer") ?? KMS_DEPLOYER_ADDRESS).trim(),
  };
}

async function readDeployedAddresses(deploymentId: string): Promise<DeployedAddresses> {
  const deploymentFile = path.join(
    process.cwd(),
    "ignition",
    "deployments",
    deploymentId,
    "deployed_addresses.json",
  );
  const content = await readFile(deploymentFile, "utf8");
  const deployedAddresses = JSON.parse(content) as Record<string, string>;

  const getAddress = (futureId: string): string => {
    const address = deployedAddresses[`MainnetDeploymentModule#${futureId}`];
    if (address === undefined) {
      throw new Error(`Missing deployed address for MainnetDeploymentModule#${futureId} in ${deploymentFile}`);
    }

    return address;
  };

  return {
    temporaryRegistryImplementation: getAddress("temporaryRegistryImplementation"),
    registryImplementation: getAddress("registryImplementation"),
    registryProxy: getAddress("registryProxy"),
    vaultImplementation: getAddress("vaultImplementation"),
    vaultProxy: getAddress("vaultProxy"),
    locksImplementation: getAddress("locksImplementation"),
    locksProxy: getAddress("locksProxy"),
  };
}

async function verifyOne(params: {
  label: string;
  address: string;
  constructorArgs: readonly unknown[];
}) {
  try {
    console.log(`Verifying ${params.label}: ${params.address}`);
    await verifyContract(
      {
        address: params.address,
        constructorArgs: [...params.constructorArgs],
        provider: "etherscan",
      },
      hre,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("already verified")) {
      console.log(`${params.label} is already verified`);
      return;
    }

    throw error;
  }
}

async function main() {
  const {
    deploymentId,
    deployer,
  } = parseArgs(process.argv.slice(2));

  const {
    temporaryRegistryImplementation,
    registryImplementation,
    registryProxy,
    vaultImplementation,
    vaultProxy,
    locksImplementation,
    locksProxy,
  } = await readDeployedAddresses(deploymentId);

  console.log("Verification provider: etherscan");
  console.log(`Deployment id: ${deploymentId}`);
  console.log(`Verifier deployer: ${deployer}`);
  console.log(`Registry: ${registryProxy}`);

  await verifyOne({
    label: "TemporaryRWIRegistry",
    address: temporaryRegistryImplementation,
    constructorArgs: [],
  });

  await verifyOne({
    label: "RWIRegistry",
    address: registryImplementation,
    constructorArgs: [],
  });

  await verifyOne({
    label: "Registry proxy",
    address: registryProxy,
    constructorArgs: [deployer, temporaryRegistryImplementation],
  });

  await verifyOne({
    label: "RWIVault implementation",
    address: vaultImplementation,
    constructorArgs: [registryProxy, MAINNET_USDC_ADDRESS, ASSET_DECIMALS],
  });

  await verifyOne({
    label: "Vault proxy",
    address: vaultProxy,
    constructorArgs: [registryProxy, vaultImplementation],
  });

  await verifyOne({
    label: "Locks implementation",
    address: locksImplementation,
    constructorArgs: [registryProxy, vaultProxy],
  });

  await verifyOne({
    label: "Locks proxy",
    address: locksProxy,
    constructorArgs: [registryProxy, locksImplementation],
  });

  console.log("\nVerification complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
