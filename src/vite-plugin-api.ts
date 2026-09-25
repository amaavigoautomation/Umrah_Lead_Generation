import { Plugin } from 'vite';
import { handleCoreApi } from './server/coreApiHandler.js';
import { pollAndProcessImapMailbox } from './server/inboundPipeline.js';
import { getImapConfig } from './server/imapService.js';
import { checkAndDispatchPendingWebsiteLeadEmails } from './server/websiteLeadAutoResponder.js';

export function umrah360ApiPlugin(): Plugin {
  return {
    name: 'umrah360-api-plugin',
    configureServer(server) {
      // Auto-poll IMAP inbox for incoming mail and check for new website leads every 6 seconds
      let isBackgroundPolling = false;
      const safeBackgroundPoll = async () => {
        if (isBackgroundPolling) return;
        isBackgroundPolling = true;
        try {
          // 1. Process any incoming website demo leads that need a real thank-you email
          await checkAndDispatchPendingWebsiteLeadEmails();

          // 2. Poll IMAP if configured
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

      const initialTimer = setTimeout(safeBackgroundPoll, 3000);
      const poller = setInterval(safeBackgroundPoll, 6000);

      server.httpServer?.on('close', () => {
        clearTimeout(initialTimer);
        clearInterval(poller);
      });

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/') && !req.url?.startsWith('/api')) {
          return next();
        }

        const handled = await handleCoreApi(req, res);
        if (!handled && !res.writableEnded) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: 'Endpoint not found', url: req.url }));
        }
      });
    },
  };
}
