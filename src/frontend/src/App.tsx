import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<div>Dashboard - AudioBiblica</div>} />
          <Route path="/library" element={<div>Equipment Library</div>} />
          <Route path="/research" element={<div>Manufacturer Research</div>} />
          <Route path="/mcp" element={<div>MCP Server Status</div>} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

export default App;