import { HardhatEthers } from '@nomicfoundation/hardhat-ethers/types';
import { getAccounts } from '../utils/accounts.js';
import { ContractIndexes } from '../utils/constants.js';

export async function setup(ethers: HardhatEthers) {
  const accounts = await getAccounts(ethers);

  const registry = await ethers.deployContract('RWIRegistry');
  await registry.getFunction('initialize')(accounts.governor.address);
  await registry.connect(accounts.governor).addContract(ContractIndexes.A_MEMBERSHIP_OPERATOR, accounts.membershipOperator.address, false);
  await registry.connect(accounts.governor).addContract(ContractIndexes.A_VAULT_OPERATOR, accounts.vaultOperator.address, false);
  await registry.connect(accounts.governor).setEmergencyAdmin(accounts.emergencyAdmin.address, true);

  const mockImplementation = await ethers.deployContract('ERC20Mock', ['Mock Token', 'MOCK', 18]);

  return {
    accounts,
    contracts: {
      registry,
      mockImplementation,
    },
  };
}
