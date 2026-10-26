/**
 * Whether a booked demo ends automated follow-ups.
 *
 * false (current): follow-ups keep running when a demo is proposed in the thread or booked in the system.
 *                  The AI is told a demo exists so the message stays relevant (confirm, prepare, remind).
 * true  (old behaviour): a DEMO_BOOKED lead is cancelled/disabled and never follow-up-ed again.
 */
export const STOP_FOLLOWUPS_WHEN_DEMO_BOOKED = false;
