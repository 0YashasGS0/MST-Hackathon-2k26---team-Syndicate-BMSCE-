"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { CAN_COMPLAIN, fmtInr } from "@/lib/format";
import type { Sow } from "@/lib/types";
import { useUser } from "@/components/session";
import { useDeal } from "@/components/useDeal";
import { Avatar, BackBar, Button, ButtonLink, Card, inputCls, Loading, Screen, SectionTitle } from "@/components/ui";

const MAX_FILES = 10;
const MAX_MB = 50;

type Proof = { file: File; url: string };

export default function ComplaintPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useUser();
  const { deal } = useDeal(id);
  const [sow, setSow] = useState<Sow>();
  const [picked, setPicked] = useState<string[]>([]);
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const proofsRef = useRef(proofs);

  useEffect(() => {
    api.getAgreement(id).then((a) => a && setSow(a.sow));
  }, [id]);

  useEffect(() => {
    proofsRef.current = proofs;
  }, [proofs]);

  // Free preview URLs when leaving the page.
  useEffect(() => () => proofsRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(undefined);
    const incoming = [...list].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const tooBig = incoming.filter((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig.length) setError(`${tooBig.map((f) => f.name).join(", ")} is larger than ${MAX_MB} MB.`);
    const ok = incoming.filter((f) => f.size <= MAX_MB * 1024 * 1024).slice(0, MAX_FILES - proofs.length);
    setProofs((p) => [...p, ...ok.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  function removeProof(i: number) {
    setProofs((p) => {
      URL.revokeObjectURL(p[i].url);
      return p.filter((_, j) => j !== i);
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const form = new FormData(e.currentTarget);
      proofs.forEach((p) => form.append("files", p.file));
      const party = deal!.buyer.toLowerCase() === user.address.toLowerCase() ? "buyer" : "seller";
      await api.raiseComplaint(id, party, form, proofs.map((p) => p.file));
      router.push(`/txn/${id}/resolution`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!deal) return (<><BackBar href={`/txn/${id}`} title="Raise a complaint" /><Loading /></>);

  const other = deal.buyer.toLowerCase() === user.address.toLowerCase() ? deal.sellerName : deal.buyerName;

  if (!CAN_COMPLAIN.includes(deal.status))
    return (
      <>
        <BackBar href={`/txn/${id}`} title="Raise a complaint" />
        <Screen className="pt-10 text-center">
          <p className="font-medium">A complaint can&apos;t be raised for this payment right now.</p>
          <ButtonLink variant="secondary" className="mt-6" href={`/txn/${id}/resolution`}>
            View complaint status
          </ButtonLink>
        </Screen>
      </>
    );

  return (
    <>
      <BackBar href={`/txn/${id}`} title="Raise a complaint" />
      <Screen className="pt-6">
        <Card className="flex items-center gap-3">
          <Avatar name={other} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{other}</p>
            <p className="truncate text-sm text-muted">{deal.title}</p>
          </div>
          <p className="font-semibold">{fmtInr(deal.amount)}</p>
        </Card>
        <p className="mt-3 px-1 text-sm text-muted">
          Your money stays on hold while the complaint is reviewed. We compare the proof against what was agreed and
          suggest a fair split.
        </p>

        <form onSubmit={submit}>
          {sow && (
            <>
              <SectionTitle>What wasn&apos;t done as agreed?</SectionTitle>
              <Card className="divide-y divide-line" flush>
                {sow.deliverables.map((d) => (
                  <label key={d.id} className="flex cursor-pointer items-center gap-3 p-4">
                    <input
                      type="checkbox"
                      name="deliverables"
                      value={d.id}
                      checked={picked.includes(d.id)}
                      onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.id] : p.filter((x) => x !== d.id)))}
                      className="h-5 w-5 accent-[var(--accent)]"
                    />
                    <span className="flex-1 text-sm font-medium">{d.title}</span>
                  </label>
                ))}
              </Card>
            </>
          )}

          <SectionTitle>Describe the problem</SectionTitle>
          <textarea
            name="text"
            required
            rows={5}
            className={inputCls}
            placeholder="What happened? What's missing or not working?"
          />

          <SectionTitle right={<span className="text-xs text-muted">{proofs.length}/{MAX_FILES}</span>}>
            Photos & videos as proof
          </SectionTitle>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {proofs.map((p, i) => (
              <div key={p.url} className="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface-2">
                {p.file.type.startsWith("video/") ? (
                  <video src={p.url} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img src={p.url} alt={p.file.name} className="h-full w-full object-cover" />
                )}
                {p.file.type.startsWith("video/") && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">▶ Video</span>
                )}
                <button
                  type="button"
                  onClick={() => removeProof(i)}
                  aria-label={`Remove ${p.file.name}`}
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white"
                >
                  ✕
                </button>
              </div>
            ))}
            {proofs.length < MAX_FILES && (
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-muted hover:border-accent hover:text-accent">
                <span className="text-2xl">＋</span>
                <span className="text-xs">Add photo / video</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))}
                />
              </label>
            )}
          </div>
          <p className="mt-2 px-1 text-xs text-muted">Screenshots, photos of the work, screen recordings. Up to {MAX_MB} MB each.</p>

          {error && <p className="mt-4 text-sm text-danger">{error}</p>}
          <Button size="lg" variant="primary" className="mt-6 w-full" disabled={busy}>
            {busy ? "Submitting…" : "Submit complaint"}
          </Button>
        </form>
      </Screen>
    </>
  );
}
