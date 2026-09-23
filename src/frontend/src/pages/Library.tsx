import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Equipment {
  id: string;
  name: string;
  manufacturer: string;
  category: string;
  power: string;
  frequencyResponse: string;
  weight: string;
  year: string;
  description: string;
}

interface FilterOptions {
  manufacturer: string | null;
  category: string | null;
  yearsFrom: string | null;
  yearsTo: string | null;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const SearchBar: React.FC<{ value: string; onChange: (v: string) => void }> = ({
  value,
  onChange,
}) => (
  <div className="relative w-full max-w-xl">
    <input
      type="text"
      className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-12 pr-4 text-sm outline-none focus:border-amber-500 focus:ring-2/50/amber-400 transition-colors"
      placeholder="Search equipment..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
    <div className="absolute left-3 top-3 w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/50 flex items-center justify-center">
      🎵
    </div>
  </div>
);

const EquipmentCard: React.FC<{ equipment: Equipment; onClick?: () => void }> = ({
  equipment,
  onClick,
}) => (
  <button
    onClick={onClick}
    className="w-full text-left bg-slate-900/50 border border-slate-800 rounded-2xl p-5 hover:border-amber-500/50 transition-all transform hover:scale-105"
  >
    <div className="font-bold text-amber-400 text-lg">{equipment.name}</div>
    <div className="mt-2 text-slate-400 text-sm">{equipment.category}</div>
    <div className="mt-2 text-slate-400 text-xs">Manuf: {equipment.manufacturer}</div>
    <div className="mt-2 text-slate-300">
      <div className="flex items-center gap-1">
        <span className="text-xs bg-slate-800/50 rounded px-2 py-1">{equipment.power}</span>
        <span className="text-xs bg-slate-800/50 rounded px-2 py-1">{equipment.frequencyResponse}</span>
        <span className="text-xs bg-slate-800/50 rounded px-2 py-1">{equipment.weight}</span>
      </div>
    </div>
  </button>
);

const ModalContent: React.FC<{ equipment: Equipment }> = ({ equipment }) => (
  <div className="max-w-2xl mx-auto p-6 bg-slate-950 rounded-2xl">
    <h2 className="text-2xl font-bold text-amber-400 mb-4">{equipment.name}</h2>
    <p className="text-slate-400 text-sm mb-6">{equipment.description}</p>
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="bg-slate-800/50 rounded-lg p-3"><strong className="text-amber-400">Power:</strong> <span className="text-slate-300">{equipment.power}</span></div>
      <div className="bg-slate-800/50 rounded-lg p-3"><strong className="text-amber-400">Frequency:</strong> <span className="text-slate-300">{equipment.frequencyResponse}</span></div>
      <div className="bg-slate-800/50 rounded-lg p-3"><strong className="text-amber-400">Weight:</strong> <span className="text-slate-300">{equipment.weight}</span></div>
    </div>
    <button
      onClick={() => {}}
      className="mt-4 w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors"
    >
      Close
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const Library: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<FilterOptions>({
    manufacturer: null,
    category: null,
    yearsFrom: null,
    yearsTo: null,
  });

  const modal = {
    isOpen: false,
    onOpen: () => {},
    onClose: () => {},
    title: '',
    content: null,
  };

  const { data: equipmentData, isLoading, error } = {
    data: [] as Equipment[],
    isLoading: false,
    error: null,
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleFilterChange = (field: keyof FilterOptions, value: string | null) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const filteredResults = useMemo(() => {
    if (!equipmentData) return [];
    if (!searchTerm) return equipmentData;

    return equipmentData.filter((eq) => {
      const matchesSearch =
        eq.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        eq.manufacturer.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFilter =
        !filters.manufacturer ||
        eq.manufacturer.toLowerCase().includes(filters.manufacturer.toLowerCase()) ||
        (filters.category && eq.category.toLowerCase().includes(filters.category.toLowerCase()));
      return matchesSearch && matchesFilter;
    });
  }, [equipmentData, searchTerm, filters]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6">
        <p className="text-red-300">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-amber-400">Equipment Library</h1>
            <p className="text-slate-400 mt-1">AudioBiblica Equipment Catalog</p>
          </div>
          <div className="flex items-center gap-3">
            <SearchBar value={searchTerm} onChange={handleSearchChange} />
            <button className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors">
              Filter
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {filteredResults.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-4xl mb-4">🎵</div>
            <h2 className="text-2xl font-bold text-amber-400 mb-2">No equipment found</h2>
            <p className="text-slate-400 mb-6">Try adjusting your search term or filters.</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredResults.map((eq) => (
            <EquipmentCard
              key={eq.id}
              equipment={eq}
              onClick={() => {
                modal.onOpen(
                  eq.name,
                  <ModalContent equipment={eq} />
                );
              }}
            />
          ))}
        </div>

        {filteredResults.length > 0 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-800/50">
            <span className="text-slate-400 text-sm">Showing {filteredResults.length} of {equipmentData?.length || 0}</span>
            <button className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors">
              Load More
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default Library;