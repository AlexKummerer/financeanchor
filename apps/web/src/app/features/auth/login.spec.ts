import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { translocoTesting } from '../../../testing/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { ApiError } from '../../core/http/api-error';
import { LoginPage, safeReturnUrl } from './login';

describe('safeReturnUrl', () => {
  it('lässt nur interne Pfade zu', () => {
    expect(safeReturnUrl('/kredite')).toBe('/kredite');
    expect(safeReturnUrl('//evil.example')).toBe('/');
    expect(safeReturnUrl('https://evil.example')).toBe('/');
    expect(safeReturnUrl(undefined)).toBe('/');
  });
});

describe('LoginPage', () => {
  const login = vi.fn();

  beforeEach(() => {
    login.mockReset();
    TestBed.configureTestingModule({
      imports: [LoginPage, translocoTesting()],
      providers: [provideRouter([]), { provide: AuthService, useValue: { login } }],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function fill(el: HTMLElement, email: string, password: string) {
    const set = (sel: string, v: string) => {
      const i = el.querySelector<HTMLInputElement>(sel)!;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    set('#email', email);
    set('#password', password);
  }

  it('zeigt Pflichtfeld-Fehler und sendet nichts', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Bitte eine gültige E-Mail-Adresse eingeben.');
    expect(el.querySelector('#email')!.getAttribute('aria-invalid')).toBe('true');
    expect(login).not.toHaveBeenCalled();
  });

  it('meldet an und leitet weiter', async () => {
    login.mockResolvedValue(undefined);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const { fixture, el } = await render();
    fill(el, ' alex@example.com ', 'geheim-geheim');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(login).toHaveBeenCalledWith('alex@example.com', 'geheim-geheim');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('zeigt eine verständliche Meldung bei falschen Daten', async () => {
    login.mockRejectedValue(new ApiError(401, 'invalid', 'x'));
    const { fixture, el } = await render();
    fill(el, 'alex@example.com', 'falsch-falsch');
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')!.textContent).toContain(
      'E-Mail oder Passwort stimmen nicht.',
    );
  });
});
