import { expect } from 'chai';
import { network } from "hardhat";
import { setup } from './setup.js';

const { ethers, networkHelpers } = await network.connect();

describe('RwiVault', function () {

  async function setupFixture() {
    return setup(ethers);
  }

  it('only governor can initialize', async function () {
    const { contracts: {rwiVault, registry} } = await networkHelpers.loadFixture(setupFixture);

    await expect(rwiVault.initialize("RWA", "RWA", 0)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('vault operator can change asset cap', async function () {
    const { accounts: {vaultOperator}, contracts: {rwiVault} } = await networkHelpers.loadFixture(setupFixture);

    await rwiVault.connect(vaultOperator).setAssetCap(1000);

    expect(await rwiVault.assetCap()).to.equal(1000);
  });
});
