import type {ReactNode} from 'react';

export default function SseBadge(): ReactNode {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '0.72rem',
      fontWeight: 700,
      letterSpacing: '0.05em',
      background: '#5c35cc',
      color: '#fff',
      verticalAlign: 'middle',
      marginLeft: '6px',
    }}>
      SSE
    </span>
  );
}
