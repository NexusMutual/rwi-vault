// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.28;

import "./interfaces/IRegistry.sol";

// contract indexes
uint constant C_REGISTRY             = 1 << 0;  // 1
uint constant C_GOVERNOR             = 1 << 1;  // 2
uint constant C_VAULT                = 1 << 2;  // 4
uint constant C_LOCKS                = 1 << 3;  // 8
uint constant A_VAULT_MANAGER        = 1 << 4;  // 16
uint constant A_MEMBERSHIP_MANAGER   = 1 << 5;  // 32

uint constant PAUSE_GLOBAL        = 1 << 0;   // 1
uint constant PAUSE_VAULT         = 1 << 1;   // 2
uint constant PAUSE_LOCKS         = 1 << 2;   // 4

contract RegistryAware {

  IRegistry public immutable registry;

  error Paused(uint currentState, uint checks);
  error Unauthorized(address caller, uint callerIndex, uint authorizedBitmap);
  error OnlyMember();

  modifier whenNotPaused(uint mask) {
    uint config = registry.getPauseConfig();
    uint maskWithGlobal = mask | PAUSE_GLOBAL;
    require(config & maskWithGlobal == 0, Paused(config, mask));
    _;
  }

  modifier only(uint authorizedBitmap) {
    uint callerIndex = msg.sender == address(registry)
      ? C_REGISTRY
      : registry.getContractIndexByAddress(msg.sender);
    bool isAuthorized = callerIndex & authorizedBitmap != 0;
    require(isAuthorized, Unauthorized(msg.sender, callerIndex, authorizedBitmap));
    _;
  }

  modifier onlyMember() {
    require(registry.isMember(msg.sender), OnlyMember());
    _;
  }

  function getActiveMemberId(address member) internal view returns (uint) {
    uint memberId = registry.getMemberId(member);
    require(memberId != 0, OnlyMember());
    return memberId;
  }

  function fetch(uint index) internal view returns (address) {
    return registry.getContractAddressByIndex(index);
  }

  constructor(address _registry) {
    registry = IRegistry(_registry);
  }
}
