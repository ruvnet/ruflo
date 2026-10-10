'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RotateCw } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';

const WEEKDAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const LEVELS = ['Faible', 'Moyenne', 'Élevée', 'Max'];
const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Lundi de la semaine de `d`. */
function monday(d: Date): Date {
  const day = startOfDay(d);
  return new Date(day.getTime() - ((day.getDay() + 6) % 7) * DAY_MS);
}

function level(count: number, max: number): number {
  if (count === 0 || max === 0) return 0;
  const ratio = count / max;
  return ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
}

/**
 * Carte d'activité : une case par jour (lignes = jours de la semaine, colonnes = semaines),
 * d'autant plus claire que des missions ont été lancées ce jour-là.
 */
export function ActivityHeatmap({ refreshKey }: { refreshKey: number }) {
  const [all, setAll] = useState(false);
  const weeks = all ? 52 : 26;
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstMonday = useMemo(() => new Date(monday(new Date()).getTime() - (weeks - 1) * 7 * DAY_MS), [weeks]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await getSupabase()
      .from('missions')
      .select('created_at')
      .gte('created_at', firstMonday.toISOString())
      .order('created_at', { ascending: false })
      .limit(10000);
    setLoading(false);
    if (err) setError(err.message);
    else {
      setError(null);
      setDates((data as Array<{ created_at: string }>).map((r) => r.created_at));
    }
  }, [firstMonday]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const { columns, max, total } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const iso of dates) {
      const key = dayKey(new Date(iso));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const today = startOfDay(new Date()).getTime();
    const cols = Array.from({ length: weeks }, (_, w) => {
      const start = new Date(firstMonday.getTime() + w * 7 * DAY_MS);
      return {
        start,
        days: Array.from({ length: 7 }, (_, d) => {
          const date = new Date(start.getTime() + d * DAY_MS);
          return { date, count: counts.get(dayKey(date)) ?? 0, future: date.getTime() > today };
        }),
      };
    });
    return { columns: cols, max: Math.max(0, ...counts.values()), total: dates.length };
  }, [dates, weeks, firstMonday]);

  return (
    <section className="card heat">
      <div className="heat-head">
        <span className="heat-icon" aria-hidden="true">
          <Activity size={16} strokeWidth={2} />
        </span>
        <h3>Activité</h3>
        <span className="muted small heat-total">
          {total} mission{total > 1 ? 's' : ''} sur {weeks} semaines
        </span>
        <button className="heat-btn" onClick={() => setAll((v) => !v)}>
          {all ? '6 mois' : 'View all'}
        </button>
        <button className="heat-btn heat-icon-btn" onClick={() => void load()} disabled={loading} title="Actualiser" aria-label="Actualiser">
          <RotateCw size={14} strokeWidth={2} className={loading ? 'spin' : undefined} />
        </button>
      </div>

      <div className="heat-legend">
        {LEVELS.map((label, i) => (
          <span key={label}>
            <i className={`heat-dot l${i + 1}`} />
            {label}
          </span>
        ))}
      </div>

      {error && <p className="error small">{error}</p>}

      <div className="heat-scroll">
        <div className="heat-grid" style={{ gridTemplateColumns: `40px repeat(${weeks}, minmax(14px, 1fr))` }}>
          {WEEKDAYS.map((label, d) => (
            <div key={label} className="heat-row" style={{ display: 'contents' }}>
              <span className="heat-label">{label}</span>
              {columns.map((col) => {
                const cell = col.days[d];
                const title = `${cell.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} : ${cell.count} mission${cell.count > 1 ? 's' : ''}`;
                return (
                  <span
                    key={col.start.getTime()}
                    className={`heat-cell l${level(cell.count, max)} ${cell.future ? 'future' : ''}`}
                    title={cell.future ? undefined : title}
                  />
                );
              })}
            </div>
          ))}
          <span />
          {columns.map((col, i) => (
            <span key={col.start.getTime()} className="heat-col-label">
              {weeks <= 26 || i % 2 === 0 ? col.start.getDate() : ''}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
