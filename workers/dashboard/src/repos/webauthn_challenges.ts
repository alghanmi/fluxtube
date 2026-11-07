// Repo for the `webauthn_challenge_used` D1 table (migration 0004).
//
// A passkey ceremony's challenge travels in a signed five-minute cookie
// (auth/challenge.ts). The signature proves the Worker issued it; this table
// makes it single-use. `consume()` is called only AFTER the ceremony's
// response has verified, so a request that can't produce a valid passkey
// response never writes here.

export interface ConsumeChallengeInput {
  challenge: string;
  purpose: 'register' | 'authenticate';
  /** Unix seconds after which the challenge's cookie can no longer be valid. */
  expiresAt: number;
  now: number;
}

export class WebauthnChallengeRepo {
  constructor(private readonly db: D1Database) {}

  /**
   * Records the challenge as used. Returns true the first time a challenge is
   * consumed and false on any later attempt, so the caller can refuse a
   * replayed response. Expired rows are pruned in the same batch.
   */
  async consume(input: ConsumeChallengeInput): Promise<boolean> {
    const [, inserted] = await this.db.batch([
      this.db.prepare('DELETE FROM webauthn_challenge_used WHERE expires_at < ?').bind(input.now),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO webauthn_challenge_used (challenge, purpose, expires_at)
           VALUES (?, ?, ?)`,
        )
        .bind(input.challenge, input.purpose, input.expiresAt),
    ]);
    return (inserted?.meta.changes ?? 0) === 1;
  }
}
