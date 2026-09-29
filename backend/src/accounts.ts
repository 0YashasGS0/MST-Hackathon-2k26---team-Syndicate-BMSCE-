// Accounts on top of PG's wallet sign-in: profile (name/phone from KYC), one bound device per account, security
// PIN, contact lookup and "people". Identity is ALWAYS PG's session (getCaller); nothing here trusts a body address.
// The bound device's public key doubles as the device-key registry B2's approve-sow uses (isAuthorizedSigner).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { getAddress } from "viem";

export type Role = "user" | "arbitrator";
/** Matches frontend/lib/types.ts `User`. */
export type AccountView = {
  address: string;
  phone: string;
  name?: string;
  role: Role;
  deviceId: string;
  deviceKey?: string;
  kycLevel: 0 | 1 | 2;
  hasPin: boolean;
  deviceBoundAt?: number;
  coolingUntil?: number;
};
/** Matches frontend/lib/types.ts `Contact`. */
export type ContactView = { phone: string; name: string; bankingName: string; address: string; lastActivity?: number };

const COOLING_SECS = 24 * 3600; // after moving to a new device (like UPI apps)
const PENDING_SECS = 300; // wallet signed on a new device; PIN must follow within 5 minutes
const MAX_ATTEMPTS = 5;
const LOCK_SECS = 5 * 60;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,128}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  address       TEXT PRIMARY KEY,          -- lowercase wallet
  device_id     TEXT NOT NULL,
  device_key    TEXT NOT NULL,             -- lowercase address of the device's signing key
  bound_at      INTEGER NOT NULL,
  cooling_until INTEGER
);
CREATE TABLE IF NOT EXISTS pins (
  address TEXT PRIMARY KEY,
  hash    TEXT NOT NULL                    -- scrypt, "salt:hash" hex; the PIN itself is never stored
);
CREATE TABLE IF NOT EXISTS pin_attempts (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_logins (
  address    TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  device_key TEXT NOT NULL,
  at         INTEGER NOT NULL
);
`;

class AccountError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type AccountsDeps = {
  db: Database.Database;
  getCaller: (req: Request) => string | null;
  now?: () => number; // unix seconds
  /** Wallets that get the arbitrator role (default env ARBITRATOR_ADDRESSES, comma-separated). */
  arbitrators?: string[];
};

export function createAccounts(deps: AccountsDeps) {
  const { db, getCaller } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const arbitrators = new Set(
    (deps.arbitrators ?? (process.env.ARBITRATOR_ADDRESSES ?? "").split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean),
  );

  db.exec(SCHEMA);
  const cols = new Set((db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("name")) db.exec("ALTER TABLE users ADD COLUMN name TEXT");
  if (!cols.has("phone")) db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_phone_idx ON users (phone) WHERE phone IS NOT NULL");

  const ensureUser = (a: string) => db.prepare("INSERT INTO users (address, kyc_level) VALUES (?, 0) ON CONFLICT(address) DO NOTHING").run(a);

  function view(address: string): AccountView {
    const a = address.toLowerCase();
    ensureUser(a);
    const u = db.prepare("SELECT name, phone, kyc_level FROM users WHERE address = ?").get(a) as { name: string | null; phone: string | null; kyc_level: number };
    const d = db.prepare("SELECT device_id, device_key, bound_at, cooling_until FROM devices WHERE address = ?").get(a) as
      | { device_id: string; device_key: string; bound_at: number; cooling_until: number | null }
      | undefined;
    const hasPin = !!db.prepare("SELECT 1 FROM pins WHERE address = ?").get(a);
    const arbitrator = arbitrators.has(a);
    return {
      address: getAddress(a),
      phone: u.phone ?? "",
      ...(u.name ? { name: u.name } : arbitrator ? { name: "Arbitrator Desk" } : {}),
      role: arbitrator ? "arbitrator" : "user",
      deviceId: d?.device_id ?? "",
      ...(d && { deviceKey: getAddress(d.device_key), deviceBoundAt: d.bound_at }),
      ...(d?.cooling_until && d.cooling_until > now() ? { coolingUntil: d.cooling_until } : {}),
      kycLevel: (arbitrator ? 2 : Math.min(2, Math.max(0, u.kyc_level))) as 0 | 1 | 2,
      hasPin,
    };
  }

  function contact(address: string, lastActivity?: number): ContactView | null {
    const u = db.prepare("SELECT address, name, phone, kyc_level FROM users WHERE address = ?").get(address.toLowerCase()) as
      | { address: string; name: string | null; phone: string | null; kyc_level: number }
      | undefined;
    if (!u?.name || !u.phone || u.kyc_level < 1 || arbitrators.has(u.address)) return null;
    return { phone: u.phone, name: u.name, bankingName: u.name.toUpperCase(), address: getAddress(u.address), ...(lastActivity && { lastActivity }) };
  }

  function bind(a: string, deviceId: string, deviceKey: string, newDevice: boolean) {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO devices (address, device_id, device_key, bound_at, cooling_until) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET device_id = excluded.device_id, device_key = excluded.device_key,
           bound_at = excluded.bound_at, cooling_until = excluded.cooling_until`,
      ).run(a, deviceId, deviceKey.toLowerCase(), now(), newDevice ? now() + COOLING_SECS : null);
      db.prepare("DELETE FROM pending_logins WHERE address = ?").run(a);
    })();
    return view(a);
  }

  const hashPin = (pin: string, salt = randomBytes(16)) => `${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}`;
  const pinMatches = (pin: string, stored: string) => {
    const [salt, hash] = stored.split(":");
    return timingSafeEqual(scryptSync(pin, Buffer.from(salt, "hex"), 32), Buffer.from(hash, "hex"));
  };

  /** Wrong PINs count per wallet; 5 in a row lock it for 5 minutes (checked before comparing). */
  function checkPin(a: string, pin: unknown) {
    const key = `pin:${a}`;
    const att = (db.prepare("SELECT count, locked_until FROM pin_attempts WHERE key = ?").get(key) as { count: number; locked_until: number } | undefined) ?? {
      count: 0,
      locked_until: 0,
    };
    if (att.locked_until > now()) {
      throw new AccountError(429, "PinLocked", `Too many wrong PIN attempts. Try again in ${Math.ceil((att.locked_until - now()) / 60)} min.`);
    }
    const stored = db.prepare("SELECT hash FROM pins WHERE address = ?").get(a) as { hash: string } | undefined;
    if (!stored) throw new AccountError(409, "NoPin", "Set your security PIN first.");
    if (typeof pin === "string" && /^\d{4}$/.test(pin) && pinMatches(pin, stored.hash)) {
      db.prepare("DELETE FROM pin_attempts WHERE key = ?").run(key);
      return;
    }
    const count = att.count + 1;
    if (count >= MAX_ATTEMPTS) {
      db.prepare("INSERT OR REPLACE INTO pin_attempts (key, count, locked_until) VALUES (?, 0, ?)").run(key, now() + LOCK_SECS);
      throw new AccountError(429, "PinLocked", `Too many wrong PIN attempts. Locked for ${LOCK_SECS / 60} minutes.`);
    }
    db.prepare("INSERT OR REPLACE INTO pin_attempts (key, count, locked_until) VALUES (?, ?, 0)").run(key, count);
    const left = MAX_ATTEMPTS - count;
    throw new AccountError(403, "WrongPin", `Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left.`);
  }

  const caller = (req: Request) => {
    const who = getCaller(req)?.toLowerCase();
    if (!who || !ADDRESS.test(who)) throw new AccountError(401, "Unauthorized", "Sign in with your wallet first.");
    ensureUser(who);
    return who;
  };
  const str = (v: unknown, re: RegExp, what: string) => {
    if (typeof v !== "string" || !re.test(v)) throw new AccountError(400, "BadRequest", `invalid ${what}`);
    return v;
  };
  const wrap =
    (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const out = fn(req, res);
        if (out !== undefined) res.json(out);
      } catch (err) {
        if (err instanceof AccountError) return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
        next(err);
      }
    };

  const router = Router();

  // After wallet sign-in: register this device. An account that has a PIN and is bound elsewhere needs the PIN.
  router.post(
    "/auth/device/bind",
    wrap((req) => {
      const a = caller(req);
      const deviceId = str(req.body?.deviceId, DEVICE_ID, "deviceId");
      const deviceKey = str(req.body?.deviceKey, ADDRESS, "deviceKey");
      const bound = db.prepare("SELECT device_id FROM devices WHERE address = ?").get(a) as { device_id: string } | undefined;
      const hasPin = !!db.prepare("SELECT 1 FROM pins WHERE address = ?").get(a);
      if (hasPin && bound && bound.device_id !== deviceId) {
        db.prepare("INSERT OR REPLACE INTO pending_logins (address, device_id, device_key, at) VALUES (?, ?, ?, ?)").run(a, deviceId, deviceKey.toLowerCase(), now());
        return { status: "pin_required" };
      }
      return { status: "ok", user: bind(a, deviceId, deviceKey, false) };
    }),
  );

  // New device, step 2: the PIN moves the account here, de-registers the old device and starts the cooling period.
  router.post(
    "/auth/new-device",
    wrap((req) => {
      const a = caller(req);
      const deviceId = str(req.body?.deviceId, DEVICE_ID, "deviceId");
      const pending = db.prepare("SELECT device_id, device_key, at FROM pending_logins WHERE address = ?").get(a) as
        | { device_id: string; device_key: string; at: number }
        | undefined;
      if (!pending || pending.device_id !== deviceId || now() - pending.at > PENDING_SECS) {
        throw new AccountError(409, "LoginExpired", "Session expired. Sign in with your wallet again.");
      }
      checkPin(a, req.body?.pin);
      return bind(a, deviceId, pending.device_key, true);
    }),
  );

  router.post(
    "/auth/pin",
    wrap((req) => {
      const a = caller(req);
      const deviceId = str(req.body?.deviceId, DEVICE_ID, "deviceId");
      const pin = req.body?.pin;
      const bound = db.prepare("SELECT device_id FROM devices WHERE address = ?").get(a) as { device_id: string } | undefined;
      if (bound?.device_id !== deviceId) throw new AccountError(403, "DeviceNotBound", "This device isn't registered to your account.");
      if (db.prepare("SELECT 1 FROM pins WHERE address = ?").get(a)) throw new AccountError(409, "PinExists", "A security PIN is already set.");
      if (typeof pin !== "string" || !/^\d{4}$/.test(pin) || /^(\d)\1{3}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) {
        throw new AccountError(400, "WeakPin", "Choose a 4-digit PIN that isn't repeated or sequential digits.");
      }
      db.prepare("INSERT INTO pins (address, hash) VALUES (?, ?)").run(a, hashPin(pin));
      return view(a);
    }),
  );

  router.post(
    "/auth/pin/verify",
    wrap((req) => {
      checkPin(caller(req), req.body?.pin);
      return { ok: true };
    }),
  );

  router.post(
    "/auth/device",
    wrap((req) => {
      const a = caller(req);
      const deviceId = str(req.body?.deviceId, DEVICE_ID, "deviceId");
      const bound = db.prepare("SELECT device_id FROM devices WHERE address = ?").get(a) as { device_id: string } | undefined;
      return { valid: !bound || bound.device_id === deviceId };
    }),
  );

  router.get(
    "/users/me",
    wrap((req) => view(caller(req))),
  );

  // Find a person to pay by mobile number (signed-in only; rate-limited in app.ts against enumeration).
  router.get(
    "/users/by-phone/:phone",
    wrap((req, res) => {
      caller(req);
      const phone = String(req.params.phone).replace(/\D/g, "").slice(-10);
      if (!/^[6-9]\d{9}$/.test(phone)) throw new AccountError(400, "BadRequest", "Enter a valid 10-digit mobile number.");
      const u = db.prepare("SELECT address FROM users WHERE phone = ?").get(phone) as { address: string } | undefined;
      res.json(u ? contact(u.address) : null);
    }),
  );

  // Everyone you've had an agreement or deal with, most recent first. Only your own list.
  router.get(
    "/people",
    wrap((req) => {
      const a = caller(req);
      const q = req.query.address;
      if (q !== undefined && (typeof q !== "string" || q.toLowerCase() !== a)) throw new AccountError(403, "Forbidden", "you can only list your own people");
      const last = new Map<string, number>();
      const touch = (other: string, t: number) => {
        const o = other.toLowerCase();
        if (o && o !== a) last.set(o, Math.max(last.get(o) ?? 0, t));
      };
      const hasTable = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
      if (hasTable("drafts")) {
        for (const r of db.prepare("SELECT buyer, seller, updated_at AS t FROM drafts WHERE buyer = ? OR seller = ?").all(a, a) as { buyer: string; seller: string; t: number }[]) {
          touch(r.buyer === a ? r.seller : r.buyer, r.t);
        }
      }
      for (const r of db
        .prepare("SELECT buyer, seller, CAST(strftime('%s', created_at) AS INTEGER) AS t FROM deals WHERE lower(buyer) = ? OR lower(seller) = ?")
        .all(a, a) as { buyer: string; seller: string; t: number }[]) {
        touch(r.buyer.toLowerCase() === a ? r.seller : r.buyer, r.t ?? 0);
      }
      return [...last]
        .map(([addr, t]) => contact(addr, t))
        .filter((c): c is ContactView => !!c)
        .sort((x, y) => (y.lastActivity ?? 0) - (x.lastActivity ?? 0));
    }),
  );

  return {
    router,
    view,
    contact,
    isArbitrator: (address: string) => arbitrators.has(address.toLowerCase()),
    displayName: (address: string) => {
      const u = db.prepare("SELECT name FROM users WHERE address = ?").get(address.toLowerCase()) as { name: string | null } | undefined;
      return u?.name ?? (arbitrators.has(address.toLowerCase()) ? "Arbitrator Desk" : "");
    },
    /** Device-key registry for B2's approve-sow: the caller's bound device key may sign for them. */
    isAuthorizedSigner: (callerAddress: string, signer: string) => {
      const d = db.prepare("SELECT device_key FROM devices WHERE address = ?").get(callerAddress.toLowerCase()) as { device_key: string } | undefined;
      return !!d && d.device_key === signer.toLowerCase();
    },
    /** KYC form → profile (the PAN is never stored). Throws AccountError on invalid/duplicate phone. */
    saveKycProfile(address: string, name: unknown, phone: unknown) {
      const a = address.toLowerCase();
      const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
      if (n.length < 2 || n.length > 100) throw new AccountError(400, "BadRequest", "Enter your full name as on your ID.");
      const p = typeof phone === "string" ? phone.replace(/\D/g, "").slice(-10) : "";
      if (!/^[6-9]\d{9}$/.test(p)) throw new AccountError(400, "BadRequest", "Enter a valid 10-digit mobile number.");
      const taken = db.prepare("SELECT address FROM users WHERE phone = ?").get(p) as { address: string } | undefined;
      if (taken && taken.address !== a) throw new AccountError(409, "PhoneTaken", "This mobile number is already registered to another account.");
      ensureUser(a);
      db.prepare("UPDATE users SET name = ?, phone = ?, kyc_level = MAX(kyc_level, 1) WHERE address = ?").run(n, p, a);
      return view(a);
    },
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
export { AccountError };
