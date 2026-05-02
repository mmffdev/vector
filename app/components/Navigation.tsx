"use client";

// PLA-0005 — Navigation primitive (AC14).
//
// Registers itself via useRegisterAddressable({kind: 'navigation', name})
// and provides AddressContext to descendants. No help button — kind
// metadata in the library is helpable=false.
//
// Renders a semantic <nav>; caller composes the link list as children.

import { ReactNode } from "react";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";

interface NavigationProps {
  name: string;
  ariaLabel?: string;
  className?: string;
  children?: ReactNode;
}

export default function Navigation({ name, ariaLabel, className, children }: NavigationProps) {
  const { address, addressable_id, Provider } = useRegisterAddressable({
    kind: "navigation",
    name,
  });

  return (
    <Provider>
      <nav
        className={className ? `navigation ${className}` : "navigation"}
        aria-label={ariaLabel}
        data-addressable-id={addressable_id ?? undefined}
        data-address={address}
      >
        {children}
      </nav>
    </Provider>
  );
}
