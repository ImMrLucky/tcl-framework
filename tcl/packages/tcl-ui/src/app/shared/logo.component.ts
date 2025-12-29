import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-logo',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <a routerLink="/home" class="logo-link">
      <div class="logo-container">
        <span class="logo-left">Protect</span>
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
    
    .logo-left {
      color: #1e293b;
      font-size: 18px;
    }

    .logo-text {
      color: #3b82f6;
      font-size: 18px;
      font-weight: bold;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      letter-spacing: -1px;
      line-height: 1;
    }
  `]
})
export class LogoComponent {
}

