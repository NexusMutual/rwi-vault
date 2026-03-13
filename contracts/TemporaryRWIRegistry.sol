// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./RWIRegistry.sol";

contract TemporaryRWIRegistry is RWIRegistry {
  function transferGovernor(address newGovernor) external onlyGovernor {
    require(newGovernor != address(0), InvalidAddress());

    address currentGovernor = contracts[C_GOVERNOR].addr;

    contractIndexes[currentGovernor] -= C_GOVERNOR;
    contracts[C_GOVERNOR].addr = newGovernor;
    contractIndexes[newGovernor] += C_GOVERNOR;
  }
}
