import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Library from './pages/Library';
import Settings from './pages/Settings';
import NanobotChat from './components/NanobotChat';
import ResearchAgent from './pages/ResearchAgent';
import Mcp from './pages/Mcp';
import Capture from './pages/Capture';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* The capture page is for a phone held at a rack: it renders on its own,
            without the desktop shell's sidebar and header. */}
        <Route path="/capture" element={<Capture />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/library" element={<Library />} />
          <Route path="/research" element={<ResearchAgent />} />
          <Route path="/mcp" element={<Mcp />} />
          <Route path="/nanobot" element={<NanobotChat />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
