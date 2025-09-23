// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20UsdcMock is ERC20 {

  string internal _name;
  string internal _symbol;
  uint8 internal _decimals;

  constructor() ERC20("", "") {
    _name = "ERC20 USDC Mock";
    _symbol = "USDCMOCK";
    _decimals = 8;
  }

  function setMetadata(
    string memory name,
    string memory symbol,
    uint8 __decimals
  ) public {
    _name = name;
    _symbol = symbol;
    _decimals = __decimals;
  }

  function setName(string memory name) public {
    _name = name;
  }

  function setSymbol(string memory symbol) public {
    _symbol = symbol;
  }

  function setDecimals(uint8 __decimals) public {
    _decimals = __decimals;
  }

  function decimals() public view override returns (uint8) {
    return _decimals;
  }

  function mint(address account, uint amount) public {
    _mint(account, amount);
  }

  function burn(address account, uint amount) public {
    _burn(account, amount);
  }

  function setBalance(address account, uint amount) public {
    _burn(account, balanceOf(account));
    _mint(account, amount);
  }
}