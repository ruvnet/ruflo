'use client';
import { useState, useEffect } from 'react';
import { Lead, createLead, updateLead, STATUS_LABELS } from '../lib/api';

interface Props {
  lead: Lead | null;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
}

const STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] as const;
const SOURCES = ['Website', 'LinkedIn', 'Referral', 'Cold outreach', 'Event', 'Anders'];

export default function LeadModal({ lead, onClose, onSaved }: Props) {
  const isEdit = Boolean(lead);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    status: 'new' as Lead['status'],
    value: '',
    source: '',
    notes: '',
  });

  useEffect(() => {
    if (lead) {
      setForm({
        name: lead.name,
        company: lead.company,
        email: lead.email,
        phone: lead.phone || '',
        status: lead.status,
        value: String(lead.value),
        source: lead.source || '',
        notes: lead.notes || '',
      });
    }
  }, [lead]);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = { ...form, value: Number(form.value) || 0, phone: form.phone || null, source: form.source || null, notes: form.notes || null };
      const saved = isEdit ? await updateLead(lead!.id, payload) : await createLead(payload);
      onSaved(saved);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">{isEdit ? 'Lead bewerken' : 'Nieuwe lead'}</h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Naam *</label>
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="Volledige naam" />
            </div>
            <div>
              <label className="label">Bedrijf *</label>
              <input className="input" value={form.company} onChange={(e) => set('company', e.target.value)} required placeholder="Bedrijfsnaam" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">E-mail *</label>
              <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required placeholder="naam@bedrijf.nl" />
            </div>
            <div>
              <label className="label">Telefoon</label>
              <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="06 12345678" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Waarde (€)</label>
              <input className="input" type="number" min="0" value={form.value} onChange={(e) => set('value', e.target.value)} placeholder="0" />
            </div>
          </div>

          <div>
            <label className="label">Bron</label>
            <select className="input" value={form.source} onChange={(e) => set('source', e.target.value)}>
              <option value="">Selecteer bron</option>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Notities</label>
            <textarea className="input resize-none" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Aanvullende informatie..." />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>
              {saving ? 'Opslaan...' : isEdit ? 'Opslaan' : 'Lead aanmaken'}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>Annuleren</button>
          </div>
        </form>
      </div>
    </div>
  );
}
