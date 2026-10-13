import { useEffect, useRef } from "react";
import { closeAllSerialSessions } from "../serial.ts";

// Lazily load esp-web-tools (registers the <esp-web-install-button> custom element).
let espLoaded: Promise<unknown> | null = null;
function loadEsp(): Promise<unknown> {
  if (!espLoaded) espLoaded = import("esp-web-tools");
  return espLoaded;
}

export function FlashButton({
  board,
  label = "Connect & Flash",
  onFinished,
}: {
  board: string;
  label?: string;
  onFinished?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest callback without re-running the (port-grabbing) effect.
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  useEffect(() => {
    let cancelled = false;
    // Release any port our USB log / Wake button is holding, so esp-web-tools can open it.
    Promise.all([loadEsp(), closeAllSerialSessions()]).then(() => {
      if (cancelled || !ref.current) return;
      ref.current.innerHTML = "";
      const el = document.createElement("esp-web-install-button");
      el.setAttribute("manifest", `/api/firmware/${board}/manifest.json`);
      el.addEventListener("state-changed", (e) => {
        // esp-web-tools FlashState; "FINISHED" = firmware written successfully.
        if ((e as CustomEvent).detail?.state === "FINISHED") onFinishedRef.current?.();
      });

      const btn = document.createElement("button");
      btn.setAttribute("slot", "activate");
      btn.textContent = label;
      btn.className =
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer";
      el.appendChild(btn);

      const unsupported = document.createElement("span");
      unsupported.setAttribute("slot", "unsupported");
      unsupported.className = "text-sm text-amber-600";
      unsupported.textContent = "This browser can't flash — use Chrome/Edge over https or localhost.";
      el.appendChild(unsupported);

      ref.current.appendChild(el);
    });
    return () => {
      cancelled = true;
    };
  }, [board, label]);

  return <div ref={ref} />;
}
