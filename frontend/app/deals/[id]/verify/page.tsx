import Link from "next/link";
import { api } from "@/lib/api";
import { fmtBps } from "@/lib/format";
import { Card, Hash, MockNote, PageHeader } from "@/components/ui";

// Target design: this runs in the browser — split.wasm recomputes buyerBps, shared/hash.ts recomputes
// the reasoning hash, and the on-chain hash is read straight from MST (getDeal), not from our API.
export default async function VerifyPage(props: PageProps<"/deals/[id]/verify">) {
  const { id } = await props.params;
  const v = await api.verify(id);

  const checks = [
    { label: "Split recomputed from scores (split.wasm)", ok: true, value: fmtBps(v.recomputedBuyerBps) },
    { label: "Reasoning hash recomputed (shared/hash.ts)", ok: true, value: <Hash value={v.recomputedHash} /> },
    {
      label: "Matches hash committed on MST (getDeal)",
      ok: v.recomputedHash === v.onchainReasoningHash,
      value: <Hash value={v.onchainReasoningHash} />,
    },
  ];
  const allOk = checks.every((c) => c.ok);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Verify the AI ruling"
        subtitle={
          <>
            <Link href={`/deals/${id}`} className="hover:underline">
              Deal #{id}
            </Link>{" "}
            · Don&apos;t trust our server — check it yourself.
          </>
        }
      />

      <Card>
        <div className={`mb-5 rounded-lg p-4 text-center ${allOk ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
          <p className="text-3xl">{allOk ? "✅" : "❌"}</p>
          <p className="mt-1 font-semibold">{allOk ? "Ruling verified" : "Mismatch — the ruling was changed"}</p>
        </div>
        <ul className="divide-y divide-line">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center justify-between gap-4 py-3 text-sm">
              <span>
                <span className={c.ok ? "text-success" : "text-danger"}>{c.ok ? "✓" : "✗"}</span> {c.label}
              </span>
              <span>{c.value}</span>
            </li>
          ))}
        </ul>
        <MockNote>values come from the mocked /verify; browser-side recomputation lands in hour 8–10.</MockNote>
      </Card>

      <Card title="Reasoning object (what was hashed)" className="mt-4">
        <pre className="max-h-96 overflow-auto rounded-lg bg-surface-2 p-4 text-xs">{JSON.stringify(v.reasoning, null, 2)}</pre>
      </Card>
    </div>
  );
}
