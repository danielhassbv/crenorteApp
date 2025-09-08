// src/app/app.config.ts
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

import { provideFirebaseApp } from '@angular/fire/app';
import { provideAuth } from '@angular/fire/auth';
import { provideFirestore } from '@angular/fire/firestore';
import { provideStorage } from '@angular/fire/storage';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

import { firebaseConfig } from '../environments/firebase.config';
import { provideNgxMask } from 'ngx-mask';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient } from '@angular/common/http';
import { withPreloading, PreloadAllModules } from '@angular/router';

export const appConfig: ApplicationConfig = {
  
  
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withPreloading(PreloadAllModules)),

    provideFirebaseApp(() =>
      getApps().length ? getApp() : initializeApp(firebaseConfig)
    ),

    provideAuth(() => getAuth()),
    provideFirestore(() => {
      const fs = getFirestore();
      // opcional: cache offline
      enableIndexedDbPersistence(fs).catch(() => {});
      return fs;
    }),
    provideStorage(() => getStorage()),

    provideAnimationsAsync(),
    provideHttpClient(),

    provideNgxMask({
      validation: true,
      dropSpecialCharacters: true,
      thousandSeparator: '.',
      decimalMarker: ',',
    }),
  ],
};
