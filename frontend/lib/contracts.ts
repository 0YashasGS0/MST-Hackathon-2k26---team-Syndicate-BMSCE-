// Contract addresses + ABIs. Source of truth: deployments.md and
// contracts/out/DealEscrow.sol/DealEscrow.json (both owned by B1, not published yet).
import { parseAbi, type Abi, type Address } from "viem";

const addr = (v: string | undefined): Address | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined;

export const ESCROW_ADDRESS = addr(process.env.NEXT_PUBLIC_ESCROW_ADDRESS);
export const USD_ADDRESS = addr(process.env.NEXT_PUBLIC_USD_ADDRESS);

// The DealEscrow functions a party signs with their own wallet (contracts/src/DealEscrow.sol; the backend never
// signs these for users). `as const` keeps viem's function-name and argument types.
export const escrowAbi = parseAbi([
  "function acceptDeal(uint256 id, bytes32 sowHash)",
  "function markDelivered(uint256 id, bytes32 deliveryHash)",
  "function release(uint256 id)",
  "function raiseDispute(uint256 id, bytes32 evidenceHash)",
  "function acceptResolution(uint256 id)",
  "function escalate(uint256 id)",
  "function claimTimeout(uint256 id)",
]) satisfies Abi;
export const usdAbi = [] as const satisfies Abi;

export const USD_DECIMALS = 6;
