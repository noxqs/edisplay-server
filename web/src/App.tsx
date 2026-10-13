import { Routes, Route, Navigate } from "react-router-dom";
import { BackendGuard } from "./components/BackendGuard.tsx";
import { Layout } from "./components/Layout.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Albums } from "./pages/Albums.tsx";
import { Scheduler } from "./pages/Scheduler.tsx";
import { Profiles } from "./pages/Profiles.tsx";
import { Generation } from "./pages/Generation.tsx";
import { Overlay } from "./pages/Overlay.tsx";
import { Groups } from "./pages/Groups.tsx";
import { Telegram } from "./pages/Telegram.tsx";
import { Usage } from "./pages/Usage.tsx";
import { Logs } from "./pages/Logs.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { HowTo } from "./pages/HowTo.tsx";

export default function App() {
  return (
    <>
      <BackendGuard />
      <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/albums" element={<Albums />} />
        <Route path="/scheduler" element={<Scheduler />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/genai" element={<Generation />} />
        <Route path="/overlays" element={<Overlay />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/telegram" element={<Telegram />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/howto" element={<HowTo />} />
        {/* Devices moved onto the Dashboard; redirect old links there. */}
        <Route path="/devices" element={<Navigate to="/" replace />} />
        {/* Anything else falls back to the Dashboard instead of a blank screen. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      </Routes>
    </>
  );
}
