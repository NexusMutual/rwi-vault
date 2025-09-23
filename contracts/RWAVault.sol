// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./external/OpenZeppelin/ERC4626Upgradeable.sol";
import "./external/OpenZeppelin/Math.sol";

import "./interfaces/IRWAVault.sol";
import "./RegistryAware.sol";

contract RWAVault is IRWAVault, ERC4626Upgradeable, RegistryAware {

  uint constant public BPS = 100_00;

  uint public assetCap;

  uint private totalDeposited;

  uint private depositRequestNextId;
  uint private redeemRequestNexId;
  uint private lastFulfilledRedeemRequestId;

  mapping(uint depositRequestId => DepositRequestData) private depositRequests;
  mapping(uint redeemRequestId => RedeemRequestData) private redeemRequests;

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

  function setAssetCap(uint newAssetCap) external only(R_VAULT_MANAGER) {
    assetCap = newAssetCap;
  }

  function getBaseApy() external view returns(uint) {
    return apyConfigs[activeApyConfig].apy;
  }

  function getDepositRequests(uint[] calldata requestIds) external view returns(DepositRequestData[] memory) {
    DepositRequestData[] memory requests = new DepositRequestData[](requestIds.length);
    for (uint i = 0; i < requestIds.length; i++) {
      requests[i] = depositRequests[requestIds[i]];
    }
    return requests;
  }

  function getRedeemRequests(uint[] calldata requestIds) external view returns(RedeemRequestData[] memory) {
    RedeemRequestData[] memory requests = new RedeemRequestData[](requestIds.length);
    for (uint i = 0; i < requestIds.length; i++) {
      requests[i] = redeemRequests[requestIds[i]];
    }
    return requests;
  }

  /// @dev newBaseApy is in bips, check if we need to validate it
  function proposeBaseApyChange(uint newBaseApy, uint activeFrom) external only(R_VAULT_MANAGER) {
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

  function requestDeposit(uint assets, address controller, address owner) external whenNotPaused(PAUSE_GLOBAL) returns (uint256 requestId) {
    require(owner == msg.sender, OwnerNotSender());
    require(controller == msg.sender, ControllerNotSender());
    uint memberId = validateMemberGetId(msg.sender);

    requestId = depositRequestNextId++;

    SafeERC20.safeTransferFrom(IERC20(asset()), owner, address(this), assets);

    depositRequests[requestId] = DepositRequestData(assets, 0, uint32(memberId), false);

    emit DepositRequest(controller, owner, requestId, msg.sender, assets);
    
    if (totalDeposited + assets <= assetCap) {
      _fulfillDeposit(requestId, assets, true);
    }
    
    return requestId;
  }

  function cancelDepositRequest(uint requestId) external whenNotPaused(PAUSE_GLOBAL) {
    DepositRequestData memory depositRequest = depositRequests[requestId];
    address memberAddress = registry.getMemberAddress(depositRequest.memberId);
    require(msg.sender == memberAddress|| msg.sender == fetch(R_VAULT_MANAGER), OnlyRequestOwnerOrVaultManager());

    // send assets back
    SafeERC20.safeTransfer(IERC20(asset()), memberAddress, depositRequest.assets);

    depositRequest.finished = true;
    depositRequests[requestId] = depositRequest;

    emit DepositRequestCanceled(requestId, msg.sender);
  }

  function fulfillDeposit(uint requestId, uint amount, bool finishedRequest) public only(R_VAULT_MANAGER) whenNotPaused(PAUSE_GLOBAL) {
    _fulfillDeposit(requestId, amount, finishedRequest);
  } 

  // todo: use uniform names for amount/assets in the whole contract
  function _fulfillDeposit(uint requestId, uint amount, bool finishedRequest) internal {
    require(requestId < depositRequestNextId && requestId > 0, InvalidRequestId());
    DepositRequestData memory depositRequest = depositRequests[requestId];
    require(depositRequest.finished == false, AlreadyFinished());
    require(depositRequest.fulfilledAssets + amount <= depositRequest.assets, RequestedAssetsExceeded());

    address memberAddress = registry.getMemberAddress(depositRequest.memberId);

    uint shares = previewDeposit(amount);
    _mint(memberAddress, shares);

    depositRequest.fulfilledAssets += amount;
    totalDeposited += amount;

    SafeERC20.safeTransfer(IERC20(asset()), fetch(R_VAULT_MANAGER), amount);

    if (finishedRequest) {
      depositRequest.finished = true;
      uint unfulfilledAmount = depositRequest.assets - depositRequest.fulfilledAssets;
      if (unfulfilledAmount > 0) {
        SafeERC20.safeTransfer(IERC20(asset()), memberAddress, unfulfilledAmount);
      } 
    }

    depositRequests[requestId] = depositRequest;

    emit DepositFulfilled(requestId, depositRequest.memberId, memberAddress, amount);
  }

  // todo: handle controller and owner (controller == owner == msg.sender)
  function requestRedeem(uint shares, address controller, address owner) external onlyMember whenNotPaused(PAUSE_GLOBAL) returns (uint requestId) {
    require(owner == msg.sender, OwnerNotSender());
    require(controller == msg.sender, ControllerNotSender());
    require(shares != 0, ZeroShares());
    uint memberId = validateMemberGetId(msg.sender);

    requestId = redeemRequestNexId++;

    SafeERC20.safeTransferFrom(this, owner, address(this), shares);

    redeemRequests[requestId] = RedeemRequestData(shares, 0, uint32(memberId), false);

    emit RedeemRequest(controller, owner, requestId, msg.sender, shares);
    return requestId;
  }

  function fulfillRedeems(uint untilRequestId, uint maxTotalAssets) external only(R_VAULT_MANAGER) whenNotPaused(PAUSE_GLOBAL) {
    uint totalFulfilledAssets = 0;

    while(lastFulfilledRedeemRequestId < untilRequestId) {
      lastFulfilledRedeemRequestId++;
      RedeemRequestData memory redeemRequest = redeemRequests[lastFulfilledRedeemRequestId];

      if (redeemRequest.finished) continue;

      uint256 assets = previewRedeem(redeemRequest.shares);
      address memberAddress = registry.getMemberAddress(redeemRequest.memberId);

      _withdraw(msg.sender, memberAddress, memberAddress, assets, redeemRequest.shares);

      totalFulfilledAssets += assets;

      redeemRequest.fulfilledShares = redeemRequest.shares;
      redeemRequests[lastFulfilledRedeemRequestId] = redeemRequest;

      emit RequestRedeemed(lastFulfilledRedeemRequestId, redeemRequest.memberId, memberAddress, assets);
    }

    require(totalFulfilledAssets <= maxTotalAssets, MaxAssetsExceeded());

    totalDeposited -= totalFulfilledAssets;
  }

  function cancelRedeemRequest(uint requestId) whenNotPaused(PAUSE_GLOBAL) external {
    RedeemRequestData memory redeemRequest = redeemRequests[requestId];
    address memberAddress = registry.getMemberAddress(redeemRequest.memberId);
    require(msg.sender == memberAddress || msg.sender == fetch(R_VAULT_MANAGER), OnlyRequestOwnerOrVaultManager());

    redeemRequest.finished = true;
    redeemRequests[requestId] = redeemRequest;

    emit RedeemRequestCanceled(requestId, msg.sender);
  }

  function redeem(uint256, address, address) public override pure returns (uint256) {
    revert MustUseRequestRedeem();
  }

  function _convertToShares(uint assets, Math.Rounding rounding) internal view override returns (uint) {
    return Math.mulDiv(assets, 10 ** decimals(), _getCurrentAssetsPerShare(), rounding);
  }

  function _convertToAssets(uint shares, Math.Rounding rounding) internal view override returns (uint) {
    return Math.mulDiv(shares, _getCurrentAssetsPerShare(), 10 ** decimals(), rounding);
  }

  function _getCurrentAssetsPerShare() internal view returns (uint) {
    BaseApyConfig memory baseApy = apyConfigs[activeApyConfig];
    uint timePassed = block.timestamp - baseApy.activeFrom;
    uint gainPerShare = Math.mulDiv(baseApy.assetsPerShare, baseApy.apy * timePassed, BPS * 365 days);
    return baseApy.assetsPerShare + gainPerShare;
  }

  function totalAssets() public view override returns (uint256) {
    return totalDeposited; // todo: + in deposit queue?
  }
}