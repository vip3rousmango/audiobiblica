import React from 'react';
import { Icon, IconName } from './Icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
}

export const Button: React.FC<ButtonProps> = ({ variant = 'secondary', size = 'md', icon, children, className = '', ...props }) => (
  <button className={`button button-${variant} button-${size} ${className}`} {...props}>
    {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
    {children}
  </button>
);

export const StatusDot: React.FC<{ tone?: 'success' | 'warning' | 'danger' | 'neutral'; label?: string }> = ({ tone = 'neutral', label }) => (
  <span className={`status-dot status-${tone}`}>
    <span className="status-dot-core" aria-hidden="true" />
    {label && <span>{label}</span>}
  </span>
);

export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="eyebrow">{children}</p>
);

export const PageHeader: React.FC<{
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}> = ({ eyebrow, title, description, actions }) => (
  <header className="page-header">
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1>{title}</h1>
      <p className="page-description">{description}</p>
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>
);

export const SectionHeading: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ title, description, action }) => (
  <div className="section-heading">
    <div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
    {action && <div>{action}</div>}
  </div>
);

export const Surface: React.FC<{ children: React.ReactNode; className?: string; as?: 'section' | 'div'; style?: React.CSSProperties }> = ({ children, className = '', as = 'section', style }) => {
  const Component = as;
  return <Component className={`surface ${className}`} style={style}>{children}</Component>;
};

export const EmptyState: React.FC<{
  icon?: IconName;
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ icon = 'layers', title, description, action }) => (
  <div className="empty-state">
    <div className="empty-icon"><Icon name={icon} size={22} /></div>
    <h3>{title}</h3>
    <p>{description}</p>
    {action && <div className="empty-action">{action}</div>}
  </div>
);

export const InlineNotice: React.FC<{
  tone?: 'info' | 'warning' | 'success' | 'danger';
  icon?: IconName;
  children: React.ReactNode;
}> = ({ tone = 'info', icon = tone === 'success' ? 'check' : tone === 'danger' ? 'x' : 'activity', children }) => (
  <div className={`inline-notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
    <Icon name={icon} size={16} />
    <span>{children}</span>
  </div>
);
