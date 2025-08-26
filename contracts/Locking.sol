// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ILocking.sol";
import "./RegistryAware.sol";

contract Locking is ILocking, RegistryAware {

  uint constant public MIN_LOCK_PERIOD = 30 days;
  uint constant public MAX_LOCK_PERIOD = 730 days;

  mapping(uint memberId => Lock[] lockIds) private memberLocks;

  address immutable public vault;

  constructor(address _registry) RegistryAware(_registry) { 
    vault = fetch(C_VAULT);
  }

  // function initialize() only(C_GOVERNOR) external { }

  function lockShares(uint amount, uint period) external onlyMember {
    require(period >= MIN_LOCK_PERIOD && period <= MAX_LOCK_PERIOD, InvalidPeriod());

    SafeERC20.safeTransferFrom(IERC20(vault), msg.sender, address(this), amount);

    uint memberId = registry.getMemberId(msg.sender);

    memberLocks[memberId].push(Lock({
      amount: amount,
      startTime: uint32(block.timestamp),
      period: uint32(period)
    }));

    emit SharesLocked(memberId, memberLocks[memberId].length - 1, amount, amount, period);
  }

  function editLock(uint lockId, uint topUpAmount, uint period) external onlyMember {
    require(period >= MIN_LOCK_PERIOD && period <= MAX_LOCK_PERIOD, InvalidPeriod());

    SafeERC20.safeTransferFrom(IERC20(vault), msg.sender, address(this), topUpAmount);

    uint memberId = registry.getMemberId(msg.sender);

    Lock memory lock = memberLocks[memberId][lockId];
    lock.amount += topUpAmount;
    lock.period += uint32(period);

    memberLocks[memberId][lockId] = lock;

    emit SharesLocked(memberId, lockId, lock.amount, topUpAmount, period);
  }

  function withdrawShares(uint lockId) external onlyMember {
    uint memberId = registry.getMemberId(msg.sender);
    Lock memory lock = memberLocks[memberId][lockId];

    require(lock.amount > 0, LockDoesntExist());
    require(block.timestamp >= lock.startTime + lock.period, NotExpired());

    delete memberLocks[memberId][lockId];

    SafeERC20.safeTransferFrom(IERC20(vault), address(this), msg.sender, lock.amount);
    
    emit SharesWithdrawn(memberId, lockId);
  }

  function addReward(
    uint[] calldata memberIds, 
    uint[] calldata amounts, 
    address asset,
    uint totalAmount, 
    uint snapshotTimestamp
  ) external only(C_VAULT_MANAGER) {
    require(memberIds.length == amounts.length, ArraysLengthMustBeEqual());

    uint sumRewards = 0;
    for(uint i=0; i<memberIds.length; i++) {
      address member = registry.getMemberAddress(memberIds[i]);
      uint amount = amounts[i];

      SafeERC20.safeTransferFrom(IERC20(asset), address(this), member, amount);

      sumRewards += amount;

      emit MemberRewarded(memberIds[i], amount);
    }

    require(sumRewards == totalAmount, TotalAmountMustBeEqual());
    emit RewardsAdded(totalAmount, snapshotTimestamp);
  }
}