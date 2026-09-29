// B1: the ONE accounts instance on the shared connection (profile, device binding, PIN; see accounts.ts).
import { createAccounts } from "./accounts.js";
import { getCaller } from "./auth.js";
import { db } from "./db.js";

export const accounts = createAccounts({ db, getCaller });
