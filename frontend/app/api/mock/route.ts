// Single RPC endpoint for the fake backend in lib/mocks.ts. Dev/demo only: lib/api.ts calls this for every
// endpoint not yet listed in NEXT_PUBLIC_LIVE_ENDPOINTS. Delete once the real backend is live.
// Production builds answer 404 unless the server-side ENABLE_MOCK_BACKEND=true is set (e.g. a demo deployment).
import * as mock from "@/lib/mocks";

type Fn = (...args: unknown[]) => Promise<unknown>;
const fns = mock as unknown as Record<string, Fn | string>;
const enabled = () => process.env.NODE_ENV !== "production" || process.env.ENABLE_MOCK_BACKEND === "true";

export async function POST(req: Request) {
  if (!enabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { fn?: unknown; args?: unknown } | null;
  const fn = body?.fn;
  const args = body?.args ?? [];
  if (typeof fn !== "string" || !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(fn) || !Array.isArray(args)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const f = Object.prototype.hasOwnProperty.call(fns, fn) ? fns[fn] : undefined;
  if (typeof f !== "function") return Response.json({ error: `Unknown mock function: ${fn}` }, { status: 404 });
  try {
    return Response.json({ result: (await f(...args)) ?? null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
