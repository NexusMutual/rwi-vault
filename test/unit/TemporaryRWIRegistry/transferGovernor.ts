import { expect } from 'chai';
import { network } from 'hardhat';
import { getAccounts } from '../utils/accounts.js';
import { ContractIndexes } from '../utils/constants.js';

const { ethers, networkHelpers } = await network.connect();

// TemporaryRWIRegistry is the bootstrap implementation used by the mainnet
// deployment, and transferGovernor is called during that run.
describe('TemporaryRWIRegistry.transferGovernor', function () {
  async function setupFixture() {
    const accounts = await getAccounts(ethers);
    const registry = await ethers.deployContract('TemporaryRWIRegistry');
    await registry.getFunction('initialize')(accounts.governor.address);
    return { accounts, registry };
  }

  it('moves the governor and updates both index mappings', async function () {
    const { accounts: { governor, nonMembers }, registry } = await networkHelpers.loadFixture(setupFixture);
    const newGovernor = nonMembers[0];

    expect(await registry.getContractAddressByIndex(ContractIndexes.C_GOVERNOR)).to.equal(governor.address);
    expect(await registry.getContractIndexByAddress(governor.address)).to.equal(ContractIndexes.C_GOVERNOR);

    await registry.connect(governor).transferGovernor(newGovernor.address);

    expect(await registry.getContractAddressByIndex(ContractIndexes.C_GOVERNOR)).to.equal(newGovernor.address);
    expect(await registry.getContractIndexByAddress(newGovernor.address)).to.equal(ContractIndexes.C_GOVERNOR);
  });

  it('clears the previous governor from the address index', async function () {
    const { accounts: { governor, nonMembers }, registry } = await networkHelpers.loadFixture(setupFixture);

    await registry.connect(governor).transferGovernor(nonMembers[0].address);

    // the old governor no longer resolves to an index
    await expect(registry.getContractIndexByAddress(governor.address))
      .to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('hands authority to the new governor', async function () {
    const { accounts: { governor, nonMembers }, registry } = await networkHelpers.loadFixture(setupFixture);
    const newGovernor = nonMembers[0];

    await registry.connect(governor).transferGovernor(newGovernor.address);

    // the previous governor loses access
    await expect(registry.connect(governor).transferGovernor(governor.address))
      .to.be.revertedWithCustomError(registry, 'OnlyGovernor');

    // and the new one has it
    await registry.connect(newGovernor).transferGovernor(nonMembers[1].address);
    expect(await registry.getContractAddressByIndex(ContractIndexes.C_GOVERNOR)).to.equal(nonMembers[1].address);
  });

  it('reverts for the zero address', async function () {
    const { accounts: { governor }, registry } = await networkHelpers.loadFixture(setupFixture);

    await expect(registry.connect(governor).transferGovernor(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(registry, 'InvalidAddress');
  });

  it('reverts for a caller that is not the governor', async function () {
    const { accounts: { nonMembers }, registry } = await networkHelpers.loadFixture(setupFixture);

    await expect(registry.connect(nonMembers[0]).transferGovernor(nonMembers[0].address))
      .to.be.revertedWithCustomError(registry, 'OnlyGovernor');
  });
});
