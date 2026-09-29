// B1: the ONE SowStore on the shared connection (B2's tables: drafts, sow_versions, agent_calls, dispute_rulings).
import { SowStore } from "./sow/index.js";
import { db } from "./db.js";

export const sowStore = new SowStore(db);
