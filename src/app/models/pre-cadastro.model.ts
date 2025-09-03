import { Timestamp } from '@angular/fire/firestore';

export interface PreCadastro {
  id?: string;
  nomeCompleto: string;
  cpf: string;
  endereco: string;
  telefone: string;
  email: string;

  createdByUid?: string;
  createdByNome?: string;
  createdAt?: Timestamp | Date | any;
}