import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Toast } from './core/ui/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toast],
  template: `<router-outlet /><fa-toast />`,
})
export class App {}
