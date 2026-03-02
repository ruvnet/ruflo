import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
  res.json(leads);
});

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' });
  res.json(lead);
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, company, email, phone, status, value, source, notes } = req.body;

  if (!name || !company || !email) {
    return res.status(400).json({ error: 'Naam, bedrijf en e-mail zijn verplicht' });
  }

  const result = db.prepare(`
    INSERT INTO leads (name, company, email, phone, status, value, source, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, company, email, phone || null, status || 'new', Number(value) || 0, source || null, notes || null);

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(lead);
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { name, company, email, phone, status, value, source, notes } = req.body;

  const existing = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead niet gevonden' });

  db.prepare(`
    UPDATE leads
    SET name=?, company=?, email=?, phone=?, status=?, value=?, source=?, notes=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(name, company, email, phone || null, status, Number(value) || 0, source || null, notes || null, req.params.id);

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  res.json(lead);
});

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead niet gevonden' });

  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
