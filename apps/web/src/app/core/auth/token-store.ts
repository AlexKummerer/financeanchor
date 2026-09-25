import { Service, signal } from '@angular/core';

/**
 * Ablage für ein Session-Token. Im Web bleibt sie leer, weil die Session im HttpOnly-Cookie liegt.
 * Die native App (Phase 3) ersetzt sie durch eine Variante mit sicherem Gerätespeicher und nutzt
 * das Bearer-Plugin von Better Auth.
 */
@Service()
export class TokenStore {
  readonly token = signal<string | null>(null);
}
