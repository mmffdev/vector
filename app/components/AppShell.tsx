"use client";

interface AppShellProps {
  className?: string;
  children: React.ReactNode;
}

export default function AppShell({ className, children }: AppShellProps) {
  return (
    <app-shell className={className}>
      {children}
    </app-shell>
  );
}
