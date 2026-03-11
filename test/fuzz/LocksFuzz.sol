// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "forge-std/src/Test.sol";

import "./Setup.t.sol";

contract LocksFuzzTest is Setup {

  function testFuzz_locksSharesAndWithdraw(
    uint96 depositAssetsRaw,
    uint96 lockSharesRaw,
    uint32 lockPeriodRaw
  ) public {
    uint256 depositAssets = bound(uint256(depositAssetsRaw), 1e6, 1e12);
    uint256 lockPeriod = bound(uint256(lockPeriodRaw), MIN_LOCK_PERIOD, MAX_LOCK_PERIOD);

    vm.startPrank(member);
    asset.approve(address(vault), depositAssets);
    vault.requestDeposit(depositAssets, member, member);

    uint256 lockShares = bound(uint256(lockSharesRaw), 1, depositAssets);
    uint256 memberId = registry.getMemberId(member);

    vault.approve(address(locks), lockShares);
    locks.lockShares(lockShares, lockPeriod);

    ILocks.Lock memory lock = locks.getMemberLock(memberId, 0);
    assertEq(uint(lock.shares), lockShares);
    assertEq(uint(lock.period), lockPeriod);
    assertEq(vault.balanceOf(member), depositAssets - lockShares);
    assertEq(vault.balanceOf(address(locks)), lockShares);

    vm.warp(block.timestamp + lockPeriod + 1);
    locks.withdrawShares(0);

    assertEq(vault.balanceOf(member), depositAssets);
    assertEq(vault.balanceOf(address(locks)), 0);
  }

  function testFuzz_editLock(
    uint96 depositAssetsRaw,
    uint96 initialLockSharesRaw,
    uint96 topUpSharesRaw,
    uint32 initialPeriodRaw,
    uint32 extensionRaw
  ) public {
    uint256 depositAssets = bound(uint256(depositAssetsRaw), 1e6, 1e12);
    uint256 initialPeriod = bound(uint256(initialPeriodRaw), MIN_LOCK_PERIOD, MAX_LOCK_PERIOD);
    uint256 extension = bound(uint256(extensionRaw), 0, MAX_LOCK_PERIOD - initialPeriod);

    vm.startPrank(member);
    asset.approve(address(vault), depositAssets);
    vault.requestDeposit(depositAssets, member, member);

    uint256 initialLockShares = bound(uint256(initialLockSharesRaw), 1, depositAssets);
    uint256 availableForTopUp = depositAssets - initialLockShares;
    uint256 topUpShares = bound(uint256(topUpSharesRaw), 0, availableForTopUp);
    uint256 memberId = registry.getMemberId(member);

    vault.approve(address(locks), depositAssets);
    locks.lockShares(initialLockShares, initialPeriod);

    ILocks.Lock memory beforeEdit = locks.getMemberLock(memberId, 0);
    assertEq(uint(beforeEdit.shares), initialLockShares);
    assertEq(uint(beforeEdit.period), initialPeriod);

    locks.editLock(0, topUpShares, extension);

    ILocks.Lock memory afterEdit = locks.getMemberLock(memberId, 0);
    assertEq(uint(afterEdit.shares), initialLockShares + topUpShares);
    assertEq(uint(afterEdit.period), initialPeriod + extension);
    assertEq(vault.balanceOf(address(locks)), initialLockShares + topUpShares);
    assertEq(vault.balanceOf(member), depositAssets - initialLockShares - topUpShares);
  }
}
