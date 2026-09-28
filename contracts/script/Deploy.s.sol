// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {DealEscrow} from "../src/DealEscrow.sol";

/// forge script script/Deploy.s.sol --rpc-url $MST_RPC_URL --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
    function run() external {
        address agent = vm.envAddress("AGENT_ADDRESS");
        address arbitrator = vm.envAddress("ARBITRATOR_ADDRESS");

        vm.startBroadcast();
        MockUSD usd = new MockUSD();
        DealEscrow escrow = new DealEscrow(usd, agent, arbitrator);
        // ORG (deployer) pre-approves escrow so fundFor() can pull on-ramped stablecoins
        usd.approve(address(escrow), type(uint256).max);
        vm.stopBroadcast();

        console.log("MockUSD   :", address(usd));
        console.log("DealEscrow:", address(escrow));
    }
}
