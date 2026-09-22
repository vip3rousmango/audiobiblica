import React from "react";
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { EquipmentLibrary } from "./components/EquipmentLibrary";
import { ManualViewer } from "./components/ManualViewer";
import { ResearchTool } from "./components/ResearchTool";
import { MCPStatus } from "./components/MCPStatus";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/equipment" element={<EquipmentLibrary />} />
        <Route path="/equipment/:id/manuals/:manualId" element={<ManualViewer />} />
        <Route path="/research" element={<ResearchTool />} />
        <Route path="/mcp" element={<MCPStatus />} />
      </Route>
    </Routes>
  );
}
