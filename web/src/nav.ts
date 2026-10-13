import {
  LayoutDashboard,
  Images,
  CalendarClock,
  SlidersHorizontal,
  Sparkles,
  Layers,
  Boxes,
  Activity,
  ScrollText,
  Send,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/albums", label: "Albums", icon: Images },
  { to: "/profiles", label: "Profiles", icon: SlidersHorizontal },
  { to: "/scheduler", label: "Scheduler", icon: CalendarClock },
  { to: "/genai", label: "GenAI", icon: Sparkles },
  { to: "/overlays", label: "Overlays", icon: Layers },
  { to: "/groups", label: "Groups", icon: Boxes },
  { to: "/telegram", label: "Telegram", icon: Send },
  { to: "/usage", label: "Usage", icon: Activity },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
];
