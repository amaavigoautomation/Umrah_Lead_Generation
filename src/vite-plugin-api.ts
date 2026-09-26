import { Plugin } from 'vite';
import { handleCoreApi } from './server/coreApiHandler.js';
import { pollAndProcessImapMailbox } from './server/inboundPipeline.js';
import { getImapConfig } from './server/imapService.js';

export function umrah360ApiPlugin(): Plugin {
  return {
    name: 'umrah360-api-plugin',
    configureServer(server) {
      // Auto-poll IMAP inbox for incoming mail every 10 seconds if configured (singleton lock)
      let isBackgroundPolling = false;
      const safeBackgroundPoll = async () => {
        if (isBackgroundPolling) return;
        isBackgroundPolling = true;
        try {
          const cfg = getImapConfig();
          if (cfg.configured) {
            await pollAndProcessImapMailbox();
          }
        } catch (e) {
          // ignore background poller errors
        } finally {
          isBackgroundPolling = false;
        }
      };

      const initialTimer = setTimeout(safeBackgroundPoll, 4000);
      const imapPoller = setInterval(safeBackgroundPoll, 10000);

      server.httpServer?.on('close', () => {
        clearTimeout(initialTimer);
        clearInterval(imapPoller);
      });

      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (!rawUrl.startsWith('/api/') && rawUrl !== '/api' && !rawUrl.startsWith('/api?')) {
          return next();
        }

        try {
          const handled = await handleCoreApi(req, res);
          if (!handled && !res.writableEnded) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ success: false, error: 'Endpoint not found', url: req.url }));
          }
        } catch (err: any) {
          console.error('[API Middleware Error]:', err);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ success: false, error: err?.message || 'Internal Server Error' }));
          }
        }
      });
    },
  };
}
