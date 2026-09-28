"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/components/session";
import { api } from "@/lib/api";
import { Button, Card } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { address, connect, connecting, error } = useSession();

  useEffect(() => {
    if (!address) return;
    api.login(address).then((u) => router.push(u.kycLevel === 0 ? "/kyc" : "/dashboard"));
  }, [address, router]);

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Your wallet signs every deal action. We never hold your keys.</p>

        <div className="mt-6 space-y-3">
          <Button className="w-full" onClick={connect} disabled={connecting}>
            {connecting ? "Connecting…" : "Continue with MetaMask"}
          </Button>
          {/* PG's SARAL adapter goes here (hour 6–9). */}
          <Button className="w-full" variant="secondary" disabled title="Coming soon">
            Continue with SARAL (phone / Google)
          </Button>
        </div>

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        <p className="mt-6 text-xs text-muted">
          No MetaMask? The skeleton signs you in as a demo buyer so you can click through.
        </p>
      </Card>
    </div>
  );
}
