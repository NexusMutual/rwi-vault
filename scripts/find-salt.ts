import { artifacts } from "hardhat";

import { DEFAULT_CREATE2_PREFIX, findSalt, getArtifactInitCodeHash } from "./create2-utils.js";

type CliArgs = {
  factory: string;
  contract: string;
  constructorArgs: unknown[];
  targetPrefix: string;
  workers?: number;
  startNonce?: bigint;
  endNonce?: bigint;
};

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

  const workersValue = args.get("workers");
  const startNonceValue = args.get("start-nonce");
  const endNonceValue = args.get("end-nonce");
  const constructorArgsValue = args.get("constructor-args");

  return {
    factory: getRequiredArg(args, "factory"),
    contract: getRequiredArg(args, "contract"),
    constructorArgs: constructorArgsValue === undefined
      ? []
      : constructorArgsValue.trim().match(/^\[/)
        ? JSON.parse(constructorArgsValue)
        : [constructorArgsValue],
    targetPrefix: (args.get("prefix") ?? DEFAULT_CREATE2_PREFIX).trim().toLowerCase(),
    workers: workersValue === undefined ? undefined : Number(workersValue),
    startNonce: startNonceValue === undefined ? undefined : BigInt(startNonceValue),
    endNonce: endNonceValue === undefined ? undefined : BigInt(endNonceValue),
  };
}

function normalizeConstructorArg(type: string, value: unknown): unknown {
  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) {
      throw new Error(`Expected array value for constructor argument type ${type}`);
    }

    const itemType = type.slice(0, -2);
    return value.map((item) => normalizeConstructorArg(itemType, item));
  }

  if ((type.startsWith("uint") || type.startsWith("int")) && (typeof value === "string" || typeof value === "number")) {
    return BigInt(value);
  }

  if (type === "bool" && typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }

  return value;
}

async function resolveConstructorArgs(contract: string, constructorArgs: unknown[]): Promise<unknown[]> {
  const artifact = await artifacts.readArtifact(contract);
  const constructorAbi = artifact.abi.find((entry) => entry.type === "constructor");
  const inputs = constructorAbi?.inputs ?? [];

  if (inputs.length !== constructorArgs.length) {
    throw new Error(
      `Constructor argument count mismatch for ${contract}: expected ${inputs.length}, got ${constructorArgs.length}`,
    );
  }

  return constructorArgs.map((value, index) => normalizeConstructorArg(inputs[index].type, value));
}

async function main() {
  const {
    factory,
    contract,
    constructorArgs,
    targetPrefix,
    workers,
    startNonce,
    endNonce,
  } = parseArgs(process.argv.slice(2));
  const resolvedConstructorArgs = await resolveConstructorArgs(contract, constructorArgs);
  const initCodeHash = await getArtifactInitCodeHash(contract, resolvedConstructorArgs);

  console.log(`Searching salts for factory ${factory}`);
  if (resolvedConstructorArgs.length > 0) {
    console.log(`Constructor args: ${JSON.stringify(constructorArgs)}`);
  }
  console.log(`Target prefix: ${targetPrefix}`);
  console.log(`Contract: ${contract}`);
  if (startNonce !== undefined || endNonce !== undefined) {
    console.log(`Nonce range: ${startNonce ?? 0n}..${endNonce ?? "unbounded"}`);
  }

  console.log(`\nSearching salt for ${contract}...`);
  const result = await findSalt({
    registryAddress: factory,
    initCodeHash,
    contract,
    targetPrefix,
    workers,
    startNonce,
    endNonce,
  });

  console.log(`Found ${contract}: ${result.address} with salt ${result.salt}`);
  console.log("\nSalt search result:");
  console.log(JSON.stringify(result, null, 2));

  const envName = `${contract.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}_SALT`;

  console.log(`${envName}=${result.salt}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
