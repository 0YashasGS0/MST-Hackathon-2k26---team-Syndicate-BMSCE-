// Deploys MockUSD + DealEscrow to MST Testnet without Foundry. Same result as script/Deploy.s.sol:
//   1. MockUSD()                                  owner = ORG (the deployer)
//   2. DealEscrow(usd, agent, arbitrator)         owner = ORG
//   3. usd.approve(escrow, max) from ORG          so the on-ramp's fundFor() can pull minted stablecoins
// then reads every value back from the chain and prints what to put in deployments.md and the env files.
//
//   cd contracts && npm ci
//   node deploy.js --compile-only    # compile only, no keys or network needed
//   node deploy.js --write-abi       # also refresh backend/abi/*.json from the sources (CI checks they match)
//   node deploy.js --write           # deploy (asks for confirmation) and fill the contract rows in deployments.md
//
// Keys: ORG_KEY from the environment or backend/.env (never printed). Agent/arbitrator: AGENT_ADDRESS /
// ARBITRATOR_ADDRESS, else derived from AGENT_KEY / ARBITRATOR_KEY. RPC: MST_RPC_URL (default MST testnet).
// Flags: --yes (skip the prompt), --any-chain (allow a chain other than MST testnet, e.g. a local node).
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const solc = require("solc");
const { createPublicClient, createWalletClient, defineChain, getAddress, http, maxUint256 } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const MST_TESTNET_ID = 91562037;
const DEFAULT_RPC = "https://testnetrpc.mstblockchain.com";
const EXPLORER = "https://testnet.mstscan.com";
const SOURCES = ["MockUSD.sol", "DealEscrow.sol"];

const args = new Set(process.argv.slice(2));

// ---------- compile (same settings as foundry.toml: solc 0.8.24, optimizer 200 runs) ----------

function findImport(importPath) {
  for (const base of [path.join(__dirname, "node_modules"), path.join(__dirname, "lib/openzeppelin-contracts")]) {
    const rel = base.endsWith("openzeppelin-contracts") ? importPath.replace(/^@openzeppelin\//, "") : importPath;
    const file = path.join(base, rel);
    if (fs.existsSync(file)) return { contents: fs.readFileSync(file, "utf8") };
  }
  return { error: `not found: ${importPath} (run npm ci in contracts/)` };
}

function compile() {
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(
      SOURCES.map((f) => [`src/${f}`, { content: fs.readFileSync(path.join(__dirname, "src", f), "utf8") }]),
    ),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
  const errors = (out.errors || []).filter((e) => e.severity === "error");
  if (errors.length) {
    for (const e of errors) console.error(e.formattedMessage);
    throw new Error("compilation failed");
  }
  const get = (file, name) => {
    const c = out.contracts[`src/${file}`][name];
    return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
  };
  return { usd: get("MockUSD.sol", "MockUSD"), escrow: get("DealEscrow.sol", "DealEscrow") };
}

// ---------- env (process env wins; backend/.env is parsed, never printed) ----------

function loadEnv() {
  const env = {};
  const file = path.join(__dirname, "..", "backend", ".env");
  if (fs.existsSync(file)) {
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      let value = line.slice(eq + 1).trim();
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      env[line.slice(0, eq).trim()] = value;
    }
  }
  return { ...env, ...process.env };
}

function requireKey(env, name) {
  const v = env[name];
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} is missing or not a 0x-prefixed 32-byte key`);
  return v;
}

function roleAddress(env, addrVar, keyVar) {
  if (env[addrVar] && env[addrVar] !== "0x") return getAddress(env[addrVar]);
  return privateKeyToAccount(requireKey(env, keyVar)).address;
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(/^y(es)?$/i.test(a.trim())))));
}

// ---------- deploy ----------

async function main() {
  console.log("Compiling MockUSD + DealEscrow (solc", solc.version().split("+")[0] + ")…");
  const art = compile();
  const ctor = art.escrow.abi.find((x) => x.type === "constructor");
  console.log(`OK. DealEscrow constructor: (${ctor.inputs.map((i) => `${i.type} ${i.name}`).join(", ")})`);
  if (args.has("--write-abi")) {
    for (const [name, a] of [["DealEscrow", art.escrow], ["MockUSD", art.usd]]) {
      fs.writeFileSync(path.join(__dirname, "..", "backend", "abi", `${name}.json`), JSON.stringify(a.abi, null, 2) + "\n");
    }
    console.log("Wrote backend/abi/DealEscrow.json and MockUSD.json");
  }
  if (args.has("--compile-only") || args.has("--write-abi")) return;

  const env = loadEnv();
  const rpc = env.MST_RPC_URL || DEFAULT_RPC;
  const org = privateKeyToAccount(requireKey(env, "ORG_KEY"));
  const agent = roleAddress(env, "AGENT_ADDRESS", "AGENT_KEY");
  const arbitrator = roleAddress(env, "ARBITRATOR_ADDRESS", "ARBITRATOR_KEY");
  if (new Set([org.address, agent, arbitrator]).size !== 3) {
    throw new Error("ORG, agent and arbitrator must be three different wallets");
  }

  const probe = createPublicClient({ transport: http(rpc) });
  const chainId = await probe.getChainId();
  if (chainId !== MST_TESTNET_ID && !args.has("--any-chain")) {
    throw new Error(`RPC ${rpc} is chain ${chainId}, expected MST testnet ${MST_TESTNET_ID} (use --any-chain to override)`);
  }
  const chain = defineChain({
    id: chainId,
    name: chainId === MST_TESTNET_ID ? "MST Testnet" : `chain ${chainId}`,
    nativeCurrency: { name: "tMSTC", symbol: "tMSTC", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account: org, chain, transport: http(rpc) });

  const balance = await pub.getBalance({ address: org.address });
  console.log(`\nChain      ${chainId} (${rpc})`);
  console.log(`ORG/owner  ${org.address}  balance ${Number(balance) / 1e18} tMSTC`);
  console.log(`Agent      ${agent}`);
  console.log(`Arbitrator ${arbitrator}`);
  if (balance === 0n) throw new Error("the ORG wallet has 0 gas; fund it from the faucet first");
  if (!args.has("--yes") && !(await confirm("\nDeploy with these roles? [y/N] "))) return console.log("Aborted.");

  const send = async (label, hashPromise) => {
    const hash = await hashPromise;
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`${label.padEnd(22)} tx ${hash}  block ${receipt.blockNumber}`);
    return receipt;
  };

  const usdR = await send("MockUSD deploy", wallet.deployContract({ ...art.usd, args: [] }));
  const usd = getAddress(usdR.contractAddress);
  const escrowR = await send(
    "DealEscrow deploy",
    wallet.deployContract({ ...art.escrow, args: [usd, agent, arbitrator] }),
  );
  const escrow = getAddress(escrowR.contractAddress);
  await send(
    "approve(escrow, max)",
    wallet.writeContract({ address: usd, abi: art.usd.abi, functionName: "approve", args: [escrow, maxUint256] }),
  );

  // Read everything back so a wrong deploy is caught here, not in the demo.
  const read = (address, abi, functionName, a = []) => pub.readContract({ address, abi, functionName, args: a });
  const checks = [
    ["DealEscrow.owner", getAddress(await read(escrow, art.escrow.abi, "owner")), org.address],
    ["DealEscrow.agent", getAddress(await read(escrow, art.escrow.abi, "agent")), agent],
    ["DealEscrow.arbitrator", getAddress(await read(escrow, art.escrow.abi, "arbitrator")), arbitrator],
    ["DealEscrow.stablecoin", getAddress(await read(escrow, art.escrow.abi, "stablecoin")), usd],
    ["MockUSD.owner", getAddress(await read(usd, art.usd.abi, "owner")), org.address],
    ["MockUSD.decimals", Number(await read(usd, art.usd.abi, "decimals")), 6],
    ["allowance(ORG, escrow)", await read(usd, art.usd.abi, "allowance", [org.address, escrow]), maxUint256],
  ];
  let ok = true;
  console.log("\nChecks:");
  for (const [name, got, want] of checks) {
    const pass = got === want;
    ok &&= pass;
    console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` = ${got}, expected ${want}`}`);
  }

  const rows = {
    MockUSD: `| MockUSD | ${usd} | ${usdR.transactionHash} | ${usdR.blockNumber} | ${EXPLORER}/address/${usd} | ⬜ |`,
    DealEscrow: `| DealEscrow | ${escrow} | ${escrowR.transactionHash} | ${escrowR.blockNumber} | ${EXPLORER}/address/${escrow} | ⬜ |`,
  };
  if (args.has("--write") && ok && chainId === MST_TESTNET_ID) {
    const file = path.join(__dirname, "..", "deployments.md");
    let md = fs.readFileSync(file, "utf8");
    for (const [name, row] of Object.entries(rows)) md = md.replace(new RegExp(`^\\| ${name} \\|.*$`, "m"), row);
    md = md.replace(/^> The previous values here were placeholders:.*\n/m, "");
    fs.writeFileSync(file, md);
    console.log("\nUpdated deployments.md (commit it).");
  }
  console.log(`
deployments.md:
${rows.MockUSD}
${rows.DealEscrow}

backend/.env:
ESCROW_ADDRESS=${escrow}
USD_ADDRESS=${usd}
DEPLOY_BLOCK=${escrowR.blockNumber}

frontend (.env.local / build env):
NEXT_PUBLIC_ESCROW_ADDRESS=${escrow}
NEXT_PUBLIC_USD_ADDRESS=${usd}`);
  if (!ok) throw new Error("post-deploy checks failed (see above)");
}

main().catch((e) => {
  console.error(`\nERROR: ${e.shortMessage || e.message}`);
  process.exit(1);
});
