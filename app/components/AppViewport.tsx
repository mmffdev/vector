"use client";

interface AppViewportProps {
  className?: string;
  children: React.ReactNode;
}

export default function AppViewport({ className, children }: AppViewportProps) {
  return (
    <app-viewport className={className}>
      {children}
    </app-viewport>
  );
}
