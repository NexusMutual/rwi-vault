import { expect } from 'chai';
import { network } from 'hardhat';
import { setup } from './setup.js';

const { ethers, networkHelpers } = await network.connect();

describe('upgradeContract', function () {
  async function setupFixture() {
    return setup(ethers);
  }

  function numberToBytes32(value: bigint) {
    return ethers.zeroPadValue(ethers.toBeHex(value), 32);
  }

  it('reverts for non-governor and non-existent contracts', async function () {
    const { accounts: { governor, nonMembers }, contracts: { registry, mockImplementation } } = await networkHelpers.loadFixture(setupFixture);

    await expect(registry.connect(nonMembers[0]).upgradeContract(2n ** 32n, await mockImplementation.getAddress()))
      .to.be.revertedWithCustomError(registry, 'OnlyGovernor');

    await expect(registry.connect(governor).upgradeContract(2n ** 32n, await mockImplementation.getAddress()))
      .to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('reverts when target is not a proxy', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const impl = await ethers.deployContract('ERC20Mock', ['X', 'X', 18]);
    const nonProxy = await ethers.deployContract('ERC20Mock', ['Y', 'Y', 18]);
    const idx = 2n ** 40n;

    await registry.connect(governor).addContract(idx, await nonProxy.getAddress(), false);
    await expect(registry.connect(governor).upgradeContract(idx, await impl.getAddress()))
      .to.be.revertedWithCustomError(registry, 'ContractIsNotProxy');
  });

  it('upgrades proxy implementation and emits event', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    const idx = 2n ** 41n;
    const initialImpl = await ethers.deployContract('ERC20Mock', ['I1', 'I1', 18]);
    const newImpl = await ethers.deployContract('ERC20Mock', ['I2', 'I2', 18]);
    await registry.connect(governor).deployContract(idx, numberToBytes32(55n), await initialImpl.getAddress());

    const proxyAddress = await registry.getContractAddressByIndex(idx);
    const proxy = await ethers.getContractAt('UpgradeableProxy', proxyAddress);
    expect(await proxy.implementation()).to.equal(await initialImpl.getAddress());

    await expect(registry.connect(governor).upgradeContract(idx, await newImpl.getAddress()))
      .to.emit(registry, 'ContractUpgraded')
      .withArgs(idx, proxyAddress, await newImpl.getAddress())
      .to.emit(proxy, 'Upgraded')
      .withArgs(await newImpl.getAddress());

    expect(await proxy.implementation()).to.equal(await newImpl.getAddress());
    expect(await proxy.proxyOwner()).to.equal(await registry.getAddress());
  });
});
