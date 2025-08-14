// src/app/firebase.config.ts
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../environments/firebase.config';

// Garante que só exista UM app (se já existir, apenas reutiliza)
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Expõe a mesma instância do Firestore para quem já importa { db } deste arquivo
export const db = getFirestore(app);
