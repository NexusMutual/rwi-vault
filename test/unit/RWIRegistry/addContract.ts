import { expect } from 'chai';
import { network } from 'hardhat';
import { setup } from './setup.js';
import { ContractIndexes } from '../utils/constants.js';

const { ethers, networkHelpers } = await network.connect();

describe('addContract', function () {
  async function setupFixture() {
    return setup(ethers);
  }

  it('reverts when called by non-governor', async function () {
    const { accounts: { nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    await expect(registry.connect(nonMembers[0]).addContract(2n ** 32n, ethers.ZeroAddress, false))
      .to.be.revertedWithCustomError(registry, 'OnlyGovernor');
  });

  it('validates index and contract address', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    await expect(registry.connect(governor).addContract((2n ** 32n) + 1n, governor.address, false))
      .to.be.revertedWithCustomError(registry, 'InvalidContractIndex');

    await expect(registry.connect(governor).addContract(2n ** 32n, ethers.ZeroAddress, false))
      .to.be.revertedWithCustomError(registry, 'InvalidContractAddress');
  });

  it('reverts when contract already exists at index', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    const another = await ethers.deployContract('ERC20Mock', ['A', 'A', 18]);
    await expect(registry.connect(governor).addContract(ContractIndexes.C_GOVERNOR, await another.getAddress(), false))
      .to.be.revertedWithCustomError(registry, 'ContractAlreadyExists');
  });

  it('reverts when proxy owner is not registry', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    const proxy = await ethers.deployContract('UpgradeableProxy', [governor.address, governor.address]);
    await expect(registry.connect(governor).addContract(2n ** 33n, await proxy.getAddress(), true))
      .to.be.revertedWithCustomError(registry, 'NotProxyOwner');
  });

  it('adds non-proxy contracts', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    const mock = await ethers.deployContract('ERC20Mock', ['B', 'B', 18]);
    const idx = 2n ** 35n;
    const addr = await mock.getAddress();

    await registry.connect(governor).addContract(idx, addr, false);

    expect(await registry.getContractAddressByIndex(idx)).to.equal(addr);
    expect(await registry.getContractIndexByAddress(addr)).to.equal(idx);
    expect(await registry.isProxyContract(idx)).to.equal(false);
  });

  it('adds proxy contracts owned by registry', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    const idx = 2n ** 36n;
    const impl = await ethers.deployContract('ERC20Mock', ['C', 'C', 18]);
    await registry.connect(governor).deployContract(idx, ethers.zeroPadValue('0x01', 32), await impl.getAddress());
    const proxyAddr = await registry.getContractAddressByIndex(idx);

    expect(await registry.isProxyContract(idx)).to.equal(true);
    expect(await registry.getContractIndexByAddress(proxyAddr)).to.equal(idx);
  });
});
