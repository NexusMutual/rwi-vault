import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const deploymentsPackageDir = __dirname;
const rootDir = path.resolve(deploymentsPackageDir, "..");

const contractNames = ["RWIRegistry", "RWIVault", "Locks"];
const deploymentAddressKeys = {
  RWIRegistry: "MainnetDeploymentModule#registryProxy",
  RWIVault: "MainnetDeploymentModule#vaultProxy",
  Locks: "MainnetDeploymentModule#locksProxy",
};

function getArtifactPath(contractName) {
  return path.join(rootDir, "artifacts", "contracts", `${contractName}.sol`, `${contractName}.json`);
}

function getTypePath(contractName) {
  return path.join(rootDir, "types", "ethers-contracts", `${contractName}.ts`);
}

function getMainnetDeploymentId() {
  return process.env.MAINNET_DEPLOYMENT_ID?.trim() || "1";
}

function getDeployedAddressesPath() {
  return path.join(
    rootDir,
    "ignition",
    "deployments",
    `mainnet-${getMainnetDeploymentId()}`,
    "deployed_addresses.json",
  );
}

async function updatePackageVersion() {
  const rootPackagePath = path.join(rootDir, "package.json");
  const deploymentsPackagePath = path.join(deploymentsPackageDir, "package.json");

  const rootPackageJson = JSON.parse(await readFile(rootPackagePath, "utf8"));
  const deploymentsPackageJson = JSON.parse(await readFile(deploymentsPackagePath, "utf8"));
  deploymentsPackageJson.version = rootPackageJson.version;

  await writeFile(deploymentsPackagePath, `${JSON.stringify(deploymentsPackageJson, null, 2)}\n`);
}

async function generateAbis() {
  const generatedAbisDir = path.join(deploymentsPackageDir, "generated", "abis");
  await mkdir(generatedAbisDir, { recursive: true });

  for (const contractName of contractNames) {
    const artifact = JSON.parse(await readFile(getArtifactPath(contractName), "utf8"));
    await writeFile(path.join(generatedAbisDir, `${contractName}.json`), `${JSON.stringify(artifact.abi, null, 2)}\n`);
  }
}

async function generateAbisTs() {
  const generatedDir = path.join(deploymentsPackageDir, "generated");
  const lines = [];

  for (const contractName of contractNames) {
    const abiPath = path.join(generatedDir, "abis", `${contractName}.json`);
    const abi = (await readFile(abiPath, "utf8")).trim();
    lines.push(`export const ${contractName} = ${abi} as const;`);
  }

  lines.push("");
  lines.push("export const abis = {");
  for (const contractName of contractNames) {
    lines.push(`  ${contractName},`);
  }
  lines.push("} as const;");

  await writeFile(path.join(generatedDir, "abis.ts"), `${lines.join("\n")}\n`);
}

async function generateTypes() {
  const generatedTypesDir = path.join(deploymentsPackageDir, "generated", "types");
  await mkdir(generatedTypesDir, { recursive: true });

  for (const contractName of contractNames) {
    await cp(getTypePath(contractName), path.join(generatedTypesDir, `${contractName}.ts`));
  }
}

async function copyDistTypes() {
  const distDir = path.join(deploymentsPackageDir, "dist");
  const distTypesDir = path.join(distDir, "types");
  await mkdir(distTypesDir, { recursive: true });

  const commonSource = path.join(rootDir, "types", "ethers-contracts", "common.ts");
  const commonContent = await readFile(commonSource, "utf8");
  await writeFile(path.join(distDir, "common.d.ts"), commonContent);

  for (const contractName of contractNames) {
    const typeContent = await readFile(path.join(deploymentsPackageDir, "generated", "types", `${contractName}.ts`), "utf8");
    await writeFile(path.join(distTypesDir, `${contractName}.d.ts`), typeContent);
  }
}

async function generateDistEntrypoints() {
  const distDir = path.join(deploymentsPackageDir, "dist");
  await mkdir(distDir, { recursive: true });

  await writeFile(
    path.join(distDir, "index.js"),
    "module.exports = { addresses: require('./data/addresses.json'), abis: require('./data/abis/index.json') };",
  );
  await writeFile(
    path.join(distDir, "index.mjs"),
    "export { default as addresses } from './data/addresses.json' with { type: 'json' };\nexport { default as abis } from './data/abis/index.json' with { type: 'json' };\n",
  );
  await writeFile(
    path.join(distDir, "index.d.ts"),
    "export declare const addresses: Record<string, string>;\nexport declare const abis: Record<string, readonly unknown[]>;\n",
  );
}

async function copyDistData() {
  const distDataDir = path.join(deploymentsPackageDir, "dist", "data");
  const distAbisDir = path.join(distDataDir, "abis");
  await mkdir(distDataDir, { recursive: true });
  await mkdir(distAbisDir, { recursive: true });

  const deployedAddresses = JSON.parse(await readFile(getDeployedAddressesPath(), "utf8"));
  const addresses = Object.fromEntries(
    contractNames.map((contractName) => [contractName, deployedAddresses[deploymentAddressKeys[contractName]] ?? ""]),
  );
  await writeFile(path.join(distDataDir, "addresses.json"), `${JSON.stringify(addresses, null, 2)}\n`);

  const abis = {};
  for (const contractName of contractNames) {
    const abi = JSON.parse(await readFile(path.join(deploymentsPackageDir, "generated", "abis", `${contractName}.json`), "utf8"));
    abis[contractName] = abi;
    await writeFile(path.join(distAbisDir, `${contractName}.json`), `${JSON.stringify(abi, null, 2)}\n`);
  }
  await writeFile(path.join(distAbisDir, "index.json"), `${JSON.stringify(abis, null, 2)}\n`);
}

async function main() {
  await rm(path.join(deploymentsPackageDir, "dist"), { recursive: true, force: true });
  await rm(path.join(deploymentsPackageDir, "generated"), { recursive: true, force: true });

  await updatePackageVersion();
  await generateAbis();
  await generateAbisTs();
  await generateTypes();
  await copyDistData();
  await generateDistEntrypoints();
  await copyDistTypes();

  console.log("Deployments package build complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
