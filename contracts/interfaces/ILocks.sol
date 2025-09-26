// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface ILocks {
  struct Lock {
    uint96 shares;
    uint32 startTime;
    uint32 period;
  }

  function lockShares(uint shares, uint period) external;
  function lockSharesOnDeposit(uint shares, uint memberId, uint period) external;
  function editLock(uint lockId, uint topUpShares, uint period) external;
  function withdrawShares(uint lockId) external;
    function addReward(
    uint[] calldata memberIds, 
    uint[] calldata assetAmounts, 
    address asset,
    uint totalAssetAmount, 
    uint snapshotTimestamp
  ) external;

  event SharesLocked(uint indexed memberId, uint indexed lockId, uint shares, uint topUpShares, uint period);
  event SharesWithdrawn(uint indexed memberId, uint indexed lockId);
  event MemberRewarded(uint indexed memberId, uint amount);
  event RewardsAdded(address asset, uint totalAssetAmount, uint snapshotTimestamp);

  error InvalidPeriod();
  error NotExpired();
  error LockDoesntExist();
  error ArraysLengthMustBeEqual();
  error TotalAmountMustBeEqual();
  error InvalidLockId();
  error LockExpired();
}
