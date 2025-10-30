import { expect } from "chai";
import { network } from "hardhat";
import { setup } from './setup.js';
import { parseUsdc } from '../utils/utils.js';

const { ethers, networkHelpers } = await network.connect();

describe('rewards', function () {

  async function setupFixture() {
    return setup(ethers);
  }

  it('only vault operator can add rewards', async function () {
    const { contracts: {locks, registry} } = await networkHelpers.loadFixture(setupFixture);
    await expect(locks.addReward([], [], ethers.ZeroAddress, 0n, 0n)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('vault operator should be able to add rewards', async function () {
    const { accounts: {members, vaultOperator}, contracts: {locks, registry, rwaSharesMock} } = await networkHelpers.loadFixture(setupFixture);
    const startBalance = await rwaSharesMock.balanceOf(members[0].address);
    const memberIds = [
      await registry.getMemberId(members[0].address),
      await registry.getMemberId(members[1].address),
      await registry.getMemberId(members[2].address),
    ];

    const assetAmounts = [
      parseUsdc("1000"),
      parseUsdc("2000"),
      parseUsdc("3000"),
    ];
    const totalAssetAmounts = assetAmounts.reduce((acc, curr) => acc + curr, 0n);
    const snapshotTimestamp = await networkHelpers.time.latest();

    await rwaSharesMock.mint(await locks.getAddress(), totalAssetAmounts);
    await locks.connect(vaultOperator).addReward(memberIds, assetAmounts, await rwaSharesMock.getAddress(), totalAssetAmounts, snapshotTimestamp);

    expect(await rwaSharesMock.balanceOf(await locks.getAddress())).to.equal(0n);
    expect(await rwaSharesMock.balanceOf(members[0].address)).to.equal(startBalance + assetAmounts[0]);
    expect(await rwaSharesMock.balanceOf(members[1].address)).to.equal(startBalance + assetAmounts[1]);
    expect(await rwaSharesMock.balanceOf(members[2].address)).to.equal(startBalance + assetAmounts[2]);
  });

  it('total rewards should be equal to total asset amounts', async function () {
    const { accounts: {vaultOperator}, contracts: {locks, rwaSharesMock} } = await networkHelpers.loadFixture(setupFixture);
    const memberIds = [1, 2, 3];
    const assetAmounts = [
      parseUsdc("1000"),
      parseUsdc("2000"),
      parseUsdc("3000"),
    ];

    await rwaSharesMock.mint(await locks.getAddress(),  parseUsdc("10000"));
    await expect(locks.connect(vaultOperator).addReward(memberIds, assetAmounts, await rwaSharesMock.getAddress(), parseUsdc("5000"), 0))
            .to.be.revertedWithCustomError(locks, 'TotalAmountMustBeEqual');
  });

});
