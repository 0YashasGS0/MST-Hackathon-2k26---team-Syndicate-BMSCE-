import { Router } from "express";
import type { Request, Response } from "express";
import { formatUnits } from "viem";
import { requireApiKey } from "../auth";
import {
  confirmOnrampPayment,
  createOnrampSession,
  OnrampConflictError,
  isPaymentMethod,
  type PaymentConfirmationChain,
  type PaymentConfirmationStore,
  type PaymentHistoryStore,
  type PaymentSessionStore,
} from "./onramp";

export type PaymentsRouteDependencies = {
  sessionStore: PaymentSessionStore;
  confirmationStore: PaymentConfirmationStore;
  historyStore: PaymentHistoryStore;
  /** Reads status and amount from B1's on-chain deal client. */
  readDeal(dealId: number): Promise<{ status: string; amount: string }>;
  confirmationChain: PaymentConfirmationChain;
};

function parseDealId(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) throw new TypeError("Deal ID must be an integer");
  const dealId = Number(value);
  if (!Number.isSafeInteger(dealId) || dealId < 1) {
    throw new TypeError("Deal ID must be a positive safe integer");
  }
  return dealId;
}

function sendRouteError(error: unknown, response: Response): void {
  if (error instanceof OnrampConflictError) {
    response.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    response.status(400).json({ error: { code: "BadRequest", message: error.message } });
    return;
  }
  response.status(500).json({
    error: { code: "PaymentError", message: "Payment request failed" },
  });
}

/**
 * Mount this router at the application root, alongside B1's other routers.
 * It uses B1's API-key middleware and the same DB/chain adapters.
 */
export function createPaymentsRouter(dependencies: PaymentsRouteDependencies): Router {
  const router = Router();

  router.post("/onramp/:dealId/session", requireApiKey, async (request: Request, response: Response) => {
    try {
      const dealId = parseDealId(String(request.params.dealId));
      const deal = await dependencies.readDeal(dealId);
      const session = await createOnrampSession(
        dependencies.sessionStore,
        dealId,
        deal.amount,
      );
      response.json(session);
    } catch (error) {
      sendRouteError(error, response);
    }
  });

  router.post("/onramp/:dealId/confirm", requireApiKey, async (request: Request, response: Response) => {
    try {
      const dealId = parseDealId(String(request.params.dealId));
      const method = request.body?.method;
      if (!isPaymentMethod(method)) {
        throw new TypeError("method must be one of: upi_qr, upi_id, upi_app, crypto");
      }
      response.json(
        await confirmOnrampPayment(
          dependencies.confirmationStore,
          dependencies.confirmationChain,
          dealId,
          method,
        ),
      );
    } catch (error) {
      sendRouteError(error, response);
    }
  });

  router.get("/deals/:id/payment", requireApiKey, async (request: Request, response: Response) => {
    try {
      const dealId = parseDealId(String(request.params.id));
      const [payment, payout] = await Promise.all([
        dependencies.historyStore.getPayment(dealId),
        dependencies.historyStore.getPayout(dealId),
      ]);

      response.json({
        payment: payment
          ? { ...payment, amountFormatted: formatUnits(BigInt(payment.amount), 6) }
          : null,
        payout: payout
          ? {
              ...payout,
              toBuyerFormatted: formatUnits(BigInt(payout.toBuyer), 6),
              toSellerFormatted: formatUnits(BigInt(payout.toSeller), 6),
            }
          : null,
      });
    } catch (error) {
      sendRouteError(error, response);
    }
  });

  return router;
}
