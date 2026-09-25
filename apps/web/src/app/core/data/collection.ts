import { HttpClient } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import { toApiError } from '../http/api-error';

/**
 * Eine Ressource der API als Signal-Liste mit Laden, Anlegen, Ändern und Löschen.
 * Nach jedem Schreibzugriff steht der Stand des Servers in der Liste.
 */
export class Collection<T extends { id: string }, C = unknown, U = unknown> {
  private readonly _items = signal<T[]>([]);
  readonly items = this._items.asReadonly();
  readonly loaded = signal(false);
  readonly byId = computed(() => new Map(this._items().map((x) => [x.id, x])));

  constructor(
    private readonly http: HttpClient,
    private readonly path: string,
  ) {}

  clear(): void {
    this._items.set([]);
    this.loaded.set(false);
  }

  async load(): Promise<void> {
    try {
      this._items.set(await firstValueFrom(this.http.get<T[]>(this.path)));
      this.loaded.set(true);
    } catch (err) {
      throw toApiError(err);
    }
  }

  async create(body: C): Promise<T> {
    const row = await this.call(this.http.post<T>(this.path, body));
    this._items.update((xs) => [...xs, row]);
    return row;
  }

  async update(id: string, patch: U): Promise<T> {
    const row = await this.call(this.http.patch<T>(`${this.path}/${id}`, patch));
    this._items.update((xs) => xs.map((x) => (x.id === id ? row : x)));
    return row;
  }

  async remove(id: string, query = ''): Promise<void> {
    await this.call(this.http.delete<unknown>(`${this.path}/${id}${query}`));
    this._items.update((xs) => xs.filter((x) => x.id !== id));
  }

  private async call<R>(obs: Observable<R>): Promise<R> {
    try {
      return await firstValueFrom(obs);
    } catch (err) {
      throw toApiError(err);
    }
  }
}
