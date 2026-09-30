import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Library from './pages/Library';
import Settings from './pages/Settings';
import NanobotChat from './components/NanobotChat';
import ResearchAgent from './pages/ResearchAgent';
import Mcp from './pages/Mcp';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/library" element={<Library />} />
          <Route path="/research" element={<ResearchAgent />} />
          <Route path="/mcp" element={<Mcp />} />
          <Route path="/nanobot" element={<NanobotChat />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

export default App;