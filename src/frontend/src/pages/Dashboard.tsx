import React, { useState, useEffect } from 'react';

interface Equipment {
  id: string;
  name: string;
  category: string;
  manufacturer: string;
  model?: string;
  description?: string;
  specifications?: Record<string, string>;
  manuals?: Array<{
    title: string;
    url: string;
    source: string;
    downloaded_at: string;
  }>;
}

interface DashboardProps {
  onRefresh?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onRefresh }) => {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [stats, setStats] = useState({
    totalEquipment: 0,
    totalManuals: 0,
    totalManufacturers: 0,
    aiStatus: 'unknown',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEquipment = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/equipment');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      const equipmentList = data.equipment || [];
      
      const totalManuals = equipmentList.reduce(
        (count, eq) => count + (eq.manuals ? eq.manuals.length : 0),
        0
      );
      const uniqueManufacturers = new Set(
        equipmentList.map((eq) => eq.manufacturer || '')
      ).size;
      
      setEquipment(equipmentList);
      setStats({
        totalEquipment: equipmentList.length,
        totalManuals: totalManuals,
        totalManufacturers: uniqueManufacturers,
        aiStatus: 'unknown',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch equipment data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEquipment();
  }, []);

  const handleRefresh = () => {
    fetchEquipment();
  };

  if (loading && equipment.length === 0) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-800 bg-slate-900/50 text-slate-400">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span>Loading equipment data...</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-red-500 bg-red-500/20 text-red-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01" />
              </svg>
              <span>Error loading equipment data</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-amber-400">
            Equipment Dashboard
          </h1>
          <p className="mt-2 text-slate-400">
            Overview of audio equipment inventory and statistics
          </p>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <StatCard title="Total Equipment" value={stats.totalEquipment} icon="📦" />
          <StatCard title="Total Manuals" value={stats.totalManuals} icon="📖" />
          <StatCard title="Unique Manufacturers" value={stats.totalManufacturers} icon="🏭" />
          <StatCard title="AI Status" value={stats.aiStatus} icon="🤖" />
        </div>

        {/* Featured Equipment Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {equipment.slice(0, 4).map((eq) => (
            <EquipmentCard key={eq.id} equipment={eq} />
          ))}
        </div>
      </div>
    </main>
  );
};

// Stat card component
const StatCard: React.FC<{title: string, value: string, icon: string}> = ({
  title,
  value,
  icon,
}) => (
  <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 hover:border-amber-500/50 transition-colors">
    <div className="flex items-center justify-between mb-3">
      <div className="text-2xl font-bold text-amber-400">{icon}</div>
      <div className="text-slate-400 text-sm">{value}</div>
    </div>
    <p className="text-slate-500 text-sm mt-1">{title}</p>
  </div>
);

// Equipment card component
const EquipmentCard: React.FC<{equipment: Equipment}> = ({ equipment }) => {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 hover:border-amber-500/50 transition-colors">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h3 className="font-semibold text-white">{equipment.name}</h3>
          <p className="text-slate-400 text-sm mt-1">{equipment.category}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-amber-400 font-medium">{equipment.manufacturer}</span>
          <span className="text-slate-500 text-xs">{equipment.model || '-'}</span>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-slate-800">
        {equipment.description && (
          <p className="text-slate-400 text-sm leading-relaxed">{equipment.description}</p>
        )}
        {equipment.specifications && (
          <div className="mt-3 space-y-2 text-sm text-slate-400">
            {Object.entries(equipment.specifications).map(([key, val]) => (
              <div key={key} className="flex items-center gap-2 text-sm text-slate-400">
                <span className="text-xs text-slate-500">{key}</span>
                <span className="text-emerald-400">{val}</span>
              </div>
            ))}
          </div>
        )}
        {equipment.manuals && (
          <div className="mt-3 space-y-1">
            {equipment.manuals.slice(0, 3).map((manual) => (
              <div key={manual.id} className="flex items-center gap-2 text-sm text-slate-400">
                <span className="text-amber-400">{manual.title}</span>
                <span className="ml-auto text-xs text-slate-500">{manual.url}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;