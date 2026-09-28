export type PaymentStatus = "created" | "paid" | "minted" | "funded" | "failed";

export type PaymentRecord = {
  id: string;
  dealId: number;
  /** MockUSD base units (6 decimals). */
  amount: string;
  status: PaymentStatus;
  mintTx: string | null;
  fundTx: string | null;
  createdAt: string;
};

export type NewPaymentRecord = Pick<PaymentRecord, "dealId" | "amount" | "status">;

export type PayoutRecord = {
  dealId: number;
  toBuyer: string;
  toSeller: string;
  finalStatus: string;
  txHash: string;
};

/**
 * Storage contract compatible with B1's shared SQLite schema. A payment row is
 * unique per deal and its amount is always the on-chain MockUSD base-unit value.
 */
export interface PaymentSessionStore {
  createIfAbsent(payment: NewPaymentRecord): Promise<PaymentRecord>;
}

export interface PaymentConfirmationStore extends PaymentSessionStore {
  /** Atomically claim a created/failed payment; retain hashes on retry. */
  claimConfirmation(dealId: number): Promise<{ claimed: boolean; payment: PaymentRecord }>;
  recordMinted(dealId: number, mintTx: string): Promise<PaymentRecord>;
  recordFunded(dealId: number, fundTx: string): Promise<PaymentRecord>;
  markFailed(dealId: number): Promise<PaymentRecord>;
  releaseConfirmation(dealId: number): Promise<void>;
}

export interface PaymentHistoryStore {
  getPayment(dealId: number): Promise<PaymentRecord | null>;
  getPayout(dealId: number): Promise<PayoutRecord | null>;
}

export interface PaymentConfirmationChain {
  getDeal(dealId: number): Promise<{ status: string; amount: string }>;
  /** Resolve a previously mined ORG DealFunded event after a process restart. */
  getOrgFundingTx(dealId: number): Promise<string | null>;
  /** Check that ORG has enough MockUSD allowance before minting. */
  assertFundingReady(amountBaseUnits: string): Promise<void>;
  /** Mint the given MockUSD base-unit amount to ORG and wait for success. */
  mint(amountBaseUnits: string): Promise<{ mintTx: string }>;
  /** Call fundFor and wait for success; the adapter must check ORG allowance. */
  fundFor(dealId: number): Promise<{ fundTx: string }>;
}

export type OnrampSession = {
  paymentId: string;
  /** Human-readable INR amount, rounded to the nearest paise. */
  amountInr: string;
  /** MockUSD base-unit amount (6 decimals). */
  amountUsd: string;
  status: PaymentStatus;
  upi: { payee: string; note: string };
};

export type PaymentConfirmationResult = {
  status: PaymentStatus;
  mintTx: string | null;
  fundTx: string | null;
};

export class OnrampConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "BadStatus";

  constructor(message: string) {
    super(message);
    this.name = "OnrampConflictError";
  }
}

const USD_BASE_UNITS = 1_000_000n;
const INR_PAISE_PER_USD = 8_400n;
const DEMO_UPI_PAYEE = "tranquebar-demo@upi";

function formatInrFromUsdBaseUnits(amountUsd: bigint): string {
  const paise = (amountUsd * INR_PAISE_PER_USD + USD_BASE_UNITS / 2n) / USD_BASE_UNITS;
  const rupees = paise / 100n;
  const remainingPaise = (paise % 100n).toString().padStart(2, "0");
  return `${rupees}.${remainingPaise}`;
}

/** Create or retrieve the single mock UPI session allowed for a deal. */
export async function createOnrampSession(
  store: PaymentSessionStore,
  dealId: number,
  amountUsdBaseUnits: string,
): Promise<OnrampSession> {
  if (!Number.isSafeInteger(dealId) || dealId < 1) {
    throw new RangeError("Deal ID must be a positive safe integer");
  }
  if (!/^\d+$/.test(amountUsdBaseUnits)) {
    throw new TypeError("MockUSD amount must be an integer base-unit string");
  }

  const amount = BigInt(amountUsdBaseUnits);
  if (amount <= 0n) {
    throw new RangeError("MockUSD amount must be greater than zero");
  }

  const payment = await store.createIfAbsent({
    dealId,
    amount: amount.toString(),
    status: "created",
  });

  const storedAmount = BigInt(payment.amount);
  return {
    paymentId: payment.id,
    amountInr: formatInrFromUsdBaseUnits(storedAmount),
    amountUsd: storedAmount.toString(),
    status: payment.status,
    upi: { payee: DEMO_UPI_PAYEE, note: `deal-${dealId}` },
  };
}

/**
 * Confirm a mock UPI payment. The store's atomic claim prevents concurrent
 * requests from minting twice. A retry after mint but failed funding reuses
 * the saved mintTx and retries only fundFor.
 */
export async function confirmOnrampPayment(
  store: PaymentConfirmationStore,
  chain: PaymentConfirmationChain,
  dealId: number,
): Promise<PaymentConfirmationResult> {
  if (!Number.isSafeInteger(dealId) || dealId < 1) {
    throw new RangeError("Deal ID must be a positive safe integer");
  }

  const claim = await store.claimConfirmation(dealId);
  if (!claim.claimed) {
    return {
      status: claim.payment.status,
      mintTx: claim.payment.mintTx,
      fundTx: claim.payment.fundTx,
    };
  }

  try {
    const deal = await chain.getDeal(dealId);
    if (BigInt(deal.amount) !== BigInt(claim.payment.amount)) {
      throw new OnrampConflictError("Payment amount does not match the deal amount");
    }
    if (deal.status === "Funded" && claim.payment.mintTx) {
      const fundTx = await chain.getOrgFundingTx(dealId);
      if (!fundTx) {
        throw new OnrampConflictError("Funding is on-chain; retry after B1's event indexer records the transaction");
      }
      const payment = await store.recordFunded(dealId, fundTx);
      return { status: payment.status, mintTx: payment.mintTx, fundTx: payment.fundTx };
    }
    if (deal.status !== "Accepted") {
      throw new OnrampConflictError("Deal must be Accepted before payment");
    }
    await chain.assertFundingReady(deal.amount);

    let payment = claim.payment;
    if (!payment.mintTx) {
      const { mintTx } = await chain.mint(payment.amount);
      payment = await store.recordMinted(dealId, mintTx);
    }

    if (!payment.fundTx) {
      const { fundTx } = await chain.fundFor(dealId);
      payment = await store.recordFunded(dealId, fundTx);
    }

    return {
      status: payment.status,
      mintTx: payment.mintTx,
      fundTx: payment.fundTx,
    };
  } catch (error) {
    await store.markFailed(dealId);
    throw error;
  } finally {
    await store.releaseConfirmation(dealId);
  }
}
