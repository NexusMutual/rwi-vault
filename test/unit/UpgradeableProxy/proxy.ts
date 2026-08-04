import { expect } from 'chai';
import { network } from 'hardhat';
import { setup } from '../RWIRegistry/setup.js';
import { ContractIndexes } from '../utils/constants.js';

const { ethers, networkHelpers } = await network.connect();

describe('UpgradeableProxy', function () {
  async function setupFixture() {
    return setup(ethers);
  }

  function numberToBytes32(value: bigint) {
    return ethers.zeroPadValue(ethers.toBeHex(value), 32);
  }

  async function deployProxy(registry: any, governor: any, index: bigint, implementation: string) {
    await registry.connect(governor).deployContract(index, numberToBytes32(index), implementation);
    return ethers.getContractAt('UpgradeableProxy', await registry.getContractAddressByIndex(index));
  }

  describe('delegation', function () {
    it('forwards calls to the implementation and returns its data', async function () {
      const { accounts: { governor }, contracts: { registry, mockImplementation } } =
        await networkHelpers.loadFixture(setupFixture);

      const idx = 2n ** 20n;
      const proxy = await deployProxy(registry, governor, idx, await mockImplementation.getAddress());

      // call through the fallback, using the implementation's ABI
      const proxied = await ethers.getContractAt('ERC20Mock', await proxy.getAddress());

      // constructor state lives in the implementation's storage, so the proxy
      // starts empty even though the implementation was built with 18 decimals
      expect(await proxied.decimals()).to.equal(0);

      // a write through the delegatecall lands in the proxy's own storage
      await proxied.connect(governor).mint(governor.address, 1000n);
      expect(await proxied.balanceOf(governor.address)).to.equal(1000n);
      expect(await proxied.totalSupply()).to.equal(1000n);

      // and leaves the implementation untouched
      expect(await mockImplementation.balanceOf(governor.address)).to.equal(0n);
    });

    it('bubbles up a revert from the implementation', async function () {
      const { accounts: { governor, nonMembers }, contracts: { registry, mockImplementation } } =
        await networkHelpers.loadFixture(setupFixture);

      const idx = 2n ** 21n;
      const proxy = await deployProxy(registry, governor, idx, await mockImplementation.getAddress());
      const proxied = await ethers.getContractAt('ERC20Mock', await proxy.getAddress());

      // transferring more than the (zero) balance must revert through the delegatecall
      await expect(proxied.connect(nonMembers[0]).transfer(nonMembers[1].address, 1n)).to.be.revert(ethers);
    });

    it('reverts when no implementation is set', async function () {
      const { accounts: { governor, nonMembers }, contracts: { registry } } =
        await networkHelpers.loadFixture(setupFixture);

      const idx = 2n ** 22n;
      const proxy = await deployProxy(registry, governor, idx, ethers.ZeroAddress);
      expect(await proxy.implementation()).to.equal(ethers.ZeroAddress);

      await expect(nonMembers[0].sendTransaction({ to: await proxy.getAddress(), data: '0x12345678' }))
        .to.be.revert(ethers);
    });

    it('routes plain ether transfers through receive', async function () {
      const { accounts: { governor, nonMembers }, contracts: { registry, mockImplementation } } =
        await networkHelpers.loadFixture(setupFixture);

      const idx = 2n ** 23n;
      const proxy = await deployProxy(registry, governor, idx, await mockImplementation.getAddress());

      // ERC20Mock has no receive/fallback, so the delegatecall reverts —
      // reaching receive() and _delegate() is the point.
      await expect(nonMembers[0].sendTransaction({ to: await proxy.getAddress(), value: 1n }))
        .to.be.revert(ethers);
    });
  });

  describe('transferProxyOwnership', function () {
    it('moves ownership and emits ProxyOwnershipTransferred', async function () {
      const { accounts: { governor }, contracts: { registry, mockImplementation } } =
        await networkHelpers.loadFixture(setupFixture);

      const idx = 2n ** 24n;
      const proxy = await deployProxy(registry, governor, idx, await mockImplementation.getAddress());
      const registryAddress = await registry.getAddress();

      expect(await proxy.proxyOwner()).to.equal(registryAddress);

      // only the registry owns the proxy, so impersonate it to exercise the happy path
      const asRegistry = await ethers.getImpersonatedSigner(registryAddress);
      await networkHelpers.setBalance(registryAddress, ethers.parseEther('1'));

      await expect(proxy.connect(asRegistry).transferProxyOwnership(governor.address))
        .to.emit(proxy, 'ProxyOwnershipTransferred')
        .withArgs(registryAddress, governor.address);

      expect(await proxy.proxyOwner()).to.equal(governor.address);
    });

    it('reverts for a caller that is not the proxy owner', async function () {
      const { accounts: { governor, nonMembers }, contracts: { registry, mockImplementation } } =
        await networkHelpers.loadFixture(setupFixture);

      const idx = 2n ** 25n;
      const proxy = await deployProxy(registry, governor, idx, await mockImplementation.getAddress());

      await expect(proxy.connect(nonMembers[0]).transferProxyOwnership(nonMembers[0].address)).to.be.revert(ethers);
    });
  });

  describe('upgradeTo', function () {
    it('reverts for a caller that is not the proxy owner', async function () {
      const { accounts: { governor, nonMembers }, contracts: { registry, mockImplementation } } =
        await networkHelpers.loadFixture(setupFixture);

      const idx = 2n ** 26n;
      const proxy = await deployProxy(registry, governor, idx, await mockImplementation.getAddress());

      await expect(proxy.connect(nonMembers[0]).upgradeTo(nonMembers[0].address)).to.be.revert(ethers);
    });
  });

  it('is registered against the deploying registry', async function () {
    const { accounts: { governor }, contracts: { registry, mockImplementation } } =
      await networkHelpers.loadFixture(setupFixture);

    const idx = ContractIndexes.C_VAULT;
    const proxy = await deployProxy(registry, governor, idx, await mockImplementation.getAddress());

    expect(await proxy.proxyOwner()).to.equal(await registry.getAddress());
    expect(await proxy.implementation()).to.equal(await mockImplementation.getAddress());
  });
});
