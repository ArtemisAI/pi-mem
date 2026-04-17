import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export type FeedbackSignalType =
  | 'retrieved'
  | 'retained_in_context'
  | 'tool_adjacent'
  | 'merged_into'
  | 'superseded'
  | 'consolidated_into';

export interface FeedbackSignal {
  observationId: number;
  signalType: FeedbackSignalType;
  sessionDbId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface FeedbackCountOptions {
  signalType?: FeedbackSignalType;
  sinceEpoch?: number;
}

export class FeedbackRecorder {
  private readonly insertStmt: ReturnType<Database['prepare']>;

  constructor(private readonly db: Database) {
    this.insertStmt = db.prepare(
      `INSERT INTO observation_feedback
         (observation_id, signal_type, session_db_id, created_at_epoch, metadata)
       VALUES (?, ?, ?, ?, ?)`
    );
  }

  record(signal: FeedbackSignal): void {
    try {
      this.insertStmt.run(
        signal.observationId,
        signal.signalType,
        signal.sessionDbId ?? null,
        Date.now(),
        signal.metadata ? JSON.stringify(signal.metadata) : null
      );
    } catch (err) {
      logger.warn(
        'FEEDBACK',
        'record failed',
        { observationId: signal.observationId, signalType: signal.signalType },
        err as Error
      );
    }
  }

  recordBatch(signals: FeedbackSignal[]): void {
    if (signals.length === 0) return;
    try {
      const tx = this.db.transaction((items: FeedbackSignal[]) => {
        for (const s of items) {
          this.insertStmt.run(
            s.observationId,
            s.signalType,
            s.sessionDbId ?? null,
            Date.now(),
            s.metadata ? JSON.stringify(s.metadata) : null
          );
        }
      });
      tx(signals);
    } catch (err) {
      logger.warn(
        'FEEDBACK',
        'recordBatch failed',
        { count: signals.length },
        err as Error
      );
    }
  }

  countForObservation(observationId: number, opts: FeedbackCountOptions = {}): number {
    const clauses: string[] = ['observation_id = ?'];
    const params: unknown[] = [observationId];
    if (opts.signalType) {
      clauses.push('signal_type = ?');
      params.push(opts.signalType);
    }
    if (typeof opts.sinceEpoch === 'number') {
      clauses.push('created_at_epoch >= ?');
      params.push(opts.sinceEpoch);
    }
    const sql = `SELECT COUNT(*) AS n FROM observation_feedback WHERE ${clauses.join(' AND ')}`;
    const row = this.db.query(sql).get(...params) as { n: number } | undefined;
    return row?.n ?? 0;
  }
}
