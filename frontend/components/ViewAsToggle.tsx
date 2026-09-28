"use client";
import { useSession } from "./session";

/** Demo-only switch so one browser can act as either party while the API is mocked. */
export function ViewAsToggle() {
  const { viewAs, setViewAs } = useSession();
  return (
    <div className="inline-flex rounded-lg border border-line p-0.5 text-xs" title="Demo: act as buyer or seller">
      {(["buyer", "seller"] as const).map((p) => (
        <button
          key={p}
          onClick={() => setViewAs(p)}
          className={`rounded-md px-3 py-1 capitalize ${viewAs === p ? "bg-accent text-accent-fg" : "text-muted"}`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
