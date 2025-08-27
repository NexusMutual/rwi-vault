// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IRWAVault.sol";
import "./RegistryAware.sol";

contract RWAVault is IRWAVault, ERC4626Upgradeable, RegistryAware {

  uint constant public BPS = 100_00;

  uint private assetCap;

  uint private totalDeposited;

  uint private depositRequestNextId;
  uint private redeemRequestNexId;
  uint private lastFulfilledRedeemRequestId;

  mapping(uint depositRequestId => DepositRequest) private depositRequests;
  mapping(uint redeemRequestId => RedeemRequest) private redeemRequests;

  BaseApyConfig[] private apyConfigs;
  uint private activeApyConfig;

  constructor(address _registry) RegistryAware(_registry) { }
  
  function initialize(address _asset, uint _baseApy) only(C_GOVERNOR) external {
    __ERC4626_init(IERC20(_asset));

    apyConfigs.push(BaseApyConfig({
      apy: uint32(_baseApy),
      activeFrom: uint32(block.timestamp),
      assetsPerShare: 10 ** decimals() // todo: is it 1:1 to begin with?
    }));
    activeApyConfig = 0;

    redeemRequestNexId = 1;
    depositRequestNextId = 1;
  }

  function setAssetCap(uint newAssetCap) external only(C_VAULT_MANAGER) {
    assetCap = newAssetCap;
  }

  /// @dev newBaseApy is in bips, check if we need to validate it
  function proposeBaseApyChange(uint newBaseApy, uint activeFrom) external only(C_VAULT_MANAGER) {
    uint lastActiveFrom = apyConfigs[apyConfigs.length - 1].activeFrom;
    require(activeFrom > lastActiveFrom, ProposalActiveBeforePreviousOne());
    
    apyConfigs.push(BaseApyConfig({
      apy: uint32(newBaseApy),
      activeFrom: uint32(activeFrom),
      assetsPerShare: 0
    }));

    emit BaseApyChangeProposed(newBaseApy, activeFrom);
  } 

  function executeBaseApyChange() external {
    require(activeApyConfig + 1 < apyConfigs.length, ProposalDoesntExist());
    BaseApyConfig memory nextConfig = apyConfigs[activeApyConfig + 1];

    require(nextConfig.activeFrom <= block.timestamp, ProposalNotActive());

    nextConfig.activeFrom = uint32(block.timestamp);
    nextConfig.assetsPerShare = convertToAssets(10 ** decimals());

    apyConfigs[activeApyConfig + 1] = nextConfig;
    activeApyConfig++;

    emit BaseApyChangeExecuted(nextConfig.apy, nextConfig.activeFrom, nextConfig.assetsPerShare);
  }

  // todo: handle controller and owner (controller == owner == msg.sender)
  function requestDeposit(uint assets, address /* controller */, address owner) external onlyMember whenNotPaused(PAUSE_GLOBAL) returns (uint256 requestId) {
    requestId = depositRequestNextId++;
    SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), assets);

    depositRequests[requestId] = DepositRequest(owner, assets, 0, false);

    emit DepositRequested(msg.sender, requestId, assets);
    
    if (totalDeposited + assets <= assetCap) {
      fulfillDeposit(requestId, assets, true);
    }
    
    return requestId;
  }

  function cancelDepositRequest(uint requestId) external whenNotPaused(PAUSE_GLOBAL) {
    DepositRequest memory depositRequest = depositRequests[requestId];
    require(msg.sender == depositRequest.owner || msg.sender == fetch(C_VAULT_MANAGER), OnlyRequestOwner());

    // send assets back
    SafeERC20.safeTransferFrom(IERC20(asset()), address(this), depositRequest.owner, depositRequest.assets);

    depositRequest.finished = true;
    depositRequests[requestId] = depositRequest;
  }

  function fulfillDeposit(uint requestId, uint amount, bool finishedRequest) public only(C_VAULT_MANAGER) whenNotPaused(PAUSE_GLOBAL) {
    _fulfillDeposit(requestId, amount, finishedRequest);
  } 

  // todo: use uniform names for amount/assets in the whole contract
  function _fulfillDeposit(uint requestId, uint amount, bool finishedRequest) internal {
    DepositRequest memory depositRequest = depositRequests[requestId];
    require(depositRequest.finished == false, AlreadyFinished());
    require(depositRequest.fulfilledAssets + amount <= depositRequest.assets, RequestedAssetsExceeded());

    uint shares = previewDeposit(amount);
    _mint(depositRequest.owner, shares);

    depositRequest.fulfilledAssets += amount;
    totalDeposited += amount;

    if (finishedRequest) {
      depositRequest.finished = true;
      uint unfulfilledAmount = depositRequest.assets - (depositRequest.fulfilledAssets + amount);
      if (unfulfilledAmount > 0) {
        SafeERC20.safeTransferFrom(IERC20(asset()), address(this),  depositRequest.owner, unfulfilledAmount);
      } 
    }

    depositRequests[requestId] = depositRequest;
  }

  // todo: handle controller and owner (controller == owner == msg.sender)
  function requestRedeem(uint shares, address /* controller */, address owner) external onlyMember whenNotPaused(PAUSE_GLOBAL) returns (uint requestId) {
    require(balanceOf(owner) >= shares, InsufficientBalance());
    require(shares != 0, ZeroShares());

    requestId = redeemRequestNexId++;

    SafeERC20.safeTransferFrom(this, owner, address(this), shares);

    redeemRequests[requestId] = RedeemRequest(owner, shares, 0, false);

    emit RedeemRequested(msg.sender, requestId, shares);
    return requestId;
  }

  function fulfillRedeems(uint untilRequestId, uint maxTotalAssets) external only(C_VAULT_MANAGER) whenNotPaused(PAUSE_GLOBAL) {
    uint totalFulfilledAssets = 0;

    while(lastFulfilledRedeemRequestId < untilRequestId) {
      lastFulfilledRedeemRequestId++;
      RedeemRequest memory redeemRequest = redeemRequests[lastFulfilledRedeemRequestId];

      if (redeemRequest.finished) continue;

       uint256 assets = previewRedeem(redeemRequest.shares);
      _withdraw(_msgSender(), redeemRequest.owner, redeemRequest.owner, assets, redeemRequest.shares);

      totalFulfilledAssets += assets;

      redeemRequest.fulfilledShares = redeemRequest.shares;
      redeemRequests[lastFulfilledRedeemRequestId] = redeemRequest;
    }

    require(totalFulfilledAssets <= maxTotalAssets, MaxAssetsExceeded());

    totalDeposited -= totalFulfilledAssets;
  }

  function cancelRedeemRequest(uint requestId) whenNotPaused(PAUSE_GLOBAL) external {
    RedeemRequest memory redeemRequest = redeemRequests[requestId];
    require(msg.sender == redeemRequest.owner || msg.sender == fetch(C_VAULT_MANAGER), OnlyRequestOwner());

    redeemRequest.finished = true;
    redeemRequests[requestId] = redeemRequest;
  }

  function redeem(uint256, address, address) public override pure returns (uint256) {
    revert MustUseRequestRedeem();
  }

  function _convertToShares(uint assets, Math.Rounding rounding) internal view override returns (uint) {
    BaseApyConfig memory baseApy = apyConfigs[activeApyConfig];

    uint timePassed = block.timestamp - baseApy.activeFrom;
    return Math.mulDiv(
      assets, 
      BPS * 365 days * 10 ** decimals(), 
      baseApy.assetsPerShare * timePassed * baseApy.apy, 
      rounding
    );
  }

  function _convertToAssets(uint shares, Math.Rounding rounding) internal view override returns (uint) {
    BaseApyConfig memory baseApy = apyConfigs[activeApyConfig];
    
    uint timePassed = block.timestamp - baseApy.activeFrom;
    return Math.mulDiv(
      shares, 
      baseApy.assetsPerShare * timePassed * baseApy.apy, 
      BPS * 365 days * 10 ** decimals(),
      rounding
    );
  }

  function totalAssets() public view override returns (uint256) {
    return totalDeposited; // todo: + in deposit queue?
  }
}