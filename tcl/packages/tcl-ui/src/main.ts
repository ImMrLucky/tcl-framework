import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { AuthInterceptor } from './app/auth.interceptor';
import {provideAnimations} from "@angular/platform-browser/animations";

bootstrapApplication(AppComponent, {
  providers: [
    // withInterceptorsFromDi() is required for class-based interceptors in Angular 17+
    provideHttpClient(withInterceptorsFromDi()),
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    },
    provideRouter(routes),
      provideAnimations()
  ]
}).catch(err => console.error(err));

