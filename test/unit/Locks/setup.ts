import { getAccounts } from '../utils/accounts.js'
import { ContractIndexes } from "../utils/constants.js"
import { HardhatEthers } from '@nomicfoundation/hardhat-ethers/types';

export async function setup(ethers: HardhatEthers) {
  const accounts = await getAccounts(ethers);

  const rwaSharesMock = await ethers.deployContract('ERC20Mock', ["RWA Shares Mock", "RWA", 8]);
  // mint shares to members
  for (const member of accounts.members) {
    await rwaSharesMock.connect(member).mint(member.address, ethers.parseUnits("100000", 8));
  }

  const registry = await ethers.deployContract('RWIRegistry', [accounts.governor.address]);
  await registry.connect(accounts.governor).addContract(ContractIndexes.A_VAULT_OPERATOR, accounts.vaultOperator, false);
  await registry.connect(accounts.governor).addContract(ContractIndexes.A_MEMBERSHIP_OPERATOR, accounts.membershipOperator, false);
  await registry.connect(accounts.governor).setEmergencyAdmin(accounts.emergencyAdmin, true);
  await registry.connect(accounts.governor).addContract(ContractIndexes.C_VAULT, await rwaSharesMock.getAddress(), false);

  const locks = await ethers.deployContract('Locks', [await registry.getAddress(), await rwaSharesMock.getAddress()]);
  await registry.connect(accounts.governor).addContract(ContractIndexes.C_LOCKS, await locks.getAddress(), false);

  // register members
  for (const member of accounts.members) {
    await registry.connect(accounts.membershipOperator).addMember(member.address);
  }

  return {
    accounts,
    contracts: {
      registry,
      rwaSharesMock,
      locks
    },
  }
}
