import { Timestamp } from '@angular/fire/firestore';

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
}