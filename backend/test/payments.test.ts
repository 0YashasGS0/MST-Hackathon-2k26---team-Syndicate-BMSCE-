import { describe, expect, it } from "vitest";
import { parseEther, type Address, type Hex } from "viem";
import {
  confirmOnrampPayment,
  type PaymentConfirmationChain,
  type PaymentConfirmationStore,
  type PaymentRecord,
} from "../src/payments/onramp";
import { gasDrip, type GasDripChain, type GasDripStore } from "../src/payments/gas-drip";

const wallet = "0x0000000000000000000000000000000000000001" as Address;
const transactionHash = `0x${"ab".repeat(32)}` as Hex;

class MemoryPaymentStore implements PaymentConfirmationStore {
  payment: PaymentRecord = {
    id: "1",
    dealId: 7,
    amount: "100000000",
    status: "created",
    mintTx: null,
    fundTx: null,
    createdAt: "2026-09-29T12:00:00.000Z",
  };
  private claimed = false;

  async createIfAbsent(): Promise<PaymentRecord> { return this.payment; }

  async claimConfirmation(): Promise<{ claimed: boolean; payment: PaymentRecord }> {
    if (this.claimed || this.payment.status === "funded") return { claimed: false, payment: this.payment };
    this.claimed = true;
    if (this.payment.status === "created" || this.payment.status === "failed") {
      this.payment = { ...this.payment, status: this.payment.mintTx ? "minted" : "paid" };
    }
    return { claimed: true, payment: this.payment };
  }

  async recordMinted(_dealId: number, mintTx: string): Promise<PaymentRecord> {
    this.payment = { ...this.payment, status: "minted", mintTx };
    return this.payment;
  }

  async recordFunded(_dealId: number, fundTx: string): Promise<PaymentRecord> {
    this.payment = { ...this.payment, status: "funded", fundTx };
    return this.payment;
  }

  async markFailed(): Promise<PaymentRecord> {
    this.payment = { ...this.payment, status: "failed" };
    return this.payment;
  }

  async releaseConfirmation(): Promise<void> { this.claimed = false; }
}

function makePaymentChain(overrides: Partial<PaymentConfirmationChain> = {}) {
  let mintCalls = 0;
  let fundCalls = 0;
  const chain: PaymentConfirmationChain = {
    async getDeal() { return { status: "Accepted", amount: "100000000" }; },
    async getOrgFundingTx() { return null; },
    async assertFundingReady() {},
    async mint() { mintCalls += 1; return { mintTx: transactionHash }; },
    async fundFor() { fundCalls += 1; return { fundTx: transactionHash }; },
    ...overrides,
  };
  return { chain, mintCalls: () => mintCalls, fundCalls: () => fundCalls };
}

describe("PG payment confirmation", () => {
  it("funds at most once across five repeated confirmations", async () => {
    const store = new MemoryPaymentStore();
    const counts = makePaymentChain();
    const results: Awaited<ReturnType<typeof confirmOnrampPayment>>[] = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await confirmOnrampPayment(store, counts.chain, 7));
    }
    expect(results.every((result) => result.status === "funded")).toBe(true);
    expect(counts.mintCalls()).toBe(1);
    expect(counts.fundCalls()).toBe(1);
  });

  it("retries funding after failure without minting again", async () => {
    const store = new MemoryPaymentStore();
    let fundCalls = 0;
    const counts = makePaymentChain({
      async fundFor() {
        fundCalls += 1;
        if (fundCalls === 1) throw new Error("temporary funding failure");
        return { fundTx: transactionHash };
      },
    });
    await expect(confirmOnrampPayment(store, counts.chain, 7)).rejects.toThrow("temporary funding failure");
    const retry = await confirmOnrampPayment(store, counts.chain, 7);
    expect(retry.status).toBe("funded");
    expect(counts.mintCalls()).toBe(1);
    expect(fundCalls).toBe(2);
  });

  it("refuses to mint unless the deal is Accepted", async () => {
    const store = new MemoryPaymentStore();
    const counts = makePaymentChain({ async getDeal() { return { status: "Proposed", amount: "100000000" }; } });
    await expect(confirmOnrampPayment(store, counts.chain, 7)).rejects.toThrow("Deal must be Accepted");
    expect(counts.mintCalls()).toBe(0);
    expect(counts.fundCalls()).toBe(0);
  });
});

class MemoryGasDripStore implements GasDripStore {
  private readonly claimed = new Set<string>();
  readonly outcomes: string[] = [];

  async claim(address: Address): Promise<boolean> {
    const key = address.toLowerCase();
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    this.outcomes.push("pending");
    return true;
  }
  async markSent(_address: Address, _txHash: Hex): Promise<void> { this.outcomes[this.outcomes.length - 1] = "sent"; }
  async markFailed(_address: Address): Promise<void> { this.outcomes[this.outcomes.length - 1] = "failed"; }
}

function makeGasDripChain(balance: bigint, sendError?: Error) {
  let sentAmount: bigint | undefined;
  let sendCalls = 0;
  const chain: GasDripChain = {
    async getBalance() { return balance; },
    async sendNative(_address, amount) {
      sendCalls += 1;
      sentAmount = amount;
      if (sendError) throw sendError;
      return { txHash: transactionHash };
    },
  };
  return { chain, sendCalls: () => sendCalls, sentAmount: () => sentAmount };
}

describe("PG gas drip", () => {
  it("sends 0.1 MSTC below the 0.05 threshold once and records success", async () => {
    const store = new MemoryGasDripStore();
    const chain = makeGasDripChain(parseEther("0.01"));
    const first = await gasDrip(store, chain.chain, wallet);
    const second = await gasDrip(store, chain.chain, wallet);
    expect(first.status).toBe("sent");
    expect(chain.sentAmount()).toBe(parseEther("0.1"));
    expect(second.status).toBe("already_claimed");
    expect(chain.sendCalls()).toBe(1);
    expect(store.outcomes).toEqual(["sent"]);
  });

  it("does not send or claim when the balance meets the threshold", async () => {
    const store = new MemoryGasDripStore();
    const chain = makeGasDripChain(parseEther("0.05"));
    expect((await gasDrip(store, chain.chain, wallet)).status).toBe("not_needed");
    expect(chain.sendCalls()).toBe(0);
    expect(store.outcomes).toEqual([]);
  });

  it("records a failed attempt and never retries the address", async () => {
    const store = new MemoryGasDripStore();
    const chain = makeGasDripChain(parseEther("0"), new Error("send failed"));
    await expect(gasDrip(store, chain.chain, wallet)).rejects.toThrow("send failed");
    expect(store.outcomes).toEqual(["failed"]);
    expect((await gasDrip(store, chain.chain, wallet)).status).toBe("already_claimed");
    expect(chain.sendCalls()).toBe(1);
  });
});
