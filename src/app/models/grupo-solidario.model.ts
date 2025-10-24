// src/app/models/grupo-solidario.model.ts
import { Timestamp } from '@angular/fire/firestore';

export type GrupoStatus = 'rascunho' | 'ativo' | 'fechado' | 'cancelado';

export interface GrupoSolidario {
  id: string;
  nome: string;

  criadoEm: Timestamp | Date | any;
  criadoPorUid: string;
  criadoPorNome?: string;

  coordenadorUid?: string | null;   // opcional (pode ser um apto escolhido)
  coordenadorNome?: string | null;

  cidade?: string | null;
  uf?: string | null;

  capacidadeMin: number;            // 3
  capacidadeMax: number;            // 10

  membrosIds: string[];             // array de IDs de PreCadastro
  membrosCount: number;

  status: GrupoStatus;

  inviteToken: string;              // token de convite (curto)
  inviteUrl?: string;               // URL pronta pra compartilhar

  observacoes?: string | null;
}
