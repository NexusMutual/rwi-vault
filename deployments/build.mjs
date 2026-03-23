import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";

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

async function generateAddressesSource() {
  const generatedDir = path.join(deploymentsPackageDir, "generated");
  const deployedAddresses = JSON.parse(await readFile(getDeployedAddressesPath(), "utf8"));
  const mappedAddresses = Object.fromEntries(
    contractNames.map((contractName) => [contractName, deployedAddresses[deploymentAddressKeys[contractName]] ?? ""]),
  );
  await mkdir(generatedDir, { recursive: true });
  await writeFile(path.join(generatedDir, "addresses.json"), `${JSON.stringify(mappedAddresses, null, 2)}\n`);
}

async function buildSource() {
  await build({
    entry: [path.join(deploymentsPackageDir, "src", "index.ts")],
    outDir: path.join(deploymentsPackageDir, "dist"),
    tsconfig: path.join(deploymentsPackageDir, "tsconfig.json"),
    format: ["cjs", "esm"],
    outExtension: ({ format }) => ({ js: format === "cjs" ? ".js" : ".mjs" }),
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
  });
}

async function copyDistData() {
  const distDataDir = path.join(deploymentsPackageDir, "dist", "data");
  const distAbisDir = path.join(distDataDir, "abis");
  await mkdir(distAbisDir, { recursive: true });
  await cp(path.join(deploymentsPackageDir, "generated", "addresses.json"), path.join(distDataDir, "addresses.json"));

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
  await generateAddressesSource();
  await buildSource();
  await copyDistData();

  console.log("Deployments package build complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
