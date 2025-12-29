import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { LogoComponent } from '../shared/logo.component';

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatCardModule,
    LogoComponent
  ],
  templateUrl: './pricing.component.html',
  styleUrls: ['./pricing.component.scss']
})
export class PricingComponent {
  plans = [
    {
      name: 'Sandbox',
      price: 'Free',
      period: '',
      description: 'Perfect for evaluators, QA managers, and developers to prove value fast',
      features: [
        'UI + REST API access',
        'Limited evaluations/day',
        'Short data retention',
        'No exports',
        'No SLAs'
      ],
      cta: 'Get Started Free',
      ctaLink: '/login',
      highlight: false
    },
    {
      name: 'Team / Developer',
      price: '$129',
      period: '/month',
      description: 'Ideal for small teams, pilots, and integrations',
      features: [
        'Higher limits',
        'API + webhooks',
        'Basic exports',
        'Email support',
        'Credit card checkout'
      ],
      cta: 'Start Free Trial',
      ctaLink: '/login',
      highlight: true
    },
    {
      name: 'Enterprise',
      price: 'Contact Us',
      period: '',
      description: 'For regulated organizations at scale',
      features: [
        'Custom limits',
        'SLA',
        'SSO',
        'Audit log exports',
        'Dedicated tenant options',
        'Security reviews'
      ],
      cta: 'Contact Sales',
      ctaLink: '/contact',
      highlight: false
    }
  ];
}

