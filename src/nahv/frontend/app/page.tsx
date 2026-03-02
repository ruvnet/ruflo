'use client';
import { useEffect, useState } from 'react';
import { getAnalytics, AnalyticsData, STATUS_LABELS, STATUS_COLORS } from '../lib/api';

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent: string }) {
  return (
    <div className={`card p-5 border-l-4 ${accent}`}>
      <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
      {sub && <p className="text-gray-400 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function eur(value: number) {
  return `€${value.toLocaleString('nl-NL')}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAnalytics()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-sm">Laden...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="card p-6 border-l-4 border-red-500">
          <p className="text-red-600 font-medium">Backend niet bereikbaar</p>
          <p className="text-gray-500 text-sm mt-1">Zorg dat de backend draait op poort 3001.</p>
          <code className="text-xs text-gray-400 mt-2 block">cd src/nahv/backend && npm install && npm run dev</code>
        </div>
      </div>
    );
  }

  const { summary, dealsByStage, recentLeads } = data;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
        <p className="text-gray-500 text-sm mt-1">Overzicht van je sales activiteiten</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Totaal leads" value={summary.totalLeads} accent="border-indigo-500" />
        <StatCard label="Gewonnen" value={summary.wonLeads} sub={`${summary.conversionRate}% conversie`} accent="border-green-500" />
        <StatCard label="Omzet" value={eur(summary.totalRevenue)} accent="border-yellow-500" />
        <StatCard label="Nieuwe leads" value={summary.newLeads} accent="border-blue-500" />
        <StatCard label="Pipeline waarde" value={eur(summary.pipelineValue)} accent="border-purple-500" />
        <StatCard label="Conversieratio" value={`${summary.conversionRate}%`} accent="border-pink-500" />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wide">Pipeline per fase</h3>
          <div className="space-y-3">
            {dealsByStage.map((stage) => {
              const maxValue = Math.max(...dealsByStage.map((s) => s.total_value), 1);
              const pct = Math.round((stage.total_value / maxValue) * 100);
              return (
                <div key={stage.name}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="text-sm text-gray-600">{stage.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium text-gray-700">{stage.deal_count} deals</span>
                      <span className="text-xs text-gray-400 ml-2">{eur(stage.total_value)}</span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: stage.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wide">Recente leads</h3>
          <div className="space-y-3">
            {recentLeads.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-700">{lead.name}</p>
                  <p className="text-xs text-gray-400">{lead.company}</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[lead.status]}`}>
                    {STATUS_LABELS[lead.status]}
                  </span>
                  <p className="text-xs text-gray-400 mt-0.5">{eur(lead.value)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
