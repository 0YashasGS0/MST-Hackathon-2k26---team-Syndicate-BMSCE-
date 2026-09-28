import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import json
import os
import tempfile

import pytest
from eth_account import Account
from web3 import EthereumTesterProvider, Web3

from app import create_app
from app.chain import Chain

ART = os.path.join(os.path.dirname(__file__), "artifacts")


class TestCfg:
    MST_RPC_URL = "local"
    CHAIN_ID = 131277322940537  # eth-tester default chain id, set below from the provider
    EXPLORER_URL = "https://explorer.test"
    DEPLOY_BLOCK = 0
    ESCROW_ADDRESS = ""
    USD_ADDRESS = ""
    API_KEY = "test-key"
    ADMIN_TOKEN = "test-admin"
    CORS_ORIGINS = ["http://localhost:3000"]
    B2_SCORER_URL = ""
    USE_STUB_SCORER = True
    GAS_DRIP_MIN = 0.05
    GAS_DRIP_AMOUNT = 0.1
    INDEXER_POLL_SECONDS = 1
    GAS_PRICE_GWEI = ""
    RUN_INDEXER = False
    MAX_UPLOAD_BYTES = 1024 * 1024
    ORG_KEY = AGENT_KEY = ARBITRATOR_KEY = ""


class Env:
    """Local chain + deployed contracts + Flask client + helpers acting as end users."""

    def __init__(self, tmp):
        self.w3 = Web3(EthereumTesterProvider())
        cfg = type("Cfg", (TestCfg,), {})
        cfg.CHAIN_ID = self.w3.eth.chain_id
        cfg.DB_PATH = os.path.join(tmp, "t.db")
        cfg.UPLOAD_DIR = os.path.join(tmp, "up")
        self.users = {n: Account.create() for n in ("org", "agent", "arb", "buyer", "seller", "stranger")}
        for a in self.users.values():
            self.w3.eth.send_transaction({"from": self.w3.eth.accounts[0], "to": a.address, "value": Web3.to_wei(50, "ether")})
        # a user with 0 gas, to test the drip
        self.poor = Account.create()
        cfg.ORG_KEY, cfg.AGENT_KEY, cfg.ARBITRATOR_KEY = (self.users[n].key.hex() for n in ("org", "agent", "arb"))
        usd = json.load(open(f"{ART}/MockUSD.json"))
        esc = json.load(open(f"{ART}/DealEscrow.json"))
        u = self._deploy(usd, [])
        e = self._deploy(esc, [u, self.users["agent"].address, self.users["arb"].address])
        cfg.ESCROW_ADDRESS, cfg.USD_ADDRESS = e, u
        self.cfg = cfg
        self.chain = Chain(cfg, w3=self.w3)
        self.org_send(self.chain.usd.functions.approve(e, 2**256 - 1))
        self.app = create_app(cfg, chain=self.chain, start_indexer=False)
        self.client = self.app.test_client()
        self.hdr = {"X-API-Key": "test-key"}
        self.adm = {**self.hdr, "X-Admin-Token": "test-admin"}

    def _deploy(self, art, args):
        acct = self.users["org"]
        c = self.w3.eth.contract(abi=art["abi"], bytecode=art["bytecode"]["object"])
        tx = c.constructor(*args).build_transaction({"from": acct.address, "nonce": self.w3.eth.get_transaction_count(acct.address),
                                                     "gasPrice": self.w3.eth.gas_price})
        rc = self.w3.eth.wait_for_transaction_receipt(self.w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction))
        return rc["contractAddress"]

    def org_send(self, fn):
        return self.chain.send("org", fn)

    def user_send(self, who, fn):
        """Simulates a user's wallet signing (frontend responsibility in production)."""
        acct = self.users[who]
        tx = fn.build_transaction({"from": acct.address, "nonce": self.w3.eth.get_transaction_count(acct.address),
                                   "gasPrice": self.w3.eth.gas_price, "chainId": self.cfg.CHAIN_ID})
        rc = self.w3.eth.wait_for_transaction_receipt(self.w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction))
        assert rc["status"] == 1, "user tx reverted"
        return rc

    def sync(self):
        return self.app.extensions["svc"].indexer.sync_once()

    def get(self, path, admin=False, **kw):
        return self.client.get(path, headers=self.adm if admin else self.hdr, **kw)

    def post(self, path, admin=False, **kw):
        return self.client.post(path, headers=self.adm if admin else self.hdr, **kw)

    def addr(self, who):
        return self.users[who].address

    def kyc_both(self):
        for w in ("buyer", "seller"):
            assert self.post(f"/admin/kyc/{self.addr(w)}/approve", admin=True).status_code == 200

    def new_accepted_deal(self, amount=100_000_000, review=3600, deliver_in=86400):
        self.kyc_both()
        sow_hash = Web3.keccak(text="sow-v1")
        now = self.w3.eth.get_block("latest")["timestamp"]
        rc = self.user_send("buyer", self.chain.escrow.functions.proposeDeal(self.addr("seller"), amount, sow_hash, now + deliver_in, review))
        deal_id = self.chain.escrow.events.DealProposed().process_receipt(rc)[0]["args"]["id"]
        self.user_send("seller", self.chain.escrow.functions.acceptDeal(deal_id, sow_hash))
        return deal_id

    def fund(self, deal_id, amount):
        self.org_send(self.chain.usd.functions.mint(self.addr("org"), amount))
        return self.org_send(self.chain.escrow.functions.fundFor(deal_id))

    def travel(self, seconds):
        t = self.w3.provider.ethereum_tester
        t.time_travel(self.w3.eth.get_block("latest")["timestamp"] + seconds)
        t.mine_blocks(1)


@pytest.fixture()
def env():
    with tempfile.TemporaryDirectory() as tmp:
        yield Env(tmp)
