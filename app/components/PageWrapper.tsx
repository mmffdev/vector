"use client";

interface PageWrapperProps {
  className?: string;
  children: React.ReactNode;
}

export default function PageWrapper({ className, children }: PageWrapperProps) {
  return (
    <page-wrapper className={className}>
      {children}
    </page-wrapper>
  );
}
