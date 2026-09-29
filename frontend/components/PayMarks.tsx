// Simplified payment-method marks in the style checkout pages use (UPI apps, wallet).
// These are lightweight approximations drawn inline; swap in the official SVGs from each brand's
// media kit before any public release.
import { cx } from "./ui";

const base = "grid h-8 min-w-12 place-items-center rounded-lg px-1.5";
const tile = `${base} bg-white ring-1 ring-black/10`;

export function UpiMark({ className }: { className?: string }) {
  return (
    <span className={cx(tile, className)} title="UPI">
      <svg viewBox="0 0 64 24" className="h-4" aria-label="UPI">
        <text x="0" y="19" fontSize="20" fontWeight="800" fontStyle="italic" fill="#4d4d4f" fontFamily="Arial, sans-serif">
          UPI
        </text>
        <path d="M44 3l8 9-8 9z" fill="#f47920" />
        <path d="M51 3l8 9-8 9z" fill="#098041" />
      </svg>
    </span>
  );
}

export function GPayMark() {
  return (
    <span className={tile} title="Google Pay">
      <svg viewBox="0 0 60 24" className="h-4" aria-label="Google Pay">
        <text x="0" y="19" fontSize="20" fontWeight="700" fontFamily="Arial, sans-serif">
          <tspan fill="#4285f4">G</tspan>
          <tspan fill="#5f6368" dx="3">
            Pay
          </tspan>
        </text>
      </svg>
    </span>
  );
}

export function PhonePeMark() {
  return (
    <span className={cx(base, "bg-[#5f259f]")} title="PhonePe">
      <svg viewBox="0 0 24 24" className="h-5" aria-label="PhonePe">
        <text x="12" y="18" textAnchor="middle" fontSize="17" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">
          पे
        </text>
      </svg>
    </span>
  );
}

export function PaytmMark() {
  return (
    <span className={tile} title="Paytm">
      <svg viewBox="0 0 64 24" className="h-4" aria-label="Paytm">
        <text x="0" y="18" fontSize="19" fontWeight="800" fontFamily="Arial, sans-serif">
          <tspan fill="#002e6e">pay</tspan>
          <tspan fill="#00baf2">tm</tspan>
        </text>
      </svg>
    </span>
  );
}

export function BhimMark() {
  return (
    <span className={tile} title="BHIM">
      <svg viewBox="0 0 60 24" className="h-4" aria-label="BHIM">
        <text x="0" y="19" fontSize="19" fontWeight="800" fontFamily="Arial, sans-serif" fill="#1b3a6b">
          BHIM
        </text>
        <path d="M54 4l5 8-5 8z" fill="#f47920" />
      </svg>
    </span>
  );
}

export function WalletMark() {
  return (
    <span className={cx(base, "bg-[#f6851b]")} title="Crypto wallet">
      <svg viewBox="0 0 24 24" className="h-5" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" aria-label="Crypto wallet">
        <path d="M12 2 5 12l7 4 7-4z" />
        <path d="m5 13.5 7 8.5 7-8.5-7 4z" />
      </svg>
    </span>
  );
}
