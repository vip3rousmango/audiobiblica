import React from "react";
import { Link, useNavigate } from "react-router-dom";

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();

  return (
    <div className="app-container">
      <header className="app-header">
        <nav className="main-nav">
          <ul>
            <li>
              <Link to="/">Dashboard</Link>
            </li>
            <li>
              <Link to="/equipment">Equipment Library</Link>
            </li>
            <li>
              <Link to="/research">Research</Link>
            </li>
            <li>
              <Link to="/mcp">MCP Status</Link>
            </li>
          </ul>
        </nav>
      </header>

      <main className="app-main">
        {children}
      </main>
    </div>
  );
};