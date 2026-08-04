import "dotenv/config";

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AwsKmsSigner } from "@nexusmutual/ethers-v6-aws-kms-signer";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getCreate2Address,
  keccak256,
  parseUnits,
  toBeHex,
  type Provider,
  type Signer,
} from "ethers";

const ADDRESS_REGEX = /^0x[a-f0-9]{40}$/i;

const DEPLOYER_ABI = [
  "function deploy(bytes code, uint256 salt) external",
  "function deployAt(bytes code, uint256 salt, address expectedAddress) external",
];

const RPC_ENV_BY_NETWORK: Record<string, string> = {
  mainnet: "MAINNET_RPC_URL",
  sepolia: "SEPOLIA_RPC_URL",
  tenderlyvnet: "TENDERLYVNET_RPC_URL",
};

const EXPLORER_TX_BY_NETWORK: Record<string, string> = {
  mainnet: "https://etherscan.io/tx/",
  sepolia: "https://sepolia.etherscan.io/tx/",
};

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ARTIFACTS_DIR = fileURLToPath(new URL("../../artifacts/", import.meta.url));

type LinkReference = { start: number; length: number };
type LinkReferences = Record<string, Record<string, LinkReference[]>>;

type Artifact = {
  contractName: string;
  sourceName: string;
  abi: unknown[];
  bytecode: string;
  linkReferences: LinkReferences;
};

type Options = {
  contract: string;
  address: string;
  factory: string;
  salt: bigint;
  constructorArgs: unknown[];
  libraries: Record<string, string>;
  baseFee?: string;
  priorityFee: string;
  gasLimit?: bigint;
  confirmations: number;
  kms: boolean;
  network: string;
  rpcUrl?: string;
  compile: boolean;
  dryRun: boolean;
};

function usage(): void {
  console.log(`
  Usage:
    node scripts/create2/deploy.ts [OPTIONS] CONTRACT_NAME

    CONTRACT_NAME is the contract you want to deploy (e.g. RWIRegistry).

  Options:
    --address, -a ADDRESS           Expected CREATE2 deployment address. Required.
    --factory-address, -f ADDRESS   Address of the CREATE2 factory (deployAt caller). Required.
    --salt, -s SALT                 Salt for CREATE2 (0x-prefixed bytes32 or decimal). Required.
    --constructor-args, -c ARGS     Constructor args. JSON array for multiple, or a single value.
    --library, -l NAME:ADDRESS      Link an external library (repeatable).
    --network, -n NETWORK           Network name for RPC env lookup. Default: $HARDHAT_NETWORK or mainnet.
    --rpc-url URL                   Explicit RPC URL (overrides --network lookup).
    --base-fee, -b GWEI             EIP-1559 base fee in gwei. Optional (provider estimates if omitted).
    --priority-fee, -p GWEI         Miner tip in gwei. Default: 2.
    --gas-limit, -g GAS             Gas limit for the tx. Optional.
    --confirmations CONFS           Confirmations to wait. Default: 1.
    --kms, -k                       Sign with AWS KMS (uses AWS_* env). Otherwise <NETWORK>_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY.
    --no-compile                    Skip the "hardhat build" step.
    --dry-run                       Simulate via staticCall; do not broadcast.
    --help, -h                      Print this help message.
`);
}

function parseArgs(argv: string[]): Options {
  const opts: Partial<Options> & { constructorArgs: unknown[]; libraries: Record<string, string> } = {
    constructorArgs: [],
    libraries: {},
    priorityFee: "2",
    confirmations: 1,
    kms: false,
    network: process.env.HARDHAT_NETWORK?.trim() || "mainnet",
    compile: true,
    dryRun: false,
  };
  const positional: string[] = [];
  const args = [...argv];

  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  while (args.length) {
    const arg = args.shift() as string;

    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--kms" || arg === "-k") {
      opts.kms = true;
    } else if (arg === "--no-compile") {
      opts.compile = false;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--address" || arg === "-a") {
      const value = (args.shift() ?? "").trim();
      if (!ADDRESS_REGEX.test(value)) throw new Error(`Invalid address: ${value}`);
      opts.address = value;
    } else if (arg === "--factory-address" || arg === "-f") {
      const value = (args.shift() ?? "").trim();
      if (!ADDRESS_REGEX.test(value)) throw new Error(`Invalid factory address: ${value}`);
      opts.factory = value;
    } else if (arg === "--salt" || arg === "-s") {
      opts.salt = parseSalt(args.shift() ?? "");
    } else if (arg === "--constructor-args" || arg === "-c") {
      const value = args.shift() ?? "";
      opts.constructorArgs = value.trim().startsWith("[") ? JSON.parse(value) : [value];
    } else if (arg === "--library" || arg === "-l") {
      const value = args.shift() ?? "";
      const [name, address] = value.split(":");
      if (!name || !address || !ADDRESS_REGEX.test(address)) {
        throw new Error(`Invalid library format: ${value}. Expected NAME:ADDRESS`);
      }
      opts.libraries[name] = address;
    } else if (arg === "--network" || arg === "-n") {
      opts.network = (args.shift() ?? "").trim();
    } else if (arg === "--rpc-url") {
      opts.rpcUrl = (args.shift() ?? "").trim();
    } else if (arg === "--base-fee" || arg === "-b") {
      opts.baseFee = (args.shift() ?? "").trim();
    } else if (arg === "--priority-fee" || arg === "-p") {
      opts.priorityFee = (args.shift() ?? "").trim();
    } else if (arg === "--gas-limit" || arg === "-g") {
      opts.gasLimit = BigInt(args.shift() ?? "0");
    } else if (arg === "--confirmations") {
      opts.confirmations = Number(args.shift() ?? "1");
    } else if (arg.startsWith("--") || arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (opts.address === undefined) throw new Error("Missing required argument: --address");
  if (opts.factory === undefined) throw new Error("Missing required argument: --factory-address");
  if (opts.salt === undefined) throw new Error("Missing required argument: --salt");
  if (positional.length === 0) throw new Error("Missing required positional argument: CONTRACT_NAME");
  if (positional.length > 1) throw new Error(`Too many positional arguments: ${positional.join(", ")}`);

  opts.contract = positional[0];

  return opts as Options;
}

function parseSalt(value: string): bigint {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error("Missing salt value");
  const salt = BigInt(trimmed);
  if (salt < 0n || salt > (1n << 256n) - 1n) throw new Error(`Salt out of range: ${trimmed}`);
  return salt;
}

/**
 * Resolve a Hardhat 3 artifact by contract name (or fully-qualified `source:Name`)
 * by scanning the artifacts directory, mirroring `artifacts.readArtifact`.
 */
function resolveArtifact(contract: string): Artifact {
  const [pathHint, bareName] = contract.includes(":") ? contract.split(":") : [undefined, contract];

  if (!existsSync(ARTIFACTS_DIR)) {
    throw new Error(`Artifacts directory not found at ${ARTIFACTS_DIR}. Run "hardhat build" first.`);
  }

  const matches: Artifact[] = [];
  for (const entry of readdirSync(ARTIFACTS_DIR, { recursive: true, encoding: "utf8" })) {
    const normalized = entry.split("\\").join("/");
    if (!normalized.endsWith(`/${bareName}.json`) && normalized !== `${bareName}.json`) continue;

    const artifact = JSON.parse(readFileSync(`${ARTIFACTS_DIR}${normalized}`, "utf8")) as Artifact;
    if (artifact.contractName !== bareName || typeof artifact.bytecode !== "string") continue;
    if (pathHint !== undefined && artifact.sourceName !== pathHint) continue;
    matches.push(artifact);
  }

  if (matches.length === 0) throw new Error(`No artifact found for contract "${contract}"`);
  if (matches.length > 1) {
    const names = matches.map((m) => `${m.sourceName}:${m.contractName}`).join(", ");
    throw new Error(`Ambiguous contract name "${contract}". Candidates: ${names}. Use source:Name.`);
  }

  return matches[0];
}

function linkBytecode(artifact: Artifact, libraries: Record<string, string>): string {
  let bytecode = artifact.bytecode.startsWith("0x") ? artifact.bytecode.slice(2) : artifact.bytecode;

  for (const [sourceName, libs] of Object.entries(artifact.linkReferences ?? {})) {
    for (const [libName, references] of Object.entries(libs)) {
      const address = libraries[libName] ?? libraries[`${sourceName}:${libName}`];
      if (address === undefined) {
        throw new Error(`Missing library address for ${sourceName}:${libName}. Use --library ${libName}:ADDRESS`);
      }

      const addressHex = address.toLowerCase().replace(/^0x/, "");
      for (const { start, length } of references) {
        const from = start * 2;
        const to = (start + length) * 2;
        bytecode = bytecode.slice(0, from) + addressHex + bytecode.slice(to);
      }
    }
  }

  if (bytecode.includes("__")) {
    throw new Error("Bytecode still contains unlinked library placeholders. Provide all --library links.");
  }

  return `0x${bytecode}`;
}

/**
 * Build deployment (init) code: linked bytecode + ABI-encoded constructor args.
 */
export function getDeploymentBytecode(
  artifact: Artifact,
  constructorArgs: readonly unknown[],
  libraries: Record<string, string> = {},
): string {
  const linked = linkBytecode(artifact, libraries);
  const iface = new Interface(artifact.abi as ConstructorParameters<typeof Interface>[0]);
  return `${linked}${iface.encodeDeploy(constructorArgs).slice(2)}`;
}

export function calculateCreate2Address(factory: string, salt: bigint, initCode: string): string {
  return getCreate2Address(factory, toBeHex(salt, 32), keccak256(initCode));
}

function resolveRpcUrl(opts: Options): string {
  if (opts.rpcUrl !== undefined && opts.rpcUrl !== "") return opts.rpcUrl;
  const envName = RPC_ENV_BY_NETWORK[opts.network] ?? `${opts.network.toUpperCase()}_RPC_URL`;
  const value = process.env[envName];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing RPC url. Set ${envName} or pass --rpc-url.`);
  }
  return value.trim();
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`Missing required environment variable: ${name}`);
  return value.trim();
}

function buildSigner(opts: Options, provider: Provider): Signer {
  if (opts.kms) {
    // The KMS signer package ships CommonJS-ethers types, so cast across the
    // dual-package (ESM/CJS) boundary. This is runtime-safe.
    const signer = new AwsKmsSigner(
      {
        region: getRequiredEnv("AWS_REGION"),
        accessKeyId: getRequiredEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: getRequiredEnv("AWS_SECRET_ACCESS_KEY"),
        kmsKeyId: getRequiredEnv("AWS_KMS_KEY_ID"),
      },
      provider as unknown as ConstructorParameters<typeof AwsKmsSigner>[1],
    );
    return signer as unknown as Signer;
  }

  const keyEnv = `${opts.network.toUpperCase()}_PRIVATE_KEY`;
  const privateKey = process.env[keyEnv]?.trim() || process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (privateKey === undefined || privateKey === "") {
    throw new Error(`Missing private key. Set ${keyEnv} or DEPLOYER_PRIVATE_KEY, or pass --kms.`);
  }

  return new Wallet(privateKey, provider);
}

function compileContracts(): void {
  const bin = `${REPO_ROOT}node_modules/.bin/hardhat`;
  if (!existsSync(bin)) {
    console.warn("Skipping compile: local hardhat binary not found.");
    return;
  }

  console.log("Compiling contracts (hardhat build)...");
  const result = spawnSync(bin, ["build"], { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("hardhat build failed");
  }
}

function buildGasOverrides(opts: Options): Record<string, bigint> {
  const overrides: Record<string, bigint> = {};

  if (opts.baseFee !== undefined && opts.baseFee !== "") {
    const baseFee = parseUnits(opts.baseFee, "gwei");
    const priorityFee = parseUnits(opts.priorityFee, "gwei");
    overrides.maxPriorityFeePerGas = priorityFee;
    overrides.maxFeePerGas = baseFee + priorityFee;
  }

  if (opts.gasLimit !== undefined) {
    overrides.gasLimit = opts.gasLimit;
  }

  return overrides;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.compile) {
    compileContracts();
  }

  const artifact = resolveArtifact(opts.contract);
  const initCode = getDeploymentBytecode(artifact, opts.constructorArgs, opts.libraries);
  const predicted = calculateCreate2Address(opts.factory, opts.salt, initCode);

  if (predicted.toLowerCase() !== opts.address.toLowerCase()) {
    throw new Error(`Expected address ${opts.address} but computed ${predicted}. Check bytecode, salt, and args.`);
  }

  const provider = new JsonRpcProvider(resolveRpcUrl(opts));
  const signer = buildSigner(opts, provider);
  const [signerAddress, chain] = await Promise.all([signer.getAddress(), provider.getNetwork()]);

  console.log(`Network: ${opts.network} (chainId ${chain.chainId})`);
  console.log(`Signer: ${signerAddress} (${opts.kms ? "AWS KMS" : "private key"})`);
  console.log(`Factory: ${opts.factory}`);
  console.log(`Contract: ${artifact.sourceName}:${artifact.contractName}`);
  console.log(`Init code hash: ${keccak256(initCode)}`);
  console.log(`Salt: ${toBeHex(opts.salt, 32)}`);
  console.log(`Expected address: ${opts.address}`);

  const existingCode = await provider.getCode(opts.address);
  if (existingCode !== "0x") {
    console.log(`\n${artifact.contractName} already deployed at ${opts.address}. Nothing to do.`);
    return;
  }

  const factory = new Contract(opts.factory, DEPLOYER_ABI, signer);
  const overrides = buildGasOverrides(opts);

  console.log("\nSimulating deployAt (staticCall)...");
  await factory.deployAt.staticCall(initCode, opts.salt, opts.address, { from: signerAddress });
  console.log("Simulation succeeded.");

  if (opts.dryRun) {
    console.log("\n--dry-run set: skipping broadcast.");
    return;
  }

  console.log("\nBroadcasting deployAt transaction...");
  const tx = await factory.deployAt(initCode, opts.salt, opts.address, overrides);
  const explorer = EXPLORER_TX_BY_NETWORK[opts.network];
  console.log(explorer ? `Waiting for tx: ${explorer}${tx.hash}` : `Waiting for tx: ${tx.hash}`);
  const receipt = await tx.wait(opts.confirmations);

  if ((await provider.getCode(opts.address)) === "0x") {
    throw new Error(`Deployment mined but no code found at ${opts.address}`);
  }

  console.log("\nDeployment complete");
  console.log(`${artifact.contractName}: ${opts.address}`);
  console.log(`Tx hash: ${receipt?.hash ?? tx.hash}`);
  console.log(`Block: ${receipt?.blockNumber}`);
  console.log(`Gas used: ${receipt?.gasUsed?.toString()}`);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
