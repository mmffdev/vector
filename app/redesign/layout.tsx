import "./shell.css";
import { NavPrefsProvider } from "@/app/contexts/NavPrefsContext";
import { ShellProvider } from "./ShellContext";
import IconRail from "./components/nav_primary_rail_1";
import SectionFlyout from "./components/nav_primary_rail_2";
import RedesignTopBar from "./components/RedesignTopBar";

export default function RedesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <NavPrefsProvider>
      <ShellProvider>
        <div className="rd-shell">
          <IconRail />
          <SectionFlyout />
          <main className="rd-shell__main">
            <RedesignTopBar />
            <div className="rd-shell__main-body">{children}</div>
          </main>
        </div>
      </ShellProvider>
    </NavPrefsProvider>
  );
}
