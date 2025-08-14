// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IRWAVault {

  struct RedeemRequest {
    address owner;
    uint256 shares;
    bool canceled;
    bool fulfilled;
  }

  event RedeemRequested(
    address indexed controller, 
    address indexed owner, 
    uint256 indexed requestId, 
    address sender, 
    uint256 assets
  );

  error OnlyVaultManager();
  error OnlyMember();
  error VaultPaused();
  error OnlyRequestOwner();
  error InsufficientBalance();
  error ZeroShares();
  error MaxAssetsExceeded();
  error MustUseRequestRedeem();
}