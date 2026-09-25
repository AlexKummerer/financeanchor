import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { AuthService } from './auth.service';
import { authGuard, guestGuard } from './guards';

describe('Guards', () => {
  let authenticated = false;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { isAuthenticated: () => authenticated } },
      ],
    });
  });

  const run = (guard: typeof authGuard, url = '/') =>
    TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );

  it('ohne Session: zum Login mit Rücksprungadresse', () => {
    authenticated = false;
    const r = run(authGuard, '/kredite') as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/login?returnUrl=%2Fkredite');
  });

  it('mit Session: Zugang, Login leitet zur Übersicht', () => {
    authenticated = true;
    expect(run(authGuard)).toBe(true);
    expect(TestBed.inject(Router).serializeUrl(run(guestGuard) as UrlTree)).toBe('/');
  });
});
