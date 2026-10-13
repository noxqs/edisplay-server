// Polls the backend liveness endpoint and shows a blocking modal when it's
// unreachable (e.g. the server crashed or never started). Recovers on its own
// once the backend answers again.
import { useQuery } from "@tanstack/react-query";
import { ServerCrash } from "lucide-react";

async function probe(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { headers: { Accept: "application/json" } });
    return res.ok;
  } catch {
    return false;
  }
}

export function BackendGuard() {
  const { data, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: probe,
    refetchInterval: 5000,
    retry: false,
  });

  // Don't flash the modal on the very first load before we know anything.
  const offline = !isLoading && data === false;
  if (!offline) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl text-center">
        <div className="flex justify-center mb-3 text-red-500">
          <ServerCrash size={40} />
        </div>
        <h2 className="font-semibold text-lg mb-2">Backend not reachable</h2>
        <p className="text-sm text-[var(--muted)] mb-4">
          The web UI can't reach the API server on this host. It probably crashed or didn't start.
          Check the terminal running <code>npm run dev</code> for an error.
        </p>
        <p className="text-xs text-[var(--muted)]">
          Retrying automatically every 5s… this will close once the server is back.
        </p>
      </div>
    </div>
  );
}
