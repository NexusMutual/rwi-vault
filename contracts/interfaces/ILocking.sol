// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface ILocking {
  struct Lock {
    uint amount;
    uint32 startTime;
    uint32 period;
  }

  function lockShares(uint amount, uint period) external;
  function editLock(uint lockId, uint topUpAmount, uint period) external;
  function withdrawShares(uint lockId) external;
    function addReward(
    uint[] calldata memberIds, 
    uint[] calldata amounts, 
    address asset,
    uint totalAmount, 
    uint snapshotTimestamp
  ) external;

  event SharesLocked(uint indexed memberId, uint indexed lockId, uint amount, uint topUpAmount, uint period);
  event SharesWithdrawn(uint indexed memberId, uint indexed lockId);
  event MemberRewarded(uint indexed memberId, uint amount);
  event RewardsAdded(uint totalAmount, uint snapshotTimestamp);

  error InvalidPeriod();
  error NotExpired();
  error LockDoesntExist();
  error ArraysLengthMustBeEqual();
  error TotalAmountMustBeEqual();
}