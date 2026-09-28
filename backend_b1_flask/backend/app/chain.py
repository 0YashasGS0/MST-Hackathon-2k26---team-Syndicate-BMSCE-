"""Web3 clients for MST + every on-chain call the backend makes with a system key.

Keys live only in the process environment. Nothing in here logs or returns a key.
"""
import ast
import json
import os
import re
import threading

from eth_abi import decode as abi_decode
from eth_account import Account
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

from .errors import ApiError

STATUS = ["None", "Proposed", "Accepted", "Funded", "Delivered", "Disputed", "ResolutionProposed",
          "Escalated", "Released", "Refunded", "Resolved", "Cancelled"]
ZERO = "0x" + "00" * 20
BYTES_LITERAL = re.compile(r"""b('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")""")
ABI_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "abi")

# contract custom error -> (api code, http status, human message)
ERROR_MAP = {
    "NotParty": ("not_party", 403, "Only the buyer or seller of this deal can do that."),
    "NotBuyer": ("not_buyer", 403, "Only the buyer can do that."),
    "NotSeller": ("not_seller", 403, "Only the seller can do that."),
    "NotAgent": ("not_agent", 403, "Only the AI agent wallet can propose a resolution."),
    "NotArbitrator": ("not_arbitrator", 403, "Only the arbitrator wallet can rule."),
    "BadStatus": ("bad_status", 409, "The deal is not in the right state for this action."),
    "KycRequired": ("kyc_required", 403, "KYC approval is required for this address."),
    "InvalidParams": ("invalid_params", 400, "The contract rejected the parameters."),
    "TooEarly": ("too_early", 409, "Too early: the review window or deadline has not passed yet."),
    "OwnableUnauthorizedAccount": ("not_owner", 403, "Only the ORG wallet can do that."),
    "ERC20InsufficientBalance": ("insufficient_balance", 409, "Insufficient stablecoin balance."),
    "ERC20InsufficientAllowance": ("insufficient_allowance", 409, "Escrow is not approved to pull the stablecoin."),
}


def load_abi(name: str):
    """Prefer Foundry output (contracts/out/<name>.sol/<name>.json), fall back to backend/abi/."""
    root = os.path.dirname(os.path.dirname(ABI_DIR))
    for p in (os.path.join(root, "contracts", "out", f"{name}.sol", f"{name}.json"),
              os.path.join(ABI_DIR, f"{name}.json")):
        if os.path.exists(p):
            with open(p) as fh:
                data = json.load(fh)
            return data["abi"] if isinstance(data, dict) else data
    raise FileNotFoundError(f"ABI for {name} not found")


def ck(addr: str) -> str:
    try:
        return Web3.to_checksum_address(addr)
    except Exception:
        raise ApiError("bad_address", f"'{addr}' is not a valid address", 400)


class Chain:
    def __init__(self, cfg, w3: Web3 = None):
        self.cfg = cfg
        if w3 is None:
            w3 = Web3(Web3.HTTPProvider(cfg.MST_RPC_URL, request_kwargs={"timeout": 30}))
            # MST is Proof-of-Staked-Authority: block extraData exceeds 32 bytes, which web3 rejects without this
            w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        self.w3 = w3
        self.escrow_abi = load_abi("DealEscrow")
        self.usd_abi = load_abi("MockUSD")
        self.escrow = self.usd = None
        self.set_addresses(cfg.ESCROW_ADDRESS, cfg.USD_ADDRESS)
        self.accounts = {}
        for role, key in (("org", cfg.ORG_KEY), ("agent", cfg.AGENT_KEY), ("arbitrator", cfg.ARBITRATOR_KEY)):
            if key:
                self.accounts[role] = Account.from_key(key)
        self._locks = {}
        self._errors = self._error_table()

    # ------------------------------------------------------------------ setup
    def set_addresses(self, escrow, usd):
        self.escrow_address = ck(escrow) if escrow else None
        self.usd_address = ck(usd) if usd else None
        if self.escrow_address:
            self.escrow = self.w3.eth.contract(address=self.escrow_address, abi=self.escrow_abi)
        if self.usd_address:
            self.usd = self.w3.eth.contract(address=self.usd_address, abi=self.usd_abi)

    def address_of(self, role):
        return self.accounts[role].address if role in self.accounts else None

    def require_ready(self):
        if not self.escrow:
            raise ApiError("not_configured", "ESCROW_ADDRESS is not set. Deploy first and fill .env.", 503)

    # ------------------------------------------------------------- error decode
    def _error_table(self):
        t = {}
        for item in self.escrow_abi + self.usd_abi:
            if item.get("type") == "error":
                types = [i["type"] for i in item.get("inputs", [])]
                sig = f'{item["name"]}({",".join(types)})'
                t[Web3.keccak(text=sig)[:4].hex().removeprefix("0x")] = (item["name"], types)
        return t

    def decode_revert(self, exc) -> ApiError:
        """Turn any web3 / node exception into a readable ApiError."""
        blob = " ".join([str(exc)] + [str(a) for a in getattr(exc, "args", [])] + [str(getattr(exc, "data", ""))])
        candidates = [m.group(1) for m in re.finditer(r"0x([0-9a-fA-F]{8,})", blob)]
        # some providers (eth-tester) hand back the revert data as a python bytes literal: b'\x08]\xe6%'
        for m in BYTES_LITERAL.finditer(blob):
            try:
                v = ast.literal_eval("b" + m.group(1))
                if len(v) >= 4:
                    candidates.append(v.hex())
            except Exception:
                pass
        for raw in candidates:
            sel, body = raw[:8].lower(), raw[8:]
            if sel in self._errors:
                name, types = self._errors[sel]
                try:
                    args = abi_decode(types, bytes.fromhex(body)) if types else ()
                except Exception:
                    args = ()
                code, http, msg = ERROR_MAP.get(name, (name, 409, f"Contract reverted: {name}"))
                extra = {"contract_error": name}
                if name == "BadStatus" and args:
                    cur = STATUS[args[0]] if args[0] < len(STATUS) else str(args[0])
                    msg = f"{msg} Current status: {cur}."
                    extra["current_status"] = cur
                if name == "KycRequired" and args:
                    extra["address"] = args[0]
                    msg = f"KYC approval is required for {args[0]}."
                return ApiError(code, msg, http, **extra)
            if sel == "08c379a0":
                try:
                    return ApiError("reverted", f"Contract reverted: {abi_decode(['string'], bytes.fromhex(body))[0]}", 409)
                except Exception:
                    pass
        m = re.search(r"execution reverted:?\s*([^'\"\}]*)", blob)
        if m:
            return ApiError("reverted", f"Contract reverted: {m.group(1).strip() or 'no reason'}", 409)
        return ApiError("chain_error", "The chain call failed.", 502, detail=str(exc)[:300])

    # ------------------------------------------------------------------ sending
    def _lock(self, addr):
        return self._locks.setdefault(addr, threading.Lock())

    def _gas_price(self):
        if self.cfg.GAS_PRICE_GWEI:
            return Web3.to_wei(float(self.cfg.GAS_PRICE_GWEI), "gwei")
        return self.w3.eth.gas_price

    def send(self, role, fn, wait: bool = True, value: int = 0) -> dict:
        """Sign + send a contract call with a system wallet. Estimates gas first so reverts
        surface as readable errors instead of failed on-chain transactions."""
        # `role` is "org"/"agent"/"arbitrator", or an eth_account LocalAccount (used by the seed script for demo users)
        acct = role if hasattr(role, "sign_transaction") else self.accounts.get(role)
        if not acct:
            raise ApiError("not_configured", f"{str(role).upper()}_KEY is not set in .env", 503)
        with self._lock(acct.address):
            try:
                gas = fn.estimate_gas({"from": acct.address, "value": value})
            except Exception as e:
                raise self.decode_revert(e)
            tx = fn.build_transaction({
                "from": acct.address, "value": value, "gas": int(gas * 1.3) + 10_000,
                "nonce": self.w3.eth.get_transaction_count(acct.address, "pending"),
                "gasPrice": self._gas_price(), "chainId": self.cfg.CHAIN_ID,
            })
            signed = acct.sign_transaction(tx)
            try:
                h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            except Exception as e:
                raise self.decode_revert(e)
        tx_hash = h.hex() if h.hex().startswith("0x") else "0x" + h.hex()
        if not wait:
            return {"tx_hash": tx_hash}
        rc = self.w3.eth.wait_for_transaction_receipt(h, timeout=90, poll_latency=1)
        if rc["status"] != 1:
            raise ApiError("tx_reverted", "Transaction was mined but reverted.", 409, tx_hash=tx_hash)
        return {"tx_hash": tx_hash, "block": rc["blockNumber"], "gas_used": rc["gasUsed"]}

    def send_native(self, role: str, to: str, wei: int) -> dict:
        acct = self.accounts.get(role)
        if not acct:
            raise ApiError("not_configured", f"{role.upper()}_KEY is not set in .env", 503)
        with self._lock(acct.address):
            tx = {"to": ck(to), "value": wei, "gas": 21000, "gasPrice": self._gas_price(),
                  "nonce": self.w3.eth.get_transaction_count(acct.address, "pending"), "chainId": self.cfg.CHAIN_ID}
            h = self.w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)
        rc = self.w3.eth.wait_for_transaction_receipt(h, timeout=90, poll_latency=1)
        tx_hash = h.hex() if h.hex().startswith("0x") else "0x" + h.hex()
        return {"tx_hash": tx_hash, "block": rc["blockNumber"]}

    # -------------------------------------------------------------------- reads
    def get_deal(self, deal_id: int):
        self.require_ready()
        try:
            t = self.escrow.functions.getDeal(int(deal_id)).call()
        except Exception as e:
            raise self.decode_revert(e)
        names = [c["name"] for c in next(f for f in self.escrow_abi if f.get("name") == "getDeal")["outputs"][0]["components"]]
        d = dict(zip(names, t))
        if d["buyer"] == ZERO:
            return None
        d["status"] = STATUS[d["status"]]
        for k in ("sowHash", "deliveryHash", "evidenceHash", "reasoningHash"):
            d[k] = "0x" + bytes(d[k]).hex()
        return d

    def is_kyc(self, addr):
        self.require_ready()
        return bool(self.escrow.functions.kycVerified(ck(addr)).call())

    def native_balance(self, addr):
        return self.w3.eth.get_balance(ck(addr))

    def usd_balance(self, addr):
        return self.usd.functions.balanceOf(ck(addr)).call() if self.usd else 0

    def latest_block(self):
        return self.w3.eth.block_number

    def health(self):
        try:
            return {"connected": True, "chain_id": self.w3.eth.chain_id, "block": self.w3.eth.block_number}
        except Exception as e:
            return {"connected": False, "error": str(e)[:120]}
