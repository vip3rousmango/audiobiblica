import React, { Component, ReactNode } from 'react';

interface Props { children?: ReactNode; }

export default class Layout extends Component<Props> {
  render() {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
        <nav className="flex items-center gap-6 px-6 py-4 bg-slate-900/80 border-b border-slate-800 backdrop-blur-md sticky top-0 z-50">
          <a href="/" className="text-xl font-bold text-amber-400 tracking-tight hover:text-amber-300 transition">AudioBiblica</a>
          <a href="/library" className="text-sm font-medium text-slate-300 hover:text-white transition">Library</a>
          <a href="/research" className="text-sm font-medium text-slate-300 hover:text-white transition">Research</a>
          <a href="/mcp" className="text-sm font-medium text-slate-300 hover:text-white transition">MCP</a>
          <a href="/nanobot" className="text-sm font-medium text-amber-400 hover:text-amber-300 transition">Nanobot</a>
        </nav>
        <main className="max-w-6xl mx-auto px-6 py-10">{this.props.children}</main>
      </div>
    );
  }
}