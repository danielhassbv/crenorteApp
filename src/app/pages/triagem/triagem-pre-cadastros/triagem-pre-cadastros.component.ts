// src/app/pages/triagem/triagem-pre-cadastros/triagem-pre-cadastros.component.ts
import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Firestore
import { db } from '../../../firebase.config';
import {
  collectionGroup,
  onSnapshot,
  query,
  Unsubscribe,
} from 'firebase/firestore';

type PreCadastroRow = {
  id: string;
  data: Date | null;

  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  endereco: string;
  bairro: string;
  rota: string;
  origem: string;
};

@Component({
  standalone: true,
  selector: 'app-triagem-pre-cadastros',
  imports: [CommonModule, FormsModule],
  templateUrl: './triagem-pre-cadastros.component.html',
  styleUrls: ['./triagem-pre-cadastros.component.css'],
})
export class TriagemPreCadastrosComponent implements OnInit, OnDestroy {
  carregando = signal(false);
  erro = signal<string | null>(null);

  // filtros (propriedades simples para evitar erro de two-way binding)
  busca = '';
  filtroRota = '';

  // dados
  private unsub?: Unsubscribe;
  all: PreCadastroRow[] = [];
  view: PreCadastroRow[] = [];

  ngOnInit(): void {
    this.carregarTodos();
  }

  ngOnDestroy(): void {
    if (this.unsub) this.unsub();
  }

  // ---------- carregar TODOS (sem orderBy para não exigir índice) ----------
  private carregarTodos() {
    this.carregando.set(true);
    this.erro.set(null);

    // Sem orderBy -> não precisa de COLLECTION_GROUP index
    const base = collectionGroup(db, 'pre_cadastros');
    const qy = query(base);

    this.unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: PreCadastroRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            data: this.toDate(data?.createdAt ?? data?.criadoEm),
            nome: String(data?.nomeCompleto ?? data?.nome ?? '').trim(),
            cpf: String(data?.cpf ?? '').trim(),
            telefone: String(data?.telefone ?? data?.contato ?? '').trim(),
            email: String(data?.email ?? '').trim(),
            endereco: String(data?.endereco ?? data?.enderecoCompleto ?? '').trim(),
            bairro: String(data?.bairro ?? '').trim(),
            rota: String(data?.rota ?? '').trim(),
            origem: String(data?.origem ?? '').trim(),
          };
        });

        // Ordena no cliente por data desc (sem exigir índice)
        rows.sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

        this.all = rows;
        this.aplicarFiltros();
        this.carregando.set(false);
      },
      (err) => {
        console.error('[Triagem] onSnapshot error:', err);
        this.erro.set(err?.message ?? 'Falha ao carregar pré-cadastros.');
        this.carregando.set(false);
      }
    );
  }

  // ---------- utils ----------
  private toDate(x: unknown): Date | null {
    if (!x) return null;
    if (typeof (x as any)?.toDate === 'function') return (x as any).toDate();
    if (x instanceof Date) return x;
    if (typeof x === 'number') return new Date(x);
    return null;
  }

  initial(s: string): string {
    const t = (s ?? '').toString().trim();
    return t ? t.charAt(0).toUpperCase() : '?';
  }

  // ---------- filtros ----------
  onBusca(val: string) {
    this.busca = (val ?? '').trim();
    this.aplicarFiltros();
  }
  onFiltroRota(val: string) {
    this.filtroRota = (val ?? '').trim();
    this.aplicarFiltros();
  }
  limparFiltros() {
    this.busca = '';
    this.filtroRota = '';
    this.aplicarFiltros();
  }

  aplicarFiltros() {
    let list = [...this.all];
    const term = this.busca.toLowerCase();
    const rota = this.filtroRota.toLowerCase();

    if (rota) {
      list = list.filter((p) => (p.rota || '').toLowerCase().includes(rota));
    }
    if (term) {
      list = list.filter((p) => {
        const blob = `${p.nome} ${p.cpf} ${p.telefone} ${p.email} ${p.endereco} ${p.bairro} ${p.rota} ${p.origem}`.toLowerCase();
        return blob.includes(term);
      });
    }

    this.view = list;
  }
}
