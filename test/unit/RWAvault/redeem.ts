import { expect, use } from 'chai';
import { network } from "hardhat";
import { setup } from './setup.js';
import { parseUsdc } from '../utils/utils.js';
import { RequestStatus } from '../utils/constants.js';
import { RWAVault } from '../../../types/ethers-contracts/RWAVault.js';
import { Registry } from '../../../types/ethers-contracts/Registry.js';
import { ERC20UsdcMock } from '../../../types/ethers-contracts/mock/ERC20UsdcMock.js';

const { ethers, networkHelpers } = await network.connect();

describe('redeem', function () {

  let nonMembers : any[];
  let members : any[];
  let vaultManager : any;
  let rwaVault : RWAVault;
  let usdcMock : ERC20UsdcMock;
  let registry : Registry;
  let userShares : bigint;

  async function setupFixture() {
    return setup(ethers);
  }

  async function _deposit(user : any, amount : bigint) : Promise<bigint> {
    await usdcMock.connect(user).approve(await rwaVault.getAddress(), amount);
    await rwaVault.connect(user).requestDeposit(amount, user.address, user.address);
    return rwaVault.balanceOf(user.address);
  }

  async function _requestRedeem(user : any, amount : bigint) {
    await rwaVault.connect(user).approve(await rwaVault.getAddress(), amount);
    await rwaVault.connect(user).requestRedeem(amount, user.address, user.address);
  }

  beforeEach(async function () {
    const { accounts, contracts } = await networkHelpers.loadFixture(setupFixture);
    ({members, nonMembers, vaultManager} = accounts);
    ({rwaVault, usdcMock, registry} = contracts);

    const user = members[0];
    const depositAmount = parseUsdc("1000");

    userShares = await _deposit(user, depositAmount);
  });

  it('only members can redeem', async function () {
    const user = members[0];
    const nonMember = nonMembers[0];

    await rwaVault.connect(user).transfer(nonMember.address, userShares);

    await rwaVault.connect(nonMember).approve(await rwaVault.getAddress(), userShares);
    await expect(rwaVault.connect(nonMember).requestRedeem(userShares, nonMember.address, nonMember.address))
      .to.be.revertedWithCustomError(rwaVault, 'OnlyMember');
  });

  it('redeem request goes to the queue when submitted', async function () {
    const user = members[0];
    await _requestRedeem(user, userShares);

    expect(await rwaVault.balanceOf(user.address)).to.equal(0);
    expect(await rwaVault.balanceOf(await rwaVault.getAddress())).to.equal(userShares);

    const [request] = await rwaVault.getRedeemRequests([1]);
    expect(request.fulfilledShares).to.equal(0);
    expect(request.status).to.equal(RequestStatus.PENDING);
  });

  it('only vault manager can fulfill the request', async function () {
    await expect(rwaVault.fulfillRedeems(1, userShares)).to.be.revertedWithCustomError(registry, 'ContractDoesNotExist');
  });

  it('vault manager can fulfill the requests in FIFO order', async function () {
    const user1 = members[0];
    const userShares1 = await rwaVault.balanceOf(user1.address);
    await _requestRedeem(user1, userShares1);

    const user2 = members[1];
    const depositAmount2 = parseUsdc("2000");
    const userShares2 = await _deposit(user2, depositAmount2);
    await _requestRedeem(user2, userShares2);

    const user3 = members[2];
    const depositAmount3 = parseUsdc("3000"); 
    const userShares3 = await _deposit(user3, depositAmount3);
    await _requestRedeem(user3, userShares3);

    await usdcMock.mint(vaultManager, parseUsdc("10000"));
    await usdcMock.connect(vaultManager).approve(await rwaVault.getAddress(), parseUsdc("10000"));
    await rwaVault.connect(vaultManager).fulfillRedeems(2, parseUsdc("10000"));

    expect(await rwaVault.balanceOf(await rwaVault.getAddress())).to.equal(userShares3);

    const [request1, request2, request3] = await rwaVault.getRedeemRequests([1,2,3]);
    expect(request1.fulfilledShares).to.equal(userShares1);
    expect(request1.status).to.equal(RequestStatus.FULFILLED);
    expect(request2.fulfilledShares).to.equal(userShares2);
    expect(request2.status).to.equal(RequestStatus.FULFILLED);
    expect(request3.fulfilledShares).to.equal(0);
    expect(request3.status).to.equal(RequestStatus.PENDING);
  });

  it('total distributed assets must be capped by maxTotalAssets', async function () {
    const user = members[0];
    await _requestRedeem(user, userShares);

    const expectTotalAssets = await rwaVault.convertToAssets(userShares);

    await usdcMock.mint(vaultManager, parseUsdc("10000"));
    await usdcMock.connect(vaultManager).approve(await rwaVault.getAddress(), parseUsdc("10000"));
    await expect(rwaVault.connect(vaultManager).fulfillRedeems(1, expectTotalAssets - 1n))
            .to.be.revertedWithCustomError(rwaVault, 'MaxAssetsExceeded');
  });

  it('totalAssets is updated on fulfillment', async function () {
     // deposit to have more assets in the vault, so difference in totalAssets can be testet
    await _deposit(members[1], parseUsdc("1000"));
    
    const user = members[0];
    await _requestRedeem(user, userShares);

    await usdcMock.mint(vaultManager, parseUsdc("10000"));
    await usdcMock.connect(vaultManager).approve(await rwaVault.getAddress(), parseUsdc("10000"));

    const userAssetsBefore = await usdcMock.balanceOf(user.address);
    await networkHelpers.mine(); // mine 1 block to make sure the totalAssets is updated
    const totalAssetsBefore = await rwaVault.totalAssets();
    await rwaVault.connect(vaultManager).fulfillRedeems(1, parseUsdc("10000"));

    const totalAssetsAfter = await rwaVault.totalAssets();
    const userAssetsAfter = await usdcMock.balanceOf(user.address);
    expect(totalAssetsBefore - totalAssetsAfter).to.equal(userAssetsAfter - userAssetsBefore);
  });

  it('cancelled requests are skipped on fulfillment', async function () {
    const user1 = members[0];
    const userShares1 = await rwaVault.balanceOf(user1.address);
    await _requestRedeem(user1, userShares1);

    const user2 = members[1];
    const depositAmount2 = parseUsdc("2000");
    const userShares2 = await _deposit(user2, depositAmount2);
    await _requestRedeem(user2, userShares2);

    const user3 = members[2];
    const depositAmount3 = parseUsdc("3000"); 
    const userShares3 = await _deposit(user3, depositAmount3);
    await _requestRedeem(user3, userShares3);

    await rwaVault.connect(user2).cancelRedeemRequest(2);
    
    const expectTotalAssets = await rwaVault.convertToAssets(userShares1 + userShares3);
    await usdcMock.mint(vaultManager, expectTotalAssets)
    await usdcMock.connect(vaultManager).approve(await rwaVault.getAddress(), expectTotalAssets);
    await rwaVault.connect(vaultManager).fulfillRedeems(3, expectTotalAssets);

    const [request1, request2, request3] = await rwaVault.getRedeemRequests([1,2,3]);
    expect(request1.fulfilledShares).to.equal(userShares1);
    expect(request1.status).to.equal(RequestStatus.FULFILLED);
    expect(request2.fulfilledShares).to.equal(0);
    expect(request2.status).to.equal(RequestStatus.CANCELLED);
    expect(request3.fulfilledShares).to.equal(userShares3);
    expect(request3.status).to.equal(RequestStatus.FULFILLED);
  });

  it('user or vault manager can cancel the request', async function () {
    const user = members[0];
    await _requestRedeem(user, userShares);

    await expect(rwaVault.connect(members[1]).cancelRedeemRequest(1)).to.be.revertedWithCustomError(rwaVault, 'OnlyRequestOwnerOrVaultManager');

    // vault manager should also be able to cancel the request
    await expect(rwaVault.connect(vaultManager).cancelRedeemRequest.staticCall(1)).to.not.be.revert(ethers);

    expect(await rwaVault.balanceOf(user.address)).to.equal(0);
    await rwaVault.connect(user).cancelRedeemRequest(1);
    
    const [request] = await rwaVault.getRedeemRequests([1]);
    expect(request.fulfilledShares).to.equal(0);
    expect(request.status).to.equal(RequestStatus.CANCELLED);
    expect(await rwaVault.balanceOf(user.address)).to.equal(userShares);
  });
});
