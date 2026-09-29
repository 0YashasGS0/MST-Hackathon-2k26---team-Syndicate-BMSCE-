// MST testnet chain definition (TEAM_ROADMAP §0). Wallets are asked to switch to this chain.
import { defineChain } from "viem";

const rpcHttp = process.env.NEXT_PUBLIC_MST_RPC_URL ?? "https://testnetrpc.mstblockchain.com";
const rpcWs = process.env.NEXT_PUBLIC_MST_WS_URL ?? "wss://testnetrpc.mstblockchain.com";
// Testnet explorer URL is still an open question with mentors; override via env once confirmed.
export const EXPLORER_URL = (process.env.NEXT_PUBLIC_EXPLORER ?? "https://testnet.mstscan.com").replace(/\/$/, "");

export const mst = defineChain({
  id: 91562037,
  name: "MST Testnet",
  nativeCurrency: { name: "MST", symbol: "MSTC", decimals: 18 },
  rpcUrls: { default: { http: [rpcHttp], webSocket: [rpcWs] } },
  blockExplorers: { default: { name: "MST Explorer", url: EXPLORER_URL } },
  testnet: true,
});
