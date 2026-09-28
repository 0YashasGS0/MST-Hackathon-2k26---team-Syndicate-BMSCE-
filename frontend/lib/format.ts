import { formatUnits, type Hex } from "viem";
import { EXPLORER_URL } from "./chain";
import { USD_DECIMALS } from "./contracts";

export const txUrl = (h: Hex | string) => `${EXPLORER_URL}/tx/${h}`;
export const addressUrl = (a: string) => `${EXPLORER_URL}/address/${a}`;

/** Base units (6 decimals) → human string, e.g. 100000000n → "100". */
export const fmtUsd = (x: bigint | string) => formatUnits(BigInt(x), USD_DECIMALS);

/** basis points → "35%" / "35.5%". */
export const fmtBps = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

export const shortHex = (h: string, n = 4) => (h.length > 2 + 2 * n ? `${h.slice(0, 2 + n)}…${h.slice(-n)}` : h);
