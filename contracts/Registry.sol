// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "./interfaces/IRegistry.sol";
import "./RegistryAware.sol";
import "./UpgradeableProxy.sol";

contract Registry is IRegistry {

  // contracts
  mapping(uint index => Contract) internal contracts;
  mapping(address contractAddress => uint index) internal contractIndexes;

  // membership
  MembersMeta internal membersMeta; // 1 slot
  mapping(uint memberId => address member) internal members;
  mapping(address member => uint memberId) internal memberIds;

  // emergency pause
  mapping(address => bool) public isEmergencyAdmin;
  uint internal pauseConfig; 

  modifier onlyGovernor() {
    address governor = contracts[C_GOVERNOR].addr;
    require(msg.sender == governor, OnlyGovernor());
    _;
  }

  modifier onlyMembershipOperator() {
    address membershipOperator = contracts[A_MEMBERSHIP_OPERATOR].addr;
    require(msg.sender == membershipOperator, OnlyMembershipOperator());
    _;
  }

  modifier onlyEmergencyAdmin() {
    require(isEmergencyAdmin[msg.sender], OnlyEmergencyAdmin());
    _;
  }

  constructor(address governor) {
    _addContract(C_GOVERNOR, governor, false);
  }

  /* == EMERGENCY PAUSE == */

  function setEmergencyAdmin(address _emergencyAdmin, bool enabled) external onlyGovernor {
    isEmergencyAdmin[_emergencyAdmin] = enabled;
    emit EmergencyAdminSet(_emergencyAdmin, enabled);
  }

  function setPauseConfig(uint newPauseConfig) external onlyEmergencyAdmin {
    pauseConfig = newPauseConfig;
    emit PauseConfigSet(newPauseConfig, msg.sender);
  }

  function getPauseConfig() external view returns (uint config) {
    return pauseConfig;
  }

  function isPaused(uint mask) external view returns (bool) {
    return pauseConfig & mask != 0;
  }

  /* == MEMBERSHIP MANAGEMENT == */

  modifier whenNotPaused(uint mask) {
    uint maskWithGlobal = mask | PAUSE_GLOBAL;
    require(pauseConfig & maskWithGlobal == 0, Paused(pauseConfig, mask));
    _;
  }
  
  function isMember(address member) external view returns (bool) {
    return memberIds[member] != 0;
  }

  function getMemberId(address member) external view returns (uint) {
    return memberIds[member];
  }

  function getMemberAddress(uint memberId) external view returns (address) {
    return members[memberId];
  }

  function getMemberCount() external view returns (uint) {
    return membersMeta.memberCount;
  }

  function getLastMemberId() external view returns (uint) {
    return membersMeta.lastMemberId;
  }

  function addMember(address member) external onlyMembershipOperator {
    require(memberIds[member] == 0, AlreadyMember());

    uint memberId = ++membersMeta.lastMemberId;
    ++membersMeta.memberCount;
    memberIds[member] = memberId;
    members[memberId] = member;

    emit MembershipChanged(memberId, address(0), member);
  }

  function changeMemberAddress(address newAddress) external {
    uint memberId = memberIds[msg.sender];
    require(memberId != 0, NotMember());
    require(memberIds[newAddress] == 0, AlreadyMember());

    delete memberIds[msg.sender];
    memberIds[newAddress] = memberId;
    members[memberId] = newAddress;

    emit MembershipChanged(memberId, msg.sender, newAddress);
  }

  function removeMember(uint memberId) external {
    address member = members[memberId];
    require(member != address(0), NotMember());
    require(msg.sender == member || msg.sender == contracts[A_MEMBERSHIP_OPERATOR].addr, OnlyMemberOrOperator());

    delete members[memberId];
    delete memberIds[member];
    --membersMeta.memberCount;

    emit MembershipChanged(memberId, msg.sender, address(0));
  }

  /* == CONTRACT MANAGEMENT == */

  function isValidContractIndex(uint index) public pure returns (bool) {
    // cheap validation that only one bit is set (i.e. it's a power of two)
    unchecked { return index & (index - 1) == 0 && index > 0; }
  }

  function isProxyContract(uint index) external view returns (bool) {
    require(isValidContractIndex(index), InvalidContractIndex());
    Contract memory contractDetails = contracts[index];
    require(contractDetails.addr != address(0), ContractDoesNotExist());
    return contractDetails.isProxy;
  }

  function getContractAddressByIndex(uint index) external view returns (address payable) {
    require(isValidContractIndex(index), InvalidContractIndex());
    address addr = contracts[index].addr;
    require(addr != address(0), ContractDoesNotExist());
    return payable(addr);
  }

  function getContractIndexByAddress(address contractAddress) external view returns (uint) {
    require(contractAddress != address(0), InvalidContractAddress());
    uint idx = contractIndexes[contractAddress];
    require(idx != 0, ContractDoesNotExist());
    return idx;
  }

  function getContracts(uint[] memory indexes) external view returns (Contract[] memory _contracts) {
    _contracts = new Contract[](indexes.length);
    for (uint i = 0; i < indexes.length; i++) {
      require(isValidContractIndex(indexes[i]), InvalidContractIndex());
      _contracts[i] = contracts[indexes[i]];
    }
  }

  function deployContract(uint index, bytes32 salt, address implementation) external onlyGovernor {
    _deployContract(index, salt, implementation);
  }

  function _deployContract(uint index, bytes32 salt, address implementation) internal {
    require(isValidContractIndex(index), InvalidContractIndex());
    require(contracts[index].addr == address(0), ContractAlreadyExists());

    UpgradeableProxy proxy = new UpgradeableProxy{salt: bytes32(salt)}();
    proxy.upgradeTo(implementation);

    contracts[index] = Contract({ addr: address(proxy), isProxy: true });
    contractIndexes[address(proxy)] = index;

    emit ContractDeployed(index, address(proxy), implementation);
  }

  function upgradeContract(uint index, address implementation) external onlyGovernor {
    Contract memory _contract = contracts[index];
    require(_contract.addr != address(0), ContractDoesNotExist());
    require(_contract.isProxy, ContractIsNotProxy());

    UpgradeableProxy proxy = UpgradeableProxy(payable(_contract.addr));
    proxy.upgradeTo(implementation);

    emit ContractUpgraded(index, address(proxy), implementation);
  }

  function addContract(uint index, address contractAddress, bool isProxy) external onlyGovernor {
    _addContract(index, contractAddress, isProxy);
  }

  function _addContract(uint index, address contractAddress, bool isProxy) internal {
    require(isValidContractIndex(index), InvalidContractIndex());
    require(contractAddress != address(0), InvalidContractAddress());
    require(contracts[index].addr == address(0), ContractAlreadyExists());
    require(!isProxy || UpgradeableProxy(payable(contractAddress)).proxyOwner() == address(this), NotProxyOwner());

    contracts[index] = Contract({addr: contractAddress, isProxy: isProxy});
    contractIndexes[contractAddress] += index;

    emit ContractAdded(index, contractAddress, isProxy);
  }

  function removeContract(uint index) external onlyGovernor {
    Contract memory _contract = contracts[index];
    require(_contract.addr != address(0), ContractDoesNotExist());
    require(index != C_GOVERNOR, InvalidContractIndex());

    contractIndexes[_contract.addr] -= index;
    delete contracts[index];

    emit ContractRemoved(index, _contract.addr, _contract.isProxy);
  }
}
