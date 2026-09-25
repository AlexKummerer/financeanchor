import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import type { Loan, LoanPlan } from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { AllocationTable } from './allocation-table';

export interface PlanPreviewData {
  title: string;
  /** Kurz, was übernommen würde */
  summary: string;
  plan: LoanPlan | null;
  loans: Loan[];
  settled: ReadonlySet<string>;
}

/** Aufteilung pro Monat, als wäre ein Vorschlag übernommen. */
@Component({
  selector: 'fa-plan-preview-dialog',
  imports: [TranslocoPipe, AllocationTable],
  template: `
    <h2 id="fa-dialog-title" style="margin-top: 0">{{ data.title }}</h2>
    <p class="small muted">{{ data.summary }}</p>
    <p class="small muted hint">{{ 'loans.advice.previewHint' | transloco }}</p>
    <fa-allocation-table [plan]="data.plan" [loans]="data.loans" [settled]="data.settled" />
    <div class="btnrow" style="margin-top: 16px; justify-content: flex-end">
      <button type="button" class="btn ghost" (click)="ref.close(false)" cdkFocusInitial>
        {{ 'common.close' | transloco }}
      </button>
      <button type="button" class="btn" (click)="ref.close(true)">
        {{ 'loans.advice.adopt' | transloco }}
      </button>
    </div>
  `,
  styles: `
    .hint {
      margin: 4px 0 10px;
    }
  `,
})
export class PlanPreviewDialog {
  protected readonly data = inject<PlanPreviewData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
}
