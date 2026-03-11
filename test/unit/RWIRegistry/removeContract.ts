import { expect } from 'chai';
import { network } from 'hardhat';
import { setup } from './setup.js';
import { ContractIndexes } from '../utils/constants.js';

const { ethers, networkHelpers } = await network.connect();

describe('removeContract', function () {
  async function setupFixture() {
    return setup(ethers);
  }

  it('reverts when called by non-governor or for non-existent indexes', async function () {
    const { accounts: { governor, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    await expect(registry.connect(nonMembers[0]).removeContract(ContractIndexes.A_MEMBERSHIP_OPERATOR))
      .to.be.revertedWithCustomError(registry, 'OnlyGovernor');

    await expect(registry.connect(governor).removeContract(2n ** 42n))
      .to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('does not allow removing governor index', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    await expect(registry.connect(governor).removeContract(ContractIndexes.C_GOVERNOR))
      .to.be.revertedWithCustomError(registry, 'InvalidContractIndex');
  });

  it('removes non-proxy contracts and clears mappings', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const idx = 2n ** 43n;
    const nonProxy = await ethers.deployContract('ERC20Mock', ['R', 'R', 18]);
    const nonProxyAddress = await nonProxy.getAddress();

    await registry.connect(governor).addContract(idx, nonProxyAddress, false);
    await expect(registry.connect(governor).removeContract(idx))
      .to.emit(registry, 'ContractRemoved')
      .withArgs(idx, nonProxyAddress, false);

    await expect(registry.getContractAddressByIndex(idx)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
    await expect(registry.getContractIndexByAddress(nonProxyAddress)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('removes proxy contracts and leaves proxy state intact on-chain', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const idx = 2n ** 44n;
    const impl = await ethers.deployContract('ERC20Mock', ['P', 'P', 18]);

    await registry.connect(governor).deployContract(idx, ethers.zeroPadValue('0x1234', 32), await impl.getAddress());
    const proxyAddress = await registry.getContractAddressByIndex(idx);
    const proxy = await ethers.getContractAt('UpgradeableProxy', proxyAddress);
    const implementation = await proxy.implementation();

    await expect(registry.connect(governor).removeContract(idx))
      .to.emit(registry, 'ContractRemoved')
      .withArgs(idx, proxyAddress, true);

    expect(await proxy.proxyOwner()).to.equal(await registry.getAddress());
    expect(await proxy.implementation()).to.equal(implementation);
    await expect(registry.getContractAddressByIndex(idx)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });
});
