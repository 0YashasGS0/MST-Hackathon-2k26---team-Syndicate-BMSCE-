import { ButtonLink, Card } from "@/components/ui";

const steps = [
  { n: 1, title: "Agree", body: "Buyer and seller state their terms. AI merges them into a weighted SOW; both commit the same hash on MST." },
  { n: 2, title: "Fund", body: "Pay with UPI. Stablecoin is minted and locked in the escrow contract — not in anyone's wallet." },
  { n: 3, title: "Deliver", body: "Seller delivers and marks it on-chain. Buyer releases, or the timeout pays the seller." },
  { n: 4, title: "Resolve", body: "On dispute, AI scores each deliverable, a fixed formula computes the split, and the parties accept or escalate." },
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="py-10 text-center">
        <p className="text-sm font-medium text-accent">Escrow on MST Blockchain</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Pay for work with a witness that can&apos;t be bribed.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-muted">
          The AI can only propose. Money moves only by buyer release, mutual agreement, timeout, or an arbitrator&apos;s
          ruling — enforced by the contract.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <ButtonLink href="/login">Get started</ButtonLink>
          <ButtonLink href="/dashboard" variant="secondary">
            Open dashboard
          </ButtonLink>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <Card key={s.n}>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-accent/15 text-sm font-semibold text-accent">{s.n}</div>
            <h3 className="mt-3 font-semibold">{s.title}</h3>
            <p className="mt-1 text-sm text-muted">{s.body}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
