// Frequently asked questions.
import { ChevronRight } from "@/components/icons";
import { BackBar, Card, Screen, SectionTitle } from "@/components/ui";

const faqs: { group: string; items: [string, string][] }[] = [
  {
    group: "Payments",
    items: [
      [
        "Where is my money while the work is being done?",
        "It's locked in a secure escrow, not in the other person's account and not with us. It can only move when you release it, when you both accept a resolution, when the review window ends, or on an arbitrator's ruling.",
      ],
      [
        "What happens if I forget to release the payment?",
        "After the work is marked delivered you have a review window (shown on the payment). If you don't release it or raise a complaint by then, the other person can claim the money.",
      ],
      [
        "What if the work is never delivered?",
        "If the delivery date passes and nothing was delivered, you can raise a complaint, and you can get your money back.",
      ],
      ["Which payment methods can I use?", "Any UPI app (scan a QR, UPI ID request, or open your UPI app on a phone), or a linked crypto wallet."],
      [
        "Why can't I pay more than ₹5,000 right now?",
        "Your account was moved to this device recently. For your safety, larger payments are paused for 24 hours after registering a new device.",
      ],
    ],
  },
  {
    group: "Agreements",
    items: [
      [
        "Why do both people have to describe the work?",
        "So we have both sides of the story. The agreement is built from both, and anything you disagree on has to be settled by both of you — we never pick a middle ground for you.",
      ],
      [
        "What does signing do?",
        "Your phone creates a digital signature over the exact agreement. If anyone changes even one word later, the signature no longer matches, so the agreement can't be tampered with.",
      ],
      ["Can I change the agreement after signing?", "No. If something needs to change, start a new payment with a new agreement."],
    ],
  },
  {
    group: "Complaints",
    items: [
      [
        "How is a complaint decided?",
        "The proof from both sides is checked against the signed agreement. Each part of the work is scored, and the split follows a fixed rule based on how much of each part was done. Both of you must accept it.",
      ],
      [
        "What if I don't agree with the suggestion?",
        "Tap “Ask an arbitrator”. A human arbitrator reviews everything and makes a final decision. The money stays on hold until then.",
      ],
      ["What proof can I upload?", "Photos, screenshots and videos, up to 50 MB each and up to 10 files."],
    ],
  },
  {
    group: "Account & security",
    items: [
      [
        "Why can I use my account on only one phone?",
        "Like UPI apps, your account is tied to one device. Moving it to a new phone needs an OTP and your security PIN, and your old phone is logged out.",
      ],
      ["Why does the app ask for my PIN so often?", "To make sure it's really you whenever the app is opened and before any money moves."],
      ["I forgot my PIN. What do I do?", "Contact support from Help & support. We'll verify your identity with your KYC details before resetting it."],
      ["Will Sakshi ever ask for my PIN or OTP?", "Never. Don't share them with anyone, even if they say they're from Sakshi."],
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <BackBar href="/account" title="FAQs" />
      <Screen className="pt-2">
        {faqs.map((g) => (
          <section key={g.group}>
            <SectionTitle>{g.group}</SectionTitle>
            <Card flush className="divide-y divide-line/70">
              {g.items.map(([q, a]) => (
                <details key={q} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 sm:px-6">
                    <span className="flex-1 text-[15px] font-semibold tracking-tight">{q}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted transition group-open:rotate-90" />
                  </summary>
                  <p className="px-5 pb-4 text-sm text-muted sm:px-6">{a}</p>
                </details>
              ))}
            </Card>
          </section>
        ))}
      </Screen>
    </>
  );
}
