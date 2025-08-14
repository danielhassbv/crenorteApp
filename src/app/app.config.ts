// src/app/app.config.ts
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

// AngularFire providers
import { provideFirebaseApp } from '@angular/fire/app';
import { provideAuth } from '@angular/fire/auth';
import { provideFirestore } from '@angular/fire/firestore';
import { provideStorage } from '@angular/fire/storage';

// SDK factories (reutilizam o app existente)
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

import { firebaseConfig } from '../environments/firebase.config';
import { provideNgxMask } from 'ngx-mask';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),

    // ✅ Reaproveita o app se já existir; senão cria UM (sem duplicar)
    provideFirebaseApp(() =>
      getApps().length ? getApp() : initializeApp(firebaseConfig)
    ),

    // ✅ Esses providers passam a usar a MESMA instância (nada de 2 Firestores)
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage()),

    // Globais
    provideNgxMask({
      validation: true,
      dropSpecialCharacters: true,
      thousandSeparator: '.',
      decimalMarker: ',',
    }),
  ],
};
