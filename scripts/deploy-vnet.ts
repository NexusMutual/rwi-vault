import { network } from "hardhat";
import { ContractIndexes } from "../test/unit/utils/constants.js";

const BASE_APY = 650; // 6.5%
const ASSET_DECIMALS = 6;
const ASSET_CAP = 10000000 * (10 ** ASSET_DECIMALS);

// Helper function to pause for 1 second
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const { ethers } = await network.connect();
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  // const governorAddress = "0x8E68137756572D30760e47d7bBf5E3f4ECd6Fcf6";
  const governorAddress = deployer.address;
  const vaultOperatorAddress = deployer.address;
  const membershipOperatorAddress = deployer.address;
  const emergencyAdminAddress = deployer.address;

  console.log("\n=== Configuration ===");
  console.log("USDC Address:", usdcAddress);
  console.log("Governor Address:", governorAddress);
  console.log("Vault Operator Address:", vaultOperatorAddress);
  console.log("Membership Operator Address:", membershipOperatorAddress);
  console.log("Emergency Admin Address:", emergencyAdminAddress);
  console.log("Base APY:", BASE_APY, "(7%)");
  console.log("Asset Cap:", ASSET_CAP);

  const governorSigner = deployer;
  const vaultOperatorSigner = deployer;

  // Deploy Registry
  const registry = await ethers.deployContract("Registry", [governorAddress]);
  await registry.waitForDeployment();
  await sleep(1000);
  console.log("Registry deployed to:", await registry.getAddress());

  const tx1 = await registry.connect(governorSigner)
    .addContract(ContractIndexes.A_VAULT_OPERATOR, deployer.address, false);
  await tx1.wait();
  await sleep(1000);

  const tx2 = await registry.connect(governorSigner)
    .addContract(ContractIndexes.A_MEMBERSHIP_OPERATOR, membershipOperatorAddress, false);
  await tx2.wait();
  await sleep(1000);

  const tx3 = await registry.connect(governorSigner)
    .setEmergencyAdmin(emergencyAdminAddress, true);
  await tx3.wait();
  await sleep(1000);

  // Deploy RwiVault
  console.log("\n=== Deploying RwiVault ===");
  const rwiVault = await ethers.deployContract("RWIVault", [
    await registry.getAddress(),
    usdcAddress,
    ASSET_DECIMALS
  ]);
  await rwiVault.waitForDeployment();
  await sleep(1000);
  console.log("RwiVault deployed to:", await rwiVault.getAddress());

  const tx4 = await registry.connect(governorSigner)
    .addContract(ContractIndexes.C_VAULT, await rwiVault.getAddress(), false);
  await tx4.wait();
  await sleep(1000);

  // Deploy Locks
  const locks = await ethers.deployContract("Locks", [
    await registry.getAddress(),
    await rwiVault.getAddress()
  ]);
  await locks.waitForDeployment();
  await sleep(1000);
  console.log("Locks deployed to:", await locks.getAddress());

  const tx5 = await registry.connect(governorSigner)
    .addContract(ContractIndexes.C_LOCKS, await locks.getAddress(), false);
  await tx5.wait();
  await sleep(1000);

  // Initialize RwiVault
  const tx6 = await rwiVault.connect(governorSigner)
    .initialize("RWI VAULT", "RWIV", BASE_APY);
  await tx6.wait();
  await sleep(1000);

  // Set asset cap
  const tx7 = await rwiVault.connect(vaultOperatorSigner)
    .setAssetCap(ASSET_CAP);
  await tx7.wait();
  await sleep(1000);

  console.log("\n=== Deployment Summary ===");
  console.log("Registry:", await registry.getAddress());
  console.log("RwiVault:", await rwiVault.getAddress());
  console.log("Locks:", await locks.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
