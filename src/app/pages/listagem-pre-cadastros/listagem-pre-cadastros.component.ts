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
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';

import { db } from '../../firebase.config';
import { HeaderComponent } from '../shared/header/header.component';

type SortDir = 'asc' | 'desc';

type PreCadastroList = {
  id: string;
  _path: string;

  nomeCompleto?: string;

  telefone?: string;
  contato?: string;
  email?: string;

  cidade?: string;
  endereco?: string;
  enderecoCompleto?: string;
  bairro?: string;

  createdAt?: any;
  createdByUid?: string;
  createdByNome?: string;

  origem?: string | null;

  agendado?: boolean;
  agendamento?:
    | {
        /** NOVO: data e hora juntos (Timestamp/Date/epoch/ISO/pt-BR longo) */
        dataHora?: any;
        /** LEGADO: campos separados */
        data?: any;
        hora?: string;
        status?: string;
        observacao?: string;
      }
    | null;

  /** LEGADO – campos espalhados */
  agendamentoEm?: any;
  agendaData?: any;
  agendaHora?: string | null;
  agendamentoStatus?: string | null;
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

  // Filtros
  filtro: {
    nome: string;
    dataDe?: string;
    dataAte?: string;
    agendado: 'todos' | 'sim' | 'nao';
    origem: string;
    bairro: string;
  } = { nome: '', dataDe: '', dataAte: '', agendado: 'todos', origem: '', bairro: '' };

  // Opções dinâmicas
  origensDisponiveis: string[] = [];
  bairrosDisponiveis: string[] = [];

  itensPorPagina = 20;
  paginaAtual = 1;
  totalPaginas = 1;
  totalEstimado = 0;

  // agora inclui 'bairro' e 'assessorNome'
  sortField: 'nomeCompleto' | 'createdAt' | 'assessorNome' | 'bairro' = 'createdAt';
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
    const keepLower = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della']);
    return parts.map((p, i) => (i > 0 && keepLower.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
  }

  public maskPhone(input?: string): string {
    const d = (input || '').replace(/\D/g, '');
    if (!d) return '—';
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    if (d.length > 11) return d.replace(/(\d{2,3})(\d{2})(\d{4,5})(\d{4})/, '+$1 ($2) $3-$4');
    return d;
  }
  public getPhone(c: any): string {
    return (c?.contato ?? c?.telefone ?? '') as string;
  }

  private normalize(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // ====================== PARSERS DATA/HORA ======================
  private readonly PT_MESES: Record<string, number> = {
    janeiro: 0,
    fevereiro: 1,
    marco: 2,
    março: 2,
    abril: 3,
    maio: 4,
    junho: 5,
    julho: 6,
    agosto: 7,
    setembro: 8,
    outubro: 9,
    novembro: 10,
    dezembro: 11,
  };

  /** Ex.: "20 de setembro de 2025 às 10:30:00 UTC-3" (o "UTC-3" é opcional) */
  private parsePtBrLongDateTime(s: string): Date | null {
    if (!s) return null;
    const norm = s.trim().replace(/\s+UTC[^\s]+$/i, '').replace(/\,/g, '');
    const re = /^(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})(?:\s+às\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i;
    const m = norm.match(re);
    if (!m) return null;

    const dd = +m[1];
    const mesNome = m[2].toLowerCase();
    const yyyy = +m[3];
    const h = m[4] ? +m[4] : 0;
    const min = m[5] ? +m[5] : 0;
    const sec = m[6] ? +m[6] : 0;

    const mm = this.PT_MESES[mesNome];
    if (mm == null) return null;

    return new Date(yyyy, mm, dd, h, min, sec, 0);
  }

  private asDateFlexible(v: any): Date | null {
    if (!v) return null;

    // Firestore Timestamp
    if (typeof v === 'object' && typeof v.toDate === 'function') {
      try {
        return v.toDate();
      } catch {}
    }

    // Objeto {seconds, nanoseconds}
    if (v && typeof v === 'object' && typeof v.seconds === 'number') {
      const ms = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
      return new Date(ms);
    }

    // Date nativo
    if (v instanceof Date) return v;

    // epoch ms
    if (typeof v === 'number') return new Date(v);

    // Strings
    if (typeof v === 'string') {
      // ISO / "AAAA-MM-DDTHH:mm..." etc.
      const iso = new Date(v);
      if (!isNaN(iso.getTime())) return iso;

      // dd/MM/yyyy
      const m1 = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m1) {
        const [, dd, mm, yyyy] = m1;
        return new Date(+yyyy, +mm - 1, +dd);
      }

      // "20 de setembro de 2025 às 10:30:00 (UTC-3 opcional)"
      const dLong = this.parsePtBrLongDateTime(v);
      if (dLong) return dLong;
    }

    return null;
  }

  /** Versão curta: delega para o parser flexível (inclui formatos pt-BR longos) */
  private asDate(input: any): Date | null {
    return this.asDateFlexible(input);
  }

  public toBRDate(value: any): string {
    const d = this.asDate(value);
    if (!d) return '—';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  public toBRTime(hhmm?: string | null): string {
    if (!hhmm) return '';
    const clean = hhmm.replace(/[^\d]/g, '');
    if (clean.length === 4) return `${clean.slice(0, 2)}:${clean.slice(2, 4)}`;
    if (clean.length === 3) return `0${clean[0]}:${clean.slice(1)}`;
    return hhmm;
  }

  private toBRTimeFromDate(d: Date): string {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  private parseHoraToHM(hora: string | null | undefined): { h: number; m: number } | null {
    if (!hora) return null;
    const m = hora.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Math.min(23, Math.max(0, +m[1]));
    const min = Math.min(59, Math.max(0, +m[2]));
    return { h, m: min };
  }

  // ====================== CAMPOS EXTRAS ======================
  public getAssessorNome(c: PreCadastroList): string {
    if (c.createdByNome && c.createdByNome.trim()) return this.displayName(c.createdByNome);
    if (c.createdByUid) return `UID: ${c.createdByUid.slice(0, 6)}…`;
    return '—';
  }

  public getOrigem(c: PreCadastroList): string {
    const o = (c.origem ?? (c as any)?.origemNome ?? '').toString().trim();
    return o || '—';
  }

  public getBairro(c: PreCadastroList): string {
    const b =
      c.bairro ??
      (c as any)?.enderecoBairro ??
      (c as any)?.addressBairro ??
      this.extrairBairroDeEndereco(c.enderecoCompleto || c.endereco || '');
    return (b || '').toString().trim() || '—';
  }

  private extrairBairroDeEndereco(endereco: string): string {
    const m1 = endereco.match(/bairro[:\s-]*([^,-]+)/i);
    if (m1?.[1]) return m1[1].trim();
    const m2 = endereco.split(' - ')[0];
    return m2?.trim() || '';
  }

  // ====================== AGENDAMENTO ======================
  public isAgendado(c: PreCadastroList): boolean {
    const ag: any = (c as any)?.agendamento;
    const temNovo = ag?.dataHora || ag?.status;
    const temLegado =
      c.agendado === true ||
      !!(ag?.data || c.agendamentoEm || c.agendaData) ||
      !!(ag?.hora || c.agendaHora) ||
      !!(ag?.status || c.agendamentoStatus);
    return !!(temNovo || temLegado);
  }

  /** Retorna um Date combinando a fonte nova (dataHora) ou o legado (data + hora). */
  private getAgendaDateTime(c: PreCadastroList): Date | null {
    const ag: any = (c as any)?.agendamento;

    // 1) Novo modelo: dataHora (Timestamp/Date/ISO/epoch/PT-BR long)
    if (ag?.dataHora) {
      const d = this.asDateFlexible(ag.dataHora);
      return d ?? null;
    }

    // 2) Legado: data + hora em campos separados
    const dataBruta = ag?.data ?? c.agendamentoEm ?? c.agendaData ?? null;
    const d = this.asDateFlexible(dataBruta);
    if (!d) return null;

    const horaStr = ag?.hora ?? c.agendaHora ?? null;
    const hm = this.parseHoraToHM(horaStr);
    if (hm) d.setHours(hm.h, hm.m, 0, 0);
    return d;
  }

  private getAgendaStatus(c: PreCadastroList): string {
    const ag: any = (c as any)?.agendamento;
    return (ag?.status ?? c.agendamentoStatus ?? '').toString();
  }

  public getAgendamentoResumo(c: PreCadastroList): string {
    if (!this.isAgendado(c)) return '—';

    const dt = this.getAgendaDateTime(c);
    const status = this.getAgendaStatus(c);

    if (dt) {
      const data = this.toBRDate(dt);
      const hora = this.toBRTimeFromDate(dt);
      const pedacos = [data, hora].filter(Boolean).join(' ');
      return [pedacos || 'Agendado', status].filter(Boolean).join(' · ');
    }

    // Fallback (se por algum motivo não montou o Date)
    const dataFallback =
      this.toBRDate(
        this.asDateFlexible((c as any)?.agendamento?.data ?? c.agendamentoEm ?? c.agendaData) as any
      ) || '';
    const horaFallback = this.toBRTime((c as any)?.agendamento?.hora ?? c.agendaHora ?? '');
    const pedacos = [dataFallback, horaFallback].filter(Boolean).join(' ');
    return [pedacos || 'Agendado', status].filter(Boolean).join(' · ');
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
      try {
        snapGroup = await getDocs(collectionGroup(db, 'pre_cadastros'));
      } catch {}

      if (snapGroup && !snapGroup.empty) {
        snapGroup.forEach((d) => {
          const dados = d.data() as any;
          this.presAll.push({ id: d.id, _path: d.ref.path, ...dados });
          found[d.ref.path] = true;
        });
      }

      const snapTop = await getDocs(collection(db, 'pre_cadastros'));
      snapTop.forEach((d) => {
        const key = d.ref.path;
        if (found[key]) return;
        const dados = d.data() as any;
        this.presAll.push({ id: d.id, _path: d.ref.path, ...dados });
      });

      // opções dinâmicas (origens e bairros)
      this.origensDisponiveis = Array.from(
        new Set(this.presAll.map((c) => this.getOrigem(c)).filter((o) => o && o !== '—'))
      ).sort((a, b) => this.normalize(a).localeCompare(this.normalize(b)));

      this.bairrosDisponiveis = Array.from(
        new Set(this.presAll.map((c) => this.getBairro(c)).filter((b) => b && b !== '—'))
      ).sort((a, b) => this.normalize(a).localeCompare(this.normalize(b)));

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
    this.paginaAtual = n;
    this.recalcularPaginacao();
    try {
      document.querySelector('.table-responsive')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {}
  }
  pages(): number[] {
    return Array.from({ length: this.totalPaginas }, (_, i) => i + 1);
  }
  trackById(_i: number, c: PreCadastroList) {
    return c._path || c.id;
  }

  // ====================== FILTROS / ORDENAÇÃO ======================
  onFiltroNomeChange(v: string) {
    this.filtro.nome = v;
    this.aplicarFiltrosLocais();
  }

  aplicarFiltrosLocais(resetPagina = false) {
    const nl = this.normalize(this.filtro.nome);
    let arr = [...this.presAll];

    // nome
    if (nl) arr = arr.filter((c) => this.normalize(this.displayName(c.nomeCompleto || '')).includes(nl));

    // datas (createdAt)
    if (this.filtro.dataDe || this.filtro.dataAte) {
      const start = this.filtro.dataDe ? new Date(this.filtro.dataDe + 'T00:00:00') : null;
      const end = this.filtro.dataAte ? new Date(this.filtro.dataAte + 'T23:59:59.999') : null;
      arr = arr.filter((c) => {
        const d = this.asDate(c.createdAt);
        if (!d) return false;
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
      });
    }

    // agendado
    if (this.filtro.agendado !== 'todos') {
      const want = this.filtro.agendado === 'sim';
      arr = arr.filter((c) => this.isAgendado(c) === want);
    }

    // origem
    if (this.filtro.origem) {
      const alvo = this.normalize(this.filtro.origem);
      arr = arr.filter((c) => this.normalize(this.getOrigem(c)) === alvo);
    }

    // bairro
    if (this.filtro.bairro) {
      const alvoB = this.normalize(this.filtro.bairro);
      arr = arr.filter((c) => this.normalize(this.getBairro(c)) === alvoB);
    }

    // ordenar
    this.presFiltrados = this.ordenarArray(arr, this.sortField, this.sortDir);

    if (resetPagina) this.paginaAtual = 1;
    this.recalcularPaginacao();
  }

  ordenarPor(campo: 'nomeCompleto' | 'createdAt' | 'assessorNome' | 'bairro') {
    if (this.sortField === campo) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else {
      this.sortField = campo;
      this.sortDir = 'asc';
    }
    this.presFiltrados = this.ordenarArray(this.presFiltrados, this.sortField, this.sortDir);
    this.recalcularPaginacao();
  }

  private ordenarArray(
    arr: PreCadastroList[],
    campo: 'nomeCompleto' | 'createdAt' | 'assessorNome' | 'bairro',
    dir: SortDir
  ): PreCadastroList[] {
    const mult = dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      let va: any;
      let vb: any;

      if (campo === 'createdAt') {
        va = this.asDate(a.createdAt)?.getTime() ?? 0;
        vb = this.asDate(b.createdAt)?.getTime() ?? 0;
      } else if (campo === 'assessorNome') {
        va = this.normalize(this.getAssessorNome(a));
        vb = this.normalize(this.getAssessorNome(b));
      } else if (campo === 'bairro') {
        va = this.normalize(this.getBairro(a));
        vb = this.normalize(this.getBairro(b));
      } else {
        va = this.normalize(this.displayName(a.nomeCompleto || ''));
        vb = this.normalize(this.displayName(b.nomeCompleto || ''));
      }

      if (va < vb) return -1 * mult;
      if (va > vb) return 1 * mult;
      return 0;
    });
  }

  // ====================== EDITAR / REMOVER ======================
  editarPreCadastro(item: PreCadastroList) {
    const url = `/pre-cadastro/novo?edit=true&id=${encodeURIComponent(item.id)}&path=${encodeURIComponent(
      item._path
    )}`;
    window.location.href = url;
  }

  async removerPreCadastro(item: PreCadastroList) {
    const ok = window.confirm('Tem certeza que deseja remover este pré-cadastro?');
    if (!ok) return;
    try {
      const path = item._path || `pre_cadastros/${item.id}`;
      await deleteDoc(doc(db, path));
      const key = path;
      this.presAll = this.presAll.filter((c) => (c._path || `pre_cadastros/${c.id}`) !== key);

      // Atualiza opções dinâmicas
      this.origensDisponiveis = Array.from(
        new Set(this.presAll.map((c) => this.getOrigem(c)).filter((o) => o && o !== '—'))
      ).sort((a, b) => this.normalize(a).localeCompare(this.normalize(b)));

      this.bairrosDisponiveis = Array.from(
        new Set(this.presAll.map((c) => this.getBairro(c)).filter((b) => b && b !== '—'))
      ).sort((a, b) => this.normalize(a).localeCompare(this.normalize(b)));

      this.aplicarFiltrosLocais();
    } catch (e) {
      console.error(e);
      alert('Falha ao remover o pré-cadastro.');
    }
  }
}
