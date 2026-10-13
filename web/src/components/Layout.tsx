import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar.tsx";

export function Layout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-5 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
