import { Component, computed, input } from '@angular/core';

const PATHS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  book: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3',
  repeat: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4',
  trend: 'M4 18L10 12l4 4 6-8M15 8h5v5',
  bars: 'M4 20h16M6 20V10M10 20V6M14 20v-8M18 20V4',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  anchor: 'M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 7v14M5 12H3a9 9 0 0 0 18 0h-2M8 10h8',
} as const;

export type IconName = keyof typeof PATHS;

/**
 * Strich-Icons als eigene Komponente. Inline-SVG direkt in Layout-Templates führte dazu, dass
 * später per Router eingesetzte Seiten im SVG-Namensraum erzeugt wurden und unsichtbar blieben.
 */
@Component({
  selector: 'fa-icon',
  template: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path [attr.d]="d()" />
  </svg>`,
  host: { class: 'fa-icon' },
  styles: `
    :host {
      display: inline-flex;
      width: var(--icon-size, 22px);
      height: var(--icon-size, 22px);
    }
    svg {
      width: 100%;
      height: 100%;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  protected readonly d = computed(() => PATHS[this.name()]);
}
