'use client';
import { useEffect, useState } from 'react';
import { getPipelineStages, moveDealToStage, deleteDeal, StageWithDeals, Deal } from '../../lib/api';

function eur(v: number) {
  return `€${v.toLocaleString('nl-NL')}`;
}

interface DealCardProps {
  deal: Deal;
  stages: StageWithDeals[];
  onMove: (dealId: number, stageId: number) => void;
  onDelete: (dealId: number) => void;
}

function DealCard({ deal, stages, onMove, onDelete }: DealCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{deal.title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{deal.lead_name} · {deal.company}</p>
        </div>
        <button
          className="text-gray-300 hover:text-gray-500 ml-2 shrink-0"
          onClick={() => setOpen((o) => !o)}
          title="Acties"
        >
          ···
        </button>
      </div>

      <div className="flex items-center justify-between mt-3">
        <span className="text-sm font-bold text-gray-700">{eur(deal.value)}</span>
        <span className="text-xs text-gray-400">{deal.probability}% kans</span>
      </div>

      <div className="w-full bg-gray-100 rounded-full h-1 mt-2">
        <div className="h-1 rounded-full bg-indigo-400" style={{ width: `${deal.probability}%` }} />
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Verplaats naar</p>
          <div className="flex flex-wrap gap-1">
            {stages.map((s) => (
              <button
                key={s.id}
                className="text-xs px-2 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                style={deal.stage_id === s.id ? { borderColor: s.color, color: s.color } : undefined}
                onClick={() => { onMove(deal.id, s.id); setOpen(false); }}
              >
                {s.name}
              </button>
            ))}
          </div>
          <button
            className="text-xs text-red-500 hover:text-red-700"
            onClick={() => { if (confirm('Deal verwijderen?')) onDelete(deal.id); setOpen(false); }}
          >
            Verwijderen
          </button>
        </div>
      )}
    </div>
  );
}

export default function PipelinePage() {
  const [stages, setStages] = useState<StageWithDeals[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await getPipelineStages();
      setStages(data);
    } finally {
      setLoading(false);
    }
  }

  async function handleMove(dealId: number, stageId: number) {
    await moveDealToStage(dealId, stageId);
    setStages((prev) =>
      prev.map((s) => ({
        ...s,
        deals: s.deals
          .filter((d) => !(d.id === dealId && s.id !== stageId))
          .map((d) => d.id === dealId ? { ...d, stage_id: stageId } : d),
      })).map((s) => {
        const movedDeal = prev.flatMap((st) => st.deals).find((d) => d.id === dealId);
        if (s.id === stageId && movedDeal && !s.deals.find((d) => d.id === dealId)) {
          return { ...s, deals: [{ ...movedDeal, stage_id: stageId }, ...s.deals] };
        }
        return s;
      })
    );
    load();
  }

  async function handleDelete(dealId: number) {
    await deleteDeal(dealId);
    setStages((prev) => prev.map((s) => ({ ...s, deals: s.deals.filter((d) => d.id !== dealId) })));
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-gray-400 text-sm">Laden...</div></div>;
  }

  const totalPipelineValue = stages.flatMap((s) => s.deals).reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Sales Pipeline</h2>
        <p className="text-gray-500 text-sm mt-1">
          {stages.flatMap((s) => s.deals).length} actieve deals · {eur(totalPipelineValue)} totale waarde
        </p>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const stageValue = stage.deals.reduce((s, d) => s + d.value, 0);
          return (
            <div key={stage.id} className="shrink-0 w-64">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                  <span className="text-sm font-semibold text-gray-700">{stage.name}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{stage.deals.length}</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-3">{eur(stageValue)}</p>

              <div className="min-h-24">
                {stage.deals.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-xl h-24 flex items-center justify-center">
                    <p className="text-xs text-gray-300">Geen deals</p>
                  </div>
                ) : (
                  stage.deals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      stages={stages}
                      onMove={handleMove}
                      onDelete={handleDelete}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
