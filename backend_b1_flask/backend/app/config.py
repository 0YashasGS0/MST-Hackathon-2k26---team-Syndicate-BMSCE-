import os
from dotenv import load_dotenv

load_dotenv()


def _get(name, default=""):
    v = os.getenv(name)
    return default if v is None else v.split("#")[0].strip()


class Config:
    MST_RPC_URL = _get("MST_RPC_URL", "https://testnetrpc.mstblockchain.com")
    CHAIN_ID = int(_get("CHAIN_ID", "91562037") or 91562037)
    EXPLORER_URL = _get("EXPLORER_URL").rstrip("/")
    DEPLOY_BLOCK = int(_get("DEPLOY_BLOCK", "0") or 0)
    ESCROW_ADDRESS = _get("ESCROW_ADDRESS")
    USD_ADDRESS = _get("USD_ADDRESS")
    ORG_KEY = _get("ORG_KEY")
    AGENT_KEY = _get("AGENT_KEY")
    ARBITRATOR_KEY = _get("ARBITRATOR_KEY")
    API_KEY = _get("API_KEY")
    ADMIN_TOKEN = _get("ADMIN_TOKEN")
    CORS_ORIGINS = [o.strip() for o in _get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
    DB_PATH = _get("DB_PATH", "data/app.db")
    UPLOAD_DIR = _get("UPLOAD_DIR", "data/uploads")
    B2_SCORER_URL = _get("B2_SCORER_URL")
    USE_STUB_SCORER = _get("USE_STUB_SCORER", "1") == "1"
    GAS_DRIP_MIN = float(_get("GAS_DRIP_MIN", "0.05") or 0.05)
    GAS_DRIP_AMOUNT = float(_get("GAS_DRIP_AMOUNT", "0.1") or 0.1)
    INDEXER_POLL_SECONDS = float(_get("INDEXER_POLL_SECONDS", "2") or 2)
    GAS_PRICE_GWEI = _get("GAS_PRICE_GWEI")
    RUN_INDEXER = _get("RUN_INDEXER", "1") == "1"
    MAX_UPLOAD_BYTES = 10 * 1024 * 1024
