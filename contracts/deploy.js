const { createWalletClient, http, publicActions } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Compile the contract using local solc
console.log("Compiling contracts with solc...");
try {
  execSync('npx solc --abi --bin --base-path . --include-path ../node_modules/ --overwrite -o build src/DealEscrow.sol src/MockUSD.sol', { stdio: 'inherit' });
} catch (e) {
  console.error("Compilation failed:", e.message);
  process.exit(1);
}

// Load env
const envPath = path.join(__dirname, '..', 'backend', '.env');
const envStr = fs.readFileSync(envPath, 'utf8');
const env = {};
envStr.split('\n').forEach(line => {
  const [k, v] = line.split('=');
  if (k && v) env[k.trim()] = v.trim();
});

const account = privateKeyToAccount(env.ORG_KEY);
const client = createWalletClient({
  account,
  transport: http(env.MST_RPC_URL)
}).extend(publicActions);

async function deploy() {
  console.log(`Deploying with ORG wallet: ${account.address}`);
  const balance = await client.getBalance({ address: account.address });
  if (balance === 0n) {
    console.error("ERROR: The ORG wallet has 0 tMSTC! You must fund it from the faucet first.");
    process.exit(1);
  }
  
  console.log(`Wallet balance is ${balance} tMSTC. Deploying MockUSD...`);
  const mockUsdAbi = JSON.parse(fs.readFileSync('build/MockUSD.abi', 'utf8'));
  const mockUsdBin = '0x' + fs.readFileSync('build/MockUSD.bin', 'utf8');
  
  const usdHash = await client.deployContract({
    abi: mockUsdAbi,
    bytecode: mockUsdBin,
    args: []
  });
  const usdReceipt = await client.waitForTransactionReceipt({ hash: usdHash });
  const usdAddress = usdReceipt.contractAddress;
  console.log(`MockUSD deployed to: ${usdAddress}`);

  console.log(`Deploying DealEscrow...`);
  const escrowAbi = JSON.parse(fs.readFileSync('build/DealEscrow.abi', 'utf8'));
  const escrowBin = '0x' + fs.readFileSync('build/DealEscrow.bin', 'utf8');
  
  const escrowHash = await client.deployContract({
    abi: escrowAbi,
    bytecode: escrowBin,
    args: [usdAddress, account.address]
  });
  const escrowReceipt = await client.waitForTransactionReceipt({ hash: escrowHash });
  const escrowAddress = escrowReceipt.contractAddress;
  console.log(`DealEscrow deployed to: ${escrowAddress}`);
  
  console.log(`\nDeployment Complete! Update your deployments.md with these addresses!`);
}

deploy().catch(console.error);
