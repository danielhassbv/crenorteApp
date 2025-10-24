// src/app/pages/lista-grupos/lista-grupos.component.ts
import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import {
  Firestore,
  collection,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
  DocumentData,
} from '@angular/fire/firestore';

import { HeaderComponent } from '../shared/header/header.component';

export type GrupoStatus = 'rascunho' | 'ativo' | 'fechado' | 'cancelado';

export interface GrupoSolidario {
  id: string;
  nome: string;
  criadoEm: Timestamp | Date | any;
  criadoPorUid: string;
  criadoPorNome?: string;
  cidade?: string | null;
  uf?: string | null;
  capacidadeMin: number;
  capacidadeMax: number;
  membrosIds: string[];
  membrosCount: number;
  status: GrupoStatus;
  inviteToken: string;
  inviteUrl?: string;
  observacoes?: string | null;
  coordenadorUid?: string | null;
  coordenadorNome?: string | null;
}

type SortField = 'nome' | 'criadoEm' | 'membrosCount' | 'status' | 'cidade' | 'uf';
type SortDir = 'asc' | 'desc';
type Visualizacao = 'cards' | 'tabela';

@Component({
  standalone: true,
  selector: 'app-lista-grupos',
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent],
  templateUrl: './lista-grupos.component.html',
  styleUrls: ['./lista-grupos.component.css'],
})
export class ListaGruposComponent implements OnInit {
  private fs = inject(Firestore);

  // ===== Estado base =====
  grupos = signal<GrupoSolidario[]>([]);
  carregando = signal<boolean>(true);
  erroCarregar = signal<string>('');

  // ===== Visualização / ordenação / paginação =====
  visualizacao = signal<Visualizacao>('cards');
  sortField = signal<SortField>('criadoEm');
  sortDir = signal<SortDir>('desc');
  itensPorPagina = signal<number>(20);
  paginaAtual = signal<number>(1);

  // ===== Filtros =====
  filtro = signal({
    nome: '',
    status: '' as '' | GrupoStatus,
    cidade: '',
    uf: '',
    criadoDe: '' as string | '',
    criadoAte: '' as string | '',
    coordenador: '',
  });

  // Combos dinâmicos
  cidadesDisponiveis = signal<string[]>([]);
  ufsDisponiveis = signal<string[]>([]);
  statusDisponiveis = signal<GrupoStatus[]>(['rascunho', 'ativo', 'fechado', 'cancelado']);
  coordenadoresDisponiveis = signal<string[]>([]);

  // ===== Modal de detalhes =====
  modalAberto = signal<boolean>(false);
  grupoSelecionado = signal<GrupoSolidario | null>(null);

  // ===== Derivados =====
  kpiTotal = computed(() => this.grupos().length);

  gruposFiltrados = computed(() => {
    const arr = [...this.grupos()];
    const f = this.filtro();
    const norm = (s: string) =>
      (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    return arr.filter(g => {
      const nomeOk = f.nome ? norm(g.nome).includes(norm(f.nome)) : true;
      const statusOk = f.status ? g.status === f.status : true;
      const cidadeOk = f.cidade ? norm(g.cidade || '') === norm(f.cidade) : true;
      const ufOk = f.uf ? (g.uf || '').toUpperCase() === f.uf.toUpperCase() : true;
      const coordOk = f.coordenador ? norm(g.coordenadorNome || '') === norm(f.coordenador) : true;

      let dataOk = true;
      if (f.criadoDe || f.criadoAte) {
        const d0 = f.criadoDe ? new Date(f.criadoDe + 'T00:00:00') : null;
        const d1 = f.criadoAte ? new Date(f.criadoAte + 'T23:59:59.999') : null;
        const d = this.asDateFlexible(g.criadoEm);
        if (!d) dataOk = false;
        if (d0 && d && d < d0) dataOk = false;
        if (d1 && d && d > d1) dataOk = false;
      }

      return nomeOk && statusOk && cidadeOk && ufOk && coordOk && dataOk;
    });
  });

  gruposOrdenados = computed(() => {
    const field = this.sortField();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const norm = (s: string) =>
      (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    return [...this.gruposFiltrados()].sort((a, b) => {
      let va: any = null;
      let vb: any = null;

      switch (field) {
        case 'nome':
          va = norm(a.nome); vb = norm(b.nome); break;
        case 'status':
          va = norm(a.status); vb = norm(b.status); break;
        case 'cidade':
          va = norm(a.cidade || ''); vb = norm(b.cidade || ''); break;
        case 'uf':
          va = (a.uf || '').toUpperCase(); vb = (b.uf || '').toUpperCase(); break;
        case 'membrosCount':
          va = a.membrosCount || 0; vb = b.membrosCount || 0; break;
        default:
          va = this.asDateFlexible(a.criadoEm)?.getTime() ?? 0;
          vb = this.asDateFlexible(b.criadoEm)?.getTime() ?? 0;
      }

      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  });

  totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.gruposOrdenados().length / this.itensPorPagina()))
  );

  gruposPaginados = computed(() => {
    const page = Math.min(this.paginaAtual(), this.totalPaginas());
    const ini = (page - 1) * this.itensPorPagina();
    const fim = ini + this.itensPorPagina();
    return this.gruposOrdenados().slice(ini, fim);
  });

  // =================== Ciclo de vida ===================
  ngOnInit(): void {
    const ref = query(collection(this.fs, 'grupos_solidarios'), orderBy('criadoEm', 'desc'));
    this.carregando.set(true);
    this.erroCarregar.set('');

    onSnapshot(ref, {
      next: (snap) => {
        const rows = snap.docs.map((d) => {
          const data = d.data() as DocumentData;

          const g: GrupoSolidario = {
            id: d.id,
            nome: s(data, 'nome'),
            criadoEm: dataLike(data, 'criadoEm'),
            criadoPorUid: s(data, 'criadoPorUid'),
            criadoPorNome: s(data, 'criadoPorNome') || undefined,
            cidade: s(data, 'cidade') || null,
            uf: upperOrNull(data, 'uf'),
            capacidadeMin: n(data, 'capacidadeMin', 3),
            capacidadeMax: n(data, 'capacidadeMax', 10),
            membrosIds: arr(data, 'membrosIds'),
            membrosCount: n(data, 'membrosCount', arr(data, 'membrosIds').length),
            status: (s(data, 'status') as GrupoStatus) || 'rascunho',
            inviteToken: s(data, 'inviteToken'),
            inviteUrl: s(data, 'inviteUrl') || undefined,
            observacoes: s(data, 'observacoes') || null,
            coordenadorUid: s(data, 'coordenadorUid') || null,
            coordenadorNome: s(data, 'coordenadorNome') || null,
          };

          // Garante link válido mesmo sem inviteUrl persistido
          g.inviteUrl = buildInviteUrl(g);

          return g;
        });

        this.grupos.set(rows);
        this.recalcularCombos(rows);
        this.carregando.set(false);
        if (this.paginaAtual() > this.totalPaginas()) this.paginaAtual.set(1);
      },
      error: (err) => {
        console.error(err);
        this.erroCarregar.set('Falha ao carregar os grupos do Firebase.');
        this.carregando.set(false);
      }
    });
  }

  // =================== Utils ===================
  statusBadgeClass(s: GrupoStatus): string {
    switch (s) {
      case 'ativo': return 'text-bg-success';
      case 'rascunho': return 'text-bg-secondary';
      case 'fechado': return 'text-bg-dark';
      case 'cancelado': return 'text-bg-danger';
      default: return 'text-bg-light';
    }
  }

  private asDateFlexible(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'object' && typeof (v as any).toDate === 'function') {
      try { return (v as any).toDate(); } catch {}
    }
    if (v && typeof v === 'object' && typeof (v as any).seconds === 'number') {
      const ns = (v as any).nanoseconds || 0;
      return new Date((v as any).seconds * 1000 + Math.floor(ns / 1e6));
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  toBRDate(value: any): string {
    const d = this.asDateFlexible(value);
    if (!d) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  toBRTime(value: any): string {
    const d = this.asDateFlexible(value);
    if (!d) return '—';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  displayName(raw?: string | null): string {
    const s = (raw || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    const parts = lower.split(/\s+/);
    const keep = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della']);
    return parts.map((p, i) => (i > 0 && keep.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
  }

  private uniqSorted(arr: string[]): string[] {
    const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return Array.from(new Set(arr.filter(x => !!x && x.trim() !== '')))
      .sort((a, b) => norm(a).localeCompare(norm(b)));
  }

  private recalcularCombos(grupos: GrupoSolidario[]) {
    this.cidadesDisponiveis.set(this.uniqSorted(grupos.map(g => g.cidade || '').filter(Boolean)));
    this.ufsDisponiveis.set(this.uniqSorted(grupos.map(g => g.uf || '').filter(Boolean)));
    this.coordenadoresDisponiveis.set(
      this.uniqSorted(grupos.map(g => this.displayName(g.coordenadorNome || '')).filter(Boolean))
    );
  }

  // =================== Handlers UI ===================
  trocarVisualizacao(v: Visualizacao) {
    if (this.visualizacao() === v) return;
    this.visualizacao.set(v);
    this.paginaAtual.set(1);
  }

  ordenarPor(campo: SortField) {
    if (this.sortField() === campo) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(campo);
      this.sortDir.set('asc');
    }
  }

  irParaPagina(n: number) {
    if (n < 1 || n > this.totalPaginas() || n === this.paginaAtual()) return;
    this.paginaAtual.set(n);
  }

  pages(): number[] { return Array.from({ length: this.totalPaginas() }, (_, i) => i + 1); }

  trackById(_i: number, g: GrupoSolidario) { return g.id; }

  // =================== Modal ===================
  abrirModal(g: GrupoSolidario) { this.grupoSelecionado.set(g); this.modalAberto.set(true); }
  fecharModal() { this.modalAberto.set(false); this.grupoSelecionado.set(null); }

  // =================== Ações rápidas ===================
  goToGrupo(g: GrupoSolidario) {
    // Ajuste se tua rota de detalhes for diferente
    window.open(`/grupos/${g.id}`, '_blank');
  }

  copyInvite(g: GrupoSolidario) {
    const url = buildInviteUrl(g);
    // navigator.clipboard pode não existir em alguns browsers/https
    if (navigator && (navigator as any).clipboard && (navigator as any).clipboard.writeText) {
      (navigator as any).clipboard.writeText(url).then(
        () => alert('Link copiado!'),
        () => alert('Não foi possível copiar o link.')
      );
    } else {
      // fallback
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      try { document.execCommand('copy'); alert('Link copiado!'); }
      catch { alert('Não foi possível copiar o link.'); }
      document.body.removeChild(textArea);
    }
  }

  shareWhatsApp(g: GrupoSolidario) {
    const url = buildInviteUrl(g);
    const text = encodeURIComponent(`Convite para entrar no grupo "${g.nome}": ${url}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }
}

/* =================== Helpers sem ?. / ?? =================== */
function has(obj: any, key: string) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null;
}
function s(obj: any, key: string, fallback = ''): string {
  return has(obj, key) ? String(obj[key]) : fallback;
}
function n(obj: any, key: string, fallback = 0): number {
  const v = has(obj, key) ? Number(obj[key]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}
function arr<T = any>(obj: any, key: string): T[] {
  const v = has(obj, key) ? obj[key] : [];
  return Array.isArray(v) ? (v as T[]) : [];
}
function upperOrNull(obj: any, key: string): string | null {
  const v = s(obj, key).trim();
  return v ? v.toUpperCase() : null;
}
function dataLike(obj: any, key: string): any {
  // mantém Timestamp, Date ou value cru; os formatadores lidam com isso
  return has(obj, key) ? obj[key] : null;
}
function buildInviteUrl(g: GrupoSolidario): string {
  const persisted = (g.inviteUrl || '').trim();
  if (persisted.startsWith('http')) return persisted;

  const origin = typeof window !== 'undefined' && (window as any).location ? window.location.origin : '';
  const token = encodeURIComponent(g.inviteToken || '');
  const gid = encodeURIComponent(g.id || '');
  // Ajuste a rota se preferir outro caminho:
  // return `${origin}/grupo/convite/${token}`;
  return `${origin}/grupos/entrar?token=${token}&gid=${gid}`;
}
