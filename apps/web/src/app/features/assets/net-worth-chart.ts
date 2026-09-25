import { Component, computed, input, signal } from '@angular/core';
import type { NetWorthSnapshot } from '@financeanchor/shared';
import { TranslocoPipe } from '@jsverse/transloco';
import { DatePipe, MoneyPipe } from '../../core/format/pipes';

const W = 340;
const H = 150;
const PAD = { l: 6, r: 6, t: 16, b: 22 };

/**
 * Verlauf des Nettovermögens (letzte 26 Stände): eine Linie mit Fläche, Fadenkreuz und Tooltip
 * beim Überfahren oder per Pfeiltasten, dazu die Werte als Tabelle.
 */
@Component({
  selector: 'fa-net-worth-chart',
  imports: [MoneyPipe, DatePipe, TranslocoPipe],
  template: `
    @if (points().length < 2) {
      <p class="empty">{{ 'assets.chartEmpty' | transloco }}</p>
    } @else {
      <div class="wrap">
        <svg
          [attr.viewBox]="'0 0 ' + w + ' ' + h"
          preserveAspectRatio="none"
          role="img"
          tabindex="0"
          [attr.aria-label]="
            'assets.chartLabel'
              | transloco
                : {
                    from: (first()!.date | faDate),
                    to: (last()!.date | faDate),
                    value: (last()!.netCents | money: true),
                  }
          "
          (pointermove)="onPointer($event)"
          (pointerleave)="active.set(null)"
          (blur)="active.set(null)"
          (keydown)="onKey($event)"
        >
          <line
            class="grid"
            [attr.x1]="0"
            [attr.x2]="w"
            [attr.y1]="h - pad.b"
            [attr.y2]="h - pad.b"
          />
          <path class="area" [attr.d]="areaPath()" />
          <path class="line" [attr.d]="linePath()" />
          @if (active(); as a) {
            <line
              class="cross"
              [attr.x1]="a.x"
              [attr.x2]="a.x"
              [attr.y1]="pad.t"
              [attr.y2]="h - pad.b"
            />
          }
        </svg>
        <!-- Punkt als HTML, damit er bei gestrecktem SVG rund bleibt -->
        @if (active() ?? last(); as p) {
          <span
            class="dot"
            aria-hidden="true"
            [style.left.%]="(p.x / w) * 100"
            [style.top.px]="p.y"
          ></span>
        }
        @if (active(); as a) {
          <div class="tip" [style.left.%]="(a.x / w) * 100" role="status">
            <b>{{ a.netCents | money: true }}</b>
            <span>{{ a.date | faDate }}</span>
          </div>
        }
        <div class="axis small muted" aria-hidden="true">
          <span>{{ first()!.date | faDate }}</span>
          <span>{{ last()!.date | faDate }}</span>
        </div>
      </div>
      <details class="table">
        <summary>{{ 'assets.asTable' | transloco }}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{{ 'assets.date' | transloco }}</th>
              <th scope="col">{{ 'assets.assetsCol' | transloco }}</th>
              <th scope="col">{{ 'assets.debtCol' | transloco }}</th>
              <th scope="col">{{ 'assets.netCol' | transloco }}</th>
            </tr>
          </thead>
          <tbody>
            @for (s of snapshots(); track s.id) {
              <tr>
                <td>{{ s.date | faDate }}</td>
                <td>{{ s.assetsCents | money: true }}</td>
                <td>{{ s.debtCents | money: true }}</td>
                <td>{{ s.netCents | money: true }}</td>
              </tr>
            }
          </tbody>
        </table>
      </details>
    }
  `,
  styles: `
    .wrap {
      position: relative;
      margin-top: 8px;
    }
    svg {
      width: 100%;
      height: 150px;
      display: block;
      touch-action: pan-y;
      border-radius: 8px;
    }
    .grid {
      stroke: var(--line);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    .area {
      fill: var(--pine-soft);
      opacity: 0.8;
    }
    .line {
      fill: none;
      stroke: var(--pine);
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }
    .cross {
      stroke: var(--muted);
      stroke-width: 1;
      stroke-dasharray: 3 3;
      vector-effect: non-scaling-stroke;
    }
    .dot {
      position: absolute;
      width: 10px;
      height: 10px;
      margin: -5px 0 0 -5px;
      border-radius: 50%;
      background: var(--pine);
      box-shadow: 0 0 0 2px var(--surface);
      pointer-events: none;
    }
    .tip {
      position: absolute;
      top: -6px;
      transform: translateX(-50%);
      background: var(--ink);
      color: var(--bg);
      border-radius: 8px;
      padding: 4px 8px;
      font-size: 0.8rem;
      white-space: nowrap;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .axis {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
    }
    .table {
      margin-top: 10px;
    }
    .table summary {
      font-weight: 500;
      font-size: 0.9rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
    }
    th,
    td {
      text-align: right;
      padding: 6px 4px;
      border-bottom: 1px solid var(--line);
    }
    th:first-child,
    td:first-child {
      text-align: left;
    }
    th {
      color: var(--muted);
      font-weight: 500;
    }
  `,
})
export class NetWorthChart {
  readonly snapshots = input.required<NetWorthSnapshot[]>();

  protected readonly w = W;
  protected readonly h = H;
  protected readonly pad = PAD;
  protected readonly active = signal<(Point & { index: number }) | null>(null);

  protected readonly points = computed<Point[]>(() => {
    const pts = [...this.snapshots()].sort((a, b) => a.date.localeCompare(b.date)).slice(-26);
    if (pts.length < 2) return [];
    const vals = pts.map((p) => p.netCents);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi === lo) {
      hi += 100;
      lo -= 100;
    }
    const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (pts.length - 1);
    const y = (v: number) => PAD.t + ((hi - v) * (H - PAD.t - PAD.b)) / (hi - lo);
    return pts.map((p, i) => ({ x: x(i), y: y(p.netCents), date: p.date, netCents: p.netCents }));
  });
  protected readonly first = computed(() => this.points()[0]);
  protected readonly last = computed(() => this.points().at(-1));
  protected readonly linePath = computed(() =>
    this.points()
      .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' '),
  );
  protected readonly areaPath = computed(() => {
    const pts = this.points();
    const base = H - PAD.b;
    return `${this.linePath()} L${pts.at(-1)?.x.toFixed(1)} ${base} L${pts[0]?.x.toFixed(1)} ${base} Z`;
  });

  protected onPointer(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    this.activate(this.nearest(vx));
  }

  protected onKey(e: KeyboardEvent) {
    const n = this.points().length;
    const cur = this.active()?.index ?? n - 1;
    const next =
      e.key === 'ArrowLeft'
        ? cur - 1
        : e.key === 'ArrowRight'
          ? cur + 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    this.activate(Math.max(0, Math.min(n - 1, next)));
  }

  private nearest(vx: number): number {
    const pts = this.points();
    let best = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs((pts[i]?.x ?? 0) - vx) < Math.abs((pts[best]?.x ?? 0) - vx)) best = i;
    }
    return best;
  }

  private activate(index: number) {
    const p = this.points()[index];
    this.active.set(p ? { ...p, index } : null);
  }
}

interface Point {
  x: number;
  y: number;
  date: string;
  netCents: number;
}
