import type { Timestamp, FieldValue } from 'firebase/firestore';
import { serverTimestamp } from 'firebase/firestore';

export type Alerta = 'D15' | 'D7' | 'D0' | 'ATRASO' | 'OK';
export type FireTime = Timestamp | FieldValue | null;

export interface GrupoDoc {
  id: string;                 // ex: "232"
  numeroContrato: string;     // ex: "232"
  nomeGrupo?: string | null;
  dataLiberacao?: Timestamp | null;
  operador?: string | null;
  cidade?: string | null;     // ✅ novo
  uf?: string | null;         // ✅ novo
  createdAt?: FireTime;
  updatedAt?: FireTime;
}

export interface IntegranteDoc {
  id: string;
  nome: string;
  valorIndividual?: number | null;
  telefone1?: string | null;
  telefone2?: string | null;
  statusFlag?: 'SIM' | 'NAO' | null;
  createdAt?: FireTime;
  updatedAt?: FireTime;
}

export interface ParcelaDoc {
  id: string;                 // normalmente = String(parcela)
  parcela: number;
  valorParcela: number;
  vencimento: Timestamp;      // sempre Timestamp no Firestore
  pago: boolean;
  createdAt?: FireTime;
  updatedAt?: FireTime;
}

export const nowStamp = (): FieldValue => serverTimestamp();
