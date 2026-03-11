// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "forge-std/src/Test.sol";

import "./Setup.t.sol";

contract RWIVaultFuzzTest is Setup {

  function testFuzz_requestDeposit(uint96 assetsRaw) public {
    uint256 assets = bound(uint256(assetsRaw), 1e4, 1e12);
    uint256 memberAssetBefore = asset.balanceOf(member);
    uint256 memberSharesBefore = vault.balanceOf(member);

    vm.startPrank(member);
    asset.approve(address(vault), assets);
    uint256 requestId = vault.requestDeposit(assets, member, member);
    vm.stopPrank();

    uint[] memory ids = new uint[](1);
    ids[0] = requestId;
    IRWIVault.DepositRequestData[] memory reqs = vault.getDepositRequests(ids);
    assertEq(uint(reqs[0].status), uint(IRWIVault.RequestStatus.FULFILLED));
    assertEq(vault.balanceOf(member), memberSharesBefore + assets);
    assertEq(asset.balanceOf(member), memberAssetBefore - assets);
  }

  function testFuzz_requestDepositAndLock(
    uint96 assetsRaw,
    uint32 lockPeriodRaw
  ) public {
    uint256 assets = bound(uint256(assetsRaw), 1e4, 1e12);
    uint256 lockPeriod = bound(uint256(lockPeriodRaw), MIN_LOCK_PERIOD, MAX_LOCK_PERIOD);
    uint256 memberId = registry.getMemberId(member);

    vm.startPrank(member);
    asset.approve(address(vault), assets);
    uint256 requestId = vault.requestDepositAndLock(assets, member, member, lockPeriod);
    vm.stopPrank();

    uint[] memory ids = new uint[](1);
    ids[0] = requestId;
    IRWIVault.DepositRequestData[] memory reqs = vault.getDepositRequests(ids);
    assertEq(uint(reqs[0].status), uint(IRWIVault.RequestStatus.FULFILLED));

    ILocks.Lock memory lock = locks.getMemberLock(memberId, 0);
    assertEq(uint(lock.shares), assets);
    assertEq(uint(lock.period), lockPeriod);
    assertEq(vault.balanceOf(member), 0);
    assertEq(vault.balanceOf(address(locks)), assets);
  }

  function testFuzz_requestRedeem(
    uint96 depositAssetsRaw,
    uint96 redeemSharesRaw
  ) public {
    uint256 depositAssets = bound(uint256(depositAssetsRaw), 1e6, 1e12);

    vm.startPrank(member);
    asset.approve(address(vault), depositAssets);
    vault.requestDeposit(depositAssets, member, member);

    uint256 redeemShares = bound(uint256(redeemSharesRaw), 1, depositAssets);
    uint256 memberAssetsBeforeRedeem = asset.balanceOf(member);
    uint256 memberSharesBeforeRedeem = vault.balanceOf(member);

    vault.approve(address(vault), redeemShares);
    uint256 requestId = vault.requestRedeem(redeemShares, member, member);
    vm.stopPrank();

    vm.prank(vaultOperator);
    vault.fulfillRedeems(requestId, type(uint256).max);

    uint[] memory ids = new uint[](1);
    ids[0] = requestId;
    IRWIVault.RedeemRequestData[] memory reqs = vault.getRedeemRequests(ids);
    assertEq(uint(reqs[0].status), uint(IRWIVault.RequestStatus.FULFILLED));
    assertEq(vault.balanceOf(member), memberSharesBeforeRedeem - redeemShares);
    assertEq(asset.balanceOf(member), memberAssetsBeforeRedeem + redeemShares);
  }

  function testFuzz_depositLockRedeemFlow(
    uint96 lockAssetsRaw,
    uint96 liquidAssetsRaw,
    uint32 lockPeriodRaw,
    uint96 redeemSharesRaw
  ) public {
    uint256 lockAssets = bound(uint256(lockAssetsRaw), 1e4, 1e12);
    uint256 liquidAssets = bound(uint256(liquidAssetsRaw), 1e4, 1e12);
    uint256 lockPeriod = bound(uint256(lockPeriodRaw), MIN_LOCK_PERIOD, MAX_LOCK_PERIOD);

    uint256 memberAssetBefore = asset.balanceOf(member);
    uint256 totalDeposit = lockAssets + liquidAssets;

    vm.startPrank(member);
    asset.approve(address(vault), type(uint256).max);

    uint256 lockRequestId = vault.requestDepositAndLock(lockAssets, member, member, lockPeriod);
    uint256 liquidRequestId = vault.requestDeposit(liquidAssets, member, member);
    vm.stopPrank();

    // both requests should be auto fulfilled
    uint[] memory depositIds = new uint[](2);
    depositIds[0] = lockRequestId;
    depositIds[1] = liquidRequestId;
    IRWIVault.DepositRequestData[] memory depositRequests = vault.getDepositRequests(depositIds);
    assertEq(uint(depositRequests[0].status), uint(IRWIVault.RequestStatus.FULFILLED));
    assertEq(uint(depositRequests[1].status), uint(IRWIVault.RequestStatus.FULFILLED));

    uint256 memberId = registry.getMemberId(member);
    ILocks.Lock memory memberLock = locks.getMemberLock(memberId, 0);
    assertEq(uint256(memberLock.shares), lockAssets);
    assertEq(uint256(memberLock.period), lockPeriod);
    assertEq(vault.balanceOf(member), liquidAssets);
    assertEq(vault.balanceOf(address(locks)), lockAssets);
    assertEq(asset.balanceOf(member), memberAssetBefore - totalDeposit);

    vm.warp(block.timestamp + lockPeriod + 1);
    vm.startPrank(member);
    locks.withdrawShares(0);
    assertEq(vault.balanceOf(member), totalDeposit);
    assertEq(vault.balanceOf(address(locks)), 0);

    uint256 redeemShares = bound(uint256(redeemSharesRaw), 1, totalDeposit);
    uint256 memberAssetBeforeRedeem = asset.balanceOf(member);


    vault.approve(address(vault), redeemShares);
    uint256 redeemRequestId = vault.requestRedeem(redeemShares, member, member);
    vm.stopPrank();

    vm.prank(vaultOperator);
    vault.fulfillRedeems(redeemRequestId, type(uint256).max);
    uint256 redeemedAssets = vault.convertToAssets(redeemShares);

    uint[] memory redeemIds = new uint[](1);
    redeemIds[0] = redeemRequestId;
    IRWIVault.RedeemRequestData[] memory redeemRequests = vault.getRedeemRequests(redeemIds);
    assertEq(uint(redeemRequests[0].status), uint(IRWIVault.RequestStatus.FULFILLED));
    assertEq(vault.balanceOf(member), totalDeposit - redeemShares);
    assertEq(asset.balanceOf(member), memberAssetBeforeRedeem + redeemedAssets);
  }

  function testFuzz_pendingDeposits_canBeManuallyFulfilledByOperator(
    uint96 assets1Raw,
    uint96 assets2Raw
  ) public {
    uint256 assets1 = bound(uint256(assets1Raw), 1e6, 1e12);
    uint256 assets2 = bound(uint256(assets2Raw), 1e6, 1e12);
    uint256 totalAssets = assets1 + assets2;

    vm.prank(vaultOperator);
    vault.setAssetCap(1);

    uint256 memberAssetBefore = asset.balanceOf(member);
    uint256 memberSharesBefore = vault.balanceOf(member);

    vm.startPrank(member);
    asset.approve(address(vault), totalAssets);
    uint256 requestId1 = vault.requestDeposit(assets1, member, member);
    uint256 requestId2 = vault.requestDeposit(assets2, member, member);
    vm.stopPrank();

    uint[] memory ids = new uint[](2);
    ids[0] = requestId1;
    ids[1] = requestId2;
    IRWIVault.DepositRequestData[] memory reqsBeforeFulfill = vault.getDepositRequests(ids);
    assertEq(uint(reqsBeforeFulfill[0].status), uint(IRWIVault.RequestStatus.PENDING));
    assertEq(uint(reqsBeforeFulfill[1].status), uint(IRWIVault.RequestStatus.PENDING));
    assertEq(asset.balanceOf(member), memberAssetBefore - totalAssets);

    vm.startPrank(vaultOperator);
    vault.fulfillDeposit(requestId1, assets1);
    vault.fulfillDeposit(requestId2, assets2);
    vm.stopPrank();

    IRWIVault.DepositRequestData[] memory reqsAfterFulfill = vault.getDepositRequests(ids);
    assertEq(uint(reqsAfterFulfill[0].status), uint(IRWIVault.RequestStatus.FULFILLED));
    assertEq(uint(reqsAfterFulfill[1].status), uint(IRWIVault.RequestStatus.FULFILLED));
    assertEq(vault.balanceOf(member), memberSharesBefore + totalAssets);
    assertEq(asset.balanceOf(member), memberAssetBefore - totalAssets);
  }

  function testFuzz_redeemPartialFulfillment_thenCancelReturnsRemainingShares(
    uint96 depositAssetsRaw,
    uint16 fillBpsRaw
  ) public {
    uint256 depositAssets = bound(uint256(depositAssetsRaw), 1e6, 1e14);
    uint256 fillBps = bound(uint256(fillBpsRaw), 1, 9_999);

    vm.startPrank(member);
    asset.approve(address(vault), depositAssets);
    vault.requestDeposit(depositAssets, member, member);

    uint256 sharesBeforeRedeem = vault.balanceOf(member);
    assertEq(sharesBeforeRedeem, depositAssets);

    vault.approve(address(vault), sharesBeforeRedeem);
    uint256 redeemRequestId = vault.requestRedeem(sharesBeforeRedeem, member, member);
    vm.stopPrank();

    uint256 maxAssetsToFulfill = sharesBeforeRedeem * fillBps / 10_000;
    vm.assume(maxAssetsToFulfill > 0);
    
    vm.prank(vaultOperator);
    vault.fulfillRedeems(redeemRequestId, maxAssetsToFulfill);

    uint[] memory ids = new uint[](1);
    ids[0] = redeemRequestId;
    IRWIVault.RedeemRequestData[] memory reqsAfterFulfill = vault.getRedeemRequests(ids);
    assertEq(uint(reqsAfterFulfill[0].status), uint(IRWIVault.RequestStatus.PENDING));
    assertGt(uint(reqsAfterFulfill[0].fulfilledShares), 0);
    assertLt(uint(reqsAfterFulfill[0].fulfilledShares), sharesBeforeRedeem);

    uint256 memberSharesBeforeCancel = vault.balanceOf(member);
    vm.prank(member);
    vault.cancelRedeemRequest(redeemRequestId);

    IRWIVault.RedeemRequestData[] memory reqsAfterCancel = vault.getRedeemRequests(ids);
    assertEq(uint(reqsAfterCancel[0].status), uint(IRWIVault.RequestStatus.CANCELED));

    uint256 fulfilledShares = uint(reqsAfterCancel[0].fulfilledShares);
    uint256 expectedFinalShares = memberSharesBeforeCancel + (sharesBeforeRedeem - fulfilledShares);
    assertEq(vault.balanceOf(member), expectedFinalShares);
  }
}
