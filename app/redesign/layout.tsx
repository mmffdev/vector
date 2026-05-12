import "./shell.css";
import { ShellProvider } from "./ShellContext";
import IconRail from "./components/IconRail";
import SectionFlyout from "./components/SectionFlyout";

export default function RedesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <div className="rd-shell">
        <IconRail />
        <SectionFlyout />
        <main className="rd-shell__main">{children}</main>
      </div>
    </ShellProvider>
  );
}
