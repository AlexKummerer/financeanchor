import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import type { DueBookRequest, DueEntry, IsoDate, YearMonth } from '@financeanchor/shared';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../http/api-error';

@Service()
export class DueApi {
  private readonly http = inject(HttpClient);

  async plan(month: YearMonth, today: IsoDate): Promise<DueEntry[]> {
    try {
      return await firstValueFrom(
        this.http.get<DueEntry[]>(`/api/due/${month}`, { params: { today } }),
      );
    } catch (err) {
      throw toApiError(err);
    }
  }

  async book(
    month: YearMonth,
    req: Omit<DueBookRequest, 'overrides'> & Partial<Pick<DueBookRequest, 'overrides'>>,
  ) {
    try {
      return await firstValueFrom(
        this.http.post<{ bookedCount: number; entries: DueEntry[] }>(`/api/due/${month}/book`, req),
      );
    } catch (err) {
      throw toApiError(err);
    }
  }
}
