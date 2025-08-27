// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IUpgradeableProxy {

  event Upgraded(address indexed implementation);
  event ProxyOwnershipTransferred(address previousOwner, address newOwner);

  function proxyOwner() external view returns (address);

  function implementation() external view returns (address);

  function transferProxyOwnership(address _newOwner) external;

  function upgradeTo(address _newImplementation) external;

}
