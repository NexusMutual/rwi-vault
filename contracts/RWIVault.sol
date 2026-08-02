// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./ERC7540.sol";
import "./external/OpenZeppelin/Math.sol";
import "./external/OpenZeppelin/SafeCast.sol";
import "./external/OpenZeppelin/SafeERC20.sol";
import "./external/solady/FixedPointMathLib.sol";

import "./interfaces/ILocks.sol";
import "./interfaces/IRWIVault.sol";
import "./RegistryAware.sol";

contract RWIVault is IRWIVault, ERC7540, RegistryAware {
  using SafeERC20 for IERC20;
  using SafeCast for uint;

  uint constant public MIN_RATE_PROPOSAL_TIME = 90 days;
  uint constant public WAD = 1e18;
  uint constant public MAX_APY = 1.5e18;

  uint public assetCap;

  uint private depositRequestNextId;
  uint private redeemRequestNextId;
  uint private redeemRequestNextFulfillId;

  mapping(uint depositRequestId => DepositRequestData) private depositRequests;
  mapping(uint redeemRequestId => RedeemRequestData) private redeemRequests;

  BaseRateConfig private rateConfig;

  constructor(address _registry, address _asset, uint8 _assetDecimals) RegistryAware(_registry) ERC7540(_asset, _assetDecimals) { 
  }

  function initialize(string memory _name, string memory _symbol, uint _baseRate) only(C_GOVERNOR) external {
    require(rateConfig.activeFrom == 0, AlreadyInitialized());

    __ERC20_init(_name, _symbol);

    rateConfig = BaseRateConfig({
      startRate: WAD.toUint64(),
      ratePerSecond: _baseRate.toUint64(),
      activeFrom: block.timestamp.toUint32(),
      proposedRate: 0,
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
    return FixedPointMathLib.wadPow(uint(rateConfig.ratePerSecond), 365 days);
  }

  function getRatePerSecond() external view returns(uint) {
    return rateConfig.ratePerSecond;
  }

  function getBaseRateConfig() external view returns(BaseRateConfig memory) {
    return rateConfig;
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

  function proposeBaseRateChange(uint proposalRate, uint proposalActivationTime) external only(A_VAULT_OPERATOR) {
    require(proposalActivationTime > block.timestamp + MIN_RATE_PROPOSAL_TIME, ProposalActivationTimeTooSoon());

    uint proposedApy = FixedPointMathLib.wadPow(uint(proposalRate), 365 days);
    require(proposalRate >= WAD && proposedApy <= MAX_APY, InvalidRate());
    
    rateConfig.proposedRate = proposalRate.toUint64(); 
    rateConfig.proposedActivationTime = proposalActivationTime.toUint32();

    emit BaseRateChangeProposed(proposalRate, proposalActivationTime);
  } 

  function executeBaseRateChange() external {
    require(rateConfig.proposedRate > 0, ProposalDoesntExist());
    require(rateConfig.proposedActivationTime <= block.timestamp, ProposalNotActive());

    BaseRateConfig memory config = rateConfig;

    config.startRate = _getCurrentRate().toUint64();
    config.ratePerSecond = rateConfig.proposedRate;
    config.activeFrom = block.timestamp.toUint32();

    config.proposedRate = 0;
    config.proposedActivationTime = 0;

    rateConfig = config;

    emit BaseRateChangeExecuted(rateConfig.ratePerSecond, rateConfig.activeFrom, rateConfig.startRate);
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
    emit DepositRequested(requestId, memberId, assets);
    
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

  function fulfillDeposit(uint requestId, uint assets) public only(A_VAULT_OPERATOR) whenNotPaused(PAUSE_VAULT) {
    _fulfillDeposit(requestId, assets);
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
    emit RedeemRequested(requestId, memberId, shares);
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
    return Math.mulDiv(assets, WAD, _getCurrentRate(), rounding);
  }

  function _convertToAssets(uint shares, Math.Rounding rounding) internal view override returns (uint) {
    return Math.mulDiv(shares, _getCurrentRate(), WAD, rounding);
  }

  function _getCurrentRate() internal view returns (uint) {
    BaseRateConfig memory baseRate = rateConfig;
    uint timePassed = block.timestamp - baseRate.activeFrom;

    // rate = startRate * (ratePerSecond ^ timePassed)
    uint rate = Math.mulDiv(
      baseRate.startRate, 
      FixedPointMathLib.wadPow(uint(baseRate.ratePerSecond), timePassed), 
      WAD, 
      Math.Rounding.Floor
    );

    return rate;
  }

  function totalAssets() public view override returns (uint) {
    return convertToAssets(totalSupply());
  }
}
