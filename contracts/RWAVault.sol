// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IRWAVault.sol";

contract RWAVault is IRWAVault, ERC4626Upgradeable {

  uint constant public BPS = 100_00;
  uint constant public BASE_APY = 7_00;

  uint private vaultStartTimestamp;
  uint private assetCap;
  bool private paused;

  uint private totalDeposited;

  address immutable private vaultManager;
  address immutable private vaultContractAdmin;

  uint private redeemRequestNexId;
  uint private lastFulfilledRedeemRequestId;

  // todo: move to registry, refactor to member ids
  mapping(address => bool) private isMember; 

  mapping(uint => RedeemRequest) private redeemRequests;

  modifier onlyVaultManager() {
    require(msg.sender == vaultManager, OnlyVaultManager());
    _;
  }

  modifier onlyMember() {
    require(isMember[msg.sender], OnlyMember());
    _;
  }

  modifier NotPaused() {
    require(paused == false, VaultPaused());
    _;
  }

  // todo: only permissioned
  function initialize() external {
    vaultStartTimestamp = block.timestamp;
    redeemRequestNexId = 1;
  }

  function setAssetCap(uint newAssetCap) external onlyVaultManager {
    assetCap = newAssetCap;
  }

  function setPaused(bool newPaused) external onlyVaultManager {
    paused = newPaused;
  }

  // todo: move to registry
  function addMember(address member) external onlyVaultManager {
    isMember[member] = true;
  }

  function removeMember(address member) external onlyVaultManager {
    isMember[member] = false;
  }

  function maxDeposit(address) public view override returns (uint) {
    if (assetCap <= totalDeposited) return 0;
    return assetCap - totalDeposited;
  }

  function deposit(uint assets, address receiver) public override onlyMember NotPaused returns (uint) {
    uint maxAssets = maxDeposit(receiver);

    // todo: if larger than allowed cap, transfer to deposit request queue
    if (assets > maxAssets) {
      revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
    }

    uint shares = previewDeposit(assets);
    _deposit(_msgSender(), receiver, assets, shares);

    totalDeposited += assets;

    return shares;
  }

  function requestRedeem(uint shares, address controller, address owner) external onlyMember NotPaused returns (uint requestId) {
    require(balanceOf(owner) >= shares, InsufficientBalance());
    require(shares != 0, ZeroShares());

    requestId = redeemRequestNexId;

    SafeERC20.safeTransferFrom(this, owner, address(this), shares);

    redeemRequests[requestId] = RedeemRequest(owner, shares, false, false);

    emit RedeemRequested(controller, owner, requestId, msg.sender, shares);
    return requestId;
  }

  function fulfillRedeems(uint untilRequestId, uint maxTotalAssets) external onlyVaultManager {
    uint totalFulfilledAssets = 0;

    while(lastFulfilledRedeemRequestId < untilRequestId) {
      lastFulfilledRedeemRequestId++;
      RedeemRequest memory redeemRequest = redeemRequests[lastFulfilledRedeemRequestId];

      if (redeemRequest.canceled) continue;

       uint256 assets = previewRedeem(redeemRequest.shares);
      _withdraw(_msgSender(), redeemRequest.owner, redeemRequest.owner, assets, redeemRequest.shares);

      totalFulfilledAssets += assets;

      redeemRequest.fulfilled = true;
      redeemRequests[lastFulfilledRedeemRequestId] = redeemRequest;
    }

    require(totalFulfilledAssets <= maxTotalAssets, MaxAssetsExceeded());
  }

  function cancelRedeemRequest(uint requestId) onlyMember NotPaused external {
    RedeemRequest memory redeemRequest = redeemRequests[requestId];
    require(msg.sender == redeemRequest.owner || msg.sender == vaultManager, OnlyRequestOwner());

    redeemRequest.canceled = true;
    redeemRequests[requestId] = redeemRequest;
  }

  function redeem(uint256, address, address) public override pure returns (uint256) {
    revert MustUseRequestRedeem();
  }

  function _convertToShares(uint assets, Math.Rounding rounding) internal view override returns (uint) {
    uint timePassed = block.timestamp - vaultStartTimestamp;
    return Math.mulDiv(assets, BPS * 365 days, timePassed * BASE_APY, rounding);
  }

  function _convertToAssets(uint shares, Math.Rounding rounding) internal view override returns (uint) {
    uint timePassed = block.timestamp - vaultStartTimestamp;
    return Math.mulDiv(shares, timePassed * BASE_APY, BPS * 365 days, rounding);
  }
}