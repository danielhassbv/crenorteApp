// src/app/models/pre-cadastro.model.ts
import { Timestamp } from '@angular/fire/firestore';

export type AgendamentoStatus = 'nao_agendado' | 'agendado' | 'visitado';

export interface PreCadastro {
  id: string;   // era string | undefined
  nomeCompleto: string;
  cpf: string;
  endereco: string;
  telefone: string;
  email: string;
  bairro: string;
  origem: string;

  createdByUid?: string;
  createdByNome?: string;
  createdAt?: Timestamp | Date | any;

  // ⬇️ novo bloco de agendamento
  agendamentoStatus?: AgendamentoStatus;   // default: 'nao_agendado'
  agendamentoId?: string | null;           // id do doc em /agendamentos
}
