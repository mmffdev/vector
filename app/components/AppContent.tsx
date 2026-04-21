"use client";

interface AppContentProps {
  className?: string;
  children: React.ReactNode;
}

export default function AppContent({ className, children }: AppContentProps) {
  return (
    <viewport className={className}>
      {children}
    </viewport>
  );
}
