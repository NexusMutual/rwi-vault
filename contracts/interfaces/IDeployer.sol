// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IDeployer {
  function deploy(bytes memory code, uint256 salt) external;
  function deployAt(bytes memory code, uint256 salt, address expectedAddress) external;
}
