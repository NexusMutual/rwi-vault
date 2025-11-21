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

  struct BaseApyConfig {
    uint96 startAssetsPerShare;
    uint16 apy;
    uint32 activeFrom;
    uint16 proposedApy;
    uint32 proposedActivationTime;
  }

  function getBaseApy() external view returns(uint);
  function getBaseApyConfig() external view returns(BaseApyConfig memory);
  function setAssetCap(uint newAssetCap) external;
  function getDepositRequests(uint[] calldata requestIds) external view returns(DepositRequestData[] memory);
  function getRedeemRequests(uint[] calldata requestIds) external view returns(RedeemRequestData[] memory);
  function proposeBaseApyChange(uint proposalApy, uint proposalActivationTime) external;
  function executeBaseApyChange() external;
  function requestDepositAndLock(uint assets, address controller, address owner, uint lockPeriod) external returns(uint requestId);
  function cancelDepositRequest(uint requestId) external;
  function fulfillDeposit(uint requestId, uint amount) external;
  function fulfillRedeems(uint maxRequestId, uint maxTotalAssets) external;
  function cancelRedeemRequest(uint requestId) external;

  event DepositRequestId(uint indexed requestId, uint indexed memberId);
  event RedeemRequestId(uint indexed requestId, uint indexed memberId);
  event DepositRequestCanceled(uint indexed requestId, uint indexed memberId, address indexed sender);
  event RedeemRequestCanceled(uint indexed requestId, uint indexed memberId, address indexed sender);
  event DepositFulfilled(uint indexed requestId, uint indexed memberId, address indexed memberAddress, uint assets, uint shares);
  event RedeemFulfilled(uint indexed requestId, uint indexed memberId, address indexed memberAddress, uint assets, uint shares);

  event BaseApyChangeProposed(uint newBaseApy, uint activeFrom);
  event BaseApyChangeExecuted(uint newBaseApy, uint activeFrom, uint assetsPerShare);

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
  error InvalidApy();
  error NoProposal();
  error ProposalActivationTimeTooSoon();
  error RequestNotPending();
  error MaxRequestIdTooLarge();
}
