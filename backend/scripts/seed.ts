// Hour 8-10 — Demo readiness, per TEAM_ROADMAP.md §1 "Hour 8-10 step 2".
// Creates 4 demo deals in the states judges will see:
//   1. Funded      -> ready to deliver and release
//   2. Delivered   -> ready to dispute
//   3. ResolutionProposed -> ready to accept/escalate
//   4. Escalated   -> ready for the arbitrator console
//
// Run with: npx tsx scripts/seed.ts
// Requires ESCROW_ADDRESS/USD_ADDRESS, ORG_KEY/AGENT_KEY, and 2 funded demo
// wallets (buyer/seller) in .env. Fill DEMO_BUYER_KEY / DEMO_SELLER_KEY below.
import "dotenv/config";
import { createWalletClient, http, keccak256, parseUnits, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mst, escrowAbi, usdAbi, pub, org, ESCROW, USD, sendContractTx } from "../src/chain";

const DEMO_BUYER_KEY = process.env.DEMO_BUYER_KEY as `0x${string}` | undefined;
const DEMO_SELLER_KEY = process.env.DEMO_SELLER_KEY as `0x${string}` | undefined;

function fakeSowHash(label: string) {
  return keccak256(stringToHex(`demo-sow-${label}-${Date.now()}`));
}

async function main() {
  if (!ESCROW || !USD || !org || !DEMO_BUYER_KEY || !DEMO_SELLER_KEY) {
    console.error(
      "Missing config. Need ESCROW_ADDRESS, USD_ADDRESS, ORG_KEY, DEMO_BUYER_KEY, DEMO_SELLER_KEY in .env"
    );
    process.exit(1);
  }

  const buyer = createWalletClient({ chain: mst, transport: http(), account: privateKeyToAccount(DEMO_BUYER_KEY) });
  const seller = createWalletClient({ chain: mst, transport: http(), account: privateKeyToAccount(DEMO_SELLER_KEY) });

  // Make sure both demo wallets are KYC'd.
  for (const w of [buyer, seller]) {
    await sendContractTx(org!, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "setKyc",
      args: [w.account!.address, true],
    });
  }

  async function makeDeal(label: string, amountMusd: string) {
    const sowHash = fakeSowHash(label);
    const deliverBy = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const reviewPeriod = BigInt(120); // 120s per the roadmap's demo review period

    const { hash: proposeTx } = await sendContractTx(buyer as any, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "proposeDeal",
      args: [seller.account!.address, parseUnits(amountMusd, 6), sowHash, deliverBy, reviewPeriod],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: proposeTx });
    // DealProposed's first indexed topic (after the event sig) is the deal id.
    const dealId = BigInt(receipt.logs[0].topics[1]!);

    await sendContractTx(seller as any, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "acceptDeal",
      args: [dealId, sowHash],
    });

    await sendContractTx(org!, {
      address: USD,
      abi: usdAbi,
      functionName: "mint",
      args: [org!.account!.address, parseUnits(amountMusd, 6)],
    });
    await sendContractTx(org!, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "fundFor",
      args: [dealId],
    });

    console.log(`[seed] deal ${dealId} funded (${label})`);
    return { dealId, sowHash };
  }

  // Deal 1: stays Funded.
  await makeDeal("funded", "100.00");

  // Deal 2: Funded -> Delivered.
  const d2 = await makeDeal("delivered", "150.00");
  const deliveryHash = keccak256(stringToHex("demo-delivery-2"));
  await sendContractTx(seller as any, {
    address: ESCROW,
    abi: escrowAbi,
    functionName: "markDelivered",
    args: [d2.dealId, deliveryHash],
  });
  console.log(`[seed] deal ${d2.dealId} delivered`);

  // Deal 3: Funded -> Delivered -> Disputed -> ResolutionProposed.
  const d3 = await makeDeal("resolution-proposed", "200.00");
  const d3DeliveryHash = keccak256(stringToHex("demo-delivery-3"));
  await sendContractTx(seller as any, {
    address: ESCROW,
    abi: escrowAbi,
    functionName: "markDelivered",
    args: [d3.dealId, d3DeliveryHash],
  });
  const d3EvidenceHash = keccak256(stringToHex("demo-evidence-3"));
  await sendContractTx(buyer as any, {
    address: ESCROW,
    abi: escrowAbi,
    functionName: "raiseDispute",
    args: [d3.dealId, d3EvidenceHash],
  });
  const { agent } = await import("../src/chain");
  if (agent) {
    const reasoningHash = keccak256(stringToHex("demo-reasoning-3"));
    await sendContractTx(agent, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "proposeResolution",
      args: [d3.dealId, 3500, reasoningHash], // 35% back to buyer, matches the doc's worked example
    });
  }
  console.log(`[seed] deal ${d3.dealId} has a proposed resolution`);

  // Deal 4: same as deal 3, then escalated.
  const d4 = await makeDeal("escalated", "250.00");
  const d4DeliveryHash = keccak256(stringToHex("demo-delivery-4"));
  await sendContractTx(seller as any, {
    address: ESCROW,
    abi: escrowAbi,
    functionName: "markDelivered",
    args: [d4.dealId, d4DeliveryHash],
  });
  const d4EvidenceHash = keccak256(stringToHex("demo-evidence-4"));
  await sendContractTx(buyer as any, {
    address: ESCROW,
    abi: escrowAbi,
    functionName: "raiseDispute",
    args: [d4.dealId, d4EvidenceHash],
  });
  await sendContractTx(buyer as any, {
    address: ESCROW,
    abi: escrowAbi,
    functionName: "escalate",
    args: [d4.dealId],
  });
  console.log(`[seed] deal ${d4.dealId} escalated`);

  console.log("[seed] done — 4 demo deals ready.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
