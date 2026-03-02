import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';

const router = Router();

router.get('/stages', (_req: Request, res: Response) => {
  const db = getDb();
  const stages = db.prepare('SELECT * FROM pipeline_stages ORDER BY "order"').all() as Array<{ id: number }>;
  const deals = db.prepare(`
    SELECT d.*, l.name as lead_name, l.company, l.email
    FROM deals d
    JOIN leads l ON d.lead_id = l.id
    ORDER BY d.value DESC
  `).all() as Array<{ stage_id: number }>;

  const result = stages.map((stage) => ({
    ...stage,
    deals: deals.filter((d) => d.stage_id === (stage as any).id),
  }));

  res.json(result);
});

router.get('/deals', (_req: Request, res: Response) => {
  const db = getDb();
  const deals = db.prepare(`
    SELECT d.*, l.name as lead_name, l.company, l.email
    FROM deals d
    JOIN leads l ON d.lead_id = l.id
    ORDER BY d.created_at DESC
  `).all();
  res.json(deals);
});

router.post('/deals', (req: Request, res: Response) => {
  const db = getDb();
  const { lead_id, stage_id, title, value, expected_close_date, probability, notes } = req.body;

  if (!lead_id || !stage_id || !title) {
    return res.status(400).json({ error: 'Lead, fase en titel zijn verplicht' });
  }

  const result = db.prepare(`
    INSERT INTO deals (lead_id, stage_id, title, value, expected_close_date, probability, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(lead_id, stage_id, title, Number(value) || 0, expected_close_date || null, Number(probability) || 50, notes || null);

  const deal = db.prepare(`
    SELECT d.*, l.name as lead_name, l.company, l.email
    FROM deals d JOIN leads l ON d.lead_id = l.id
    WHERE d.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(deal);
});

router.put('/deals/:id/stage', (req: Request, res: Response) => {
  const db = getDb();
  const { stage_id } = req.body;

  const existing = db.prepare('SELECT id FROM deals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Deal niet gevonden' });

  db.prepare('UPDATE deals SET stage_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(stage_id, req.params.id);

  const deal = db.prepare(`
    SELECT d.*, l.name as lead_name, l.company, l.email
    FROM deals d JOIN leads l ON d.lead_id = l.id
    WHERE d.id = ?
  `).get(req.params.id);

  res.json(deal);
});

router.delete('/deals/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM deals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Deal niet gevonden' });

  db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
