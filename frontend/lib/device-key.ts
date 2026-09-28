// Per-device signing key, created at first launch and kept on this device only.
// Its public address is registered with the account at login (device binding), and it signs agreements.
// In production this is SARAL's MPC key share; the private key never leaves the device either way.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const KEY = "fe.device.key";

export function deviceAccount() {
  let pk: Hex | null = null;
  try {
    pk = localStorage.getItem(KEY) as Hex | null;
  } catch {}
  if (!pk) {
    pk = generatePrivateKey();
    try {
      localStorage.setItem(KEY, pk);
    } catch {}
  }
  return privateKeyToAccount(pk);
}

export const signHash = (hash: Hex) => deviceAccount().signMessage({ message: { raw: hash } });
