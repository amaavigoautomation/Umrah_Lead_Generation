import type { IncomingMessage, ServerResponse } from 'http';
import webhookHandler from '../webhooks/umrah-demo';

export default async function handler(
  req: IncomingMessage & { body?: any; query?: any },
  res: ServerResponse
) {
  return webhookHandler(req, res);
}
