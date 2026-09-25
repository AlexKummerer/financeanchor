import { env, exports } from 'cloudflare:workers';

let ipCounter = 0;
/** Jeder Testnutzer bekommt eine eigene IP, damit sich die Login-Limits nicht gegenseitig treffen. */
export const nextIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

export const BASE = 'http://localhost';
export const PASSWORD = 'ein-sicheres-passwort-123';

export function request(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return exports.default.fetch(`${BASE}${path}`, { ...init, headers });
}

/** Registriert einen Nutzer und liefert Session-Cookie und ID. */
export async function signUp(email: string, ip = nextIp()) {
  const res = await request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip, origin: 'http://localhost:4200' },
    body: JSON.stringify({ email, password: PASSWORD, name: email.split('@')[0] }),
  });
  if (res.status !== 200) throw new Error(`sign-up ${res.status}: ${await res.text()}`);
  const body = await res.json<{ user: { id: string } }>();
  return { userId: body.user.id, cookie: sessionCookie(res) };
}

export async function signIn(email: string, password = PASSWORD, ip = nextIp()) {
  return request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip, origin: 'http://localhost:4200' },
    body: JSON.stringify({ email, password }),
  });
}

export function sessionCookie(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

export { env };
