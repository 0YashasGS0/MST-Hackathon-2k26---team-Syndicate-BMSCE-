"use client";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Field, Hash, inputCls, MockNote, PageHeader } from "@/components/ui";

type Step = "form" | "uploading" | "sign" | "resolving";

export default function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [evidenceHash, setEvidenceHash] = useState<string>();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStep("uploading");
    const r = await api.uploadEvidence(id, new FormData(e.currentTarget));
    setEvidenceHash(r.hash);
    setStep("sign");
  }

  async function signAndResolve() {
    // TODO(FE): raiseDispute(id, evidenceHash) via the user's wallet, then POST /resolve.
    setStep("resolving");
    await api.resolve(id);
    router.push(`/deals/${id}/resolution`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Raise a dispute"
        subtitle="The AI scores each deliverable against the SOW. It can only propose a split; you can accept or escalate."
      />
      <Card>
        {step === "form" || step === "uploading" ? (
          <form onSubmit={submit} className="space-y-5">
            <Field label="What went wrong?" hint="Refer to deliverable IDs (D1, D2…) where you can.">
              <textarea name="complaint" required rows={6} className={inputCls} />
            </Field>
            <Field label="Evidence" hint="Screenshots, logs, emails. Each file is hashed and the hash goes on-chain.">
              <input name="files" type="file" multiple className="text-sm" />
            </Field>
            <div className="flex justify-end">
              <Button variant="danger" disabled={step === "uploading"}>
                {step === "uploading" ? "Uploading…" : "Upload evidence"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              Evidence hash: <Hash value={evidenceHash!} />
            </p>
            <Button onClick={signAndResolve} disabled={step === "resolving"}>
              {step === "resolving" ? "AI is scoring…" : "Sign raiseDispute & ask the AI"}
            </Button>
          </div>
        )}
        <MockNote>signing is skipped; the resolution comes from mock data.</MockNote>
      </Card>
    </div>
  );
}
