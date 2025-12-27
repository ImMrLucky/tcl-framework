import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ValidateOutput, ValidationOptions, Source, CallMetadata } from './types';

@Injectable({
  providedIn: 'root'
})
export class TclService {
  // Use environment variable or fallback to proxy path
  private get apiBase(): string {
    if (typeof window !== 'undefined') {
      const apiUrl = (window as any).__TCL_API_URL;
      if (apiUrl) {
        return `${apiUrl}/validate`;
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
    return this.http.post<ValidateOutput>(this.apiBase, {
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

