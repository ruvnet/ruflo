export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost';

export interface Lead {
  id: number;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  status: LeadStatus;
  value: number;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  id: number;
  name: string;
  order: number;
  color: string;
}

export interface Deal {
  id: number;
  lead_id: number;
  stage_id: number;
  title: string;
  value: number;
  expected_close_date: string | null;
  probability: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealWithLead extends Deal {
  lead_name: string;
  company: string;
  email: string;
}

export interface StageWithDeals extends PipelineStage {
  deals: DealWithLead[];
}
