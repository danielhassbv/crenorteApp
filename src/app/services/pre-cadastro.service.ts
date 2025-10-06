// src/app/services/pre-cadastro.service.ts
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

  // coleção principal
  private colRef: CollectionReference<DocumentData> =
    collection(this.db, 'pre_cadastros') as CollectionReference<DocumentData>;

  /**
   * Cria o pré-cadastro e retorna o ID do documento.
   * Seta createdByUid/createdByNome/createdAt e default de aprovação = 'inapto'.
   */
 // src/app/services/pre-cadastro.service.ts
// ...imports e @Injectable inalterados...

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
    // ✅ default de aprovação
    aprovacao: { status: 'nao_verificado' as const },
    encaminhamento: null, // por padrão
    createdByUid: user.uid,
    createdByNome,
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(this.colRef, payload);
  return ref.id;
}


  /**
   * Vincula/espelha o fluxo de caixa ao pré-cadastro (e marca timestamp).
   * Se quiser manter histórico, pode criar subcoleção /fluxos e addDoc lá.
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
   * Sempre marca atualizadoEm, a menos que você já tenha passado no patch.
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

  /**
   * Lista registros relevantes para aprovação (analistas).
   * Tenta filtrar por status via where('aprovacao.status','in',...), senão cai para filtro em memória.
   * Use esta lista na tela de "Aprovação de Pré-cadastro".
   */
  async listarParaAprovacao(): Promise<PreCadastro[]> {
    try {
      // Pode exigir índice composto se adicionar orderBy juntos.
      const qy = query(this.colRef, where('aprovacao.status', 'in', ['inapto', 'apto']));
      const snap = await getDocs(qy);
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
      // Ordena por createdAt desc (em memória para evitar mais índices)
      rows.sort((a: any, b: any) => {
        const ms = (x: any) =>
          x?.toMillis ? x.toMillis() :
          x?.toDate ? x.toDate().getTime() :
          (typeof x === 'number' ? x : 0);
        return (ms(b.createdAt) - ms(a.createdAt));
      });
      return rows;
    } catch {
      // fallback: pega tudo e filtra em memória
      const snap = await getDocs(this.colRef);
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
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

  /**
   * Marca um pré-cadastro como APTO, registrando quem aprovou e quando.
   * Aceita observação opcional.
   */
  async marcarApto(preCadastroId: string, observacao?: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    // tenta pegar nome do colaborador aprovador
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

  /**
   * Consulta assessores sob o comando do analista atual (ou supervisor).
   * Regras:
   *  - Primeiro tenta por analistaResponsavelUid == user.uid
   *  - Se não houver, tenta por supervisorUid == user.uid
   *  - Opcional: passe um uidSupervisor/analista explicitamente.
   */
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

  // Dentro de PreCadastroService
async listarParaCaixa(uid: string): Promise<PreCadastro[]> {
  if (!uid) throw new Error('uid obrigatório');

  const rows: PreCadastro[] = [];
  const tryGet = async (qy: any) => {
    try {
      const snap = await getDocs(qy);
      snap.docs.forEach(d => rows.push({ id: d.id, ...(d.data() as any) } as PreCadastro));
    } catch {}
  };

  // Preferência: tudo que está na "caixa" do assessor
  await tryGet(query(this.colRef, where('caixaUid', '==', uid)));
  // Compat: itens encaminhados diretamente
  await tryGet(query(this.colRef, where('encaminhamento.assessorUid', '==', uid)));
  // Fallback: itens criados por ele
  await tryGet(query(this.colRef, where('createdByUid', '==', uid)));

  // dedup + ordena por createdAt desc
  const ms = (x: any) => x?.toMillis ? x.toMillis() : x?.toDate ? x.toDate().getTime() : (typeof x === 'number' ? x : 0);
  const map = new Map<string, PreCadastro>();
  rows.forEach(r => map.set(r.id, r));
  return Array.from(map.values()).sort((a: any, b: any) => ms(b.createdAt) - ms(a.createdAt));
}


  /**
   * Define o assessor responsável por um pré-cadastro (após estar APTO).
   * Se assessorNome não for informado, tenta descobrir no doc de colaboradores.
   */
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
}
