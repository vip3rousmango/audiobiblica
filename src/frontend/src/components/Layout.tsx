/*
 * AudioBiblica — Properly Designed React UI
 * Layout with sidebar, top bar, main content using modern practices
 */
import React, { Component, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

/**
 * Main app layout:
 * - Top bar with app title and user settings
 * - Sidebar with navigation
 * - Main content area
 * Uses modern practices: Tailwind, responsive design, accessible nav
 */
export default class Layout extends Component<Props> {
  render() {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-amber-400">AudioBiblica</h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span className="hidden sm:block">AV Specialist</span>
            <a href="#" className="hover:text-amber-300 transition">
              ⚙️
            </a>
          </div>
        </header>

        {/* Sidebar */}
        <nav className="sidebar w-64 bg-slate-900/90 min-h-screen border-r border-slate-800/50 sticky left-0 top-20 shadow-lg">
          <div className="px-4 py-6 text-sm font-medium text-amber-400 border-b border-slate-800/50">
            <span>Navigation</span>
          </div>
          <ul className="space-y-2 px-2">
            <li>
              <a href="/" className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2zM3 12h13m0 8H6m0-8H13" /></svg>
                Dashboard
              </a>
            </li>
            <li>
              <a href="/library" className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 4" /></svg>
                Library
              </a>
            </li>
            <li>
              <a href="/research" className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7h4l2 2M4 21h14a2 2 0 002-2V5a2 2 0 00-2-2H4a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                Research
              </a>
            </li>
            <li>
              <a href="/mcp" className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6m2-3a2 2 0 012 2h7a2 2 0 012 2v-5m-5 7h5a2 2 0 002-2v-5a2 2 0 00-2-2h-5a2 2 0 00-2 2v5m5-7h5a2 2 0 002-2V5a2 2 0 00-2-2h-5a2 2 0 00-2 2v5m0 0v-2.5M15 13a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" /></svg>
                MCP
              </a>
            </li>
            <li>
              <a href="/settings" className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /></svg>
                Settings
              </a>
              <a href="/nanobot" className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors text-amber-400">
                <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6m3-3V7m3 3v10m-5-7h5m-5 7h5m-5-7h5" /></svg>
                Nanobot
              </a>
            </li>
          </ul>
        </nav>

        {/* Main content */}
        <main className="flex-1 p-6 overflow-y-auto">
          {this.props.children}
        </main>
      </div>
    );
  }
}