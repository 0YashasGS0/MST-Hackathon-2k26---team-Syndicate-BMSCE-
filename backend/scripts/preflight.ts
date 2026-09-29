// Go-live check. Run on the deploy host with the production backend/.env (read-only: sends no transactions):
//   npm run preflight
// 1. the production config guard (same rules the server enforces at start),
// 2. the RPC is MST testnet and both contracts exist,
// 3. the contracts' roles match the configured system wallets and ORG approved the escrow,
// 4. the system wallets have gas, 5. the data directory is writable.
// Prints addresses only, never keys. Exit code 1 if anything must be fixed.
import "dotenv/config";
import { accessSync, constants, mkdirSync } from "node:fs";
import path from "node:path";
import { createPublicClient, formatEther, getAddress, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { configProblems } from "../src/security";
import escrowAbi from "../abi/DealEscrow.json" with { type: "json" };
import usdAbi from "../abi/MockUSD.json" with { type: "json" };

const env = process.env;
const MIN_GAS = 10n ** 17n; // 0.1 tMSTC
let failed = 0;
const ok = (msg: string) => console.log(`  ok    ${msg}`);
const fail = (msg: string) => (failed++, console.log(`  FAIL  ${msg}`));
const warn = (msg: string) => console.log(`  warn  ${msg}`);

function addressOf(name: string): Address | undefined {
  try {
    return privateKeyToAccount(env[name] as `0x${string}`).address;
  } catch {
    return undefined;
  }
}

async function main() {
  console.log("1. Production config");
  if (env.NODE_ENV !== "production") warn("NODE_ENV is not production here; checking as production (docker-compose sets it)");
  const problems = configProblems({ ...env, NODE_ENV: "production" });
  for (const p of problems) fail(p);
  if (!problems.length) ok("secrets, CORS, auth, contracts, keys and LLM configured");

  console.log("2. Chain");
  const rpc = env.MST_RPC_URL ?? "https://testnetrpc.mstblockchain.com";
  const pub = createPublicClient({ transport: http(rpc, { timeout: 15_000 }) });
  const wantChain = Number(env.MST_CHAIN_ID ?? 91562037);
  let chainId: number;
  try {
    chainId = await pub.getChainId();
  } catch (e) {
    fail(`RPC ${rpc} unreachable: ${(e as Error).message.split("\n")[0]}`);
    return;
  }
  if (chainId === wantChain) ok(`RPC ${rpc} is chain ${chainId}`);
  else return void fail(`RPC ${rpc} is chain ${chainId}, expected ${wantChain}`);

  const escrow = /^0x[0-9a-fA-F]{40}$/.test(env.ESCROW_ADDRESS ?? "") ? getAddress(env.ESCROW_ADDRESS!) : undefined;
  const usd = /^0x[0-9a-fA-F]{40}$/.test(env.USD_ADDRESS ?? "") ? getAddress(env.USD_ADDRESS!) : undefined;
  if (!escrow || !usd) return void fail("ESCROW_ADDRESS / USD_ADDRESS not set; deploy first (contracts/deploy.js)");
  for (const [name, a] of [["DealEscrow", escrow], ["MockUSD", usd]] as const) {
    const code = await pub.getCode({ address: a });
    if (code && code !== "0x") ok(`${name} has code at ${a}`);
    else fail(`no contract at ${name} address ${a} on this chain`);
  }
  if (failed) return;
  const head = await pub.getBlockNumber();
  const deployBlock = BigInt(env.DEPLOY_BLOCK ?? "0");
  if (deployBlock > head) fail(`DEPLOY_BLOCK ${deployBlock} is after the current block ${head}`);
  else if (deployBlock === 0n) warn("DEPLOY_BLOCK=0: the indexer will scan from genesis");
  else ok(`DEPLOY_BLOCK ${deployBlock} (head ${head})`);

  console.log("3. Roles");
  const org = addressOf("ORG_KEY");
  const agent = addressOf("AGENT_KEY");
  const arbitrator = addressOf("ARBITRATOR_KEY");
  const read = (address: Address, abi: unknown, functionName: string, args: unknown[] = []) =>
    pub.readContract({ address, abi: abi as never, functionName, args } as never) as Promise<unknown>;
  const same = (label: string, got: unknown, want: Address | undefined, keyVar: string) => {
    if (!want) return fail(`${keyVar} is not a valid key, can't compare with ${label}`);
    if (String(got).toLowerCase() === want.toLowerCase()) ok(`${label} = ${want}`);
    else fail(`${label} is ${got}, but ${keyVar} is ${want}`);
  };
  same("DealEscrow.owner", await read(escrow, escrowAbi, "owner"), org, "ORG_KEY");
  same("DealEscrow.agent", await read(escrow, escrowAbi, "agent"), agent, "AGENT_KEY");
  same("DealEscrow.arbitrator", await read(escrow, escrowAbi, "arbitrator"), arbitrator, "ARBITRATOR_KEY");
  same("MockUSD.owner", await read(usd, usdAbi, "owner"), org, "ORG_KEY");
  const stable = String(await read(escrow, escrowAbi, "stablecoin"));
  if (stable.toLowerCase() === usd.toLowerCase()) ok("DealEscrow.stablecoin = USD_ADDRESS");
  else fail(`DealEscrow.stablecoin is ${stable}, not USD_ADDRESS ${usd}`);
  if (org) {
    const allowance = (await read(usd, usdAbi, "allowance", [org, escrow])) as bigint;
    if (allowance > 0n) ok("ORG approved the escrow (fundFor can pull on-ramped funds)");
    else fail("ORG has not approved the escrow: every UPI payment would fail at fundFor (redeploy with deploy.js)");
  }

  console.log("4. Gas");
  for (const [name, a] of [["ORG", org], ["Agent", agent], ["Arbitrator", arbitrator]] as const) {
    if (!a) continue;
    const bal = await pub.getBalance({ address: a });
    const msg = `${name} ${a}: ${formatEther(bal)} tMSTC`;
    if (bal === 0n) fail(`${msg} (needs gas: ${name === "ORG" ? "every payment, KYC and gas drip" : "disputes"})`);
    else if (bal < MIN_GAS) warn(`${msg} (low)`);
    else ok(msg);
  }
}

function checkData() {
  console.log("5. Storage");
  const dir = path.dirname(path.resolve(env.DB_PATH ?? "./data/app.db"));
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    ok(`data directory writable: ${dir}`);
  } catch {
    fail(`data directory not writable: ${dir}`);
  }
}

main()
  .catch((e) => fail(`unexpected: ${(e as Error).message.split("\n")[0]}`))
  .finally(() => {
    checkData();
    console.log(failed ? `\n${failed} problem(s): fix them before going live.` : "\nReady to go live.");
    process.exit(failed ? 1 : 0);
  });
