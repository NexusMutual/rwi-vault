import { expect } from 'chai';
import { network } from "hardhat";
import { setup } from './setup.js';
import { parseUsdc } from '../utils/utils.js';
import { RequestStatus } from '../utils/constants.js';
import { RWIVault } from '../../../types/ethers-contracts/RWIVault.js';
import { Registry } from '../../../types/ethers-contracts/Registry.js';

const { ethers, networkHelpers } = await network.connect();
const { duration } = networkHelpers.time;

describe('deposit', function () {

  async function setupFixture() {
    return setup(ethers);
  }

  it('only members can deposit', async function () {
    const { accounts: {nonMembers}, contracts: {rwiVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = nonMembers[0];
    const depositAmount = parseUsdc("1000");

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await expect(rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address))
      .to.be.revertedWithCustomError(rwiVault, 'OnlyMember');
  });

  it('deposit request is fulfilled automatically if asset cap is not reached', async function () {
    const { accounts: {members, vaultOperator}, contracts: {rwiVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    const expectedShares = await rwiVault.convertToShares(depositAmount);
    await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    expect(await rwiVault.balanceOf(user.address)).to.equal(expectedShares);

    // assets should be transferred to the vault operator directly
    expect(await usdcMock.balanceOf(vaultOperator.address)).to.equal(depositAmount);
    expect(await usdcMock.balanceOf(await rwiVault.getAddress())).to.equal(0);
  });

  it('deposit request goes to the queue if asset cap is reached', async function () {
    const { accounts: {members, vaultOperator}, contracts: {rwiVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await rwiVault.connect(vaultOperator).setAssetCap(parseUsdc("100"));

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    // assets should be held in the vault while the request is in the queue
    expect(await usdcMock.balanceOf(await rwiVault.getAddress())).to.equal(depositAmount);

    const [request] = await rwiVault.getDepositRequests([1]);
    expect(request.fulfilledAssets).to.equal(0);
    expect(request.status).to.equal(RequestStatus.PENDING);
  });

  it('vault operator can fulfill the request', async function () {
    const { accounts: {members, vaultOperator}, contracts: {rwiVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await rwiVault.connect(vaultOperator).setAssetCap(parseUsdc("100"));

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    await rwiVault.connect(vaultOperator).fulfillDeposit(1, depositAmount);
    const expectedShares = await rwiVault.convertToShares(depositAmount);

    expect(await rwiVault.balanceOf(user.address)).to.equal(expectedShares);

    expect(await usdcMock.balanceOf(vaultOperator.address)).to.equal(depositAmount);
    expect(await usdcMock.balanceOf(await rwiVault.getAddress())).to.equal(0);

    const [request] = await rwiVault.getDepositRequests([1]);
    expect(request.fulfilledAssets).to.equal(depositAmount);
    expect(request.status).to.equal(RequestStatus.FULFILLED);
  });

  it('vault manage can partially fulfill the request', async function () {
    const { accounts: {members, vaultOperator}, contracts: {rwiVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await rwiVault.connect(vaultOperator).setAssetCap(parseUsdc("100"));

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    const userBalanceBefore = await usdcMock.balanceOf(user.address);
    
    const partialAmount = parseUsdc("300");
    await rwiVault.connect(vaultOperator).fulfillDeposit(1, partialAmount);
    const expectedShares = await rwiVault.convertToShares(partialAmount);

    expect(await rwiVault.balanceOf(user.address)).to.equal(expectedShares);

    expect(await usdcMock.balanceOf(vaultOperator.address)).to.equal(partialAmount);
    expect(await usdcMock.balanceOf(await rwiVault.getAddress())).to.equal(0);
    const userBalanceAfter = await usdcMock.balanceOf(user.address);
    expect(userBalanceAfter - userBalanceBefore).to.equal(depositAmount - partialAmount);

    const [requestAfterFirst] = await rwiVault.getDepositRequests([1]);
    expect(requestAfterFirst.fulfilledAssets).to.equal(partialAmount);
    expect(requestAfterFirst.status).to.equal(RequestStatus.FULFILLED);
  });

  it('user or vault operator can cancel the request', async function () {
    const { accounts: {members, vaultOperator}, contracts: {rwiVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await rwiVault.connect(vaultOperator).setAssetCap(parseUsdc("100"));

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    await expect(rwiVault.connect(members[1]).cancelDepositRequest(1)).to.be.revertedWithCustomError(rwiVault, 'OnlyRequestOwnerOrVaultOperator');

    // vault operator should also be able to cancel the request
    await expect(rwiVault.connect(vaultOperator).cancelDepositRequest.staticCall(1)).to.not.be.revert(ethers);

    await rwiVault.connect(user).cancelDepositRequest(1);
    
    const [request] = await rwiVault.getDepositRequests([1]);
    expect(request.fulfilledAssets).to.equal(0);
    expect(request.status).to.equal(RequestStatus.CANCELLED);
  });

  it('user should be able to lock shares on deposit', async function () {
    const { accounts: {members}, contracts: {rwiVault, registry, locks, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");
    const lockPeriod = duration.days(30);

    const expectedShares = await rwiVault.convertToShares(depositAmount);
    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDepositAndLock(depositAmount, user.address, user.address, lockPeriod);
    
    const [request] = await rwiVault.getDepositRequests([1]);
    expect(request.fulfilledAssets).to.equal(depositAmount);
    expect(await rwiVault.balanceOf(user.address)).to.equal(0);
    expect(await rwiVault.balanceOf(await locks.getAddress())).to.equal(expectedShares);

    const memberId = await registry.getMemberId(user.address);

    const memberLocks = await locks.getAllMemberLocks(memberId);
    expect(memberLocks.length).to.equal(1);
    expect(memberLocks[0].shares).to.equal(expectedShares);
    expect(memberLocks[0].period).to.equal(lockPeriod);
    expect(memberLocks[0].startTime).to.equal(await networkHelpers.time.latest());
  });

  it('user should be able to request locking shares on deposit when it goes to the queue', async function () {
    const { accounts: {members, vaultOperator}, contracts: {rwiVault, registry, locks, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");
    const lockPeriod = duration.days(30);
    
    await rwiVault.connect(vaultOperator).setAssetCap(parseUsdc("100"));

    await usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
    await rwiVault.connect(user).requestDepositAndLock(depositAmount, user.address, user.address, lockPeriod);

    await rwiVault.connect(vaultOperator).fulfillDeposit(1, depositAmount); 
    const expectedShares = await rwiVault.convertToShares.staticCall(depositAmount);
    
    const [request] = await rwiVault.getDepositRequests([1]);
    expect(request.fulfilledAssets).to.equal(depositAmount);
    expect(await rwiVault.balanceOf(user.address)).to.equal(0);
    expect(await rwiVault.balanceOf(await locks.getAddress())).to.equal(expectedShares);

    const memberId = await registry.getMemberId(user.address);

    const memberLocks = await locks.getAllMemberLocks(memberId);
    expect(memberLocks.length).to.equal(1);
    expect(memberLocks[0].shares).to.equal(expectedShares);
    expect(memberLocks[0].period).to.equal(lockPeriod);
    expect(memberLocks[0].startTime).to.equal(await networkHelpers.time.latest());

  });

  describe('deposit fulfillment reverts', async function () {
    let user : any;
    let vaultOperator : any;
    let rwiVault : RWIVault;
    let registry : Registry;
    const depositAmount = parseUsdc("1000");

    beforeEach(async function () {
      const { accounts, contracts } = await networkHelpers.loadFixture(setupFixture);
      ({members: [user], vaultOperator} = accounts);
      ({rwiVault, registry} = contracts);
      
      await rwiVault.connect(vaultOperator).setAssetCap(parseUsdc("100"));
      await contracts.usdcMock.connect(user).approve(await rwiVault.getAddress(), depositAmount);
      await rwiVault.connect(user).requestDeposit(depositAmount, user.address, user.address);
    });

    it('only vault operator can fulfill the request', async function () {
      await expect(rwiVault.connect(user).fulfillDeposit(1, depositAmount)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
    });

    it('request is already fulfilled', async function () {
      await rwiVault.connect(vaultOperator).fulfillDeposit(1, depositAmount);
      await expect(rwiVault.connect(vaultOperator).fulfillDeposit(1, depositAmount))
        .to.be.revertedWithCustomError(rwiVault, 'RequestNotPending');
    });

    it('requested assets exceeded', async function () {
      await expect(rwiVault.connect(vaultOperator).fulfillDeposit(1, depositAmount + 1n))
      .to.be.revertedWithCustomError(rwiVault, 'RequestedAssetsExceeded');
    });

    it('invalid request id', async function () {
      await expect(rwiVault.connect(vaultOperator).fulfillDeposit(2, depositAmount))
      .to.be.revertedWithCustomError(rwiVault, 'InvalidRequestId');
    });

  });

});
