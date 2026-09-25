import type { Auth } from '../auth.js';
import type { Db } from '../db/client.js';

export interface AppVariables {
  auth: Auth;
  db: Db;
  userId: string;
  requestId: string;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
