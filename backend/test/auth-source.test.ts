// Proves the router takes identity ONLY from getCaller(): mock it and ignore the header entirely.
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../src/sow/auth", () => ({ getCaller: vi.fn() }));
import { getCaller } from "../src/sow/auth";
import { createSowRouter } from "../src/sow";
import { SowStore } from "../src/sow/store";

const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const mocked = vi.mocked(getCaller);

function app() {
  const a = express();
  a.use(createSowRouter({ store: new SowStore(":memory:"), usdAddress: "0x3333333333333333333333333333333333333333", verifyLink: async () => ({ ok: true }) }));
  return a;
}
const draft = {
  buyer: BUYER, seller: SELLER, purpose: "x", buyerConstraints: "y", amount: "1",
  deliveryDeadline: Math.floor(Date.now() / 1000) + 3600, reviewWindowSecs: 60,
};

beforeEach(() => mocked.mockReset());

describe("identity source", () => {
  it("a valid x-user-address header is ignored when getCaller says null", async () => {
    mocked.mockReturnValue(null);
    const res = await request(app()).post("/drafts").set("x-user-address", BUYER).send(draft);
    expect(res.status).toBe(401);
    expect(mocked).toHaveBeenCalled();
  });

  it("getCaller's answer wins even with no header, and a wrong header can't override it", async () => {
    mocked.mockReturnValue(BUYER);
    await request(app()).post("/drafts").send(draft).expect(201);
    mocked.mockReturnValue(SELLER);
    await request(app()).post("/drafts").set("x-user-address", BUYER).send(draft).expect(403);
  });
});
