import { exportSchema } from '@financeanchor/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../middleware/context.js';
import { requireEntitlement } from '../middleware/entitlement.js';
import { exportUserData, importUserData } from '../services/exportImport.js';
import { validate } from '../validation.js';
import { scopedFrom } from './util.js';

export const backupRoutes = new Hono<AppEnv>()
  .get('/export', requireEntitlement('export'), async (c) => {
    const file = await exportUserData(scopedFrom(c));
    c.header(
      'Content-Disposition',
      `attachment; filename="financeanchor-sicherung-${file.exportedAt.slice(0, 10)}.json"`,
    );
    return c.json(file);
  })
  .post('/import', requireEntitlement('export'), validate('json', exportSchema), async (c) => {
    return c.json({ imported: await importUserData(scopedFrom(c), c.req.valid('json')) });
  });
