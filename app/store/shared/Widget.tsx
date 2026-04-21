"use client";

interface WidgetProps {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export default function Widget({ title, actions, children, className }: WidgetProps) {
  return (
    <div className={`ui-app-widget ${className ?? ""}`}>
      {(title || actions) && (
        <header className="ui-app-widget__header">
          {title && <h3 className="ui-app-widget__title">{title}</h3>}
          {actions && <div className="ui-app-widget__actions">{actions}</div>}
        </header>
      )}
      <div className="ui-app-widget__body">{children}</div>
    </div>
  );
}
