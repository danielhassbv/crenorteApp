import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  getDocs,
  CollectionReference,
  DocumentData,
  doc,
  getDoc
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { PreCadastro } from '../models/pre-cadastro.model';

@Injectable({ providedIn: 'root' })
export class PreCadastroService {
  private db = inject(Firestore);
  private auth = inject(Auth);

  // coleção principal
  private colRef: CollectionReference<DocumentData> =
    collection(this.db, 'pre_cadastros') as CollectionReference<DocumentData>;

  /**
   * Cria o pré-cadastro e retorna o ID do documento.
   * Seta createdByUid/createdByNome/createdAt para bater com suas rules.
   */
  async criar(
    data: Omit<PreCadastro, 'id' | 'createdAt' | 'createdByUid' | 'createdByNome'>
  ): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    // tenta usar o nome do colaborador salvo no Firestore
    let createdByNome = 'Assessor';
    try {
      const snap = await getDoc(doc(this.db, 'colaboradores', user.uid));
      createdByNome = (snap.data() as any)?.papel ? (snap.data() as any)?.nome || user.displayName || 'Assessor'
                                                  : user.displayName || 'Assessor';
    } catch {
      // mantém fallback
    }

    const payload = {
      ...data,
      createdByUid: user.uid,
      createdByNome,
      createdAt: serverTimestamp(),
    };

    const ref = await addDoc(this.colRef, payload);
    return ref.id;
  }

  /**
   * Salva o feedback do CLIENTE em:
   * pre_cadastros/{id}/feedback_cliente
   *
   * As rules recomendadas liberam create para:
   * - liderança (admin/supervisor/coordenador), OU
   * - assessor dono do pré-cadastro (createdByUid == auth.uid)
   */
  async registrarFeedbackCliente(preCadastroId: string, feedback: any): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const col = collection(this.db, `pre_cadastros/${preCadastroId}/feedback_cliente`);
    await addDoc(col, {
      ...feedback,
      assessorUid: user.uid, // útil para auditoria
      source: 'cliente',
      createdAt: serverTimestamp(),
    });
  }

  /**
   * Lista apenas os pré-cadastros do assessor logado (ou de um uid).
   * Mantém a semântica das suas rules (liderança vê tudo do lado do server).
   */
  async listarDoAssessor(uid?: string) {
    const useUid = uid ?? this.auth.currentUser?.uid;
    if (!useUid) throw new Error('Usuário não autenticado.');

    try {
      const qy = query(
        this.colRef,
        where('createdByUid', '==', useUid),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(qy);
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
    } catch (e: any) {
      console.warn('[PreCadastro] Fallback sem índice composto:', e?.message || e);
      const qy = query(this.colRef, where('createdByUid', '==', useUid));
      const snap = await getDocs(qy);
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];

      const ms = (x: any) =>
        x?.toMillis ? x.toMillis() :
        x?.toDate ? x.toDate().getTime() :
        (typeof x === 'number' ? x : 0);

      rows.sort((a: any, b: any) => (ms(b.createdAt) - ms(a.createdAt)));
      return rows;
    }
  }

  /**
   * Lista todos os pré-cadastros (liderança).
   */
  async listarTodos() {
    const qy = query(this.colRef, orderBy('createdAt', 'desc'));
    const snap = await getDocs(qy);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
  }
}
