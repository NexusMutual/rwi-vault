// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "forge-std/src/Test.sol";

import "../../contracts/interfaces/ILocks.sol";
import "../../contracts/interfaces/IRWIVault.sol";
import "../../contracts/Locks.sol";
import { ERC20Mock } from "../../contracts/mock/ERC20Mock.sol";
import "../../contracts/RWIRegistry.sol";
import "../../contracts/RWIVault.sol";


contract Setup is Test {
  uint internal constant MIN_LOCK_PERIOD = 30 days;
  uint internal constant MAX_LOCK_PERIOD = 732 days;

  ERC20Mock internal asset;
  RWIRegistry internal registry;
  RWIVault internal vault;
  Locks internal locks;

  address internal vaultOperator;
  address internal membershipOperator;
  address internal member;

  function setUp() public {
    vaultOperator = makeAddr("vaultOperator");
    membershipOperator = makeAddr("membershipOperator");
    member = makeAddr("member");

    asset = new ERC20Mock("USDC Mock", "USDCM", 8);
    registry = new RWIRegistry();
    registry.initialize(address(this));
    registry.addContract(A_VAULT_OPERATOR, vaultOperator, false);
    registry.addContract(A_MEMBERSHIP_OPERATOR, membershipOperator, false);

    vault = new RWIVault(address(registry), address(asset), 8);
    registry.addContract(C_VAULT, address(vault), false);

    locks = new Locks(address(registry), address(vault));
    registry.addContract(C_LOCKS, address(locks), false);

    vault.initialize("RWI VAULT", "RWI", 1e18); // keep rate flat (1:1) for deterministic fuzz assertions
    vm.prank(vaultOperator);
    vault.setAssetCap(type(uint128).max);

    vm.prank(membershipOperator);
    registry.addMember(member);

    asset.mint(member, 1_000_000_000_000_000);
    asset.mint(vaultOperator, 1_000_000_000_000_000);
    vm.prank(vaultOperator);
    asset.approve(address(vault), type(uint256).max);
  }
}
