import type { IncomingMessage, ServerResponse } from 'node:http';
import { createShortsPilotApp } from '../backend/app.js';

const app = createShortsPilotApp();

export default function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse
) {
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const rewrittenPath = parsed.searchParams.get('__vercel_path');
      if (rewrittenPath !== null) {
        parsed.searchParams.delete('__vercel_path');
        const qs = parsed.searchParams.toString();
        const cleanSubpath = rewrittenPath.replace(/^\/+/, '');
        req.url = `/api/${cleanSubpath}${qs ? `?${qs}` : ''}`;
      }
    } catch {
      // Keep original req.url if URL parsing fails
    }
  }

  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
