# Security

Funds are held by the `DealEscrow` contract on MST; the backend can never move them on its own. The AI agent can
only *propose* a split (computed by `shared/` code, not the LLM), and both parties must accept it, or a human
arbitrator rules. This file lists the web-side defenses and what they do and do not cover.

## Controls

| Threat | Control | Where |
|---|---|---|
| Impersonation | Identity comes only from PG's signed session cookie (EIP-4361-style wallet sign-in, single-use nonce, HMAC, `HttpOnly`, `SameSite=Lax`, `Secure` in prod). The `x-user-address` dev header is refused in production. | `backend/src/auth.ts`, `security.ts` |
| Unsafe deployment | Production start fails on dev auth, missing/weak secrets, wildcard CORS or demo fallbacks. | `security.ts` `configProblems` |
| Privileged actions by users | KYC approval, arbitration and the case list need `X-Admin-Token` (constant-time compare), not the public API key. | `routes/kyc.ts`, `routes/{deals,resolve}.ts` |
| Acting on someone else's deal | Delivery (seller), evidence, dispute scoring and timeout (buyer/seller) are checked against the **on-chain** parties before any write. Drafts/SOWs: parties only; drafts are listable only by their own parties. | `dealAccess.ts`, `sow/router.ts` |
| Forged SOW approval | Signatures are recovered with viem over the exact `sowHash`; only the caller (or a registered device key) is accepted. Versions are re-checked inside the write transaction. | `sow/router.ts` |
| CSRF / cross-origin abuse | Exact-origin CORS allowlist with credentials; `SameSite=Lax` cookie; JSON-only APIs. | `security.ts` `corsMiddleware` |
| XSS (device keys are in `localStorage`) | Strict CSP (no third-party scripts, no `eval` in prod, `object-src 'none'`, `base-uri`/`form-action 'self'`), React escaping, no `dangerouslySetInnerHTML`. | `frontend/next.config.ts` |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` on both apps. | `next.config.ts`, `security.ts` |
| Brute force / DoS / cost abuse | Per-IP rate limits: global, sign-in, uploads, and LLM/wallet routes (`/resolve`, `/timeout`, `/merge-sow`, `/onramp`, admin). Body limit 100 KB; server header/request timeouts. | `security.ts`, `app.ts`, `index.ts` |
| Malicious uploads | 10 MB/file, 5 files, MIME allowlist, random server-side names (the client filename is never used as a path), files never served back. Rejected KYC uploads are deleted. | `security.ts` `safeUpload` |
| Prompt injection | Party text is wrapped in escaped `<data>` blocks; the LLM output is schema-validated; money/deadlines/parties are server-controlled; the split is computed by code (`computeBuyerBps`), so injected text can't set it. Eval scenario D tests this. | `backend/src/agent/*` |
| SQL injection | All queries are parameterized (`better-sqlite3` prepared statements). | everywhere |
| Info leaks | Generic 500s (details logged, never sent), no `X-Powered-By`, `no-referrer`, chain/LLM error text trimmed. | `security.ts` `errorHandler` |
| Tampered ruling | Anyone can recompute `reasoningHash` and the split in the browser (`verifyRuling` + `split.wasm`) against the chain. | `shared/` |
| Supply chain | Lockfiles committed; `npm audit` (0 known issues at release) in CI; `multer` 2.x. | `.github/workflows/ci.yml` |
| Container escape / blast radius | Non-root images, read-only root FS, `no-new-privileges`, all capabilities dropped, data on a volume. | `Dockerfile`s, `docker-compose.yml` |

## Known limits (accepted for the hackathon)
- `BACKEND_API_KEY` ships to the browser: it throttles casual abuse, it is **not** authentication.
- The device-key registry (`isAuthorizedSigner`) isn't implemented yet, so only wallet-key signatures are accepted on `approve-sow`.
- The frontend's demo wallet (burner key in `localStorage`) and the mock backend are for demos; the mock backend is
  off in production unless `ENABLE_MOCK_BACKEND=true`.
- Rate limits are in-memory, per instance. Put a shared store (Redis) behind `express-rate-limit` before scaling out.
- Testnet only: system wallets hold test funds. For mainnet, move keys to a KMS/HSM and add monitoring.

## Reporting
Found an issue? Open a private security advisory on the GitHub repository (Security → Report a vulnerability), not a public issue.
