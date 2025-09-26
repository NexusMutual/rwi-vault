// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./external/OpenZeppelin/SafeERC20.sol";
import "./external/OpenZeppelin/SafeCast.sol";

import "./interfaces/ILocks.sol";
import "./RegistryAware.sol";

contract Locks is ILocks, RegistryAware {
  using SafeERC20 for IERC20;
  using SafeCast for uint;

  uint constant public MIN_LOCK_PERIOD = 30 days;
  uint constant public MAX_LOCK_PERIOD = 730 days;

  mapping(uint memberId => Lock[]) private memberLocks;

  address immutable public vault;

  constructor(address _registry) RegistryAware(_registry) { 
    vault = fetch(C_VAULT);
  }

  function getMemberLock(uint memberId, uint lockId) external view returns (Lock memory) {
    return memberLocks[memberId][lockId];
  }

  function getAllMemberLocks(uint memberId) external view returns (Lock[] memory) {
    return memberLocks[memberId];
  }

  function lockShares(uint shares, uint period) external whenNotPaused(PAUSE_LOCKS) {
    uint memberId = getActiveMemberId(msg.sender);
    require(period >= MIN_LOCK_PERIOD && period <= MAX_LOCK_PERIOD, InvalidPeriod());

    IERC20(vault).safeTransferFrom(msg.sender, address(this), shares);

    memberLocks[memberId].push(Lock({
      shares: shares.toUint96(),
      startTime: block.timestamp.toUint32(),
      period: period.toUint32()
    }));

    emit SharesLocked(memberId, memberLocks[memberId].length - 1, shares, shares, period);
  }

  function lockSharesOnDeposit(uint shares, uint memberId, uint period) external only(C_VAULT) {
    memberLocks[memberId].push(Lock({
      shares: shares.toUint96(),
      startTime: block.timestamp.toUint32(),
      period: period.toUint32()
    }));

    emit SharesLocked(memberId, memberLocks[memberId].length - 1, shares, shares, period);
  }

  function editLock(uint lockId, uint topUpShares, uint period) external whenNotPaused(PAUSE_LOCKS) {
    uint memberId = getActiveMemberId(msg.sender);
    require(lockId < memberLocks[memberId].length, InvalidLockId());
    require(period >= MIN_LOCK_PERIOD && period <= MAX_LOCK_PERIOD, InvalidPeriod());
    
    IERC20(vault).safeTransferFrom(msg.sender, address(this), topUpShares);

    Lock memory lock = memberLocks[memberId][lockId];
    require(block.timestamp < lock.startTime + lock.period, LockExpired());

    lock.shares += topUpShares.toUint96();
    uint32 passedTime = block.timestamp.toUint32() - lock.startTime;
    lock.period = passedTime + period.toUint32();

    memberLocks[memberId][lockId] = lock;

    emit SharesLocked(memberId, lockId, lock.shares, topUpShares, period);
  }

  function withdrawShares(uint lockId) external whenNotPaused(PAUSE_LOCKS) {
    uint memberId = getActiveMemberId(msg.sender);
    Lock memory lock = memberLocks[memberId][lockId];

    require(lock.shares > 0, LockDoesntExist());
    require(block.timestamp >= lock.startTime + lock.period, NotExpired());

    delete memberLocks[memberId][lockId];

    IERC20(vault).safeTransfer(msg.sender, lock.shares);
    
    emit SharesWithdrawn(memberId, lockId);
  }

  function addReward(
    uint[] calldata memberIds, 
    uint[] calldata assetAmounts, 
    address asset,
    uint totalAssetAmounts, 
    uint snapshotTimestamp
  ) external only(A_VAULT_MANAGER) {
    require(memberIds.length == assetAmounts.length, ArraysLengthMustBeEqual());

    uint sumRewards = 0;
    for(uint i=0; i<memberIds.length; i++) {
      address member = registry.getMemberAddress(memberIds[i]);
      uint amount = assetAmounts[i];

      IERC20(asset).safeTransfer(member, amount);

      sumRewards += amount;

      emit MemberRewarded(memberIds[i], amount);
    }

    require(sumRewards == totalAssetAmounts, TotalAmountMustBeEqual());
    emit RewardsAdded(asset, totalAssetAmounts, snapshotTimestamp);
  }
}
