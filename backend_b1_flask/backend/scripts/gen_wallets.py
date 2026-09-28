"""Generate the 5 wallets from the roadmap. Keys go ONLY into .env.wallets (gitignored);
only ADDRESSES are printed - paste those into deployments.md and ask mentors for MSTC.

    python -m scripts.gen_wallets
"""
from eth_account import Account

NAMES = ["ORG", "AGENT", "ARBITRATOR", "DEMO_BUYER", "DEMO_SELLER"]

with open(".env.wallets", "w") as f:
    for n in NAMES:
        a = Account.create()
        f.write(f"{n}_KEY={a.key.hex()}\n")
        print(f"{n:<11} {a.address}")
print("\nKeys written to .env.wallets. Copy them into .env. Never commit or paste them anywhere.")
