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
   * Normaliza para null quando não existir doc.
   */
  perfil$: Observable<Colaborador | null> = this.firebaseUser$.pipe(
    switchMap((u) => {
      if (!u?.uid) return of<Colaborador | null>(null);
      const ref = doc(this.db, 'colaboradores', u.uid) as DocumentReference<Colaborador>;
      return (docData(ref) as Observable<Colaborador | undefined>).pipe(
        map((d) => d ?? null)
      );
    })
  );

  /** Papel (role) do colaborador logado, ou null se não definido/logado */
  papel$: Observable<Papel | null> = this.perfil$.pipe(
    map((p) => p?.papel ?? null)
  );

  /** Login por e-mail/senha + bootstrap do perfil */
  async login(email: string, senha: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, senha);
    await this.garantirPerfilMinimo(); // <- garante colaboradores/{uid}
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
    return this.papel$.pipe(map((p) => !!p && roles.includes(p)));
  }

  /**
   * Cria o documento mínimo em `colaboradores/{uid}` se ainda não existir.
   * - Não altera papel/status quando já existirem (evita quebra nas regras).
   * - Papel padrão no bootstrap: 'assessor' (ajuste se necessário).
   */
  async garantirPerfilMinimo(): Promise<void> {
    const u = this.auth.currentUser;
    if (!u) return;

    const ref = doc(this.db, 'colaboradores', u.uid) as DocumentReference<Colaborador>;
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      const base: Colaborador = {
        uid: u.uid,
        nome: u.displayName ?? u.email ?? 'Usuário',
        email: u.email ?? '',
        papel: 'assessor',  // <- papel padrão para contas novas
        status: 'ativo',
        cpf: null,
        photoURL: u.photoURL ?? null,
        criadoEm: Date.now(),
      };
      // Cria o doc (permitido pelas regras: create próprio)
      await setDoc(ref, base);
    }
    // Se já existir, não escreve nada aqui para não tocar em papel/status.
  }

  
}
