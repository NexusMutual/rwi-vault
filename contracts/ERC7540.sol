// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./ERC20.sol";
import "./external/OpenZeppelin/Math.sol";
import "./interfaces/IERC7540.sol";

abstract contract ERC7540 is IERC7540, ERC20 {

  address immutable public asset;
  uint8 immutable public assetDecimals;
  uint immutable public ASSET_UNIT;

  constructor(address _asset, uint8 _assetDecimals) {
    asset = _asset;
    assetDecimals = _assetDecimals;
    ASSET_UNIT = 10 ** assetDecimals;
  }

  // ERC4626 functions

  function convertToShares(uint assets) public view virtual returns (uint) {
    return _convertToShares(assets, Math.Rounding.Floor);
  }

  function convertToAssets(uint shares) public view virtual returns (uint) {
    return _convertToAssets(shares, Math.Rounding.Floor);
  }

  function maxDeposit(address) public view virtual returns (uint) {
    return type(uint).max;
  }

  function maxMint(address) public view virtual returns (uint) {
    return type(uint).max;
  }

  function maxWithdraw(address owner) public view virtual returns (uint) {
    return _convertToAssets(balanceOf(owner), Math.Rounding.Floor);
  }

  function maxRedeem(address owner) public view virtual returns (uint) {
    return balanceOf(owner);
  }

  function previewDeposit(uint assets) public view virtual returns (uint) {
    return _convertToShares(assets, Math.Rounding.Floor);
  }

  function previewMint(uint shares) public view virtual returns (uint) {
    return _convertToAssets(shares, Math.Rounding.Ceil);
  }

  function previewWithdraw(uint assets) public view virtual returns (uint) {
    return _convertToShares(assets, Math.Rounding.Ceil);
  }

  function previewRedeem(uint shares) public view virtual returns (uint) {
    return _convertToAssets(shares, Math.Rounding.Floor);
  }

  function deposit(uint, address) public virtual override returns (uint) {
    revert NotSupported();
  }

  function mint(uint, address) public virtual override returns (uint) {
    revert NotSupported();
  }

  function withdraw(uint, address, address) public virtual returns (uint) {
    revert NotSupported();
  }

  function redeem(uint, address, address) public override pure returns (uint) {
    revert NotSupported();
  }

  function _convertToShares(uint assets, Math.Rounding rounding) internal view virtual returns (uint);

  function _convertToAssets(uint shares, Math.Rounding rounding) internal view virtual returns (uint);

  // ERC7540 functions
  function requestDeposit(uint assets, address controller, address owner) external virtual returns (uint requestId);

  function requestRedeem(uint shares, address controller, address owner) external virtual returns (uint requestId);

  function pendingDepositRequest(uint, address) external view virtual returns (uint) {
    revert NotSupported();
  }

  function pendingRedeemRequest(uint, address) external view virtual returns (uint) {
    revert NotSupported();
  }

  function claimableDepositRequest(uint, address) external view virtual returns (uint) {
    revert NotSupported();
  }

  function claimableRedeemRequest(uint, address) external view virtual returns (uint) {
    revert NotSupported();
  }

  function setOperator(address, bool) external virtual returns (bool) {
    revert NotSupported();
  }

  function isOperator(address, address) external view virtual returns (bool) {
    revert NotSupported();
  }
}
