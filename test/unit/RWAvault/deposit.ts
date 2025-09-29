import { expect } from 'chai';
import { network } from "hardhat";
import { setup } from './setup.js';
import { parseUsdc } from '../utils/utils.js';
import { RequestStatus } from '../utils/constants.js';
import { RWAVault } from '../../../types/ethers-contracts/RWAVault.js';
import { Registry } from '../../../types/ethers-contracts/Registry.js';

const { ethers, networkHelpers } = await network.connect();
const { duration } = networkHelpers.time;

describe('deposit', function () {

  async function setupFixture() {
    return setup(ethers);
  }

  it('only members can deposit', async function () {
    const { accounts: {nonMembers}, contracts: {rwaVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = nonMembers[0];
    const depositAmount = parseUsdc("1000");

    await usdcMock.connect(user).approve(await rwaVault.getAddress(), depositAmount);
    await expect(rwaVault.connect(user).requestDeposit(depositAmount, user.address, user.address))
      .to.be.revertedWithCustomError(rwaVault, 'OnlyMember');
  });

  it('deposit request is fulfilled automatically if asset cap is not reached', async function () {
    const { accounts: {members, vaultManager}, contracts: {rwaVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await usdcMock.connect(user).approve(await rwaVault.getAddress(), depositAmount);
    const expectedShares = await rwaVault.convertToShares(depositAmount);
    await rwaVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    expect(await rwaVault.balanceOf(user.address)).to.equal(expectedShares);

    // assets should be transferred to the vault manager directly
    expect(await usdcMock.balanceOf(vaultManager.address)).to.equal(depositAmount);
    expect(await usdcMock.balanceOf(await rwaVault.getAddress())).to.equal(0);
  });

  it('deposit request goes to the queue if asset cap is reached', async function () {
    const { accounts: {members, vaultManager}, contracts: {rwaVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await rwaVault.connect(vaultManager).setAssetCap(parseUsdc("100"));

    await usdcMock.connect(user).approve(await rwaVault.getAddress(), depositAmount);
    await rwaVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    // assets should be held in the vault while the request is in the queue
    expect(await usdcMock.balanceOf(await rwaVault.getAddress())).to.equal(depositAmount);

    const [request] = await rwaVault.getDepositRequests([1]);
    expect(request.fulfilledAssets).to.equal(0);
    expect(request.status).to.equal(RequestStatus.PENDING);
  });

  it('vault manager can fulfill the request', async function () {
    const { accounts: {members, vaultManager}, contracts: {rwaVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await rwaVault.connect(vaultManager).setAssetCap(parseUsdc("100"));

    await usdcMock.connect(user).approve(await rwaVault.getAddress(), depositAmount);
    await rwaVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    await rwaVault.connect(vaultManager).fulfillDeposit(1, depositAmount);
    const expectedShares = await rwaVault.convertToShares(depositAmount);

    expect(await rwaVault.balanceOf(user.address)).to.equal(expectedShares);

    expect(await usdcMock.balanceOf(vaultManager.address)).to.equal(depositAmount);
    expect(await usdcMock.balanceOf(await rwaVault.getAddress())).to.equal(0);

    const [request] = await rwaVault.getDepositRequests([1]);
    expect(request.fulfilledAssets).to.equal(depositAmount);
    expect(request.status).to.equal(RequestStatus.FULFILLED);
  });

  it('vault manage can partially fulfill the request', async function () {
    const { accounts: {members, vaultManager}, contracts: {rwaVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await rwaVault.connect(vaultManager).setAssetCap(parseUsdc("100"));

    await usdcMock.connect(user).approve(await rwaVault.getAddress(), depositAmount);
    await rwaVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    const userBalanceBefore = await usdcMock.balanceOf(user.address);
    
    const partialAmount = parseUsdc("300");
    await rwaVault.connect(vaultManager).fulfillDeposit(1, partialAmount);
    const expectedShares = await rwaVault.convertToShares(partialAmount);

    expect(await rwaVault.balanceOf(user.address)).to.equal(expectedShares);

    expect(await usdcMock.balanceOf(vaultManager.address)).to.equal(partialAmount);
    expect(await usdcMock.balanceOf(await rwaVault.getAddress())).to.equal(0);
    const userBalanceAfter = await usdcMock.balanceOf(user.address);
    expect(userBalanceAfter - userBalanceBefore).to.equal(depositAmount - partialAmount);

    const [requestAfterFirst] = await rwaVault.getDepositRequests([1]);
    expect(requestAfterFirst.fulfilledAssets).to.equal(partialAmount);
    expect(requestAfterFirst.status).to.equal(RequestStatus.FULFILLED);
  });

  it('user or vault manager can cancel the request', async function () {
    const { accounts: {members, vaultManager}, contracts: {rwaVault, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");

    await rwaVault.connect(vaultManager).setAssetCap(parseUsdc("100"));

    await usdcMock.connect(user).approve(await rwaVault.getAddress(), depositAmount);
    await rwaVault.connect(user).requestDeposit(depositAmount, user.address, user.address);

    await expect(rwaVault.connect(members[1]).cancelDepositRequest(1)).to.be.revertedWithCustomError(rwaVault, 'OnlyRequestOwnerOrVaultManager');

    // vault manager should also be able to cancel the request
    await expect(rwaVault.connect(vaultManager).cancelDepositRequest.staticCall(1)).to.not.be.revert(ethers);

    await rwaVault.connect(user).cancelDepositRequest(1);
    
    const [request] = await rwaVault.getDepositRequests([1]);
    expect(request.fulfilledAssets).to.equal(0);
    expect(request.status).to.equal(RequestStatus.CANCELLED);
  });

  it('user should be able to lock shares on deposit', async function () {
    const { accounts: {members}, contracts: {rwaVault, registry, locks, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");
    const lockPeriod = duration.days(30);

    const expectedShares = await rwaVault.convertToShares(depositAmount);
    await usdcMock.connect(user).approve(await rwaVault.getAddress(), depositAmount);
    await rwaVault.connect(user).requestDepositAndLock(depositAmount, user.address, user.address, lockPeriod);
    
    const [request] = await rwaVault.getDepositRequests([1]);
    expect(request.fulfilledAssets).to.equal(depositAmount);
    expect(await rwaVault.balanceOf(user.address)).to.equal(0);
    expect(await rwaVault.balanceOf(await locks.getAddress())).to.equal(expectedShares);

    const memberId = await registry.getMemberId(user.address);

    const memberLocks = await locks.getAllMemberLocks(memberId);
    expect(memberLocks.length).to.equal(1);
    expect(memberLocks[0].shares).to.equal(expectedShares);
    expect(memberLocks[0].period).to.equal(lockPeriod);
    expect(memberLocks[0].startTime).to.equal(await networkHelpers.time.latest());
  });

  it('user should be able to request locking shares on deposit when it goes to the queue', async function () {
    const { accounts: {members, vaultManager}, contracts: {rwaVault, registry, locks, usdcMock} } = await networkHelpers.loadFixture(setupFixture);
    const user = members[0];
    const depositAmount = parseUsdc("1000");
    const lockPeriod = duration.days(30);
    
    await rwaVault.connect(vaultManager).setAssetCap(parseUsdc("100"));

    await usdcMock.connect(user).approve(await rwaVault.getAddress(), depositAmount);
    await rwaVault.connect(user).requestDepositAndLock(depositAmount, user.address, user.address, lockPeriod);

    await rwaVault.connect(vaultManager).fulfillDeposit(1, depositAmount); 
    const expectedShares = await rwaVault.convertToShares.staticCall(depositAmount);
    
    const [request] = await rwaVault.getDepositRequests([1]);
    expect(request.fulfilledAssets).to.equal(depositAmount);
    expect(await rwaVault.balanceOf(user.address)).to.equal(0);
    expect(await rwaVault.balanceOf(await locks.getAddress())).to.equal(expectedShares);

    const memberId = await registry.getMemberId(user.address);

    const memberLocks = await locks.getAllMemberLocks(memberId);
    expect(memberLocks.length).to.equal(1);
    expect(memberLocks[0].shares).to.equal(expectedShares);
    expect(memberLocks[0].period).to.equal(lockPeriod);
    expect(memberLocks[0].startTime).to.equal(await networkHelpers.time.latest());

  });

  describe('deposit fulfillment reverts', async function () {
    let user : any;
    let vaultManager : any;
    let rwaVault : RWAVault;
    let registry : Registry;
    const depositAmount = parseUsdc("1000");

    beforeEach(async function () {
      const { accounts, contracts } = await networkHelpers.loadFixture(setupFixture);
      ({members: [user], vaultManager} = accounts);
      ({rwaVault, registry} = contracts);
      
      await rwaVault.connect(vaultManager).setAssetCap(parseUsdc("100"));
      await contracts.usdcMock.connect(user).approve(await rwaVault.getAddress(), depositAmount);
      await rwaVault.connect(user).requestDeposit(depositAmount, user.address, user.address);
    });

    it('only vault manager can fulfill the request', async function () {
      await expect(rwaVault.connect(user).fulfillDeposit(1, depositAmount)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
    });

    it('request is already fulfilled', async function () {
      await rwaVault.connect(vaultManager).fulfillDeposit(1, depositAmount);
      await expect(rwaVault.connect(vaultManager).fulfillDeposit(1, depositAmount))
        .to.be.revertedWithCustomError(rwaVault, 'RequestNotPending');
    });

    it('requested assets exceeded', async function () {
      await expect(rwaVault.connect(vaultManager).fulfillDeposit(1, depositAmount + 1n))
      .to.be.revertedWithCustomError(rwaVault, 'RequestedAssetsExceeded');
    });

    it('invalid request id', async function () {
      await expect(rwaVault.connect(vaultManager).fulfillDeposit(2, depositAmount))
      .to.be.revertedWithCustomError(rwaVault, 'InvalidRequestId');
    });

  });

});
