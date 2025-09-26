// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "../external/OpenZeppelin/interfaces/IERC4626.sol";

interface IERC7540 is IERC4626 {
  function requestDeposit(uint assets, address controller, address owner) external returns (uint requestId);
  function requestRedeem(uint shares, address controller, address owner) external returns (uint requestId);
  function pendingDepositRequest(uint requestId, address controller) external view returns (uint pendingAssets);
  function pendingRedeemRequest(uint requestId, address controller) external view returns (uint pendingShares);
  function claimableDepositRequest(uint requestId, address controller) external view returns (uint claimableAssets);
  function claimableRedeemRequest(uint requestId, address controller) external view returns (uint claimableShares);
  function setOperator(address operator, bool approved) external returns (bool success);
  function isOperator(address controller, address operator) external view returns (bool status);

  event DepositRequest(address indexed controller, address indexed owner, uint indexed requestId, address sender, uint assets);
  event RedeemRequest( address indexed controller, address indexed owner, uint indexed requestId, address sender, uint shares);
  event OperatorSet(address indexed controller, address indexed operator, bool approved);

  error NotSupported();
}
