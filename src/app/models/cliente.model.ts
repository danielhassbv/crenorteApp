export interface Cliente {
  nomeCompleto: string;
  cpf: string;
  rg: string;
  dataNascimento: string;
  contato: string;
  email: string;
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
  jaEmpreende: boolean;
  tipoNegocio: string;
  ondeVende: string;
  ocupacaoAtual: string;
  outraRenda: boolean;
  rendaMensal: string | number;
  valorSolicitado: string | number;
  parcelas: string;
  dataPrimeiraParcela: string;
  usoValor: string;
  clienteCrenorte: boolean;
  emprestimoAtivo: boolean;
  instituicaoEmprestimo: string;
  valorParcela: string | number;
  dataPreenchimento: string;
  autorizacaoUsoDados: boolean;
}
