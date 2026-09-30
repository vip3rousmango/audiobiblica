import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getHealth } from '../lib/api';
import { Icon, IconName } from './Icon';
import { StatusDot } from './ui';


interface NavigationItem {
  label: string;
  path: string;
  icon: IconName;
  end?: boolean;
  meta?: string;
}

const navigationSections: { label: string; items: NavigationItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Overview', path: '/', icon: 'grid', end: true },
      { label: 'Equipment library', path: '/library', icon: 'library' },
      { label: 'Research queue', path: '/research', icon: 'research' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'AV assistant', path: '/nanobot', icon: 'sparkles' },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { label: 'Advanced tools', path: '/mcp', icon: 'plug' },
    ],
  },
];

const pageTitles: Record<string, string> = {
  '/': 'Overview',
  '/library': 'Equipment library',
  '/research': 'Research queue',
  '/nanobot': 'AV assistant',
  '/mcp': 'Advanced tools',
  '/settings': 'Settings',
};

const commandItems = [
  { label: 'Open overview', path: '/', icon: 'grid' as IconName, section: 'Navigate' },
  { label: 'Open equipment library', path: '/library', icon: 'library' as IconName, section: 'Navigate' },
  { label: 'Open research queue', path: '/research', icon: 'research' as IconName, section: 'Navigate' },
  { label: 'Open AV assistant', path: '/nanobot', icon: 'sparkles' as IconName, section: 'Navigate' },
  { label: 'Open advanced tools', path: '/mcp', icon: 'plug' as IconName, section: 'Navigate' },
  { label: 'Open settings', path: '/settings', icon: 'settings' as IconName, section: 'Navigate' },
];

const CommandPalette: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
  }, [open]);

  if (!open) return null;

  const filteredItems = commandItems.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
  const navigateTo = (path: string) => {
    navigate(path);
    onClose();
  };

  return (
    <div className="command-overlay" role="presentation" onMouseDown={onClose}>
      <div className="command-dialog" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-header">
          <Icon name="search" size={17} />
          <input
            autoFocus
            className="command-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
            placeholder="Jump to a workspace…"
          />
          <span className="command-key">ESC</span>
        </div>
        <div className="command-list">
          <div className="command-section">Navigate</div>
          {filteredItems.length > 0 ? filteredItems.map((item) => (
            <button key={item.path} className="command-item" onClick={() => navigateTo(item.path)}>
              <span className="command-item-icon"><Icon name={item.icon} size={15} /></span>
              <span>{item.label}</span>
              <Icon name="chevron-right" size={14} className="command-key" />
            </button>
          )) : (
            <div className="empty-state" style={{ minHeight: 120 }}>
              <p>No matching workspace.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Layout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [serviceState, setServiceState] = useState<'checking' | 'online' | 'offline'>('checking');
  const currentTitle = pageTitles[location.pathname] ?? 'Workspace';

  const checkService = useCallback(async () => {
    try {
      const health = await getHealth();
      setServiceState(health.status === 'ok' ? 'online' : 'offline');
    } catch {
      setServiceState('offline');
    }
  }, []);

  useEffect(() => {
    void checkService();
    const timer = window.setInterval(() => void checkService(), 15000);
    return () => window.clearInterval(timer);
  }, [checkService, location.pathname]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const navigation = useMemo(() => navigationSections, []);

  return (
    <div className="app-shell">
      {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label="Application navigation">
        <div className="sidebar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark"><Icon name="waveform" size={18} /></span>
            <span className="brand-copy">
              <span className="brand-name">AudioBiblica</span>
              <span className="brand-subtitle">Knowledge system</span>
            </span>
          </NavLink>

          <div className="sidebar-scroll">
            {navigation.map((section) => (
              <nav key={section.label} className="nav-section" aria-label={section.label}>
                <p className="nav-label">{section.label}</p>
                <ul className="nav-list">
                  {section.items.map((item) => (
                    <li key={item.path}>
                      <NavLink
                        end={item.end}
                        to={item.path}
                        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                      >
                        <span className="nav-link-icon"><Icon name={item.icon} size={17} /></span>
                        <span>{item.label}</span>
                        {item.meta && <span className="nav-link-meta">{item.meta}</span>}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>

          <div className="sidebar-footer">
            <NavLink to="/settings" className="workspace-switcher">
              <span className="workspace-avatar">AV</span>
              <span className="workspace-meta">
                <strong>Studio workspace</strong>
                <span>Personal instance</span>
              </span>
              <Icon name="chevron-right" size={14} className="nav-link-meta" />
            </NavLink>
            <div className="sidebar-status">
              <NavLink to="/settings">Configure</NavLink>
              <StatusDot tone={serviceState === 'online' ? 'success' : serviceState === 'offline' ? 'danger' : 'neutral'} label={serviceState === 'online' ? 'Local services' : serviceState === 'offline' ? 'Services offline' : 'Checking services'} />
            </div>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-leading">
            <button className="mobile-menu-button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
              <Icon name="menu" size={17} />
            </button>
            <div className="breadcrumb">
              <span className="breadcrumb-overline">Studio workspace</span>
              <span className="breadcrumb-title">{currentTitle}</span>
            </div>
          </div>
          <div className="topbar-actions">
            {/* The visible text is the button's name: an aria-label here would
                have to repeat "Search workspace" to satisfy label-in-name, and a
                label that disagrees with the visible text is the actual failure. */}
            <button className="global-search" onClick={() => setPaletteOpen(true)}>
              <Icon name="search" size={15} />
              <span>Search workspace</span>
              <span className="keyboard-hint" aria-hidden="true">⌘ K</span>
            </button>
            <div className="topbar-divider" aria-hidden="true" />
            {/* A gear, not the "AV" initials: an icon-only button's label cannot
                disagree with text it does not have, and this one goes to Settings.
                The workspace identity stays in the sidebar's own chip. */}
            <button className="avatar" aria-label="Open settings" onClick={() => navigate('/settings')}><Icon name="settings" size={16} /></button>
            <span className="system-health"><StatusDot tone={serviceState === 'online' ? 'success' : serviceState === 'offline' ? 'danger' : 'neutral'} label={serviceState === 'online' ? 'API online' : serviceState === 'offline' ? 'API offline' : 'Checking API'} /></span>
          </div>
        </header>
        <main id="main-content" className="page-container" tabIndex={-1}><Outlet /></main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
};

export default Layout;
