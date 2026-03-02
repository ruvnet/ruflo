import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'nahv.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      value REAL NOT NULL DEFAULT 0,
      source TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1'
    );

    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      stage_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      value REAL NOT NULL DEFAULT 0,
      expected_close_date TEXT,
      probability INTEGER NOT NULL DEFAULT 50,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id)
    );
  `);

  seedDefaultData(db);
}

function seedDefaultData(db: Database.Database): void {
  const stageCount = (db.prepare('SELECT COUNT(*) as count FROM pipeline_stages').get() as { count: number }).count;

  if (stageCount === 0) {
    const insertStage = db.prepare('INSERT INTO pipeline_stages (name, "order", color) VALUES (?, ?, ?)');
    insertStage.run('Nieuw', 1, '#6366f1');
    insertStage.run('Contact', 2, '#f59e0b');
    insertStage.run('Gekwalificeerd', 3, '#3b82f6');
    insertStage.run('Offerte', 4, '#8b5cf6');
    insertStage.run('Gewonnen', 5, '#10b981');
    insertStage.run('Verloren', 6, '#ef4444');

    const insertLead = db.prepare(`
      INSERT INTO leads (name, company, email, phone, status, value, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertLead.run('Jan de Vries', 'TechNL BV', 'jan@technl.nl', '0612345678', 'qualified', 15000, 'Website', 'Geïnteresseerd in enterprise plan');
    insertLead.run('Emma Bakker', 'Bakker & Zonen', 'emma@bakker.nl', '0698765432', 'contacted', 8000, 'LinkedIn', 'Follow-up gepland voor volgende week');
    insertLead.run('Pieter Smit', 'SmitSolutions', 'p.smit@smitsolutions.nl', null, 'new', 5000, 'Referral', null);
    insertLead.run('Lisa Jansen', 'Jansen Holding', 'l.jansen@jansenholding.nl', '0645678901', 'won', 25000, 'Cold outreach', 'Contract getekend!');
    insertLead.run('Mark Visser', 'VisserTech', 'mark@vissertech.nl', '0623456789', 'proposal', 12000, 'Event', 'Offerte verstuurd');
    insertLead.run('Sophie Mulder', 'Mulder & Partners', 's.mulder@mulder.nl', '0611223344', 'lost', 3000, 'Website', 'Budget te laag');

    const stages = db.prepare('SELECT * FROM pipeline_stages ORDER BY "order"').all() as Array<{ id: number }>;
    const leads = db.prepare('SELECT * FROM leads').all() as Array<{ id: number; value: number; status: string }>;

    const insertDeal = db.prepare(`
      INSERT INTO deals (lead_id, stage_id, title, value, probability)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertDeal.run(leads[0].id, stages[2].id, 'Enterprise licentie TechNL', 15000, 70);
    insertDeal.run(leads[1].id, stages[1].id, 'Starter pakket Bakker & Zonen', 8000, 40);
    insertDeal.run(leads[2].id, stages[0].id, 'SmitSolutions onboarding', 5000, 20);
    insertDeal.run(leads[3].id, stages[4].id, 'Jansen Holding contract', 25000, 100);
    insertDeal.run(leads[4].id, stages[3].id, 'VisserTech offerte', 12000, 60);
  }
}
