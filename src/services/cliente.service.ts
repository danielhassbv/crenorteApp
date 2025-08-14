import { Injectable } from '@angular/core';
import { db } from '../app/firebase.config';
import { collection, addDoc, getDocs } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class ClienteService {
  private collectionName = 'clientes';

  async adicionar(cliente: any) {
    try {
      const docRef = await addDoc(collection(db, this.collectionName), cliente);
      console.log("Cliente salvo com ID:", docRef.id);
      return docRef.id;
    } catch (error) {
      console.error("Erro ao salvar cliente:", error);
      throw error;
    }
  }

  async listar(): Promise<any[]> {
    const querySnapshot = await getDocs(collection(db, this.collectionName));
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
}
