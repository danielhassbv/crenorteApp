// src/app/models/pre-cadastro.model.ts
import { Timestamp } from '@angular/fire/firestore';

export type AgendamentoStatus = 'nao_agendado' | 'agendado' | 'visitado';

/** Agora com 3 estados, default recomendado: 'nao_verificado' na criação */
export type AprovacaoStatus = 'nao_verificado' | 'apto' | 'inapto';

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

  // ===== Aprovação =====
  aprovacao?: {
    /** 'nao_verificado' (default recomendado na criação) | 'apto' | 'inapto' */
    status: AprovacaoStatus;
    /** Quem avaliou (analista) */
    porUid?: string;
    porNome?: string;
    /** Quando avaliou */
    em?: Timestamp | Date | any;
    /** Motivo/observação quando INAPTO (usar este) */
    motivo?: string | null;
    /** Alias antigo — mantido por compatibilidade */
    observacao?: string | null;
  };

  // ===== Encaminhamento ao assessor (após APTO) =====
  encaminhamento?: {
    assessorUid?: string | null;
    /** alias do uid, se alguma tela antiga usa */
    assessorId?: string | null;
    assessorNome?: string | null;
    em?: Timestamp | Date | any;
  };

  // ===== Roteamento / visibilidade (caixas) =====
  /** De quem é a “caixa” atual: analista ou assessor */
  caixaAtual?: 'analista' | 'assessor';
  caixaUid?: string | null;

  /** Alias descritivo do destinatário atual */
  destinatarioTipo?: 'analista' | 'assessor';
  destinatarioUid?: string | null;

  /** (Opcional) quem pode ver esse pré (para consultas com array-contains) */
  visivelParaUids?: string[];

  /** Vínculo com o analista responsável quando encaminhado */
  analistaId?: string | null;

  /** Conveniências para listagens/relatórios */
  alocadoParaUid?: string | null;
  alocadoParaNome?: string | null;

  /** Campo auxiliar usado só no front para saber de qual coleção veio */
  __col?: 'pre_cadastros' | 'pre-cadastros';
}
