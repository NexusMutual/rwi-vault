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

  error OnlyRequestOwner();
  error InsufficientBalance();
  error ZeroShares();
  error MaxAssetsExceeded();
  error MustUseRequestRedeem();
  error AlreadyFinished();
  error RequestedAssetsExceeded();
}