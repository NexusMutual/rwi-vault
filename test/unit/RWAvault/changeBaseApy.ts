import { expect } from 'chai';
import { network } from "hardhat";
import { setup } from './setup.js';
import { parseUsdc } from '../utils/utils.js';

const { ethers, networkHelpers } = await network.connect();
const { duration } = networkHelpers.time;

describe('changeBaseApy', function () {

  async function setupFixture() {
    return setup(ethers);
  }

  it('only vault operator can propose a base apy change', async function () {
    const { contracts: {rwiVault, registry} } = await networkHelpers.loadFixture(setupFixture)

    await expect(rwiVault.proposeBaseApyChange(0, 0)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('base apy change can be proposed and executed', async function () {
    const { accounts: {vaultOperator}, contracts: {rwiVault} } = await networkHelpers.loadFixture(setupFixture);

    const now = await networkHelpers.time.latest();
    const activeFrom = now + duration.days(100);
    const newRate = 1000000000500000000n;

    await rwiVault.connect(vaultOperator).proposeBaseApyChange(newRate, activeFrom);

    await networkHelpers.time.increaseTo(activeFrom + 10);

    // anybody should be able to call execute
    await rwiVault.executeBaseApyChange();

    expect(await rwiVault.getBaseRate()).to.equal(newRate);
  });

  it('proposed activation time must be at least 90 days from now', async function () {
    const { accounts: {vaultOperator}, contracts: {rwiVault} } = await networkHelpers.loadFixture(setupFixture);

    const now = await networkHelpers.time.latest();
    const activeFrom = now + duration.days(90) - 1;
    const newRate = 1000000000500000000n;

    await expect(
      rwiVault.connect(vaultOperator).proposeBaseApyChange(newRate, activeFrom)
    ).to.be.revertedWithCustomError(rwiVault, 'ProposalActivationTimeTooSoon');
  });

  it('cant execute before activation time', async function () {
    const { accounts: {vaultOperator}, contracts: {rwiVault} } = await networkHelpers.loadFixture(setupFixture);

    const now = await networkHelpers.time.latest();
    const activeFrom = now + duration.days(100);
    const newRate = 1000000000500000000n;

    await rwiVault.connect(vaultOperator).proposeBaseApyChange(newRate, activeFrom);

    await networkHelpers.time.increaseTo(activeFrom - 10);

    await expect(rwiVault.executeBaseApyChange()).to.be.revertedWithCustomError(rwiVault, 'ProposalNotActive');
  });

  it('cant execute if there is no new proposal', async function () {
    const { contracts: {rwiVault} } = await networkHelpers.loadFixture(setupFixture);
    await expect(rwiVault.executeBaseApyChange()).to.be.revertedWithCustomError(rwiVault, 'ProposalDoesntExist');
  });

  it('should compound gain after apy change', async function () {
    const { accounts: {members, vaultOperator}, contracts: {rwiVault, usdcMock}, constants: {BASE_APY} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    const userShares = await rwiVault.balanceOf(user.address);
    const baseApy = await rwiVault.getBaseApy();

    const now = await networkHelpers.time.latest();
    const activeFrom = now + duration.years(1)
    const newRate = 1000000000500000000n;
    
    await rwiVault.connect(vaultOperator).proposeBaseApyChange(newRate, activeFrom);
    await networkHelpers.time.increaseTo(activeFrom);
    await rwiVault.executeBaseApyChange();

    await networkHelpers.time.increase(duration.years(1));

    const newBaseApy = await rwiVault.getBaseApy();

    const wad = 1000000000000000000n;
    const assetsAfterFirstYear = depositAmount * baseApy / wad;
    const assetsAfterSecondYear = assetsAfterFirstYear * newBaseApy / wad;

    // don't check last digits, because of usdc precision
    const trimemdLastDigits = assetsAfterSecondYear - assetsAfterSecondYear % 100000n;
    expect(await rwiVault.convertToAssets(userShares)).to.equal(trimemdLastDigits);
  });
});
