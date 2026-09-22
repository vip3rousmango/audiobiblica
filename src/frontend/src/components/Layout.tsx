import React, { Component, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

export default class Layout extends Component<Props> {
  render() {
    return (
      <div className="layout">
        <nav>
          <a href="/">Dashboard</a>
          <a href="/library">Library</a>
          <a href="/research">Research</a>
          <a href="/mcp">MCP Status</a>
        </nav>
        <main>{this.props.children}</main>
      </div>
    );
  }
}
