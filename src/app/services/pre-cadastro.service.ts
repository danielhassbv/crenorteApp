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
  getDoc,
  deleteDoc,
  updateDoc, // <-- adicionado
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
      createdByNome = (snap.data() as any)?.papel
        ? ((snap.data() as any)?.nome || user.displayName || 'Assessor')
        : (user.displayName || 'Assessor');
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
   */
  async registrarFeedbackCliente(preCadastroId: string, feedback: any): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    const col = collection(this.db, `pre_cadastros/${preCadastroId}/feedback_cliente`);
    await addDoc(col, {
      ...feedback,
      assessorUid: user.uid,
      source: 'cliente',
      createdAt: serverTimestamp(),
    });
  }

  /**
   * Lista apenas os pré-cadastros do assessor logado (ou de um uid).
   */
  async listarDoAssessor(uid?: string): Promise<PreCadastro[]> {
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
      // fallback sem índice composto
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
  async listarTodos(): Promise<PreCadastro[]> {
    const qy = query(this.colRef, orderBy('createdAt', 'desc'));
    const snap = await getDocs(qy);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
  }

  /**
   * Atualiza campos de um pré-cadastro.
   */
  async atualizar(id: string, patch: Partial<PreCadastro>): Promise<void> {
    // remove undefined para não sobrescrever com undefined
    const clean: Record<string, any> = {};
    Object.entries(patch).forEach(([k, v]) => {
      if (v !== undefined) clean[k] = v;
    });
    await updateDoc(doc(this.db, 'pre_cadastros', id), clean);
  }

  /**
   * Remove um pré-cadastro pelo ID (apaga apenas o documento raiz).
   */
  async remover(id: string): Promise<void> {
    await deleteDoc(doc(this.db, 'pre_cadastros', id));
  }

  /**
   * (Opcional) Remove um pré-cadastro e subcoleções conhecidas.
   * Use com cautela: Firestore não tem delete recursivo no client.
   */
  async removerDeep(id: string, opts?: { feedbackCliente?: boolean }): Promise<void> {
    if (opts?.feedbackCliente) {
      const subCol = collection(this.db, `pre_cadastros/${id}/feedback_cliente`);
      const subSnap = await getDocs(subCol);
      await Promise.all(subSnap.docs.map(d => deleteDoc(d.ref)));
    }
    await deleteDoc(doc(this.db, 'pre_cadastros', id));
  }

  async atualizarStatusAgendamento(id: string, status: 'nao_agendado' | 'agendado' | 'visitado', agendamentoId?: string | null) {
    return this.atualizar(id, {
      agendamentoStatus: status,
      agendamentoId: agendamentoId ?? null,
    } as any);
  }

}
