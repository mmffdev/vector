import type {ReactNode} from 'react';

export default function RateLimit({rpm}: {rpm: number}): ReactNode {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 10px',
      borderRadius: '4px',
      background: 'var(--ifm-color-warning-contrast-background)',
      border: '1px solid var(--ifm-color-warning-dark)',
      fontSize: '0.8rem',
      margin: '4px 0',
    }}>
      ⚡ Rate limit: <strong>{rpm} req/min</strong>
    </div>
  );
}
