import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ValidateOutput, ValidationOptions, Source, CallMetadata } from './types';

@Injectable({
  providedIn: 'root'
})
export class TclService {
  // Use evaluation URL (Railway direct) for long-running /validate calls
  // This bypasses Netlify's 30-second function timeout
  private get validateUrl(): string {
    if (typeof window !== 'undefined') {
      // First check for dedicated evaluation URL (Railway)
      if ((window as any).__TCL_EVALUATION_URL) {
        return `${(window as any).__TCL_EVALUATION_URL}/validate`;
      }
      // Fall back to API URL
      if ((window as any).__TCL_API_URL) {
        return `${(window as any).__TCL_API_URL}/validate`;
      }
    }
    return '/api/validate';
  }

  constructor(private http: HttpClient) {}

  validate(
    question: string,
    answer: string,
    sources: Source[] | undefined,
    options: ValidationOptions,
    callMetadata?: CallMetadata
  ): Observable<ValidateOutput> {
    return this.http.post<ValidateOutput>(this.validateUrl, {
      question,
      answer,
      sources,
      callMetadata,
      options: {
        spectral: options.spectral,
        spectralServiceUrl: options.spectralServiceUrl,
        ann: options.ann,
        cache: options.cache,
        supportThreshold: options.supportThreshold,
        contradictionThreshold: options.contradictionThreshold,
        groundingThreshold: options.groundingThreshold,
        maxPairwiseEdges: options.maxPairwiseEdges,
        neighborK: options.neighborK,
      },
    });
  }

  getEngineVersion(): Observable<string> {
    // TODO: Implement a proper /version endpoint on the backend
    return new Observable(observer => {
      observer.next('v0.2.0 (mock)');
      observer.complete();
    });
  }
}

