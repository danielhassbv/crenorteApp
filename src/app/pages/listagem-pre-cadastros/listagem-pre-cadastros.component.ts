import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  collection,
  collectionGroup,
  getDocs,
  getCountFromServer,
  deleteDoc,
  doc,
  getDoc,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';

import { db } from '../../firebase.config';
import { HeaderComponent } from '../shared/header/header.component';

type SortDir = 'asc' | 'desc';

type PreCadastroList = {
  id: string;
  _path: string;             // caminho completo no Firestore (para deletar / editar com segurança)
  nomeCompleto?: string;
  telefone?: string;
  contato?: string;
  email?: string;
  cidade?: string;
  endereco?: string;
  enderecoCompleto?: string;
  createdAt?: any;           // Timestamp | ISO | Date | number
  createdByUid?: string;
  createdByNome?: string;
};

@Component({
  selector: 'app-listagem-pre-cadastros',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  styleUrls: ['./listagem-pre-cadastros.component.css'],
  templateUrl: './listagem-pre-cadastros.component.html',
})
export class ListagemPreCadastrosComponent implements OnInit {

  presAll: PreCadastroList[] = [];
  presFiltrados: PreCadastroList[] = [];
  presPaginados: PreCadastroList[] = [];

  filtro: {
    nome: string;
    dataDe?: string;
    dataAte?: string;
  } = { nome: '', dataDe: '', dataAte: '' };

  itensPorPagina = 20;
  paginaAtual = 1;
  totalPaginas = 1;
  totalEstimado = 0;

  sortField: 'nomeCompleto' | 'createdAt' = 'createdAt';
  sortDir: SortDir = 'desc';

  carregando = false;
  erroCarregar = '';

  async ngOnInit(): Promise<void> {
    await this.carregarTodos();
  }

  // ====================== HELPERS ======================
  public displayName(raw?: string): string {
    const s = (raw || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    const parts = lower.split(/\s+/);
    const keepLower = new Set(['de','da','do','das','dos','e','du','del','della']);
    return parts.map((p,i)=> (i>0 && keepLower.has(p)) ? p : p.charAt(0).toUpperCase()+p.slice(1)).join(' ');
  }

  public maskPhone(input?: string): string {
    const d = (input || '').replace(/\D/g, '');
    if (!d) return '—';
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    if (d.length > 11)  return d.replace(/(\d{2,3})(\d{2})(\d{4,5})(\d{4})/, '+$1 ($2) $3-$4');
    return d;
  }
  public getPhone(c: any): string { return (c?.contato ?? c?.telefone ?? '') as string; }

  private normalize(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private asDate(input: any): Date | null {
    if (!input) return null;
    if (typeof input === 'object' && typeof (input as any).seconds === 'number') {
      const i = input as { seconds: number; nanoseconds?: number };
      const ms = i.seconds * 1000 + Math.floor((i.nanoseconds || 0) / 1e6);
      return new Date(ms);
    }
    if (input instanceof Date) return input;
    if (typeof input === 'number') { const d = new Date(input); return isNaN(d.getTime())?null:d; }
    if (typeof input === 'string') { const d2 = new Date(input); return isNaN(d2.getTime())?null:d2; }
    return null;
  }

  public toBRDate(value: any): string {
    const d = this.asDate(value); if (!d) return '—';
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }

  public getAssessorNome(c: PreCadastroList): string {
    if (c.createdByNome && c.createdByNome.trim()) return this.displayName(c.createdByNome);
    if (c.createdByUid) return `UID: ${c.createdByUid.slice(0,6)}…`;
    return '—';
  }

  // ====================== CARGA ======================
  private async carregarTodos() {
    this.carregando = true;
    this.erroCarregar = '';
    this.presAll = this.presFiltrados = this.presPaginados = [];
    this.paginaAtual = 1;

    try {
      // count
      try {
        const countSnap = await getCountFromServer(collectionGroup(db, 'pre_cadastros'));
        this.totalEstimado = (countSnap.data() as any).count || 0;
      } catch {
        const countTop = await getCountFromServer(collection(db, 'pre_cadastros'));
        this.totalEstimado = (countTop.data() as any).count || 0;
      }

      // fetch group + top-level
      const found: Record<string, true> = {};
      let snapGroup: QuerySnapshot<DocumentData> | null = null;
      try { snapGroup = await getDocs(collectionGroup(db, 'pre_cadastros')); } catch {}

      if (snapGroup && !snapGroup.empty) {
        snapGroup.forEach(d => {
          const dados = d.data() as any;
          this.presAll.push({ id: d.id, _path: d.ref.path, ...dados });
          found[d.ref.path] = true;
        });
      }

      const snapTop = await getDocs(collection(db, 'pre_cadastros'));
      snapTop.forEach(d => {
        const key = d.ref.path; if (found[key]) return;
        const dados = d.data() as any;
        this.presAll.push({ id: d.id, _path: d.ref.path, ...dados });
      });

      this.aplicarFiltrosLocais(true);
    } catch (e) {
      console.error(e);
      this.erroCarregar = 'Erro ao carregar os pré-cadastros do Firebase.';
    } finally {
      this.carregando = false;
    }
  }

  // ====================== PAGINAÇÃO ======================
  private recalcularPaginacao() {
    this.totalPaginas = Math.max(1, Math.ceil(this.presFiltrados.length / this.itensPorPagina));
    if (this.paginaAtual > this.totalPaginas) this.paginaAtual = this.totalPaginas;
    const ini = (this.paginaAtual - 1) * this.itensPorPagina;
    const fim = ini + this.itensPorPagina;
    this.presPaginados = this.presFiltrados.slice(ini, fim);
  }
  irParaPagina(n: number) {
    if (n < 1 || n > this.totalPaginas || n === this.paginaAtual) return;
    this.paginaAtual = n; this.recalcularPaginacao();
    try { document.querySelector('.table-responsive')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
  }
  pages(): number[] { return Array.from({ length: this.totalPaginas }, (_, i) => i + 1); }
  trackById(_i: number, c: PreCadastroList) { return c._path || c.id; }

  // ====================== FILTROS / ORDENAÇÃO ======================
  onFiltroNomeChange(v: string) { this.filtro.nome = v; this.aplicarFiltrosLocais(); }

  aplicarFiltrosLocais(resetPagina = false) {
    const nl = this.normalize(this.filtro.nome);
    let arr = [...this.presAll];

    if (nl) arr = arr.filter(c => this.normalize(this.displayName(c.nomeCompleto || '')).includes(nl));

    if (this.filtro.dataDe || this.filtro.dataAte) {
      const start = this.filtro.dataDe ? new Date(this.filtro.dataDe + 'T00:00:00') : null;
      const end   = this.filtro.dataAte ? new Date(this.filtro.dataAte + 'T23:59:59.999') : null;
      arr = arr.filter(c => {
        const d = this.asDate(c.createdAt); if (!d) return false;
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
      });
    }

    this.presFiltrados = this.ordenarArray(arr, this.sortField, this.sortDir);
    if (resetPagina) this.paginaAtual = 1;
    this.recalcularPaginacao();
  }

  ordenarPor(campo: 'nomeCompleto' | 'createdAt') {
    if (this.sortField === campo) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortField = campo; this.sortDir = 'asc'; }
    this.presFiltrados = this.ordenarArray(this.presFiltrados, this.sortField, this.sortDir);
    this.recalcularPaginacao();
  }

  private ordenarArray(arr: PreCadastroList[], campo: 'nomeCompleto' | 'createdAt', dir: SortDir): PreCadastroList[] {
    const mult = dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      let va: any; let vb: any;
      if (campo === 'createdAt') {
        va = this.asDate(a.createdAt)?.getTime() ?? 0;
        vb = this.asDate(b.createdAt)?.getTime() ?? 0;
      } else {
        va = this.displayName(a.nomeCompleto || '').toLowerCase();
        vb = this.displayName(b.nomeCompleto || '').toLowerCase();
      }
      if (va < vb) return -1*mult;
      if (va > vb) return  1*mult;
      return 0;
    });
  }

  // ====================== EDITAR / REMOVER ======================
  editarPreCadastro(item: PreCadastroList) {
    // Passa o mínimo necessário para o form buscar TUDO direto do Firestore:
    // /pre-cadastro/novo?edit=true&id=...&path=...
    const url = `/pre-cadastro/novo?edit=true&id=${encodeURIComponent(item.id)}&path=${encodeURIComponent(item._path)}`;
    window.location.href = url;
  }

  async removerPreCadastro(item: PreCadastroList) {
    const ok = window.confirm('Tem certeza que deseja remover este pré-cadastro?');
    if (!ok) return;
    try {
      const path = item._path || `pre_cadastros/${item.id}`;
      await deleteDoc(doc(db, path));
      const key = path;
      this.presAll = this.presAll.filter(c => (c._path || `pre_cadastros/${c.id}`) !== key);
      this.aplicarFiltrosLocais();
    } catch (e) {
      console.error(e);
      alert('Falha ao remover o pré-cadastro.');
    }
  }
}
