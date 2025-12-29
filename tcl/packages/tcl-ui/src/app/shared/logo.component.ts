import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-logo',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <a routerLink="/call-center-qa" class="logo-link">
      <div class="logo-container">
        <span class="logo-text">QA</span>
      </div>
    </a>
  `,
  styles: [`
    .logo-link {
      text-decoration: none;
      display: inline-block;
    }

    .logo-container {
      background-color: #000000;
      padding: 12px 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: transform 0.2s;
    }

    .logo-container:hover {
      transform: scale(1.05);
    }

    .logo-text {
      color: #00D4FF;
      font-size: 32px;
      font-weight: bold;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      letter-spacing: -1px;
      line-height: 1;
    }
  `]
})
export class LogoComponent {
}

