import type {ReactNode} from 'react';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Props {
  method: Method;
  path: string;
  auth: 'none' | 'bearer';
}

const methodClass: Record<Method, string> = {
  GET: 'method-get',
  POST: 'method-post',
  PATCH: 'method-patch',
  PUT: 'method-put',
  DELETE: 'method-delete',
};

export default function EndpointHeader({method, path, auth}: Props): ReactNode {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: '10px', margin: '8px 0 16px', flexWrap: 'wrap'}}>
      <span className={`method-badge ${methodClass[method]}`}>{method}</span>
      <code style={{fontSize: '0.95rem'}}>{path}</code>
      {auth === 'bearer' && (
        <span style={{fontSize: '0.75rem', color: 'var(--ifm-color-emphasis-600)'}}>🔒 Bearer token</span>
      )}
    </div>
  );
}
