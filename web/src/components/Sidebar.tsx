import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { HelpCircle } from "lucide-react";
import { NAV } from "../nav.ts";
import { apiGet } from "../api/client.ts";
import { Logo } from "./Logo.tsx";

export function Sidebar() {
  const version = useQuery({ queryKey: ["version"], queryFn: () => apiGet<{ version: string }>("/api/version") });
  return (
    <aside className="w-60 shrink-0 border-r border-[var(--border)] bg-[var(--sidebar)] flex flex-col">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-[var(--border)]">
        <Logo />
        <div className="leading-tight">
          <div className="font-semibold">PhotoFrame</div>
          <div className="text-[11px] text-[var(--muted)]">
            e-paper control{version.data ? ` · v${version.data.version}` : ""}
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-[var(--hover)] text-[var(--text)] font-medium"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-[var(--border)]">
        <NavLink
          to="/howto"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              isActive
                ? "bg-[var(--hover)] text-[var(--text)] font-medium"
                : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
            }`
          }
        >
          <HelpCircle size={18} />
          How-to
        </NavLink>
      </div>
      <div className="px-4 pb-4 text-[11px] text-[var(--muted)]">
        Immich → Spectra-6 backend
      </div>
    </aside>
  );
}
