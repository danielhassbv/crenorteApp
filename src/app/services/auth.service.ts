// src/app/services/auth.service.ts
import { Injectable, inject } from '@angular/core';

// AngularFire Auth
import {
  Auth,
  user,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
} from '@angular/fire/auth';

// AngularFire Firestore
import {
  Firestore,
  doc,
  docData,
  setDoc,
  getDoc,
  DocumentReference,
} from '@angular/fire/firestore';

// Tipos do app
import { Colaborador, Papel } from '../models/colaborador.model';

// RxJS
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private db = inject(Firestore);

  /** Usuário bruto do Firebase (null quando deslogado) */
  firebaseUser$ = user(this.auth);

  /**
   * Perfil do colaborador no Firestore (colaboradores/{uid}).
   * docData pode emitir `undefined` se o doc não existir — normalizamos para `null`.
   */
  perfil$: Observable<Colaborador | null> = this.firebaseUser$.pipe(
    switchMap(u => {
      if (!u?.uid) return of<Colaborador | null>(null);
      const ref = doc(this.db, 'colaboradores', u.uid) as DocumentReference<Colaborador>;
      return (docData(ref) as Observable<Colaborador | undefined>).pipe(
        map(d => d ?? null)
      );
    })
  );

  /** Papel (role) do colaborador logado, ou null se não definido/logado */
  papel$: Observable<Papel | null> = this.perfil$.pipe(
    map((p) => p?.papel ?? null)
  );

  /** Login por e-mail/senha */
  async login(email: string, senha: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, senha);
  }

  /** Logout */
  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  /** Envia e-mail de redefinição de senha */
  async resetSenha(email: string): Promise<void> {
    await sendPasswordResetEmail(this.auth, email);
  }

  /**
   * Cria usuário no Auth e documento em `colaboradores/{uid}`.
   * Use esta função em telas restritas a administradores.
   */
  async criarColaborador(
    email: string,
    senha: string,
    dados: Omit<Colaborador, 'uid' | 'criadoEm'>
  ): Promise<string> {
    const cred = await createUserWithEmailAndPassword(this.auth, email, senha);
    const uid = cred.user.uid;

    const ref = doc(this.db, 'colaboradores', uid) as DocumentReference<Colaborador>;
    const novo: Colaborador = {
      uid,
      ...dados,
      status: dados.status ?? 'ativo',
      criadoEm: Date.now(),
    };
    await setDoc(ref, novo);
    return uid;
  }

  /**
   * Observable booleano para verificar se o usuário corrente possui
   * um dos papéis informados.
   */
  temPapel$(roles: Papel[]): Observable<boolean> {
    return this.papel$.pipe(map(p => !!p && roles.includes(p)));
  }

  /**
   * Garante que o documento mínimo exista em `colaboradores/{uid}` para o usuário atual.
   * Útil após login de contas antigas ou importadas.
   */
  async garantirPerfilMinimo(): Promise<void> {
    const u = this.auth.currentUser;
    if (!u) return;

    const ref = doc(this.db, 'colaboradores', u.uid) as DocumentReference<Colaborador>;
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: u.uid,
        nome: u.displayName ?? 'Sem Nome',
        email: u.email ?? '',
        papel: 'assessor',
        status: 'ativo',
        criadoEm: Date.now(),
      } as Colaborador);
    }
  }
}
