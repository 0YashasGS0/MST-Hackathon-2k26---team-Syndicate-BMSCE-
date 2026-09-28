// Single RPC endpoint for the fake backend in lib/mocks.ts. Dev/demo only: lib/api.ts calls this for every
// endpoint not yet listed in NEXT_PUBLIC_LIVE_ENDPOINTS. Delete once the real backend is live.
import * as mock from "@/lib/mocks";

type Fn = (...args: unknown[]) => Promise<unknown>;
const fns = mock as unknown as Record<string, Fn | string>;

export async function POST(req: Request) {
  const { fn, args } = (await req.json()) as { fn: string; args: unknown[] };
  const f = fns[fn];
  if (typeof f !== "function") return Response.json({ error: `Unknown mock function: ${fn}` }, { status: 404 });
  try {
    return Response.json({ result: (await f(...(args ?? []))) ?? null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
