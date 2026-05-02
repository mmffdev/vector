"use client";

// PLA-0005 — Table primitive (AC14).
//
// Registers itself via useRegisterAddressable({kind: 'table', name})
// and provides AddressContext to descendants. No help button — kind
// metadata in the library is helpable=false.
//
// Composition: caller provides the full <thead>/<tbody> tree as
// children. The primitive only owns the .table-wrap + .table classes
// from the CSS catalog and the addressable registration.

import { ReactNode } from "react";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";

interface TableProps {
  name: string;
  ariaLabel?: string;
  className?: string;
  children?: ReactNode;
}

export default function Table({ name, ariaLabel, className, children }: TableProps) {
  const { address, addressable_id, Provider } = useRegisterAddressable({
    kind: "table",
    name,
  });

  return (
    <Provider>
      <div
        className="table-wrap"
        data-addressable-id={addressable_id ?? undefined}
        data-address={address}
      >
        <table className={className ? `table ${className}` : "table"} aria-label={ariaLabel}>
          {children}
        </table>
      </div>
    </Provider>
  );
}
