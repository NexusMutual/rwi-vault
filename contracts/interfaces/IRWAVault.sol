// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IRWAVault {

  struct DepositRequest {
    address owner;
    uint256 assets;
    uint256 fulfilledAssets;
    bool finished;
  }

  struct RedeemRequest {
    address owner;
    uint256 shares;
    uint256 fulfilledShares;
    bool finished;
  }

  struct BaseApyConfig {
    uint32 apy;
    uint32 activeFrom; // for new proposal it is in future, updated on actual change
    uint assetsPerShare; // updated on actual change
  }

  event DepositRequested(
    address indexed owner, 
    uint256 indexed requestId, 
    uint256 assets
  );
  event RedeemRequested(
    address indexed owner, 
    uint256 indexed requestId, 
    uint256 shares
  );
  event BaseApyChangeProposed(uint newBaseApy, uint activeFrom);
  event BaseApyChangeExecuted(uint newBaseApy, uint activeFrom, uint assetsPerShare);

  error OnlyRequestOwner();
  error InsufficientBalance();
  error ZeroShares();
  error MaxAssetsExceeded();
  error MustUseRequestRedeem();
  error AlreadyFinished();
  error RequestedAssetsExceeded();
  error ProposalActiveBeforePreviousOne();
  error ProposalDoesntExist();
  error ProposalNotActive();
}