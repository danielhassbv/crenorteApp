// src/app/models/grupo-solidario.model.ts
import { Timestamp } from '@angular/fire/firestore';

export type GrupoStatus = 'rascunho' | 'ativo' | 'fechado' | 'cancelado';

/** NOVO: situação do grupo usada para triagem/distribuição */
export type GrupoSituacao = 'aprovado' | 'incompleto' | 'inapto';

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

  /** Status operacional (workflow) */
  status: GrupoStatus;

  /** NOVO: situação calculada pelas regras de aptidão e tamanho */
  situacao: GrupoSituacao;

  /** NOVO: informações para distribuição (grupo inteiro ou por membro) */
  distribuicao?: {
    groupAssessorUid?: string | null;
    groupAssessorNome?: string | null;
    membros?: Array<{
      preCadastroId: string;
      assessorUid: string;
      assessorNome?: string;
    }>;
    distribuidoEm?: Timestamp | Date | any;
    distribuidoPorUid?: string;
    distribuidoPorNome?: string;
  };

  inviteToken: string;              // token de convite (curto)
  inviteUrl?: string;               // URL pronta pra compartilhar

  observacoes?: string | null;
}
