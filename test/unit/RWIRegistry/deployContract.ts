import { expect } from 'chai';
import { network } from 'hardhat';
import { setup } from './setup.js';
import { ContractIndexes } from '../utils/constants.js';

const { ethers, networkHelpers } = await network.connect();

describe('deployContract', function () {
  async function setupFixture() {
    return setup(ethers);
  }

  function numberToBytes32(value: bigint) {
    return ethers.zeroPadValue(ethers.toBeHex(value), 32);
  }

  it('validates index and governor-only access', async function () {
    const { accounts: { governor, nonMembers }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    const salt = numberToBytes32(0n);

    await expect(registry.connect(governor).deployContract((2n ** 32n) + 1n, salt, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(registry, 'InvalidContractIndex');

    await expect(registry.connect(nonMembers[0]).deployContract(2n ** 32n, salt, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(registry, 'OnlyGovernor');
  });

  it('reverts when contract already exists at index', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);
    await expect(registry.connect(governor).deployContract(ContractIndexes.C_GOVERNOR, numberToBytes32(1n), ethers.ZeroAddress))
      .to.be.revertedWithCustomError(registry, 'ContractAlreadyExists');
  });

  it('deploys and tracks proxy contract correctly', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    const idx = 2n ** 37n;
    const salt = numberToBytes32(1337n);
    const implementation = await ethers.deployContract('ERC20Mock', ['Impl', 'IMP', 18]);

    await expect(registry.connect(governor).deployContract(idx, salt, await implementation.getAddress()))
      .to.emit(registry, 'ContractDeployed');

    const proxyAddress = await registry.getContractAddressByIndex(idx);
    expect(await ethers.provider.getCode(proxyAddress)).to.not.equal('0x');
    expect(await registry.getContractIndexByAddress(proxyAddress)).to.equal(idx);
    expect(await registry.isProxyContract(idx)).to.equal(true);
  });

  it('sets proxy implementation for zero and non-zero implementations', async function () {
    const { accounts: { governor }, contracts: { registry } } = await networkHelpers.loadFixture(setupFixture);

    const idx1 = 2n ** 38n;
    await registry.connect(governor).deployContract(idx1, numberToBytes32(101n), ethers.ZeroAddress);
    const proxy1 = await ethers.getContractAt('UpgradeableProxy', await registry.getContractAddressByIndex(idx1));
    expect(await proxy1.implementation()).to.equal(ethers.ZeroAddress);
    expect(await proxy1.proxyOwner()).to.equal(await registry.getAddress());

    const idx2 = 2n ** 39n;
    const impl = await ethers.deployContract('ERC20Mock', ['Impl2', 'IMP2', 18]);
    await registry.connect(governor).deployContract(idx2, numberToBytes32(102n), await impl.getAddress());
    const proxy2 = await ethers.getContractAt('UpgradeableProxy', await registry.getContractAddressByIndex(idx2));
    expect(await proxy2.implementation()).to.equal(await impl.getAddress());
    expect(await proxy2.proxyOwner()).to.equal(await registry.getAddress());
  });
});
