// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./IERC7540.sol";

interface IRWIVault is IERC7540 {

  enum RequestStatus { 
    PENDING,
    FULFILLED,
    CANCELED
  }

  struct DepositRequestData {
    uint96 assets;
    uint96 fulfilledAssets;
    uint32 memberId;
    uint32 lockPeriod;
    RequestStatus status;
  }

  struct RedeemRequestData {
    uint96 shares;
    uint96 fulfilledShares;
    uint32 memberId;
    RequestStatus status;
  }

  struct BaseRateConfig {
    uint64 startRate;
    uint64 ratePerSecond; // in WAD
    uint32 activeFrom;
    uint64 proposedRate;
    uint32 proposedActivationTime;
  }

  function getBaseApy() external view returns(uint);
  function getRatePerSecond() external view returns(uint);
  function getBaseRateConfig() external view returns(BaseRateConfig memory);
  function setAssetCap(uint newAssetCap) external;
  function getDepositRequests(uint[] calldata requestIds) external view returns(DepositRequestData[] memory);
  function getRedeemRequests(uint[] calldata requestIds) external view returns(RedeemRequestData[] memory);
  function proposeBaseRateChange(uint proposalRate, uint proposalActivationTime) external;
  function executeBaseRateChange() external;
  function requestDepositAndLock(uint assets, address controller, address owner, uint lockPeriod) external returns(uint requestId);
  function cancelDepositRequest(uint requestId) external;
  function fulfillDeposit(uint requestId, uint assets) external;
  function fulfillRedeems(uint maxRequestId, uint maxTotalAssets) external;
  function cancelRedeemRequest(uint requestId) external;

  event DepositRequested(uint indexed requestId, uint indexed memberId, uint assets);
  event RedeemRequested(uint indexed requestId, uint indexed memberId, uint shares);
  event DepositRequestCanceled(uint indexed requestId, uint indexed memberId, address indexed sender);
  event RedeemRequestCanceled(uint indexed requestId, uint indexed memberId, address indexed sender);
  event DepositFulfilled(uint indexed requestId, uint indexed memberId, address indexed memberAddress, uint assets, uint shares);
  event RedeemFulfilled(uint indexed requestId, uint indexed memberId, address indexed memberAddress, uint assets, uint shares);

  event BaseRateChangeProposed(uint newBaseRate, uint proposalActivationTime);
  event BaseRateChangeExecuted(uint newBaseRate, uint activeFrom, uint startRate);

  error OnlyRequestOwnerOrVaultOperator();
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
  error InvalidRate();
  error NoProposal();
  error ProposalActivationTimeTooSoon();
  error RequestNotPending();
  error MaxRequestIdTooLarge();
  error AlreadyInitialized();
}
