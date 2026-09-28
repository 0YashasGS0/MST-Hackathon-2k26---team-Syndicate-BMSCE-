// Contract addresses + ABIs. Source of truth: deployments.md and
// contracts/out/DealEscrow.sol/DealEscrow.json (both owned by B1, not published yet).
import type { Abi, Address } from "viem";

const addr = (v: string | undefined): Address | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined;

export const ESCROW_ADDRESS = addr(process.env.NEXT_PUBLIC_ESCROW_ADDRESS);
export const USD_ADDRESS = addr(process.env.NEXT_PUBLIC_USD_ADDRESS);

// TODO(FE): paste the `abi` array from DealEscrow.json / MockUSD.json once B1 deploys.
// Keep it `as const` so viem infers function names and arg types.
export const escrowAbi = [] as const satisfies Abi;
export const usdAbi = [] as const satisfies Abi;

export const USD_DECIMALS = 6;
