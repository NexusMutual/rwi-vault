import { expect } from 'chai';
import { network } from "hardhat";
import { setup } from './setup.js';
import { parseUsdc } from '../utils/utils.js';

const { ethers, networkHelpers } = await network.connect();
const { duration } = networkHelpers.time;

describe('shareAssetConversion', function () {

  async function setupFixture() {
    return setup(ethers);
  }

  it('share to assets conversion after 1 year must be at base apy rate', async function () {
    const { contracts: {rwiVault}, constants: {BASE_APY, ASSET_DECIMALS} } = await networkHelpers.loadFixture(setupFixture);
    
    const ASSET_UNIT = 10n ** BigInt(ASSET_DECIMALS);
    expect(await rwiVault.convertToAssets(ASSET_UNIT)).to.equal(ASSET_UNIT);
    expect(await rwiVault.convertToShares(ASSET_UNIT)).to.equal(ASSET_UNIT);

    await networkHelpers.time.increase(duration.years(1));

    const assetsPerShare = ASSET_UNIT + ASSET_UNIT * BigInt(BASE_APY) / 100_00n;
    const sharesPerAsset = ASSET_UNIT * (10n ** BigInt(ASSET_DECIMALS)) / assetsPerShare;

    expect(await rwiVault.convertToAssets(ASSET_UNIT)).to.equal(assetsPerShare);
    expect(await rwiVault.convertToShares(ASSET_UNIT)).to.equal(sharesPerAsset);

    expect(await rwiVault.convertToAssets(sharesPerAsset)).to.approximately(ASSET_UNIT, 1n);  // conversion rounding error is acceptable
    expect(await rwiVault.convertToAssets(sharesPerAsset)).to.be.lessThanOrEqual(ASSET_UNIT); // make sure rounding errors are always in favor of the vault

    expect(await rwiVault.convertToShares(assetsPerShare)).to.approximately(ASSET_UNIT, 1n);  // conversion rounding error is acceptable
    expect(await rwiVault.convertToShares(assetsPerShare)).to.be.lessThanOrEqual(ASSET_UNIT); // make sure rounding errors are always in favor of the vault
  }); 

  it('shareToAssets(assetsToShares(UNIT)) == UNIT at any point in time', async function () {
    const { contracts: {rwiVault}, constants: {ASSET_DECIMALS} } = await networkHelpers.loadFixture(setupFixture);
    const ASSET_UNIT = 10n ** BigInt(ASSET_DECIMALS);
    const period = duration.hours(10);
    const repeatPeriod = 100;

    for (let i = 0; i < repeatPeriod; i++) {
      await networkHelpers.time.increase(period);
      const unitConversion = await rwiVault.convertToAssets(await rwiVault.convertToShares(ASSET_UNIT));
      expect(unitConversion).to.approximately(ASSET_UNIT, 2n);  // conversion rounding error is acceptable
      expect(unitConversion).to.be.lessThanOrEqual(ASSET_UNIT); // make sure rounding errors are always in favor of the vault
    }
  });

  it('user should get exact base apy percentage gain after 1 year', async function () {
    const { accounts: {members}, contracts: {rwiVault, usdcMock}, constants: {BASE_APY} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);
    const userShares = await rwiVault.balanceOf(user.address);

    const gain = depositAmount * BigInt(BASE_APY) / 100_00n;

    await networkHelpers.time.increase(duration.years(1));

    expect(await rwiVault.convertToAssets(userShares)).to.equal(depositAmount + gain);    
  });

  it('user should get pro rated gain during any fifth period of a year', async function () {
    const { accounts: {members}, contracts: {rwiVault, usdcMock}, constants: {BASE_APY} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);
    const userShares = await rwiVault.balanceOf(user.address);

    const period = duration.days(73); // 73 days is 1/5 of a year
    const gainForPeriod = depositAmount * BigInt(BASE_APY / 5) / 100_00n;

    let lastAmount = depositAmount;

    const repeatPeriod = 20;
    for (let i = 0; i < repeatPeriod; i++) {
      await networkHelpers.time.increase(period);
      const currentAmount = await rwiVault.convertToAssets(userShares);

      expect(currentAmount).to.equal(lastAmount + gainForPeriod);

      lastAmount = currentAmount;
    }
  });
});
