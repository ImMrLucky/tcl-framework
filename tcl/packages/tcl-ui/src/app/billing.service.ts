import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CheckoutResponse {
  sessionId: string;
  url: string;
}

export interface PortalResponse {
  url: string;
}

@Injectable({
  providedIn: 'root'
})
export class BillingService {
  private get apiUrl(): string {
    const apiUrl = (window as any).__TCL_API_URL;
    if (apiUrl) {
      return apiUrl;
    }
    return 'https://protectqa.com';
  }

  constructor(private http: HttpClient) {}

  /**
   * Create Stripe Checkout Session
   */
  createCheckoutSession(priceId: string, successUrl?: string, cancelUrl?: string): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(`${this.apiUrl}/api/billing/checkout`, {
      priceId,
      successUrl,
      cancelUrl,
    });
  }

  /**
   * Get Stripe Billing Portal link
   */
  getBillingPortal(): Observable<PortalResponse> {
    return this.http.post<PortalResponse>(`${this.apiUrl}/api/billing/portal`, {});
  }
}

