import { expect, use } from 'chai';
import { network } from "hardhat";
import { setup } from './setup.js';
import { parseUsdc } from '../utils/utils.js';
import { RequestStatus } from '../utils/constants.js';
import { RWIVault } from '../../../types/ethers-contracts/RWIVault.js';
import { RWIRegistry } from '../../../types/ethers-contracts/RWIRegistry.js';
import { ERC20Mock } from '../../../types/ethers-contracts/mock/ERC20Mock.js';

const { ethers, networkHelpers } = await network.connect();

describe('redeem', function () {

  let nonMembers : any[];
  let members : any[];
  let vaultOperator : any;
  let rwiVault : RWIVault;
  let usdcMock : ERC20Mock;
  let registry : RWIRegistry;
  let user: any;
  let userShares : bigint;

  async function setupFixture() {
    return setup(ethers);
  }

  async function _deposit(user : any, amount : bigint) : Promise<bigint> {
    await usdcMock.connect(user).approve(await rwiVault.getAddress(), amount);
    await rwiVault.connect(user).requestDeposit(amount, user.address, user.address);
    return rwiVault.balanceOf(user.address);
  }

  async function _requestRedeem(user : any, amount : bigint) {
    await rwiVault.connect(user).approve(await rwiVault.getAddress(), amount);
    await rwiVault.connect(user).requestRedeem(amount, user.address, user.address);
  }

  beforeEach(async function () {
    const { accounts, contracts } = await networkHelpers.loadFixture(setupFixture);
    ({members, nonMembers, vaultOperator} = accounts);
    ({rwiVault, usdcMock, registry} = contracts);

    user = members[0];
    const depositAmount = parseUsdc("1000");

    userShares = await _deposit(user, depositAmount);
  });

  it('only members can redeem', async function () {
    const nonMember = nonMembers[0];

    await rwiVault.connect(user).transfer(nonMember.address, userShares);

    await rwiVault.connect(nonMember).approve(await rwiVault.getAddress(), userShares);
    await expect(rwiVault.connect(nonMember).requestRedeem(userShares, nonMember.address, nonMember.address))
      .to.be.revertedWithCustomError(rwiVault, 'OnlyMember');
  });

  it('redeem request goes to the queue when submitted', async function () {
    await _requestRedeem(user, userShares);

    expect(await rwiVault.balanceOf(user.address)).to.equal(0);
    expect(await rwiVault.balanceOf(await rwiVault.getAddress())).to.equal(userShares);

    const [request] = await rwiVault.getRedeemRequests([1]);
    expect(request.fulfilledShares).to.equal(0);
    expect(request.status).to.equal(RequestStatus.PENDING);
  });

  it('only vault operator can fulfill the request', async function () {
    await expect(rwiVault.fulfillRedeems(1, parseUsdc("1"))).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('vault operator can fulfill the requests in FIFO order', async function () {
    const user1 = members[0];
    const userShares1 = await rwiVault.balanceOf(user1.address);
    await _requestRedeem(user1, userShares1);

    const user2 = members[1];
    const depositAmount2 = parseUsdc("2000");
    const userShares2 = await _deposit(user2, depositAmount2);
    await _requestRedeem(user2, userShares2);

    const user3 = members[2];
    const depositAmount3 = parseUsdc("3000"); 
    const userShares3 = await _deposit(user3, depositAmount3);
    await _requestRedeem(user3, userShares3);

    await usdcMock.connect(vaultOperator).approve(await rwiVault.getAddress(), parseUsdc("10000"));
    await rwiVault.connect(vaultOperator).fulfillRedeems(2, parseUsdc("10000"));

    expect(await rwiVault.balanceOf(await rwiVault.getAddress())).to.equal(userShares3);

    const [request1, request2, request3] = await rwiVault.getRedeemRequests([1,2,3]);
    expect(request1.fulfilledShares).to.equal(userShares1);
    expect(request1.status).to.equal(RequestStatus.FULFILLED);
    expect(request2.fulfilledShares).to.equal(userShares2);
    expect(request2.status).to.equal(RequestStatus.FULFILLED);
    expect(request3.fulfilledShares).to.equal(0);
    expect(request3.status).to.equal(RequestStatus.PENDING);
  });

  it('total distributed assets must be capped by maxTotalAssets', async function () {
    await _requestRedeem(user, userShares);

    const maxTotalAssets = parseUsdc("500");
    const vaultOperatorBalanceStart = await usdcMock.balanceOf(vaultOperator);
    const userBalanceStart = await usdcMock.balanceOf(user);

    await usdcMock.connect(vaultOperator).approve(await rwiVault.getAddress(), vaultOperatorBalanceStart);
    await rwiVault.connect(vaultOperator).fulfillRedeems(1, maxTotalAssets);

    expect(await usdcMock.balanceOf(vaultOperator)).to.gte(vaultOperatorBalanceStart - maxTotalAssets);
    expect(await usdcMock.balanceOf(user)).to.lte(userBalanceStart + maxTotalAssets);

    expect(await usdcMock.balanceOf(vaultOperator)).to.closeTo(vaultOperatorBalanceStart - maxTotalAssets, 1n);
    expect(await usdcMock.balanceOf(user)).to.closeTo(userBalanceStart + maxTotalAssets, 1n);
  });

  it('last fulfilled request can be partially fulfilled', async function () {
    const user1 = members[0];
    const userShares1 = await rwiVault.balanceOf(user1.address);
    await _requestRedeem(user1, userShares1);

    const user2 = members[1];
    const depositAmount2 = parseUsdc("2000");
    const userShares2 = await _deposit(user2, depositAmount2);
    await _requestRedeem(user2, userShares2);

    
    await usdcMock.connect(vaultOperator).approve(await rwiVault.getAddress(), parseUsdc("2000"));
    await rwiVault.connect(vaultOperator).fulfillRedeems(2, parseUsdc("2000"));
    const expectedFulfilledShares = await rwiVault.convertToShares(parseUsdc("2000"));
    

    const [request1, request2] = await rwiVault.getRedeemRequests([1,2,3]);
    expect(request1.fulfilledShares).to.equal(userShares1);
    expect(request1.status).to.equal(RequestStatus.FULFILLED);
    expect(request2.fulfilledShares).to.equal(expectedFulfilledShares - userShares1);
    expect(request2.status).to.equal(RequestStatus.PENDING);
  });

  it('should continue fulfilling starting from the last partially fulfilled request', async function () {
    const user1 = members[0];
    const userShares1 = await rwiVault.balanceOf(user1.address);
    await _requestRedeem(user1, userShares1);

    const user2 = members[1];
    const depositAmount2 = parseUsdc("2000");
    const userShares2 = await _deposit(user2, depositAmount2);
    await _requestRedeem(user2, userShares2);

    const user3 = members[2];
    const depositAmount3 = parseUsdc("3000"); 
    const userShares3 = await _deposit(user3, depositAmount3);
    await _requestRedeem(user3, userShares3);

    await usdcMock.connect(vaultOperator).approve(await rwiVault.getAddress(), parseUsdc("10000"));
    await rwiVault.connect(vaultOperator).fulfillRedeems(2, parseUsdc("2000"));

    const [request2_1] = await rwiVault.getRedeemRequests([2]);
    expect(request2_1.status).to.equal(RequestStatus.PENDING);

    await rwiVault.connect(vaultOperator).fulfillRedeems(3, parseUsdc("100"));

    const [request2_2] = await rwiVault.getRedeemRequests([2]);
    expect(request2_2.status).to.equal(RequestStatus.PENDING);

    await rwiVault.connect(vaultOperator).fulfillRedeems(3, parseUsdc("1000"));
    const [request2_3, request3] = await rwiVault.getRedeemRequests([2,3]);
    expect(request2_3.status).to.equal(RequestStatus.FULFILLED);
    expect(request2_3.fulfilledShares).to.equal(userShares2);
    expect(request3.fulfilledShares).to.be.greaterThan(0);
  });

  it('totalAssets is updated on fulfillment', async function () {
     // deposit to have more assets in the vault, so difference in totalAssets can be testet
    await _deposit(members[1], parseUsdc("1000"));
    
    await _requestRedeem(user, userShares);

    await usdcMock.connect(vaultOperator).approve(await rwiVault.getAddress(), parseUsdc("10000"));

    const userAssetsBefore = await usdcMock.balanceOf(user.address);
    const totalAssetsBefore = await rwiVault.totalAssets();
    await rwiVault.connect(vaultOperator).fulfillRedeems(1, parseUsdc("10000"));

    const totalAssetsAfter = await rwiVault.totalAssets();
    const userAssetsAfter = await usdcMock.balanceOf(user.address);

    expect(totalAssetsAfter).to.be.lt(totalAssetsBefore);
    // total difference is a bit less because assets gets yield for a few seconds
    expect(totalAssetsBefore - totalAssetsAfter).to.closeTo(userAssetsAfter - userAssetsBefore, 1000n);
  });

  it('user or vault operator can cancel the request', async function () {
    await _requestRedeem(user, userShares);

    await expect(rwiVault.connect(members[1]).cancelRedeemRequest(1)).to.be.revertedWithCustomError(rwiVault, 'OnlyRequestOwnerOrVaultOperator');

    // vault operator should also be able to cancel the request
    await expect(rwiVault.connect(vaultOperator).cancelRedeemRequest.staticCall(1)).to.not.be.revert(ethers);

    expect(await rwiVault.balanceOf(user.address)).to.equal(0);
    await rwiVault.connect(user).cancelRedeemRequest(1);
    
    const [request] = await rwiVault.getRedeemRequests([1]);
    expect(request.fulfilledShares).to.equal(0);
    expect(request.status).to.equal(RequestStatus.CANCELLED);
    expect(await rwiVault.balanceOf(user.address)).to.equal(userShares);
  });

  it('cancelled requests are skipped on fulfillment', async function () {
    const user1 = members[0];
    const userShares1 = await rwiVault.balanceOf(user1.address);
    await _requestRedeem(user1, userShares1);

    const user2 = members[1];
    const depositAmount2 = parseUsdc("2000");
    const userShares2 = await _deposit(user2, depositAmount2);
    await _requestRedeem(user2, userShares2);

    const user3 = members[2];
    const depositAmount3 = parseUsdc("3000"); 
    const userShares3 = await _deposit(user3, depositAmount3);
    await _requestRedeem(user3, userShares3);

    await rwiVault.connect(user2).cancelRedeemRequest(2);
    

    const expectTotalAssets = await rwiVault.convertToAssets(userShares1 + userShares3);
    const offset = 10000n; // offset because there is more yield for a few seconds
    await usdcMock.connect(vaultOperator).approve(await rwiVault.getAddress(), expectTotalAssets + offset);
    await rwiVault.connect(vaultOperator).fulfillRedeems(3, expectTotalAssets + offset);

    const [request1, request2, request3] = await rwiVault.getRedeemRequests([1,2,3]);
    expect(request1.fulfilledShares).to.equal(userShares1);
    expect(request1.status).to.equal(RequestStatus.FULFILLED);
    expect(request2.fulfilledShares).to.equal(0);
    expect(request2.status).to.equal(RequestStatus.CANCELLED);
    expect(request3.fulfilledShares).to.equal(userShares3);
    expect(request3.status).to.equal(RequestStatus.FULFILLED);
  });

});
