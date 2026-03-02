'use client';
import { useEffect, useState } from 'react';
import { getLeads, deleteLead, Lead, STATUS_LABELS, STATUS_COLORS } from '../../lib/api';
import LeadModal from '../../components/LeadModal';

const SOURCES = ['Alle', 'Website', 'LinkedIn', 'Referral', 'Cold outreach', 'Event'];

function eur(v: number) {
  return `€${v.toLocaleString('nl-NL')}`;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalLead, setModalLead] = useState<Lead | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await getLeads();
      setLeads(data);
    } catch {
      // error handled via empty state
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(lead: Lead) {
    if (!confirm(`Weet je zeker dat je ${lead.name} wilt verwijderen?`)) return;
    setDeleting(lead.id);
    await deleteLead(lead.id);
    setLeads((ls) => ls.filter((l) => l.id !== lead.id));
    setDeleting(null);
  }

  function handleSaved(saved: Lead) {
    setLeads((ls) => {
      const idx = ls.findIndex((l) => l.id === saved.id);
      if (idx >= 0) {
        const copy = [...ls];
        copy[idx] = saved;
        return copy;
      }
      return [saved, ...ls];
    });
    setModalLead(undefined);
  }

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !q || l.name.toLowerCase().includes(q) || l.company.toLowerCase().includes(q) || l.email.toLowerCase().includes(q);
    const matchStatus = !statusFilter || l.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalValue = filtered.reduce((s, l) => s + l.value, 0);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Leads</h2>
          <p className="text-gray-500 text-sm mt-1">{filtered.length} leads · {eur(totalValue)} totaal</p>
        </div>
        <button className="btn-primary" onClick={() => setModalLead(null)}>+ Nieuwe lead</button>
      </div>

      <div className="card mb-4">
        <div className="p-4 flex gap-3 border-b border-gray-100">
          <input
            className="input flex-1"
            placeholder="Zoek op naam, bedrijf of e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Alle statussen</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Laden...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-sm">Geen leads gevonden.</p>
            <button className="btn-primary mt-4" onClick={() => setModalLead(null)}>Eerste lead aanmaken</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Naam</th>
                <th className="px-4 py-3 font-medium">Bedrijf</th>
                <th className="px-4 py-3 font-medium">E-mail</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Waarde</th>
                <th className="px-4 py-3 font-medium">Bron</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800">{lead.name}</td>
                  <td className="px-4 py-3 text-gray-600">{lead.company}</td>
                  <td className="px-4 py-3 text-gray-600">{lead.email}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[lead.status]}`}>
                      {STATUS_LABELS[lead.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 font-medium">{eur(lead.value)}</td>
                  <td className="px-4 py-3 text-gray-500">{lead.source || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button
                        className="text-indigo-600 hover:text-indigo-800 text-xs font-medium px-2 py-1 rounded hover:bg-indigo-50"
                        onClick={() => setModalLead(lead)}
                      >
                        Bewerken
                      </button>
                      <button
                        className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50"
                        onClick={() => handleDelete(lead)}
                        disabled={deleting === lead.id}
                      >
                        {deleting === lead.id ? '...' : 'Verwijder'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalLead !== undefined && (
        <LeadModal
          lead={modalLead}
          onClose={() => setModalLead(undefined)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
