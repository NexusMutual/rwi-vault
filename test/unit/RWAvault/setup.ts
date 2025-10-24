import { getAccounts } from '../utils/accounts.js'
import { ContractIndexes } from "../utils/constants.js"
import { HardhatEthers } from '@nomicfoundation/hardhat-ethers/types';

const BASE_APY = 700; // 7%
const ASSET_DECIMALS = 8;
const ASSET_CAP = 10000000 * (10 ** ASSET_DECIMALS);

export async function setup(ethers: HardhatEthers) {
  const accounts = await getAccounts(ethers);

  const usdcMock = await ethers.deployContract('ERC20Mock', ["USDC Mock", "USDCMOCK", 8]);
  // mint usdcMock to members
  for (const member of accounts.members) {
    await usdcMock.connect(member).mint(member.address, ethers.parseUnits("100000", 8));
  }

  const registry = await ethers.deployContract('Registry', [accounts.governor.address]);
  await registry.connect(accounts.governor).addContract(ContractIndexes.A_VAULT_MANAGER, accounts.vaultManager, false);
  await registry.connect(accounts.governor).addContract(ContractIndexes.A_MEMBERSHIP_MANAGER, accounts.membershipManager, false);
  await registry.connect(accounts.governor).setEmergencyAdmin(accounts.emergencyAdmin, true);

  const rwaVault = await ethers.deployContract('RWAVault', [await registry.getAddress(), await usdcMock.getAddress(), ASSET_DECIMALS]);
  await registry.connect(accounts.governor).addContract(ContractIndexes.C_VAULT, await rwaVault.getAddress(), false);

  const locks = await ethers.deployContract('Locks', [await registry.getAddress(), await rwaVault.getAddress()]);
  await registry.connect(accounts.governor).addContract(ContractIndexes.C_LOCKS, await locks.getAddress(), false);

  // register members
  for (const member of accounts.members) {
    await registry.connect(accounts.membershipManager).addMember(member.address);
  }

  await rwaVault.connect(accounts.governor).initialize("RWA VAULT", "RWA", BASE_APY);
  await rwaVault.connect(accounts.vaultManager).setAssetCap(ASSET_CAP);

  return {
    accounts,
    contracts: {
      registry,
      rwaVault,
      locks,
      usdcMock
    },
    constants: {
      BASE_APY,
      ASSET_CAP,
      ASSET_DECIMALS
    }
  }
}
