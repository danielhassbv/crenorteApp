import { Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  setDoc,
  collection,
  writeBatch,
  getDoc,
  updateDoc,
  getDocs,        // <-- mantenha este import
  query, orderBy, // <-- adicione para ordenar
} from '@angular/fire/firestore';

import { Timestamp, serverTimestamp } from 'firebase/firestore';
import { GrupoDoc, IntegranteDoc, ParcelaDoc } from '../models/cobranca.model';

function toDateSafe(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(`${v}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  if (v && typeof v === 'object' && 'toDate' in (v as any)) {
    try { return (v as Timestamp).toDate(); } catch { return null; }
  }
  try {
    const d = new Date(v as any);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

@Injectable({ providedIn: 'root' })
export class CobrancaDataService {
  constructor(private afs: Firestore) {}

  // Refs
  contratoRef(contratoId: string) { return doc(this.afs, `contratos/${contratoId}`); }
  integrantesCol(contratoId: string) { return collection(this.afs, `contratos/${contratoId}/integrantes`); }
  parcelasCol(contratoId: string) { return collection(this.afs, `contratos/${contratoId}/parcelas`); }

  // CRUD Grupo
  async upsertContrato(input: Partial<GrupoDoc> & { numeroContrato: string }) {
    const id = (input.id ?? input.numeroContrato).toString();
    const ref = this.contratoRef(id);
    const snap = await getDoc(ref);
    await setDoc(ref, {
      id,
      numeroContrato: input.numeroContrato,
      nomeGrupo: input.nomeGrupo ?? null,
      operador: input.operador ?? null,
      dataLiberacao: input.dataLiberacao ?? null,
      cidade: input.cidade ?? null,
      uf: input.uf ?? null,
      createdAt: snap.exists() ? (snap.data() as any).createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return id;
  }

  async setDataLiberacao(contratoId: string, data: Date | string | Timestamp | null) {
    const ref = this.contratoRef(contratoId);
    let ts: Timestamp | null = null;
    if (data) {
      const d = data instanceof Timestamp ? data.toDate() : toDateSafe(data);
      if (!d) throw new Error('Data de liberação inválida');
      ts = Timestamp.fromDate(d);
    }
    await updateDoc(ref, { dataLiberacao: ts, updatedAt: serverTimestamp() });
  }

  // Leitura básica
  // Lista contratos (com id garantido) e ordenados por numeroContrato
async listContratos(): Promise<GrupoDoc[]> {
  const q = query(collection(this.afs, 'contratos'), orderBy('numeroContrato'));
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    const data = d.data() as any;
    // garante id mesmo se não existir no payload
    return {
      id: data?.id ?? d.id,
      numeroContrato: data?.numeroContrato ?? d.id,
      nomeGrupo: data?.nomeGrupo ?? null,
      operador: data?.operador ?? null,
      cidade: data?.cidade ?? null,
      uf: data?.uf ?? null,
      dataLiberacao: data?.dataLiberacao ?? null,
      createdAt: data?.createdAt ?? null,
      updatedAt: data?.updatedAt ?? null,
    } as GrupoDoc;
  });
}

async listIntegrantes(contratoId: string): Promise<IntegranteDoc[]> {
  const snap = await getDocs(this.integrantesCol(contratoId));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as IntegranteDoc);
}

async listParcelas(contratoId: string): Promise<ParcelaDoc[]> {
  const snap = await getDocs(this.parcelasCol(contratoId));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }) as ParcelaDoc);
}


  // CRUD Integrante
  async upsertIntegrante(contratoId: string, integrante: Partial<IntegranteDoc> & { nome: string; id?: string }) {
    const col = this.integrantesCol(contratoId);
    const id = integrante.id || crypto.randomUUID();
    const ref = doc(col, id);
    const now = serverTimestamp();
    await setDoc(ref, {
      id,
      nome: integrante.nome,
      valorIndividual: integrante.valorIndividual ?? null,
      telefone1: integrante.telefone1 ?? null,
      telefone2: integrante.telefone2 ?? null,
      statusFlag: integrante.statusFlag ?? null,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });
    return id;
  }

  // CRUD Parcela
  async upsertParcela(
    contratoId: string,
    parcela: Partial<Omit<ParcelaDoc, 'vencimento' | 'id'>> & {
      id?: string;
      parcela: number;
      valorParcela: number;
      vencimento: string | Date | Timestamp;
      pago?: boolean;
    },
  ) {
    const col = this.parcelasCol(contratoId);
    const id = parcela.id || String(parcela.parcela);
    const ref = doc(col, id);

    const d = parcela.vencimento instanceof Timestamp
      ? parcela.vencimento.toDate()
      : toDateSafe(parcela.vencimento);
    if (!d) throw new Error('Data de vencimento inválida');

    const vencTS = Timestamp.fromDate(d);
    const now = serverTimestamp();

    await setDoc(ref, {
      id,
      parcela: Number(parcela.parcela),
      valorParcela: Number(parcela.valorParcela),
      vencimento: vencTS,
      pago: parcela.pago ?? false,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });

    return id;
  }

  async setPago(contratoId: string, parcelaId: string, pago: boolean) {
    const ref = doc(this.afs, `contratos/${contratoId}/parcelas/${parcelaId}`);
    await updateDoc(ref, { pago, updatedAt: serverTimestamp() });
  }

  // Seed completo (opcional)
  async createContratoCompleto(
    grupo: { numeroContrato: string; nomeGrupo?: string | null; dataLiberacao?: Date | string | null; operador?: string | null; cidade?: string | null; uf?: string | null; },
    integrantes: Array<Omit<IntegranteDoc, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }>,
    parcelas: Array<Omit<ParcelaDoc, 'id' | 'vencimento' | 'createdAt' | 'updatedAt'> & { id?: string; vencimento: string | Date | Timestamp; }>
  ) {
    const contratoId = grupo.numeroContrato.toString();
    const batch = writeBatch(this.afs);

    const contratoRef = this.contratoRef(contratoId);
    let dataLibTS: Timestamp | null = null;
    if (grupo.dataLiberacao) {
      const d = toDateSafe(grupo.dataLiberacao);
      dataLibTS = d ? Timestamp.fromDate(d) : null;
    }
    batch.set(contratoRef, {
      id: contratoId,
      numeroContrato: contratoId,
      nomeGrupo: grupo.nomeGrupo ?? null,
      operador: grupo.operador ?? null,
      cidade: grupo.cidade ?? null,
      uf: grupo.uf ?? null,
      dataLiberacao: dataLibTS,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    const intsColPath = `contratos/${contratoId}/integrantes`;
    for (const i of integrantes) {
      const iid = i.id || crypto.randomUUID();
      const iRef = doc(this.afs, `${intsColPath}/${iid}`);
      batch.set(iRef, {
        id: iid,
        nome: i.nome,
        valorIndividual: i.valorIndividual ?? null,
        telefone1: i.telefone1 ?? null,
        telefone2: i.telefone2 ?? null,
        statusFlag: i.statusFlag ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    const parColPath = `contratos/${contratoId}/parcelas`;
    for (const p of parcelas) {
      const pid = p.id || String(p.parcela);
      const pRef = doc(this.afs, `${parColPath}/${pid}`);
      const d = p.vencimento instanceof Timestamp ? p.vencimento.toDate() : toDateSafe(p.vencimento);
      if (!d) throw new Error(`Vencimento inválido na parcela ${p.parcela}`);
      batch.set(pRef, {
        id: pid,
        parcela: p.parcela,
        valorParcela: p.valorParcela,
        vencimento: Timestamp.fromDate(d),
        pago: !!p.pago,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    await batch.commit();
    return contratoId;
  }
}
