import { expect } from 'chai';
import { network } from 'hardhat';
import { setup } from './setup.js';
import { ContractIndexes } from '../utils/constants.js';

const { ethers, networkHelpers } = await network.connect();

describe('getters', function () {
  async function setupFixture() {
    return setup(ethers);
  }

  it('reverts for invalid index', async function () {
    const { contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const invalidIdx = 3n;

    await expect(registry.getContractAddressByIndex(invalidIdx)).to.be.revertedWithCustomError(registry, 'InvalidContractIndex');
    await expect(registry.isProxyContract(invalidIdx)).to.be.revertedWithCustomError(registry, 'InvalidContractIndex');
  });

  it('reverts for non-existent contracts', async function () {
    const { contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const idx = 2n ** 48n;

    await expect(registry.getContractAddressByIndex(idx)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
    await expect(registry.isProxyContract(idx)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('returns correct index for registered contracts', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    expect(await registry.getContractIndexByAddress(governor.address)).to.equal(ContractIndexes.C_GOVERNOR);
  });

  it('reverts for unregistered and zero addresses', async function () {
    const { accounts: { nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    await expect(registry.getContractIndexByAddress(nonMembers[0].address)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
    await expect(registry.getContractIndexByAddress(ethers.ZeroAddress)).to.be.revertedWithCustomError(registry, 'InvalidContractAddress');
  });

  it('returns empty array for empty input and full results for valid indexes', async function () {
    const { accounts: { governor, membershipOperator }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    const empty = await registry.getContracts([]);
    expect(empty.length).to.equal(0);

    const results = await registry.getContracts([ContractIndexes.C_GOVERNOR, ContractIndexes.A_MEMBERSHIP_OPERATOR]);
    expect(results.length).to.equal(2);
    expect(results[0].addr).to.equal(governor.address);
    expect(results[0].isProxy).to.equal(false);
    expect(results[1].addr).to.equal(membershipOperator.address);
    expect(results[1].isProxy).to.equal(false);
  });

  it('reverts if any index is invalid', async function () {
    const { contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    await expect(registry.getContracts([ContractIndexes.C_GOVERNOR, 3n, ContractIndexes.A_MEMBERSHIP_OPERATOR]))
      .to.be.revertedWithCustomError(registry, 'InvalidContractIndex');
  });
});
