export type Papel = 'admin' | 'supervisor' | 'coordenador' | 'assessor' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';
export interface Colaborador {


  uid: string;
  nome: string;
  email: string;
  papel: Papel;
  cargo?: string | null;
  status: 'ativo' | 'inativo';

  // 🔹 novos campos
  cpf?: string | null;        // dígitos somente
  photoURL?: string | null;   // avatar

  criadoEm: number; // ou Firebase Timestamp
}


