import { expect } from 'chai';
import { network } from "hardhat";
import { setup } from './setup.js';

const { ethers, networkHelpers } = await network.connect();

describe('RWAVault', function () {

  async function setupFixture() {
    return setup(ethers);
  }

  it('only governor can initialize', async function () {
    const { contracts: {rwaVault, registry} } = await networkHelpers.loadFixture(setupFixture);

    await expect(rwaVault.initialize("RWA", "RWA", 0)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('vault operator can change asset cap', async function () {
    const { accounts: {vaultOperator}, contracts: {rwaVault} } = await networkHelpers.loadFixture(setupFixture);

    await rwaVault.connect(vaultOperator).setAssetCap(1000);

    expect(await rwaVault.assetCap()).to.equal(1000);
  });
});
