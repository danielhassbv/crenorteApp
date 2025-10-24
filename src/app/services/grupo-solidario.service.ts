// src/app/services/grupo-solidario.service.ts
import { Injectable, inject } from '@angular/core';
import { Firestore, doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, getDocs, serverTimestamp } from '@angular/fire/firestore';
import { GrupoSolidario } from '../models/grupo-solidario.model';
import { PreCadastro } from '../models/pre-cadastro.model';
import { db } from '../firebase.config';

export type GrupoStatus = 'incompleto' | 'completo';



function randomToken(len = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

@Injectable({ providedIn: 'root' })
export class GrupoSolidarioService {
  private fs = inject(Firestore);

  async listarAptosPorPeriodo(de: string | null, ate: string | null): Promise<PreCadastro[]> {
    // Datas em ISO (yyyy-mm-dd). Campo usado: createdAt
    // Fallback: se não tiver de/até, retorna todos aptos.
    const col = collection(this.fs, 'pre_cadastros');
    const clauses: any[] = [ where('aprovacao.status', '==', 'apto') ];

    if (de) clauses.push(where('createdAt', '>=', new Date(de + 'T00:00:00')));
    if (ate) clauses.push(where('createdAt', '<=', new Date(ate + 'T23:59:59')));

    const q = (clauses.length > 1)
      ? query(col, ...clauses as any)
      : query(col, where('aprovacao.status', '==', 'apto'));

    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as PreCadastro[];
  }

  buildInviteUrl(groupId: string, token: string): string {
    // Ajuste o host/base conforme o deploy do app (ex.: app.crenorte.com.br)
    const base = window?.location?.origin || 'https://app.seudominio.com';
    return `${base}/pre-cadastro/novo?grupo=${encodeURIComponent(groupId)}&token=${encodeURIComponent(token)}`;
  }

  async criarGrupo(payload: {
    nome: string;
    criadoPorUid: string;
    criadoPorNome?: string;
    cidade?: string | null;
    uf?: string | null;
    capacidadeMin?: number;
    capacidadeMax?: number;
    membrosIds?: string[];
    coordenadorUid?: string | null;
    coordenadorNome?: string | null;
    observacoes?: string | null;
  }): Promise<GrupoSolidario> {
    const token = randomToken(10);
    const ref = await addDoc(collection(this.fs, 'grupos_solidarios'), {
      nome: payload.nome,
      criadoPorUid: payload.criadoPorUid,
      criadoPorNome: payload.criadoPorNome || null,
      criadoEm: serverTimestamp(),
      cidade: payload.cidade || null,
      uf: payload.uf || null,
      capacidadeMin: payload.capacidadeMin ?? 3,
      capacidadeMax: payload.capacidadeMax ?? 10,
      membrosIds: payload.membrosIds || [],
      membrosCount: (payload.membrosIds || []).length,
      status: 'rascunho',
      inviteToken: token,
      observacoes: payload.observacoes || null,
      coordenadorUid: payload.coordenadorUid || null,
      coordenadorNome: payload.coordenadorNome || null,
    });

    const inviteUrl = this.buildInviteUrl(ref.id, token);
    await updateDoc(ref, { inviteUrl });

    const snap = await getDoc(ref);
    return { id: ref.id, ...(snap.data() as any) } as GrupoSolidario;
  }

  async adicionarMembros(grupoId: string, novosIds: string[]) {
    const ref = doc(this.fs, 'grupos_solidarios', grupoId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Grupo não encontrado');
    const data = snap.data() as GrupoSolidario;

    const setIds = new Set([...(data.membrosIds || []), ...novosIds]);
    const membrosIds = Array.from(setIds);
    await updateDoc(ref, { membrosIds, membrosCount: membrosIds.length });
    return membrosIds;
  }

  async definirStatusGrupo(grupoId: string, status: GrupoStatus): Promise<void> {
    const ref = doc(db, 'grupos', grupoId); // <-- troque 'grupos' se seu path for outro
    await updateDoc(ref, {
      status,
      atualizadoEm: new Date(),
    });
  }
}
