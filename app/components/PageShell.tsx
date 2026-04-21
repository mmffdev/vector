interface PageShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export default function PageShell({ title, subtitle, children, actions }: PageShellProps) {
  return (
    <>
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
        </div>
        {actions && <div>{actions}</div>}
      </header>
      <div className="page-body">{children}</div>
    </>
  );
}
