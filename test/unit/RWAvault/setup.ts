import { getAccounts } from '../utils/accounts.js'
import { ContractIndexes } from "../utils/constants.js"
import { HardhatEthers } from '@nomicfoundation/hardhat-ethers/types';

const BASE_APY = 650; // 6.5%
const ASSET_DECIMALS = 6;
const ASSET_CAP = 10000000 * (10 ** ASSET_DECIMALS);

export async function setup(ethers: HardhatEthers) {
  const accounts = await getAccounts(ethers);

  const usdcMock = await ethers.deployContract('ERC20Mock', ["USDC Mock", "USDCMOCK", 8]);
  // mint usdcMock to members
  for (const member of accounts.members) {
    await usdcMock.connect(member).mint(member.address, ethers.parseUnits("100000", 8));
  }

  const registry = await ethers.deployContract('Registry', [accounts.governor.address]);
  await registry.connect(accounts.governor).addContract(ContractIndexes.A_VAULT_OPERATOR, accounts.vaultOperator, false);
  await registry.connect(accounts.governor).addContract(ContractIndexes.A_MEMBERSHIP_OPERATOR, accounts.membershipOperator, false);
  await registry.connect(accounts.governor).setEmergencyAdmin(accounts.emergencyAdmin, true);

  const rwiVault = await ethers.deployContract('RWIVault', [await registry.getAddress(), await usdcMock.getAddress(), ASSET_DECIMALS]);
  await registry.connect(accounts.governor).addContract(ContractIndexes.C_VAULT, await rwiVault.getAddress(), false);

  const locks = await ethers.deployContract('Locks', [await registry.getAddress(), await rwiVault.getAddress()]);
  await registry.connect(accounts.governor).addContract(ContractIndexes.C_LOCKS, await locks.getAddress(), false);

  // register members
  for (const member of accounts.members) {
    await registry.connect(accounts.membershipOperator).addMember(member.address);
  }

  await rwiVault.connect(accounts.governor).initialize("RWI VAULT", "RWI", BASE_APY);
  await rwiVault.connect(accounts.vaultOperator).setAssetCap(ASSET_CAP);

  return {
    accounts,
    contracts: {
      registry,
      rwiVault,
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
