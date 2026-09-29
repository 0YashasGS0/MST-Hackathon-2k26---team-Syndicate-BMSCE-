"use client";
// Read someone's Sakshi QR — live from the camera, or from an image on this device (pick, drag & drop, or
// paste a screenshot) — and jump straight to Pay / Request with them selected.
import jsQR from "jsqr";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UploadIcon } from "@/components/icons";
import { BackBar, cx, Screen } from "@/components/ui";

/** Accepts our own QR links (any host, so a laptop-made QR works on a phone) and returns the in-app path. */
function toAppPath(text: string): string | null {
  try {
    const u = new URL(text);
    if (u.pathname === "/pay/new" && u.searchParams.get("to")) return `${u.pathname}${u.search}`;
  } catch {}
  return null;
}

function decode(source: CanvasImageSource, w: number, h: number, canvas: HTMLCanvasElement) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  return jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
}

export default function ScanPage() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string>();
  const [cameraOn, setCameraOn] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let frame = 0;
    let stopped = false;

    function handle(text: string | null) {
      if (!text) return false;
      const path = toAppPath(text);
      if (path) {
        stopped = true;
        router.push(path);
        return true;
      }
      setError(text.startsWith("upi:") ? "That's a UPI merchant QR. Scan a Sakshi QR to pay safely." : "That isn't a Sakshi QR code.");
      return false;
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera isn't available here (it needs https or localhost). Upload a photo of the QR instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setCameraOn(true);
        const tick = () => {
          if (stopped) return;
          if (v.readyState >= 2 && canvas.current) {
            const scale = Math.min(1, 640 / v.videoWidth);
            if (handle(decode(v, Math.round(v.videoWidth * scale), Math.round(v.videoHeight * scale), canvas.current))) return;
          }
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError("Couldn't open the camera. Allow camera access, or upload a photo of the QR.");
      }
    }
    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [router]);

  // Paste a screenshot of a QR (Ctrl/Cmd+V) anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) fromFile(f);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  async function fromFile(file: File | undefined) {
    if (!file || !canvas.current) return;
    setError(undefined);
    if (!file.type.startsWith("image/")) return setError("Choose an image file (PNG, JPG or a screenshot).");
    let img: ImageBitmap;
    try {
      img = await createImageBitmap(file);
    } catch {
      return setError("Couldn't read that image.");
    }
    const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
    const text = decode(img, Math.round(img.width * scale), Math.round(img.height * scale), canvas.current);
    if (!text) return setError("No QR code found in that image. Try a sharper or closer picture.");
    const path = toAppPath(text);
    if (path) router.push(path);
    else setError("That isn't a Sakshi QR code.");
  }

  return (
    <>
      <BackBar href="/qr" title="Scan QR" />
      <Screen className="pt-5">
        <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-black">
          <video ref={video} playsInline muted className="h-full w-full object-cover" />
          {/* viewfinder */}
          <div className="pointer-events-none absolute inset-10 rounded-3xl border-2 border-white/80 shadow-[0_0_0_999px_rgb(0_0_0/0.35)]" />
          {!cameraOn && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
              {error ? "" : "Starting camera…"}
            </div>
          )}
        </div>
        <canvas ref={canvas} className="hidden" />

        <p className="mt-4 text-center text-sm text-muted">Point the camera at a Sakshi QR code</p>
        {error && <p className="mt-3 rounded-2xl bg-warning/10 px-4 py-3 text-center text-sm text-warning">{error}</p>}

        <label
          id="upload"
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            fromFile(e.dataTransfer.files[0]);
          }}
          className={cx(
            "mx-auto mt-5 flex w-full max-w-sm cursor-pointer flex-col items-center gap-1 rounded-3xl border-2 border-dashed px-6 py-6 text-center transition",
            dragging ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-surface-2",
          )}
        >
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent-soft text-accent">
            <UploadIcon className="h-5 w-5" />
          </span>
          <span className="mt-1 text-sm font-semibold">Upload QR image from this device</span>
          <span className="text-xs text-muted">Choose a photo or screenshot · drag &amp; drop · or paste with Ctrl+V</span>
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => (fromFile(e.target.files?.[0]), (e.target.value = ""))} />
        </label>
      </Screen>
    </>
  );
}
