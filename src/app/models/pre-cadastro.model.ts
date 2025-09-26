// src/app/models/pre-cadastro.model.ts
import { Timestamp } from '@angular/fire/firestore';

export type AgendamentoStatus = 'nao_agendado' | 'agendado' | 'visitado';

export type FluxoFixos = {
  aluguel: number;
  salarios: number;
  energiaEletrica: number;
  agua: number;
  telefoneInternet: number;
};

export type FluxoVariaveis = {
  materiaPrima: number;
  insumos: number;
  frete: number;
  transporte: number;
  outros: Array<{ nome: string; valor: number }>;
};

export type FluxoCaixa = {
  faturamentoMensal: number;
  fixos: FluxoFixos;
  variaveis: FluxoVariaveis;
};

export type FluxoTotais = { receita: number; custos: number; lucro: number };

export interface PreCadastro {
  id: string;

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
  atualizadoEm?: Timestamp | Date | any;

  // Financeiro (opcional)
  valorSolicitado?: number;
  valorSolicitadoFormatado?: string;
  parcelas?: number | null;
  valorParcela?: number;
  valorParcelaFormatado?: string;
  fluxoCaixa?: FluxoCaixa | null;
  fluxoCaixaTotais?: FluxoTotais;

  // Agendamento (opcional)
  agendamentoStatus?: AgendamentoStatus;
  agendamentoId?: string | null;
  agendamentoData?: string | null;
  agendamentoHora?: string | null;
  visitadoEm?: Timestamp | Date | any;
}
