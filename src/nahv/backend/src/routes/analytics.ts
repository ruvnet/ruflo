import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';

const router = Router();

router.get('/overview', (_req: Request, res: Response) => {
  const db = getDb();

  const totalLeads = (db.prepare('SELECT COUNT(*) as count FROM leads').get() as { count: number }).count;
  const newLeads = (db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'new'").get() as { count: number }).count;
  const wonLeads = (db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'won'").get() as { count: number }).count;
  const totalRevenue = (db.prepare("SELECT COALESCE(SUM(value), 0) as total FROM leads WHERE status = 'won'").get() as { total: number }).total;
  const pipelineValue = (db.prepare('SELECT COALESCE(SUM(value), 0) as total FROM deals').get() as { total: number }).total;
  const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

  const leadsByStatus = db.prepare(`
    SELECT status, COUNT(*) as count, COALESCE(SUM(value), 0) as total_value
    FROM leads GROUP BY status ORDER BY count DESC
  `).all();

  const dealsByStage = db.prepare(`
    SELECT ps.name, ps.color, COUNT(d.id) as deal_count, COALESCE(SUM(d.value), 0) as total_value
    FROM pipeline_stages ps
    LEFT JOIN deals d ON ps.id = d.stage_id
    GROUP BY ps.id ORDER BY ps."order"
  `).all();

  const recentLeads = db.prepare(`
    SELECT * FROM leads ORDER BY created_at DESC LIMIT 5
  `).all();

  const monthlyStats = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as leads, COALESCE(SUM(value), 0) as revenue
    FROM leads
    WHERE created_at >= date('now', '-6 months')
    GROUP BY month ORDER BY month ASC
  `).all();

  res.json({
    summary: { totalLeads, newLeads, wonLeads, totalRevenue, pipelineValue, conversionRate },
    leadsByStatus,
    dealsByStage,
    recentLeads,
    monthlyStats,
  });
});

export default router;
