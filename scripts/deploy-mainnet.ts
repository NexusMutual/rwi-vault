import "dotenv/config";

import path from "node:path";

import { AwsKmsSigner } from "@nexusmutual/ethers-v6-aws-kms-signer";
import { deploy, DeploymentResultType, type EIP1193Provider } from "@nomicfoundation/ignition-core";
import {
  HardhatArtifactResolver,
  PrettyEventHandler,
  errorDeploymentResultToExceptionMessage,
} from "@nomicfoundation/hardhat-ignition/helpers";
import { BrowserProvider, id } from "ethers";
import { artifacts, interruptions, network } from "hardhat";

import MainnetDeploymentModule from "../ignition/modules/MainnetDeployment.js";
import {
  DEFAULT_CREATE2_PREFIX,
  getArtifactDeploymentData,
  getArtifactInitCodeHash,
  getUpgradeableProxyInitCodeHash,
  predictCreate2Address,
  predictProxyAddress,
} from "./create2-utils.js";

type JsonRpcRequest = {
  method: string;
  params?: unknown[];
};

type CliArgs = {
  registryImplementationSalt: string;
  registrySalt: string;
  vaultImplementationSalt: string;
  locksImplementationSalt: string;
  vaultProxySalt: string;
  locksProxySalt: string;
  targetPrefix: string;
};

type DeployedContractRecord = {
  address: string;
};

type PredictedAddresses = {
  temporaryRegistryImplementationDeploymentData: string;
  predictedTemporaryRegistryImplementationAddress: string;
  registryImplementationDeploymentData: string;
  predictedRegistryImplementationAddress: string;
  registryProxyDeploymentData: string;
  predictedRegistryAddress: string;
  vaultImplementationDeploymentData: string;
  predictedVaultImplementationAddress: string;
  predictedVaultProxy: string;
  locksImplementationDeploymentData: string;
  predictedLocksImplementationAddress: string;
  predictedLocksProxy: string;
};

const CREATE2_FACTORY_ADDRESS = "0xfac7011663910F75CbE1E25539ec2D7529f93C3F";
const MAINNET_USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ASSET_DECIMALS = 6;
const TEMPORARY_REGISTRY_IMPLEMENTATION_SALT = id("TemporaryRWIRegistryBootstrap");
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function getOptionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function getOptionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : Number(value);
}

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
    registryImplementationSalt: getRequiredArg(args, "registry-implementation-salt"),
    registrySalt: getRequiredArg(args, "registry-salt"),
    vaultImplementationSalt: getRequiredArg(args, "vault-implementation-salt"),
    locksImplementationSalt: getRequiredArg(args, "locks-implementation-salt"),
    vaultProxySalt: getRequiredArg(args, "vault-proxy-salt"),
    locksProxySalt: getRequiredArg(args, "locks-proxy-salt"),
    targetPrefix: (args.get("target-prefix") ?? DEFAULT_CREATE2_PREFIX).trim().toLowerCase(),
  };
}

function getDeployedContract(
  contracts: Record<string, DeployedContractRecord>,
  futureId: string,
): DeployedContractRecord {
  const contract = contracts[`${MainnetDeploymentModule.id}#${futureId}`];
  if (contract === undefined) {
    throw new Error(`Missing deployed contract entry for ${MainnetDeploymentModule.id}#${futureId}`);
  }

  return contract;
}

async function resolvePredictedAddresses(params: {
  deployerAddress: string;
  registryImplementationSalt: string;
  registrySalt: string;
  vaultImplementationSalt: string;
  locksImplementationSalt: string;
  vaultProxySalt: string;
  locksProxySalt: string;
}): Promise<PredictedAddresses> {
  const temporaryRegistryImplementationDeploymentData = await getArtifactDeploymentData("TemporaryRWIRegistry");
  const predictedTemporaryRegistryImplementationAddress = predictCreate2Address(
    CREATE2_FACTORY_ADDRESS,
    TEMPORARY_REGISTRY_IMPLEMENTATION_SALT,
    await getArtifactInitCodeHash("TemporaryRWIRegistry"),
  );

  const registryImplementationDeploymentData = await getArtifactDeploymentData("RWIRegistry");
  const predictedRegistryImplementationAddress = predictCreate2Address(
    CREATE2_FACTORY_ADDRESS,
    params.registryImplementationSalt,
    await getArtifactInitCodeHash("RWIRegistry"),
  );

  const registryProxyDeploymentData = await getArtifactDeploymentData("UpgradeableProxy", [
    params.deployerAddress,
    predictedTemporaryRegistryImplementationAddress,
  ]);
  const registryProxyInitCodeHash = await getUpgradeableProxyInitCodeHash(
    params.deployerAddress,
    predictedTemporaryRegistryImplementationAddress,
  );
  const predictedRegistryAddress = predictCreate2Address(
    CREATE2_FACTORY_ADDRESS,
    params.registrySalt,
    registryProxyInitCodeHash,
  );

  const vaultImplementationArgs = [predictedRegistryAddress, MAINNET_USDC_ADDRESS, ASSET_DECIMALS] as const;
  const vaultImplementationDeploymentData = await getArtifactDeploymentData("RWIVault", vaultImplementationArgs);
  const predictedVaultImplementationAddress = predictCreate2Address(
    CREATE2_FACTORY_ADDRESS,
    params.vaultImplementationSalt,
    await getArtifactInitCodeHash("RWIVault", vaultImplementationArgs),
  );
  const vaultProxyInitCodeHash = await getUpgradeableProxyInitCodeHash(
    predictedRegistryAddress,
    predictedVaultImplementationAddress,
  );
  const predictedVaultProxy = predictProxyAddress(
    predictedRegistryAddress,
    params.vaultProxySalt,
    vaultProxyInitCodeHash,
  );

  const locksImplementationArgs = [predictedRegistryAddress, predictedVaultProxy] as const;
  const locksImplementationDeploymentData = await getArtifactDeploymentData("Locks", locksImplementationArgs);
  const predictedLocksImplementationAddress = predictCreate2Address(
    CREATE2_FACTORY_ADDRESS,
    params.locksImplementationSalt,
    await getArtifactInitCodeHash("Locks", locksImplementationArgs),
  );
  const locksProxyInitCodeHash = await getUpgradeableProxyInitCodeHash(
    predictedRegistryAddress,
    predictedLocksImplementationAddress,
  );
  const predictedLocksProxy = predictProxyAddress(
    predictedRegistryAddress,
    params.locksProxySalt,
    locksProxyInitCodeHash,
  );

  return {
    temporaryRegistryImplementationDeploymentData,
    predictedTemporaryRegistryImplementationAddress,
    registryImplementationDeploymentData,
    predictedRegistryImplementationAddress,
    registryProxyDeploymentData,
    predictedRegistryAddress,
    vaultImplementationDeploymentData,
    predictedVaultImplementationAddress,
    predictedVaultProxy,
    locksImplementationDeploymentData,
    predictedLocksImplementationAddress,
    predictedLocksProxy,
  };
}

function buildKmsBackedProvider(params: {
  provider: EIP1193Provider;
  signer: AwsKmsSigner;
  signerAddress: string;
  chainId: bigint;
}): EIP1193Provider {
  return {
    request: async (request: JsonRpcRequest) => {
      if (request.method === "eth_accounts" || request.method === "eth_requestAccounts") {
        return [params.signerAddress];
      }

      if (request.method === "eth_sendTransaction") {
        const [txRequest] = (request.params ?? []) as [Record<string, unknown> | undefined];

        if (txRequest === undefined) {
          throw new Error("eth_sendTransaction called without a transaction payload");
        }

        const { gas, ...restTxRequest } = txRequest;
        const gasLimit = gas as string | number | bigint | undefined;

        const rawTransaction = await params.signer.signTransaction({
          chainId: params.chainId,
          ...restTxRequest,
          gasLimit,
        });

        return params.provider.request({
          method: "eth_sendRawTransaction",
          params: [rawTransaction],
        });
      }

      return params.provider.request(request);
    },
  };
}

async function main() {
  const {
    registryImplementationSalt,
    registrySalt,
    vaultImplementationSalt,
    locksImplementationSalt,
    vaultProxySalt,
    locksProxySalt,
    targetPrefix,
  } = parseArgs(process.argv.slice(2));
  const connection = await network.connect();
  const provider = new BrowserProvider(connection.provider);

  const kmsSigner = new AwsKmsSigner(
    {
      region: getRequiredEnv("AWS_REGION"),
      accessKeyId: getRequiredEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("AWS_SECRET_ACCESS_KEY"),
      kmsKeyId: getRequiredEnv("AWS_KMS_KEY_ID"),
    },
    provider as unknown as ConstructorParameters<typeof AwsKmsSigner>[1],
  );

  const [kmsAddress, networkDetails] = await Promise.all([
    kmsSigner.getAddress(),
    provider.getNetwork(),
  ]);

  const {
    temporaryRegistryImplementationDeploymentData,
    predictedTemporaryRegistryImplementationAddress,
    registryImplementationDeploymentData,
    predictedRegistryImplementationAddress,
    registryProxyDeploymentData,
    predictedRegistryAddress,
    vaultImplementationDeploymentData,
    predictedVaultImplementationAddress,
    predictedVaultProxy,
    locksImplementationDeploymentData,
    predictedLocksImplementationAddress,
    predictedLocksProxy,
  } = await resolvePredictedAddresses({
    deployerAddress: kmsAddress,
    registryImplementationSalt,
    registrySalt,
    vaultImplementationSalt,
    locksImplementationSalt,
    vaultProxySalt,
    locksProxySalt,
  });

  console.log(`Network: ${connection.networkName} (${networkDetails.chainId})`);
  console.log(`KMS deployer: ${kmsAddress}`);
  console.log(`Create2 factory: ${CREATE2_FACTORY_ADDRESS}`);
  console.log(`Target prefix: ${targetPrefix}`);
  console.log(`Predicted temporary registry implementation: ${predictedTemporaryRegistryImplementationAddress}`);
  console.log(`Predicted registry implementation: ${predictedRegistryImplementationAddress}`);
  console.log(`Predicted registry: ${predictedRegistryAddress}`);
  console.log(`Predicted vault implementation: ${predictedVaultImplementationAddress}`);
  console.log(`Predicted locks implementation: ${predictedLocksImplementationAddress}`);
  console.log(`Predicted vault proxy: ${predictedVaultProxy}`);
  console.log(`Predicted locks proxy: ${predictedLocksProxy}`);

  if (
    !predictedRegistryImplementationAddress.toLowerCase().startsWith(targetPrefix) ||
    !predictedRegistryAddress.toLowerCase().startsWith(targetPrefix) ||
    !predictedVaultImplementationAddress.toLowerCase().startsWith(targetPrefix) ||
    !predictedLocksImplementationAddress.toLowerCase().startsWith(targetPrefix) ||
    !predictedVaultProxy.toLowerCase().startsWith(targetPrefix) ||
    !predictedLocksProxy.toLowerCase().startsWith(targetPrefix)
  ) {
    throw new Error("Resolved proxy salts do not match the requested CREATE2 address prefix");
  }

  // Ignition expects node-managed senders, so this wrapper swaps eth_sendTransaction
  // for presigned raw transactions from the AWS KMS-backed signer.
  const ignitionProvider = buildKmsBackedProvider({
    provider: connection.provider,
    signer: kmsSigner,
    signerAddress: kmsAddress,
    chainId: networkDetails.chainId,
  });

  const deploymentParameters = {
    [MainnetDeploymentModule.id]: {
      bootstrapGovernor: kmsAddress,
      temporaryRegistryImplementationAddress: predictedTemporaryRegistryImplementationAddress,
      temporaryRegistryImplementationDeploymentData,
      temporaryRegistryImplementationSalt: TEMPORARY_REGISTRY_IMPLEMENTATION_SALT,
      registryImplementationAddress: predictedRegistryImplementationAddress,
      registryImplementationDeploymentData,
      registryImplementationSalt,
      registryProxyAddress: predictedRegistryAddress,
      registryProxyDeploymentData,
      registrySalt,
      vaultImplementationAddress: predictedVaultImplementationAddress,
      vaultProxyAddress: predictedVaultProxy,
      vaultImplementationDeploymentData,
      vaultImplementationSalt,
      locksImplementationAddress: predictedLocksImplementationAddress,
      locksProxyAddress: predictedLocksProxy,
      locksImplementationDeploymentData,
      locksImplementationSalt,
      bootstrapVaultOperator: kmsAddress,
      vaultProxySalt,
      locksProxySalt,
    },
  };

  const deploymentId = getOptionalEnv("IGNITION_DEPLOYMENT_ID", `mainnet-${connection.networkName}-${String(networkDetails.chainId)}`);
  const deploymentDir = path.join(process.cwd(), "ignition", "deployments", deploymentId);
  const result = await deploy({
    artifactResolver: new HardhatArtifactResolver(artifacts),
    provider: ignitionProvider,
    executionEventListener: new PrettyEventHandler(interruptions, { deploymentParams: deploymentParameters }),
    deploymentDir,
    ignitionModule: MainnetDeploymentModule,
    deploymentParameters,
    accounts: [kmsAddress],
    defaultSender: kmsAddress,
    strategy: "basic",
    config: {
      requiredConfirmations: getOptionalNumber("IGNITION_REQUIRED_CONFIRMATIONS", 2),
    },
  });

  if (result.type !== DeploymentResultType.SUCCESSFUL_DEPLOYMENT) {
    throw new Error(errorDeploymentResultToExceptionMessage(result));
  }

  const registryContract = getDeployedContract(result.contracts, "registryProxy");
  const temporaryRegistryImplementation = getDeployedContract(result.contracts, "temporaryRegistryImplementation");
  const finalRegistryImplementation = getDeployedContract(result.contracts, "registryImplementation");
  const deployedVaultImplementation = getDeployedContract(result.contracts, "vaultImplementation");
  const deployedVaultProxy = getDeployedContract(result.contracts, "vaultProxy");
  const deployedLocksImplementation = getDeployedContract(result.contracts, "locksImplementation");
  const deployedLocksProxy = getDeployedContract(result.contracts, "locksProxy");

  const registry = registryContract.address;
  const vaultProxy = deployedVaultProxy.address;
  const locksProxy = deployedLocksProxy.address;

  console.log("\nDeployment complete");
  console.log(`Registry: ${registry}`);
  console.log(`Temporary registry implementation: ${temporaryRegistryImplementation.address}`);
  console.log(`Registry implementation: ${finalRegistryImplementation.address}`);
  console.log(`Vault implementation: ${deployedVaultImplementation.address}`);
  console.log(`Vault proxy: ${vaultProxy}`);
  console.log(`Locks implementation: ${deployedLocksImplementation.address}`);
  console.log(`Locks proxy: ${locksProxy}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
