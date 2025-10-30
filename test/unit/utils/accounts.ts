import { HardhatEthers } from '@nomicfoundation/hardhat-ethers/types';

const assignRoles = (accounts : any) => ({
  defaultSender: accounts[0],
  nonMembers: accounts.slice(1, 5),
  members: accounts.slice(5, 10),
  governor: accounts[10],
  vaultOperator: accounts[11],
  membershipOperator: accounts[12],
  emergencyAdmin: accounts[13],
});

export const getAccounts = async (ethers:HardhatEthers) => {
  const accounts = await ethers.getSigners();
  return assignRoles(accounts);
};