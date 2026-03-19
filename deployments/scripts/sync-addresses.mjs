import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const deploymentsPackageDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(deploymentsPackageDir, "..");
const ignitionDeploymentsDir = path.join(rootDir, "ignition", "deployments");
const outputFile = path.join(deploymentsPackageDir, "src", "addresses.json");

function mapDeploymentAddresses(rawAddresses) {
  return {
    RWIRegistry: rawAddresses["MainnetDeploymentModule#registryProxy"] ?? "",
    RWIVault: rawAddresses["MainnetDeploymentModule#vaultProxy"] ?? "",
    Locks: rawAddresses["MainnetDeploymentModule#locksProxy"] ?? "",
  };
}

async function readDeployedAddresses(deploymentId) {
  const deployedAddressesPath = path.join(ignitionDeploymentsDir, deploymentId, "deployed_addresses.json");
  const content = await readFile(deployedAddressesPath, "utf8");
  return JSON.parse(content);
}

async function main() {
  const deploymentIdArg = process.argv[2];
  const deploymentId = deploymentIdArg?.trim() || "mainnet-1";
  const rawAddresses = await readDeployedAddresses(deploymentId);

  const json = {
    mainnet: mapDeploymentAddresses(rawAddresses),
  };

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`Synced addresses to ${outputFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
