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

  it('only vault manager can propose a base apy change', async function () {
    const { contracts: {rwaVault, registry} } = await networkHelpers.loadFixture(setupFixture)

    await expect(rwaVault.proposeBaseApyChange(0, 0)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('base apy change can be proposed and executed', async function () {
    const { accounts: {vaultManager}, contracts: {rwaVault} } = await networkHelpers.loadFixture(setupFixture);

    const now = await networkHelpers.time.latest();
    const activeFrom = now + duration.days(100);
    const newBaseApy = 200;

    await rwaVault.connect(vaultManager).proposeBaseApyChange(newBaseApy, activeFrom);

    await networkHelpers.time.increaseTo(activeFrom + 10);

    // anybody should be able to call execute
    await rwaVault.executeBaseApyChange();

    expect(await rwaVault.getBaseApy()).to.equal(newBaseApy);
  });

  it('proposed activation time must be at least 90 days from now', async function () {
    const { accounts: {vaultManager}, contracts: {rwaVault} } = await networkHelpers.loadFixture(setupFixture);

    const now = await networkHelpers.time.latest();
    const activeFrom = now + duration.days(90) - 1;
    const newBaseApy = 200;

    await expect(
      rwaVault.connect(vaultManager).proposeBaseApyChange(newBaseApy, activeFrom)
    ).to.be.revertedWithCustomError(rwaVault, 'ProposalActivationTimeTooSoon');
  });

  it('cant execute before activation time', async function () {
    const { accounts: {vaultManager}, contracts: {rwaVault} } = await networkHelpers.loadFixture(setupFixture);

    const now = await networkHelpers.time.latest();
    const activeFrom = now + duration.days(100);
    const newBaseApy = 200;

    await rwaVault.connect(vaultManager).proposeBaseApyChange(newBaseApy, activeFrom);

    await networkHelpers.time.increaseTo(activeFrom - 10);

    await expect(rwaVault.executeBaseApyChange()).to.be.revertedWithCustomError(rwaVault, 'ProposalNotActive');
  });

  it('cant execute if there is no new proposal', async function () {
    const { contracts: {rwaVault} } = await networkHelpers.loadFixture(setupFixture);
    await expect(rwaVault.executeBaseApyChange()).to.be.revertedWithCustomError(rwaVault, 'ProposalDoesntExist');
  });

  it('should compound gain after apy change', async function () {
    const { accounts: {members, vaultManager}, contracts: {rwaVault, usdcMock}, constants: {BASE_APY} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await usdcMock.connect(user).approve(await rwaVault.getAddress(), depositAmount);
    await rwaVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    const userShares = await rwaVault.balanceOf(user.address);

    const now = await networkHelpers.time.latest();
    const activeFrom = now + duration.years(1)
    const newBaseApy = 200;

    await rwaVault.connect(vaultManager).proposeBaseApyChange(newBaseApy, activeFrom);
    await networkHelpers.time.increaseTo(activeFrom);
    await rwaVault.executeBaseApyChange();

    await networkHelpers.time.increase(duration.years(1));

    const assetsAfterFirstYear = depositAmount + depositAmount * BigInt(BASE_APY) / 100_00n;
    const assetsAfterSecondYear = assetsAfterFirstYear + assetsAfterFirstYear * BigInt(newBaseApy) / 100_00n;

    expect(await rwaVault.convertToAssets(userShares)).to.equal(assetsAfterSecondYear);
  });
});
