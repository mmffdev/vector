import type {ReactNode} from 'react';

export default function TableDeps({tables}: {tables: string[]}): ReactNode {
  return (
    <div style={{fontSize: '0.8rem', color: 'var(--ifm-color-emphasis-600)', margin: '4px 0 12px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap'}}>
      <span>🗄 Tables:</span>
      {tables.map((t) => (
        <code key={t} style={{fontSize: '0.78rem'}}>{t}</code>
      ))}
    </div>
  );
}
