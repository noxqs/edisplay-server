import { Link } from "react-router-dom";
import { Images, SlidersHorizontal, CalendarClock, LayoutDashboard, Plug, type LucideIcon } from "lucide-react";
import { PageHeader, Card } from "../components/ui.tsx";

interface Step {
  icon: LucideIcon;
  title: string;
  to: string;
  toLabel: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    icon: Plug,
    title: "Connect Immich",
    to: "/settings",
    toLabel: "Settings",
    body: "Point the server at your Immich instance (URL + API key). This is where all your photos come from — the Dashboard shows a green “connected” chip once it's linked.",
  },
  {
    icon: Images,
    title: "Pick your albums",
    to: "/albums",
    toLabel: "Albums",
    body: "Choose which Immich albums the frames are allowed to draw from. Everything downstream selects photos out of these albums.",
  },
  {
    icon: SlidersHorizontal,
    title: "Create profiles",
    to: "/profiles",
    toLabel: "Profiles",
    body: "A profile is a recipe: which album(s) to pull from, plus which overlays to show (battery, weather, next photo, dates…) and the selection logic. Make one per “look” you want — e.g. “Family”, “Landscapes”.",
  },
  {
    icon: CalendarClock,
    title: "Build a schedule",
    to: "/scheduler",
    toLabel: "Scheduler",
    body: "Paint a profile onto each hour of the week. This is what lets a frame show different profiles at different times of day — e.g. kids' photos during the day, calm landscapes at night.",
  },
  {
    icon: LayoutDashboard,
    title: "Add devices & assign the schedule",
    to: "/",
    toLabel: "Dashboard",
    body: "Register each frame and assign it a schedule. That's it — you don't pick a profile on the device, because the schedule decides which profile to show based on the time.",
  },
];

export function HowTo() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="How it works" subtitle="The setup flow, start to finish." />

      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <Card key={s.to} className="flex gap-4">
            <div className="flex flex-col items-center shrink-0">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--hover)] text-sm font-semibold">
                {i + 1}
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <s.icon size={16} className="text-[var(--muted)]" />
                <h2 className="font-semibold">{s.title}</h2>
              </div>
              <p className="text-sm text-[var(--muted)] mt-1">{s.body}</p>
              <Link to={s.to} className="inline-block mt-2 text-sm text-blue-500 hover:underline">
                Go to {s.toLabel} →
              </Link>
            </div>
          </Card>
        ))}
      </ol>

      <Card className="mt-3 border-dashed">
        <p className="text-sm text-[var(--muted)]">
          <span className="text-[var(--text)] font-medium">Why no profile on the device?</span> Because the
          schedule already maps each hour to a profile. Assigning the schedule to a frame is enough — the
          shown profile changes automatically as the day goes on.
        </p>
      </Card>
    </div>
  );
}
