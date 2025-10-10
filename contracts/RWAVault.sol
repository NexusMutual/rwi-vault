// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./external/OpenZeppelin/Math.sol";
import "./external/OpenZeppelin/SafeERC20.sol";
import "./external/OpenZeppelin/SafeCast.sol";

import "./interfaces/IRWAVault.sol";
import "./interfaces/ILocks.sol";
import "./RegistryAware.sol";
import "./ERC7540.sol";

contract RWAVault is IRWAVault, ERC7540, RegistryAware {
  using SafeERC20 for IERC20;
  using SafeCast for uint;

  uint constant public BPS = 100_00;
  uint constant public MIN_APY_PROPOSAL_TIME = 90 days;

  uint public assetCap;
  uint private totalDeposited;

  uint private depositRequestNextId;
  uint private redeemRequestNextId;
  uint private lastFulfilledRedeemRequestId;

  mapping(uint depositRequestId => DepositRequestData) private depositRequests;
  mapping(uint redeemRequestId => RedeemRequestData) private redeemRequests;

  BaseApyConfig private apyConfig;

  constructor(address _registry, address _asset, uint8 _assetDecimals) RegistryAware(_registry) ERC7540(_asset, _assetDecimals) { 
  }

  function initialize(string memory _name, string memory _symbol, uint _baseApy) only(C_GOVERNOR) external {
    __ERC20_init(_name, _symbol);

    apyConfig = BaseApyConfig({
      startAssetsPerShare: ASSET_UNIT.toUint96(),
      apy: _baseApy.toUint16(),
      activeFrom: block.timestamp.toUint32(),
      proposedApy: 0,
      proposedActivationTime: 0
    });

    redeemRequestNextId = 1;
    depositRequestNextId = 1;
  }

  function decimals() external view override returns (uint8) {
    return assetDecimals;
  }

  function setAssetCap(uint newAssetCap) external only(A_VAULT_MANAGER) {
    assetCap = newAssetCap;
  }

  function getBaseApy() external view returns(uint) {
    return apyConfig.apy;
  }

  function getBaseApyConfig() external view returns(BaseApyConfig memory) {
    return apyConfig;
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

  function proposeBaseApyChange(uint proposalApy, uint proposalActivationTime) external only(A_VAULT_MANAGER) {
    require(proposalApy < BPS, InvalidApy());
    require(proposalActivationTime > block.timestamp + MIN_APY_PROPOSAL_TIME, ProposalActivationTimeTooSoon());
    
    apyConfig.proposedApy = proposalApy.toUint16(); 
    apyConfig.proposedActivationTime = proposalActivationTime.toUint32();

    emit BaseApyChangeProposed(proposalApy, proposalActivationTime);
  } 

  function executeBaseApyChange() external {
    require(apyConfig.proposedApy > 0, ProposalDoesntExist());
    require(apyConfig.proposedActivationTime <= block.timestamp, ProposalNotActive());

    BaseApyConfig memory config = apyConfig;

    config.startAssetsPerShare = convertToAssets(ASSET_UNIT).toUint96();
    config.apy = apyConfig.proposedApy;
    config.activeFrom = block.timestamp.toUint32();

    config.proposedApy = 0;
    config.proposedActivationTime = 0;

    apyConfig = config;

    emit BaseApyChangeExecuted(apyConfig.apy, apyConfig.activeFrom, apyConfig.startAssetsPerShare);
  }

  function requestDeposit(uint assets, address controller, address owner) external override(ERC7540, IERC7540) whenNotPaused(PAUSE_VAULT) returns (uint requestId) {
    return _requestDeposit(assets, controller, owner, 0);
  }

  function requestDepositAndLock(uint assets, address controller, address owner, uint lockPeriod) external whenNotPaused(PAUSE_VAULT) returns (uint requestId) {
    return _requestDeposit(assets, controller, owner, lockPeriod);
  }

  /// @dev lockPeriod is 0 if no lock is requested
  function _requestDeposit(uint assets, address controller, address owner, uint lockPeriod) internal returns (uint requestId) {
    require(owner == msg.sender, OwnerNotSender());
    require(controller == msg.sender, ControllerNotSender());
    uint memberId = getActiveMemberId(msg.sender);

    IERC20(asset).safeTransferFrom(owner, address(this), assets);

    requestId = depositRequestNextId++;

    depositRequests[requestId] = DepositRequestData({
      assets: assets.toUint96(),
      fulfilledAssets: 0,
      memberId: memberId.toUint32(),
      lockPeriod: lockPeriod.toUint32(),
      status: RequestStatus.PENDING
    });

    emit DepositRequest(controller, owner, requestId, msg.sender, assets);
    
    if (totalDeposited + assets <= assetCap) {
      _fulfillDeposit(requestId, assets);
    }
    
    return requestId;
  }

  function cancelDepositRequest(uint requestId) external whenNotPaused(PAUSE_VAULT) {
    DepositRequestData memory depositRequest = depositRequests[requestId];
    address memberAddress = registry.getMemberAddress(depositRequest.memberId);
    require(msg.sender == memberAddress|| msg.sender == fetch(A_VAULT_MANAGER), OnlyRequestOwnerOrVaultManager());
    require(depositRequest.status == RequestStatus.PENDING, RequestNotPending());

    depositRequest.status = RequestStatus.CANCELED;
    depositRequests[requestId] = depositRequest;

    // send assets back
    IERC20(asset).safeTransfer(memberAddress, depositRequest.assets - depositRequest.fulfilledAssets);

    emit DepositRequestCanceled(requestId, msg.sender);
  }

  function fulfillDeposit(uint requestId, uint amount) public only(A_VAULT_MANAGER) whenNotPaused(PAUSE_VAULT) {
    _fulfillDeposit(requestId, amount);
  } 

  function _fulfillDeposit(uint requestId, uint assets) internal {
    require(requestId < depositRequestNextId && requestId > 0, InvalidRequestId());
    DepositRequestData memory depositRequest = depositRequests[requestId];
    require(depositRequest.status == RequestStatus.PENDING, RequestNotPending());
    require(depositRequest.fulfilledAssets + assets <= depositRequest.assets, RequestedAssetsExceeded());

    address memberAddress = registry.getMemberAddress(depositRequest.memberId);

    uint shares = convertToShares(assets);

    depositRequest.fulfilledAssets += assets.toUint96();
    totalDeposited += assets;

    depositRequest.status = RequestStatus.FULFILLED;
    uint unfulfilledAssets = depositRequest.assets - depositRequest.fulfilledAssets;
    if (unfulfilledAssets > 0) {
      IERC20(asset).safeTransfer(memberAddress, unfulfilledAssets);
    } 

    depositRequests[requestId] = depositRequest;

    if (depositRequest.lockPeriod > 0) {
      address locks = fetch(C_LOCKS);
      // mint shares directly to locks contract
       _mint(locks, shares);
      ILocks(locks).lockSharesOnDeposit(shares, depositRequest.memberId, depositRequest.lockPeriod);
    } else {
      _mint(memberAddress, shares);
    }

    // send assets to the vault manager
    IERC20(asset).safeTransfer(fetch(A_VAULT_MANAGER), assets);

    emit DepositFulfilled(requestId, depositRequest.memberId, memberAddress, assets, shares);
    // for erc4626 compatibility
    emit Deposit(msg.sender, memberAddress, assets, shares);
  }

  function requestRedeem(uint shares, address controller, address owner) external override(ERC7540, IERC7540) whenNotPaused(PAUSE_VAULT) returns (uint requestId) {
    require(owner == msg.sender, OwnerNotSender());
    require(controller == msg.sender, ControllerNotSender());
    require(shares != 0, ZeroShares());
    uint memberId = getActiveMemberId(msg.sender);

    IERC20(address(this)).safeTransferFrom(owner, address(this), shares);

    requestId = redeemRequestNextId++;

    redeemRequests[requestId] = RedeemRequestData({
      shares: shares.toUint96(),
      fulfilledShares: 0,
      memberId: memberId.toUint32(),
      status: RequestStatus.PENDING
    });

    emit RedeemRequest(controller, owner, requestId, msg.sender, shares);
    return requestId;
  }

  function fulfillRedeems(uint untilRequestId, uint maxTotalAssets) external only(A_VAULT_MANAGER) whenNotPaused(PAUSE_VAULT) {
    require(untilRequestId < redeemRequestNextId, UntilRequestIdTooLarge());
    uint totalFulfilledAssets = 0;

    address vaultManager = fetch(A_VAULT_MANAGER);

    while(lastFulfilledRedeemRequestId < untilRequestId) {
      lastFulfilledRedeemRequestId++;
      RedeemRequestData memory redeemRequest = redeemRequests[lastFulfilledRedeemRequestId];

      if (redeemRequest.status != RequestStatus.PENDING) continue;

      uint256 assets = convertToAssets(redeemRequest.shares);
      address memberAddress = registry.getMemberAddress(redeemRequest.memberId);

      _burn(address(this), redeemRequest.shares);

      totalFulfilledAssets += assets;

      redeemRequest.fulfilledShares = redeemRequest.shares;
      redeemRequest.status = RequestStatus.FULFILLED;
      redeemRequests[lastFulfilledRedeemRequestId] = redeemRequest;

      IERC20(asset).safeTransferFrom(vaultManager, memberAddress, assets);

      emit RedeemFulfilled(lastFulfilledRedeemRequestId, redeemRequest.memberId, memberAddress, assets, redeemRequest.shares);
      // for erc4626 compatibility
      emit Withdraw(msg.sender, memberAddress, msg.sender, assets, redeemRequest.shares);
    }

    require(totalFulfilledAssets <= maxTotalAssets, MaxAssetsExceeded());

    // redeemed assets calculated with yeild can be larger than initial total deposit
    if(totalFulfilledAssets > totalDeposited) {
      totalDeposited = 0;
    } else {
      totalDeposited -= totalFulfilledAssets;
    }
  }

  function cancelRedeemRequest(uint requestId) external whenNotPaused(PAUSE_VAULT) {
    RedeemRequestData memory redeemRequest = redeemRequests[requestId];
    address memberAddress = registry.getMemberAddress(redeemRequest.memberId);
    require(msg.sender == memberAddress || msg.sender == fetch(A_VAULT_MANAGER), OnlyRequestOwnerOrVaultManager());
    require(redeemRequest.status == RequestStatus.PENDING, RequestNotPending());

    redeemRequest.status = RequestStatus.CANCELED;
    redeemRequests[requestId] = redeemRequest;

    // send shares back
    IERC20(this).safeTransfer(memberAddress, redeemRequest.shares);

    emit RedeemRequestCanceled(requestId, msg.sender);
  }

  function pendingDepositRequest(uint requestId, address) external view override(ERC7540, IERC7540) returns (uint assets) {
    DepositRequestData memory request = depositRequests[requestId];
    if (request.status != RequestStatus.PENDING) return 0;
    return request.assets;
  }

  function pendingRedeemRequest(uint requestId, address) external view override(ERC7540, IERC7540) returns (uint shares) {
    RedeemRequestData memory request = redeemRequests[requestId];
    if (request.status != RequestStatus.PENDING) return 0;
    return request.shares;
  }

  function _convertToShares(uint assets, Math.Rounding rounding) internal view override returns (uint) {
    return Math.mulDiv(assets, ASSET_UNIT, _getCurrentAssetsPerShare(), rounding);
  }

  function _convertToAssets(uint shares, Math.Rounding rounding) internal view override returns (uint) {
    return Math.mulDiv(shares, _getCurrentAssetsPerShare(), ASSET_UNIT, rounding);
  }

  function _getCurrentAssetsPerShare() internal view returns (uint) {
    BaseApyConfig memory baseApy = apyConfig;
    uint timePassed = block.timestamp - baseApy.activeFrom;
    uint gainPerShare = Math.mulDiv(baseApy.startAssetsPerShare, uint(baseApy.apy) * timePassed, BPS * 365 days);
    return baseApy.startAssetsPerShare + gainPerShare;
  }

  function totalAssets() public view override returns (uint256) {
    return convertToAssets(totalSupply());
  }
}
