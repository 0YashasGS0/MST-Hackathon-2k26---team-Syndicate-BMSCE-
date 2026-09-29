// viem clients, per TEAM_ROADMAP.md §1 "Hour 1-3 step 2".
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import escrowAbiJson from "../abi/DealEscrow.json" with { type: "json" };
import usdAbiJson from "../abi/MockUSD.json" with { type: "json" };

export const escrowAbi = escrowAbiJson as any;
export const usdAbi = usdAbiJson as any;

export const mst = defineChain({
  id: Number(process.env.MST_CHAIN_ID ?? 91562037),
  name: "MST Testnet",
  nativeCurrency: { name: "MST", symbol: "MSTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.MST_RPC_URL ?? "https://testnetrpc.mstblockchain.com"],
      webSocket: [process.env.MST_WS_URL ?? "wss://testnetrpc.mstblockchain.com"],
    },
  },
});

export const pub = createPublicClient({ chain: mst, transport: webSocket() });

const walletFor = (key: string) =>
  createWalletClient({
    chain: mst,
    transport: http(),
    account: privateKeyToAccount(key as `0x${string}`),
  });

export const org = process.env.ORG_KEY ? walletFor(process.env.ORG_KEY) : undefined;
export const agent = process.env.AGENT_KEY ? walletFor(process.env.AGENT_KEY) : undefined;
export const arbitrator = process.env.ARBITRATOR_KEY
  ? walletFor(process.env.ARBITRATOR_KEY)
  : undefined;

export const ESCROW = (process.env.ESCROW_ADDRESS ?? "") as `0x${string}`;
export const USD = (process.env.USD_ADDRESS ?? "") as `0x${string}`;

/** Sign + send a contract write from a given system wallet, wait for the receipt. */
export async function sendContractTx(
  wallet: ReturnType<typeof walletFor>,
  args: {
    address: `0x${string}`;
    abi: any;
    functionName: string;
    args: any[];
  }
) {
  const hash = await wallet.writeContract({ ...args, chain: mst, account: wallet.account! });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}
