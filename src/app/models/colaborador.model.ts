export type Papel = 'admin' | 'supervisor' | 'coordenador' | 'assessor' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';
export interface Colaborador {
  uid: string;
  nome: string;
  email: string;
  cargo?: string;
  papel: Papel;
  status: 'ativo' | 'inativo';
  criadoEm: number;
}
