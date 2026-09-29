const { createWalletClient, createPublicClient, http, publicActions, parseAbiItem, keccak256 } = require('viem');
const { privateKeyToAccount, privateKeyToAddress } = require('viem/accounts');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const readline = require('readline/promises');

function compile() {
  console.log("Compiling contracts with solc...");
  try {
    execSync('npx solc --abi --bin --base-path . --include-path node_modules/ -o build src/DealEscrow.sol src/MockUSD.sol', { stdio: 'inherit' });
  } catch (e) {
    console.error("Compilation failed:", e.message);
    process.exit(1);
  }
}

function loadEnv() {
  const envPath = path.join(__dirname, '..', 'backend', '.env');
  if (!fs.existsSync(envPath)) throw new Error("backend/.env not found");
  const envStr = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of envStr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

async function main() {
  const mode = process.argv[2];

  if (mode !== '--compile-only' && mode !== '--write' && mode !== '--write-abi') {
    console.error("Usage: node deploy.js [--compile-only | --write | --write-abi]");
    process.exit(1);
  }

  compile();

  const escrowAbi = JSON.parse(fs.readFileSync('build/src_DealEscrow_sol_DealEscrow.abi', 'utf8'));
  const escrowBin = '0x' + fs.readFileSync('build/src_DealEscrow_sol_DealEscrow.bin', 'utf8');
  const usdAbi = JSON.parse(fs.readFileSync('build/src_MockUSD_sol_MockUSD.abi', 'utf8'));
  const usdBin = '0x' + fs.readFileSync('build/src_MockUSD_sol_MockUSD.bin', 'utf8');

  const constructor = escrowAbi.find(a => a.type === 'constructor');
  if (mode === '--compile-only') {
    if (constructor && constructor.inputs.length === 3) {
      console.log(`OK. DealEscrow constructor: (${constructor.inputs.map(i => i.type).join(', ')})`);
      process.exit(0);
    } else {
      console.error("DealEscrow constructor args do not match expectations!");
      process.exit(1);
    }
  }

  if (mode === '--write-abi') {
    fs.writeFileSync('../backend/abi/DealEscrow.json', JSON.stringify(escrowAbi, null, 2));
    fs.writeFileSync('../backend/abi/MockUSD.json', JSON.stringify(usdAbi, null, 2));
    console.log("ABI rewritten to backend/abi/");
    process.exit(0);
  }

  // --write mode
  const env = loadEnv();
  const orgKey = env.ORG_KEY;
  const agentKey = env.AGENT_KEY;
  const arbKey = env.ARBITRATOR_KEY;

  if (!orgKey || !agentKey || !arbKey) {
    console.error("Missing ORG_KEY, AGENT_KEY, or ARBITRATOR_KEY in backend/.env");
    process.exit(1);
  }

  const account = privateKeyToAccount(orgKey);
  const agentAddr = privateKeyToAddress(agentKey);
  const arbAddr = privateKeyToAddress(arbKey);

  console.log(`Deploying with these roles?`);
  console.log(`ORG (owner/deployer): ${account.address}`);
  console.log(`Agent: ${agentAddr}`);
  console.log(`Arbitrator: ${arbAddr}`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Deploy? (y/N) ');
  rl.close();
  if (answer.toLowerCase() !== 'y') {
    console.log("Aborted.");
    process.exit(0);
  }

  const rpcUrl = env.MST_RPC_URL || "https://testnetrpc.mstblockchain.com";
  const client = createWalletClient({ account, transport: http(rpcUrl) }).extend(publicActions);

  const balance = await client.getBalance({ address: account.address });
  if (balance === 0n) {
    console.error("ERROR: ORG has no tMSTC!");
    process.exit(1);
  }

  console.log("Deploying MockUSD...");
  const usdHash = await client.deployContract({ abi: usdAbi, bytecode: usdBin, args: [] });
  const usdReceipt = await client.waitForTransactionReceipt({ hash: usdHash });
  const usdAddress = usdReceipt.contractAddress;
  console.log(`MockUSD: ${usdAddress}`);

  console.log("Deploying DealEscrow...");
  const escrowHash = await client.deployContract({
    abi: escrowAbi,
    bytecode: escrowBin,
    args: [usdAddress, agentAddr, arbAddr]
  });
  const escrowReceipt = await client.waitForTransactionReceipt({ hash: escrowHash });
  const escrowAddress = escrowReceipt.contractAddress;
  const deployBlock = escrowReceipt.blockNumber;
  console.log(`DealEscrow: ${escrowAddress}`);

  console.log("Approving Escrow for MockUSD fundFor...");
  const maxUint256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
  const approveHash = await client.writeContract({
    address: usdAddress,
    abi: usdAbi,
    functionName: 'approve',
    args: [escrowAddress, maxUint256]
  });
  await client.waitForTransactionReceipt({ hash: approveHash });

  console.log("Running 7 on-chain checks...");
  const pub = createPublicClient({ transport: http(rpcUrl) });
  
  const ownerEscrow = await pub.readContract({ address: escrowAddress, abi: escrowAbi, functionName: 'owner' });
  const agentRole = await pub.readContract({ address: escrowAddress, abi: escrowAbi, functionName: 'agent' });
  const arbRole = await pub.readContract({ address: escrowAddress, abi: escrowAbi, functionName: 'arbitrator' });
  const stable = await pub.readContract({ address: escrowAddress, abi: escrowAbi, functionName: 'stablecoin' });
  
  const ownerUsd = await pub.readContract({ address: usdAddress, abi: usdAbi, functionName: 'owner' });
  const decimals = await pub.readContract({ address: usdAddress, abi: usdAbi, functionName: 'decimals' });
  const allowance = await pub.readContract({ address: usdAddress, abi: usdAbi, functionName: 'allowance', args: [account.address, escrowAddress] });

  let checksFailed = false;
  const check = (name, cond) => {
    if (cond) {
      console.log(`CHECK ${name}: ok`);
    } else {
      console.log(`CHECK ${name}: FAIL`);
      checksFailed = true;
    }
  };

  check("DealEscrow.owner() == ORG", ownerEscrow.toLowerCase() === account.address.toLowerCase());
  check("DealEscrow.agent() == Agent", agentRole.toLowerCase() === agentAddr.toLowerCase());
  check("DealEscrow.arbitrator() == Arbitrator", arbRole.toLowerCase() === arbAddr.toLowerCase());
  check("DealEscrow.stablecoin() == MockUSD", stable.toLowerCase() === usdAddress.toLowerCase());
  check("MockUSD.owner() == ORG", ownerUsd.toLowerCase() === account.address.toLowerCase());
  check("MockUSD.decimals() == 6", Number(decimals) === 6);
  check("MockUSD.allowance(ORG, DealEscrow) == max", allowance === maxUint256);

  if (checksFailed) {
    console.error("Some checks failed!");
    process.exit(1);
  }

  console.log("Checks passed! Updating deployments.md...");
  const depPath = path.join(__dirname, '..', 'deployments.md');
  let depStr = fs.readFileSync(depPath, 'utf8');
  depStr = depStr.replace(/\| MockUSD \|.*\|/, `| MockUSD | ${usdAddress} | ${usdHash} | ${deployBlock} | [Explorer](https://testnet.mstscan.com/address/${usdAddress}) | ✅ |`);
  depStr = depStr.replace(/\| DealEscrow \|.*\|/, `| DealEscrow | ${escrowAddress} | ${escrowHash} | ${deployBlock} | [Explorer](https://testnet.mstscan.com/address/${escrowAddress}) | ✅ |`);
  // Delete placeholders note
  depStr = depStr.replace(/> The previous values here were placeholders[\s\S]*?tx hash and block\./, '');
  fs.writeFileSync(depPath, depStr);

  console.log(`
OUTPUT VALUES TO SET:
------------------------------------------
backend/.env:
ESCROW_ADDRESS=${escrowAddress}
USD_ADDRESS=${usdAddress}
DEPLOY_BLOCK=${deployBlock}

frontend/.env.local (and build env):
NEXT_PUBLIC_ESCROW_ADDRESS=${escrowAddress}
NEXT_PUBLIC_USD_ADDRESS=${usdAddress}
------------------------------------------
`);

}

main().catch(console.error);
