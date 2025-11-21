// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./external/OpenZeppelin/Math.sol";
import "./external/OpenZeppelin/SafeERC20.sol";
import "./external/OpenZeppelin/SafeCast.sol";

import "./interfaces/IRWIVault.sol";
import "./interfaces/ILocks.sol";
import "./RegistryAware.sol";
import "./ERC7540.sol";

contract RWIVault is IRWIVault, ERC7540, RegistryAware {
  using SafeERC20 for IERC20;
  using SafeCast for uint;

  uint constant public BPS = 100_00;
  uint constant public MIN_APY_PROPOSAL_TIME = 90 days;

  uint public assetCap;

  uint private depositRequestNextId;
  uint private redeemRequestNextId;
  uint private redeemRequestNextFulfillId;

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
    redeemRequestNextFulfillId = 1;
  }

  function decimals() external view override returns (uint8) {
    return assetDecimals;
  }

  function setAssetCap(uint newAssetCap) external only(A_VAULT_OPERATOR) {
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

  function proposeBaseApyChange(uint proposalApy, uint proposalActivationTime) external only(A_VAULT_OPERATOR) {
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
    emit DepositRequestId(requestId, memberId);
    
    if (totalAssets() + assets <= assetCap) {
      _fulfillDeposit(requestId, assets);
    }
    
    return requestId;
  }

  function cancelDepositRequest(uint requestId) external whenNotPaused(PAUSE_VAULT) {
    DepositRequestData memory depositRequest = depositRequests[requestId];
    address memberAddress = registry.getMemberAddress(depositRequest.memberId);
    if (memberAddress == address(0)) {
      memberAddress = fetch(A_VAULT_OPERATOR);
    }
    
    require(msg.sender == memberAddress || msg.sender == fetch(A_VAULT_OPERATOR), OnlyRequestOwnerOrVaultOperator());
    require(depositRequest.status == RequestStatus.PENDING, RequestNotPending());

    depositRequest.status = RequestStatus.CANCELED;
    depositRequests[requestId] = depositRequest;

    // send assets back
    IERC20(asset).safeTransfer(memberAddress, depositRequest.assets - depositRequest.fulfilledAssets);

    emit DepositRequestCanceled(requestId, uint(depositRequest.memberId), msg.sender);
  }

  // todo: rename amount to assets
  function fulfillDeposit(uint requestId, uint amount) public only(A_VAULT_OPERATOR) whenNotPaused(PAUSE_VAULT) {
    _fulfillDeposit(requestId, amount);
  } 

  function _fulfillDeposit(uint requestId, uint assets) internal {
    require(requestId < depositRequestNextId && requestId > 0, InvalidRequestId());
    DepositRequestData memory depositRequest = depositRequests[requestId];
    require(depositRequest.status == RequestStatus.PENDING, RequestNotPending());
    require(depositRequest.fulfilledAssets + assets <= depositRequest.assets, RequestedAssetsExceeded());

    address memberAddress = registry.getMemberAddress(depositRequest.memberId); 
    if (memberAddress == address(0)) {
      memberAddress = fetch(A_VAULT_OPERATOR);
    }

    uint shares = convertToShares(assets);

    depositRequest.fulfilledAssets += assets.toUint96();

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

    // send assets to the vault operator
    IERC20(asset).safeTransfer(fetch(A_VAULT_OPERATOR), assets);

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
    emit RedeemRequestId(requestId, memberId);
    return requestId;
  }

  function fulfillRedeems(uint maxRequestId, uint maxTotalAssets) external only(A_VAULT_OPERATOR) whenNotPaused(PAUSE_VAULT) {
    require(maxRequestId < redeemRequestNextId, MaxRequestIdTooLarge());

    address vaultOperator = fetch(A_VAULT_OPERATOR);
    uint assetsLeft = maxTotalAssets;
    uint requestId;
    for(requestId = redeemRequestNextFulfillId; requestId <= maxRequestId; requestId++) {
      RedeemRequestData memory redeemRequest = redeemRequests[requestId];

      if (redeemRequest.status != RequestStatus.PENDING) continue;

      address memberAddress = registry.getMemberAddress(redeemRequest.memberId);
      if (memberAddress == address(0)) {
        memberAddress = vaultOperator;
      }

      uint shares = redeemRequest.shares - redeemRequest.fulfilledShares;
      uint assets = convertToAssets(shares);

      if (assets > assetsLeft) {
        // partially fulfill request and keep pending status, rounding down on both shares and assets
        shares = convertToShares(assetsLeft);
        assets = convertToAssets(shares);
        assetsLeft = 0;
      } else {
        redeemRequest.status = RequestStatus.FULFILLED;
        assetsLeft -= assets;
      }

      redeemRequest.fulfilledShares += shares.toUint96();
      redeemRequests[requestId] = redeemRequest;

      _burn(address(this), shares);
      IERC20(asset).safeTransferFrom(vaultOperator, memberAddress, assets);

      emit RedeemFulfilled(requestId, redeemRequest.memberId, memberAddress, assets, shares);
      // for erc4626 compatibility
      emit Withdraw(msg.sender, memberAddress, memberAddress, assets, shares);

      // break early to not update the requestId on partial fulfillment
      if (assetsLeft == 0) break;
    }

    redeemRequestNextFulfillId = requestId;
  }

  function cancelRedeemRequest(uint requestId) external whenNotPaused(PAUSE_VAULT) {
    RedeemRequestData memory redeemRequest = redeemRequests[requestId];
    address memberAddress = registry.getMemberAddress(redeemRequest.memberId);
    if (memberAddress == address(0)) {
      memberAddress = fetch(A_VAULT_OPERATOR);
    }
    
    require(msg.sender == memberAddress || msg.sender == fetch(A_VAULT_OPERATOR), OnlyRequestOwnerOrVaultOperator());
    require(redeemRequest.status == RequestStatus.PENDING, RequestNotPending());

    redeemRequest.status = RequestStatus.CANCELED;
    redeemRequests[requestId] = redeemRequest;

    // send shares back
    IERC20(this).safeTransfer(memberAddress, redeemRequest.shares - redeemRequest.fulfilledShares);

    emit RedeemRequestCanceled(requestId, uint(redeemRequest.memberId), msg.sender);
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

  function totalAssets() public view override returns (uint) {
    return convertToAssets(totalSupply());
  }
}
