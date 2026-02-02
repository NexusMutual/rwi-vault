import { expect } from 'chai';
import { network } from "hardhat";
import { setup } from './setup.js';
import { parseUsdc } from '../utils/utils.js';

const { ethers, networkHelpers } = await network.connect();
const { duration } = networkHelpers.time;

describe('shareAssetConversion', function () {

  const wad = 1000000000000000000n;

  async function setupFixture() {
    return setup(ethers);
  }

  it('share to assets conversion after 1 year must be at base apy rate', async function () {
    const { contracts: {rwiVault}, constants: {ASSET_DECIMALS} } = await networkHelpers.loadFixture(setupFixture);
    
    const ASSET_UNIT = 10n ** BigInt(ASSET_DECIMALS);

    // conversion rounding error of 1 is acceptable because of rounding donw
    // making sure rounding errors are always in favor of the vault

    expect(await rwiVault.convertToAssets(ASSET_UNIT)).to.closeTo(ASSET_UNIT, 1n);
    expect(await rwiVault.convertToAssets(ASSET_UNIT)).to.lessThanOrEqual(ASSET_UNIT);
    
    expect(await rwiVault.convertToShares(ASSET_UNIT)).to.closeTo(ASSET_UNIT, 1n);
    expect(await rwiVault.convertToShares(ASSET_UNIT)).to.lessThanOrEqual(ASSET_UNIT);

    await networkHelpers.time.increase(duration.years(1));

    const baseApy = await rwiVault.getBaseApy();
    const assetsPerShare = ASSET_UNIT * baseApy / wad;
    const sharesPerAsset = ASSET_UNIT * (10n ** BigInt(ASSET_DECIMALS)) / assetsPerShare;

    expect(await rwiVault.convertToAssets(ASSET_UNIT)).to.equal(assetsPerShare);
    expect(await rwiVault.convertToShares(ASSET_UNIT)).to.equal(sharesPerAsset);

    expect(await rwiVault.convertToAssets(sharesPerAsset)).to.be.closeTo(ASSET_UNIT, 1n);
    expect(await rwiVault.convertToAssets(sharesPerAsset)).to.be.lessThanOrEqual(ASSET_UNIT);

    expect(await rwiVault.convertToShares(assetsPerShare)).to.be.closeTo(ASSET_UNIT, 1n);
    expect(await rwiVault.convertToShares(assetsPerShare)).to.be.lessThanOrEqual(ASSET_UNIT);
  }); 

  it('shareToAssets(assetsToShares(UNIT)) == UNIT at any point in time', async function () {
    const { contracts: {rwiVault}, constants: {ASSET_DECIMALS} } = await networkHelpers.loadFixture(setupFixture);
    const ASSET_UNIT = 10n ** BigInt(ASSET_DECIMALS);
    const period = duration.hours(10);
    const repeatPeriod = 100;

    for (let i = 0; i < repeatPeriod; i++) {
      await networkHelpers.time.increase(period);
      const unitConversion = await rwiVault.convertToAssets(await rwiVault.convertToShares(ASSET_UNIT));
      expect(unitConversion).to.be.closeTo(ASSET_UNIT, 2n);
      expect(unitConversion).to.be.lessThanOrEqual(ASSET_UNIT);
    }
  });

  it('user should get exact base apy percentage gain after 1 year', async function () {
    const { accounts: {members}, contracts: {rwiVault, usdcMock}} = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);
    const userShares = await rwiVault.balanceOf(user.address);

    const baseApy = await rwiVault.getBaseApy();
    const assetsAfterYear = depositAmount * baseApy / wad;

    await networkHelpers.time.increase(duration.years(1));

    expect(await rwiVault.convertToAssets(userShares)).to.be.closeTo(assetsAfterYear, 1n);    
  });

  it('users should get the same gain over period of 1 year regardless of when they deposited', async function () {
    const { accounts: {members}, contracts: {rwiVault, usdcMock}} = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const user2 = members[1];
    const depositAmount = parseUsdc("1000");
    const depositAmount2 = parseUsdc("1000");

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);
    const userShares = await rwiVault.balanceOf(user.address);

    await networkHelpers.time.increase(duration.years(1));

    const assetsAfterYear = await rwiVault.convertToAssets(userShares);

    await usdcMock.connect(user2).approve(await rwiVault.getAddress(), depositAmount2);
    await rwiVault.connect(user2).requestDeposit(depositAmount2, user2.address, user2.address);    
    const user2shares = await rwiVault.balanceOf(user2.address);

    await networkHelpers.time.increase(duration.years(1));

    const assetsAfterYear2 = await rwiVault.convertToAssets(user2shares);
    
    expect(assetsAfterYear).to.be.closeTo(assetsAfterYear2, 1n);
  });
});
