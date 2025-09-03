// src/app/services/cadastros.service.ts
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  updateDoc,
  doc,
  DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase.config';
import type { StatusCadastro, StatusEvent, Cliente } from '../models/cliente.model';

/** IMPORTANTE: use SEMPRE o id REAL do documento (doc.id). */
export type ClienteDoc = Cliente & { id: string };

/** Lista por status (ou todos se não passar) */
export async function listarPorStatus(status?: StatusCadastro): Promise<ClienteDoc[]> {
  const col = collection(db, 'clientes');
  const q = status ? query(col, where('status', '==', status)) : col;
  const snap = await getDocs(q as any);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) } as ClienteDoc));
}

/** Pequeno helper para remover undefined antes de mandar pro Firestore */
function sanitize<T extends Record<string, any>>(obj: T): T {
  const out: any = {};
  for (const k of Object.keys(obj)) {
    const v = (obj as any)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Define/atualiza o status LENDO primeiro o doc (merge manual do histórico) */
export async function setStatusClienteById(
  docId: string,
  to: StatusCadastro,
  user: { uid: string; nome?: string },
  note?: string
) {
  const ref = doc(db, 'clientes', docId);
  const snap = await getDoc(ref);
  const prev = (snap.data() || {}) as any;

  const history: StatusEvent[] = Array.isArray(prev.statusHistory) ? prev.statusHistory : [];
  const ev: StatusEvent = sanitize({
    at: new Date(),
    byUid: user.uid,
    byNome: user.nome,
    from: (prev.status as StatusCadastro) ?? 'em_analise',
    to,
    note,
  });

  await updateDoc(ref, sanitize({
    status: to,
    statusHistory: [...history, ev],
    atualizadoEm: new Date(),
  }));
}

/** Versão por CPF (se seus DOC IDs forem o CPF LIMPO). */
export async function setStatusClienteByCpf(
  cpf: string,
  to: StatusCadastro,
  user: { uid: string; nome?: string },
  note?: string
) {
  const docId = cpf.replace(/\D/g, ''); // normaliza para dígitos
  return setStatusClienteById(docId, to, user, note);
}

/**
 * Garante que um doc tenha status inicial “em_analise” e registra 1 evento.
 * Não sobrescreve se já tiver status.
 */
export async function ensureStatusExists(docId: string) {
  const ref = doc(db, 'clientes', docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const prev = (snap.data() || {}) as any;
  if (prev.status) return; // já tem, não altera

  const history: StatusEvent[] = Array.isArray(prev.statusHistory) ? prev.statusHistory : [];
  const baseEv: StatusEvent = sanitize({
    at: new Date(),
    byUid: 'system',
    byNome: 'Backfill',
    from: undefined, // omitido no sanitize
    to: 'em_analise' as StatusCadastro,
    note: 'Status inicial definido automaticamente.',
  });

  await updateDoc(ref, sanitize({
    status: 'em_analise' as StatusCadastro,
    statusHistory: [...history, baseEv],
    atualizadoEm: new Date(),
  }));
}

/**
 * Migra todos os docs SEM status para “em_analise”.
 * Você chama isso a partir da sua lista (botão Migrar).
 */
export async function migrarStatusEmLote(clientes: { id: string }[]) {
  const chunk = 40;
  for (let i = 0; i < clientes.length; i += chunk) {
    await Promise.all(
      clientes.slice(i, i + chunk).map((c) => ensureStatusExists(c.id))
    );
  }
}
