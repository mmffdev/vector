import type {ReactNode} from 'react';

type Role = 'gadmin' | 'padmin' | 'user' | 'any';

const label: Record<Role, string> = {
  gadmin: 'gadmin only',
  padmin: 'padmin only',
  user: 'authenticated user',
  any: 'any role',
};

export default function AuthGate({role}: {role: Role}): ReactNode {
  return (
    <span className={`role-badge role-${role}`}>{label[role]}</span>
  );
}
