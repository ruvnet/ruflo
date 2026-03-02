const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API fout');
  }
  return res.json();
}

// Leads
export const getLeads = () => request<Lead[]>('/leads');
export const createLead = (data: Partial<Lead>) => request<Lead>('/leads', { method: 'POST', body: JSON.stringify(data) });
export const updateLead = (id: number, data: Partial<Lead>) => request<Lead>(`/leads/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteLead = (id: number) => request<{ success: boolean }>(`/leads/${id}`, { method: 'DELETE' });

// Pipeline
export const getPipelineStages = () => request<StageWithDeals[]>('/pipeline/stages');
export const moveDealToStage = (dealId: number, stageId: number) =>
  request<Deal>(`/pipeline/deals/${dealId}/stage`, { method: 'PUT', body: JSON.stringify({ stage_id: stageId }) });
export const createDeal = (data: Partial<Deal>) => request<Deal>('/pipeline/deals', { method: 'POST', body: JSON.stringify(data) });
export const deleteDeal = (id: number) => request<{ success: boolean }>(`/pipeline/deals/${id}`, { method: 'DELETE' });

// Analytics
export const getAnalytics = () => request<AnalyticsData>('/analytics/overview');

// Types
export interface Lead {
  id: number;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost';
  value: number;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: number;
  lead_id: number;
  stage_id: number;
  title: string;
  value: number;
  probability: number;
  notes: string | null;
  lead_name: string;
  company: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface StageWithDeals {
  id: number;
  name: string;
  order: number;
  color: string;
  deals: Deal[];
}

export interface AnalyticsData {
  summary: {
    totalLeads: number;
    newLeads: number;
    wonLeads: number;
    totalRevenue: number;
    pipelineValue: number;
    conversionRate: number;
  };
  leadsByStatus: Array<{ status: string; count: number; total_value: number }>;
  dealsByStage: Array<{ name: string; color: string; deal_count: number; total_value: number }>;
  recentLeads: Lead[];
  monthlyStats: Array<{ month: string; leads: number; revenue: number }>;
}

export const STATUS_LABELS: Record<string, string> = {
  new: 'Nieuw',
  contacted: 'Contact',
  qualified: 'Gekwalificeerd',
  proposal: 'Offerte',
  won: 'Gewonnen',
  lost: 'Verloren',
};

export const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  qualified: 'bg-indigo-100 text-indigo-700',
  proposal: 'bg-purple-100 text-purple-700',
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
};
