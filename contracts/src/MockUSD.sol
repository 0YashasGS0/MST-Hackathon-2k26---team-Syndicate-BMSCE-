// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Testnet stablecoin (6 decimals, like tMUSD). Owner = on-ramp backend that mints after mock fiat payment.
///         Swap for Masterstroke's tMUSD if organizers provide minting access.
contract MockUSD is ERC20, Ownable {
    constructor() ERC20("Mock USD", "mUSD") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
