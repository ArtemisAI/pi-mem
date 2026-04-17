import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { FeedbackRecorder } from '../../src/services/feedback/FeedbackRecorder';

function setupDb(): Database {
  const db = new Database(':memory:');
  db.run(`
    CREATE TABLE observation_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_id INTEGER NOT NULL,
      signal_type TEXT NOT NULL,
      session_db_id INTEGER,
      created_at_epoch INTEGER NOT NULL,
      metadata TEXT
    )
  `);
  db.run('CREATE INDEX idx_fb_obs ON observation_feedback(observation_id)');
  db.run('CREATE INDEX idx_fb_sig ON observation_feedback(signal_type)');
  return db;
}

describe('FeedbackRecorder', () => {
  let db: Database;
  let recorder: FeedbackRecorder;

  beforeEach(() => {
    db = setupDb();
    recorder = new FeedbackRecorder(db);
  });

  it('records a single signal', () => {
    recorder.record({ observationId: 42, signalType: 'retrieved' });
    expect(recorder.countForObservation(42)).toBe(1);
    expect(recorder.countForObservation(42, { signalType: 'retrieved' })).toBe(1);
    expect(recorder.countForObservation(42, { signalType: 'tool_adjacent' })).toBe(0);
  });

  it('stores metadata as JSON', () => {
    recorder.record({
      observationId: 7,
      signalType: 'retained_in_context',
      metadata: { concepts: ['auth', 'jwt'], overlap: 2 }
    });
    const row = db
      .query('SELECT metadata FROM observation_feedback WHERE observation_id = 7')
      .get() as { metadata: string };
    const parsed = JSON.parse(row.metadata);
    expect(parsed.concepts).toEqual(['auth', 'jwt']);
    expect(parsed.overlap).toBe(2);
  });

  it('batch-records multiple signals in a transaction', () => {
    const signals = Array.from({ length: 50 }, (_, i) => ({
      observationId: i + 1,
      signalType: 'tool_adjacent' as const
    }));
    recorder.recordBatch(signals);
    const row = db
      .query('SELECT COUNT(*) AS n FROM observation_feedback')
      .get() as { n: number };
    expect(row.n).toBe(50);
  });

  it('is a no-op on empty batch', () => {
    recorder.recordBatch([]);
    const row = db
      .query('SELECT COUNT(*) AS n FROM observation_feedback')
      .get() as { n: number };
    expect(row.n).toBe(0);
  });

  it('counts with sinceEpoch filter', () => {
    const base = Date.now();
    recorder.record({ observationId: 9, signalType: 'retrieved' });
    // Sleep-free: insert a historical row directly
    db.run(
      'INSERT INTO observation_feedback (observation_id, signal_type, created_at_epoch) VALUES (?, ?, ?)',
      [9, 'retrieved', base - 1_000_000]
    );
    expect(recorder.countForObservation(9)).toBe(2);
    expect(recorder.countForObservation(9, { sinceEpoch: base - 10 })).toBe(1);
  });

  it('never throws on insert of invalid FK (table has no FK here, but malformed type coerced)', () => {
    // Simulate a hostile caller with a bogus numeric id — should still append without throwing
    expect(() =>
      recorder.record({ observationId: -1, signalType: 'retrieved' })
    ).not.toThrow();
    expect(recorder.countForObservation(-1)).toBe(1);
  });
});
