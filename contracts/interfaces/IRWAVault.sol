// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IRWAVault {

  struct DepositRequestData {
    uint assets;
    uint fulfilledAssets;
    uint32 memberId;
    bool finished;
  }

  struct RedeemRequestData {
    uint shares;
    uint fulfilledShares;
    uint32 memberId;
    bool finished;
  }

  struct BaseApyConfig {
    uint assetsPerShare; // updated on actual change
    uint32 apy;
    uint32 activeFrom; // for new proposal it is in future, updated on actual change
  }

  function getBaseApy() external view returns(uint);

  // todo move to IERC4626
  event DepositRequest(
    address indexed controller, 
    address indexed owner,
    uint indexed requestId, 
    address sender,
    uint assets
  );
  event RedeemRequest(
    address indexed controller, 
    address indexed owner,
    uint indexed requestId, 
    address sender,
    uint shares
  );
  event DepositRequestCanceled(uint indexed requestId, address indexed sender);
  event RedeemRequestCanceled(uint indexed requestId, address indexed sender);
  event DepositFulfilled(uint indexed requestId, uint indexed memberId, address indexed memberAddress, uint amount);
  event RequestRedeemed(uint indexed requestId, uint indexed memberId, address indexed memberAddress, uint assets);

  event BaseApyChangeProposed(uint newBaseApy, uint activeFrom);
  event BaseApyChangeExecuted(uint newBaseApy, uint activeFrom, uint assetsPerShare);

  error OnlyRequestOwnerOrVaultManager();
  error InsufficientBalance();
  error ZeroShares();
  error MaxAssetsExceeded();
  error MustUseRequestRedeem();
  error AlreadyFinished();
  error RequestedAssetsExceeded();
  error ProposalActiveBeforePreviousOne();
  error ProposalDoesntExist();
  error ProposalNotActive();
  error InvalidRequestId();
  error OwnerNotSender();
  error ControllerNotSender();
}