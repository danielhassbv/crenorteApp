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
  updateDoc,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { PreCadastro } from '../models/pre-cadastro.model';

// ✅ Storage (upload/download/remover)
import {
  Storage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from '@angular/fire/storage';

// Se você criou a interface no model (recomendado)
import type { ArquivoPreCadastro } from '../models/pre-cadastro.model';

type UsuarioAssessor = {
  uid: string;
  nome: string;
  papel: 'assessor' | string;
  supervisorUid?: string | null;
  analistaResponsavelUid?: string | null;
};

@Injectable({ providedIn: 'root' })
export class PreCadastroService {
  private db = inject(Firestore);
  private auth = inject(Auth);
  private storage = inject(Storage);

  // coleção principal
  private colRef: CollectionReference<DocumentData> =
    collection(this.db, 'pre_cadastros') as CollectionReference<DocumentData>;

  /**
   * Cria o pré-cadastro e retorna o ID do documento.
   * Seta createdByUid/createdByNome/createdAt e default de aprovação = 'nao_verificado'.
   */
  async criar(
    data: Omit<PreCadastro, 'id' | 'createdAt' | 'createdByUid' | 'createdByNome' | 'aprovacao'>
  ): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    let createdByNome = 'Assessor';
    try {
      const snap = await getDoc(doc(this.db, 'colaboradores', user.uid));
      createdByNome = (snap.data() as any)?.papel
        ? ((snap.data() as any)?.nome || user.displayName || 'Assessor')
        : (user.displayName || 'Assessor');
    } catch {}

    const payload = {
      ...data,
      aprovacao: { status: 'nao_verificado' as const },
      encaminhamento: null,
      createdByUid: user.uid,
      createdByNome,
      createdAt: serverTimestamp(),
    };

    const ref = await addDoc(this.colRef, payload);
    return ref.id;
  }

  /**
   * Vincula/espelha o fluxo de caixa ao pré-cadastro (e marca timestamp).
   */
  async salvarFluxoCaixa(
    preCadastroId: string,
    fluxoCaixa: any,
    totais: { receita: number; custos: number; lucro: number }
  ): Promise<void> {
    await updateDoc(doc(this.db, 'pre_cadastros', preCadastroId), {
      fluxoCaixa,
      fluxoCaixaTotais: totais,
      fluxoAtualizadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    });
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
    } catch {
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
    const clean: Record<string, any> = {};
    Object.entries(patch).forEach(([k, v]) => {
      if (v !== undefined) clean[k] = v;
    });
    if (!('atualizadoEm' in clean)) {
      clean['atualizadoEm'] = serverTimestamp();
    }
    await updateDoc(doc(this.db, 'pre_cadastros', id), clean);
  }

  /**
   * Remove um pré-cadastro pelo ID.
   */
  async remover(id: string): Promise<void> {
    await deleteDoc(doc(this.db, 'pre_cadastros', id));
  }

  /**
   * (Opcional) Remove um pré-cadastro e subcoleções conhecidas.
   */
  async removerDeep(id: string, opts?: { feedbackCliente?: boolean }): Promise<void> {
    if (opts?.feedbackCliente) {
      const subCol = collection(this.db, `pre_cadastros/${id}/feedback_cliente`);
      const subSnap = await getDocs(subCol);
      await Promise.all(subSnap.docs.map(d => deleteDoc(d.ref)));
    }
    await deleteDoc(doc(this.db, 'pre_cadastros', id));
  }

  async atualizarStatusAgendamento(
    id: string,
    status: 'nao_agendado' | 'agendado' | 'visitado',
    agendamentoId?: string | null
  ) {
    return this.atualizar(id, {
      agendamentoStatus: status,
      agendamentoId: agendamentoId ?? null,
    } as any);
  }

  // ============================
  // *** BLOCO: APROVAÇÃO ***
  // ============================

  async listarParaAprovacao(): Promise<PreCadastro[]> {
    try {
      const qy = query(this.colRef, where('aprovacao.status', 'in', ['inapto', 'apto']));
      const snap = await getDocs(qy);
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
      rows.sort((a: any, b: any) => {
        const ms = (x: any) =>
          x?.toMillis ? x.toMillis() :
          x?.toDate ? x.toDate().getTime() :
          (typeof x === 'number' ? x : 0);
        return (ms(b.createdAt) - ms(a.createdAt));
      });
      return rows;
    } catch {
      const snap = await getDocs(this.colRef);
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
      const filtrados = rows.filter(r => ['inapto', 'apto'].includes(r?.aprovacao?.status ?? 'inapto'));
      filtrados.sort((a: any, b: any) => {
        const ms = (x: any) =>
          x?.toMillis ? x.toMillis() :
          x?.toDate ? x.toDate().getTime() :
          (typeof x === 'number' ? x : 0);
        return (ms(b.createdAt) - ms(a.createdAt));
      });
      return filtrados;
    }
  }

  async marcarApto(preCadastroId: string, observacao?: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    let aprovadorNome = user.displayName || 'Analista';
    try {
      const snap = await getDoc(doc(this.db, 'colaboradores', user.uid));
      aprovadorNome = (snap.data() as any)?.nome || aprovadorNome;
    } catch {}

    await updateDoc(doc(this.db, 'pre_cadastros', preCadastroId), {
      aprovacao: {
        status: 'apto',
        porUid: user.uid,
        porNome: aprovadorNome,
        em: serverTimestamp(),
        observacao: observacao ?? null,
      },
      atualizadoEm: serverTimestamp(),
    } as any);
  }

  async listarAssessoresDoAnalista(opts?: { usarSupervisor?: boolean; uidBase?: string }): Promise<UsuarioAssessor[]> {
    const user = this.auth.currentUser;
    if (!user && !opts?.uidBase) throw new Error('Usuário não autenticado.');

    const baseUid = opts?.uidBase ?? user!.uid;

    // 1) por analistaResponsavelUid
    let qy = query(
      collection(this.db, 'colaboradores'),
      where('papel', '==', 'assessor'),
      where('analistaResponsavelUid', '==', baseUid)
    );
    let snap = await getDocs(qy);

    // 2) se vazio, por supervisorUid
    if (snap.empty || opts?.usarSupervisor) {
      qy = query(
        collection(this.db, 'colaboradores'),
        where('papel', '==', 'assessor'),
        where('supervisorUid', '==', baseUid)
      );
      snap = await getDocs(qy);
    }

    return snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) })) as UsuarioAssessor[];
  }

  async listarParaCaixa(uid: string): Promise<PreCadastro[]> {
    if (!uid) throw new Error('uid obrigatório');

    const rows: PreCadastro[] = [];
    const tryGet = async (qy: any) => {
      try {
        const snap = await getDocs(qy);
        snap.docs.forEach(d => rows.push({ id: d.id, ...(d.data() as any) } as PreCadastro));
      } catch {}
    };

    await tryGet(query(this.colRef, where('caixaUid', '==', uid)));
    await tryGet(query(this.colRef, where('encaminhamento.assessorUid', '==', uid)));
    await tryGet(query(this.colRef, where('createdByUid', '==', uid)));

    const ms = (x: any) => x?.toMillis ? x.toMillis() : x?.toDate ? x.toDate().getTime() : (typeof x === 'number' ? x : 0);
    const map = new Map<string, PreCadastro>();
    rows.forEach(r => map.set(r.id, r));
    return Array.from(map.values()).sort((a: any, b: any) => ms(b.createdAt) - ms(a.createdAt));
  }

  async enviarParaAssessor(preCadastroId: string, assessorUid: string, assessorNome?: string): Promise<void> {
    let nome = assessorNome ?? '';
    if (!nome) {
      try {
        const snap = await getDoc(doc(this.db, 'colaboradores', assessorUid));
        nome = (snap.data() as any)?.nome || '';
      } catch {}
    }
    await updateDoc(doc(this.db, 'pre_cadastros', preCadastroId), {
      encaminhamento: {
        assessorUid,
        assessorNome: nome || null,
        em: serverTimestamp(),
      },
      atualizadoEm: serverTimestamp(),
    } as any);
  }

  // ============================
  // *** BLOCO: OBSERVAÇÕES ***
  // ============================

  /**
   * Atualiza o campo 'observacoes' no doc do pré-cadastro.
   */
  async atualizarObservacoes(preId: string, observacoes: string | null): Promise<void> {
    if (!preId) throw new Error('ID do pré-cadastro é obrigatório');
    await updateDoc(doc(this.db, 'pre_cadastros', preId), {
      observacoes: observacoes ?? null,
      atualizadoEm: serverTimestamp(),
    });
  }

  // =======================
  // *** BLOCO: ARQUIVOS ***
  // =======================
  // Estrutura sugerida:
  // - Storage:  pre-cadastros/{preId}/{timestamp}-{nomeArquivo}
  // - Firestore: pre_cadastros/{preId}/arquivos/{arquivoId} (metadados + storagePath)

  private arquivosCol(preId: string) {
    return collection(this.db, `pre_cadastros/${preId}/arquivos`);
  }

  /**
   * Lista os arquivos (metadados) de um pré-cadastro.
   */
  async listarArquivos(preId: string): Promise<ArquivoPreCadastro[]> {
    if (!preId) throw new Error('ID do pré-cadastro é obrigatório');
    const qy = query(this.arquivosCol(preId), orderBy('uploadedAt', 'desc'));
    const snap = await getDocs(qy);
    return snap.docs.map(d => ({
      id: d.id,
      ...(d.data() as any),
    })) as ArquivoPreCadastro[];
  }

  /**
   * Faz upload de um arquivo ao Storage e registra metadados na subcoleção.
   * Retorna o metadado consolidado (incluindo id e URL).
   */
  async uploadArquivo(
    preId: string,
    file: File,
    currentUser: { uid: string; nome?: string | null }
  ): Promise<ArquivoPreCadastro> {
    if (!preId) throw new Error('ID do pré-cadastro é obrigatório');
    if (!file) throw new Error('Arquivo inválido.');

    // Caminho recomendado no Storage
    const time = Date.now();
    const safeName = (file.name || 'arquivo').replace(/[^\w.\-]+/g, '_');
    const path = `pre-cadastros/${preId}/${time}-${safeName}`;

    // Upload binário
    const ref = storageRef(this.storage, path);
    await uploadBytes(ref, file);
    const url = await getDownloadURL(ref);

    // Metadados no Firestore
    const meta = {
      nome: file.name,
      url,
      tipo: (file as any).type || null,
      tamanho: (file as any).size ?? null,
      uploadedAt: serverTimestamp(),
      uploadedByUid: currentUser.uid,
      uploadedByNome: currentUser.nome ?? null,
      // Guardamos o caminho do storage para facilitar remoção futura
      storagePath: path,
    };

    const docRef = await addDoc(this.arquivosCol(preId), meta);
    // Retorna objeto já tipado + id resolvido
    return {
      id: docRef.id,
      ...(meta as any),
      // Para coerência com o tipo (uploadedAt virá resolvido quando listar)
    } as ArquivoPreCadastro;
  }

  /**
   * Remove metadados do arquivo (subcoleção) e apaga o binário no Storage.
   */
  async removerArquivo(preId: string, arquivoId: string): Promise<void> {
    if (!preId || !arquivoId) throw new Error('IDs obrigatórios');

    const metaRef = doc(this.db, `pre_cadastros/${preId}/arquivos/${arquivoId}`);
    const metaSnap = await getDoc(metaRef);
    // Mesmo que o meta não exista, tentamos excluir da mesma forma para manter idempotência.
    if (metaSnap.exists()) {
      const data = metaSnap.data() as any;
      const storagePath: string | undefined = data?.storagePath;

      try {
        if (storagePath) {
          const sref = storageRef(this.storage, storagePath);
          await deleteObject(sref);
        } else if (data?.url) {
          // Caso extremo: sem storagePath, mas com URL pública (tentativa de derivar o caminho é complexa).
          // Nessa situação, apenas removemos o metadado.
        }
      } catch (e) {
        // Se falhar a exclusão no storage (ex.: já não existe), prossegue para remover metadado.
        console.warn('[removerArquivo] Falha ao remover no Storage, seguindo para remover metadados:', e);
      }
    }

    // Remove metadados
    await deleteDoc(metaRef);
  }
}
