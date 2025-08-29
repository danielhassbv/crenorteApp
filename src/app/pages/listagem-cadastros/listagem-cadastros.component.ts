import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  limit,
  startAfter,
  startAt,
  endAt,
  getCountFromServer,
  DocumentSnapshot
} from 'firebase/firestore';
import { db } from '../../firebase.config';
import { Cliente } from '../../models/cliente.model';
import { HeaderComponent } from '../shared/header/header.component';

type ClienteList = (Cliente & {
  id: string;
  _thumbUrl?: string | null;
  _assinaturaUrl?: string | null;
});

@Component({
  selector: 'app-listagem-cadastros',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  styleUrls: ['./listagem-cadastros.component.css'],
  templateUrl: './listagem-cadastros.component.html',
})
export class ListagemCadastrosComponent implements OnInit {
  // dados
  clientes: ClienteList[] = [];
  clientesPaginados: ClienteList[] = [];

  // filtros
  filtro = { nome: '', cidade: '', empreende: '', crenorte: '' };

  // paginação
  clientesPorPagina = 20;
  paginaAtual = 1;
  totalEstimado = 0;
  totalPaginas = 1;
  private pageCursors: (DocumentSnapshot | null)[] = [null];
  private nomeBuscaAtiva = '';
  private debounceRef?: any;

  // ui
  carregando = false;
  erroCarregar = '';

  // preview
  preview = {
    open: false,
    titulo: '',
    imgUrl: null as string | null,
    assinaturaUrl: null as string | null,
  };

  async ngOnInit(): Promise<void> {
    await this.initPaginado();
  }

  // ====================== HELPERS p/ template ======================
  public toBRL(v: any): string {
    if (v === null || v === undefined) return 'R$ 0,00';
    const num =
      typeof v === 'number'
        ? v
        : parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    const safe = isNaN(num) ? 0 : num;
    return safe.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  public maskCPF(cpf?: string): string {
    const d = (cpf || '').replace(/\D/g, '').slice(0, 11);
    if (d.length !== 11) return cpf || '';
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  // ====================== Utils internos ======================
  private capitalizeFirst(s: string): string {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  private capitalizeWords(s: string): string {
    return s
      .split(/\s+/)
      .map(w => this.capitalizeFirst(w))
      .join(' ');
  }
  private dedupeById<T extends { id?: string }>(arr: T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of arr) {
      const key = item.id || JSON.stringify(item);
      if (!seen.has(key)) { seen.add(key); out.push(item); }
    }
    return out;
  }
  private normalize(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  private pickFirstUrl(anexos: Record<string, string[]> | undefined, keysInOrder: string[]): string | null {
    if (!anexos) return null;
    for (const k of keysInOrder) {
      const arr = anexos[k];
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') {
        return arr[0];
      }
    }
    return null;
  }
  private extractThumbAndAssinatura(c: Cliente): { thumb: string | null; assinatura: string | null } {
    const anexos = (c as any)?.anexos as Record<string, string[]> | undefined;
    const thumb = this.pickFirstUrl(anexos, [
      'fotoPessoa',
      'selfieDocumento',
      'docPessoa',
      'fotoEmpreendimento',
      'fotoProdutos',
      'orcamento',
      'planoNegocio',
    ]);
    const assinatura = this.pickFirstUrl(anexos, ['assinatura']);
    return { thumb, assinatura };
  }

  // ====================== CARGA & PAGINAÇÃO ======================
  private async initPaginado() {
    this.carregando = true;
    this.nomeBuscaAtiva = '';
    this.pageCursors = [null];
    this.paginaAtual = 1;
    try {
      const countSnap = await getCountFromServer(query(collection(db, 'clientes')));
      this.totalEstimado = countSnap.data().count || 0;
      this.totalPaginas = Math.max(1, Math.ceil(this.totalEstimado / this.clientesPorPagina));
      await this.carregarPagina(1);
    } catch (e) {
      console.error(e);
      this.erroCarregar = 'Erro ao carregar os cadastros do Firebase.';
    } finally {
      this.carregando = false;
    }
  }

  async carregarPagina(n: number) {
    if (this.nomeBuscaAtiva) return; // sem navegação quando há busca por nome
    if (n < 1) n = 1;
    if (this.totalPaginas && n > this.totalPaginas) n = this.totalPaginas;

    this.carregando = true;
    this.erroCarregar = '';

    try {
      const cursor = this.pageCursors[n - 1] || null;
      const qy = query(
        collection(db, 'clientes'),
        orderBy('nomeCompleto'),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(this.clientesPorPagina)
      );
      const snap = await getDocs(qy);

      const docs = snap.docs.map((d) => {
        const dados = d.data() as any;
        const { thumb, assinatura } = this.extractThumbAndAssinatura(dados);
        return { id: d.id, ...dados, _thumbUrl: thumb, _assinaturaUrl: assinatura } as ClienteList;
      });

      this.clientes = docs;
      this.aplicarFiltrosLocais();
      this.paginaAtual = n;

      const last = snap.docs.at(-1) || null;
      if (this.pageCursors.length === n) this.pageCursors.push(last);
      else this.pageCursors[n] = last;
    } catch (e) {
      console.error(e);
      this.erroCarregar = 'Erro ao carregar os cadastros do Firebase.';
    } finally {
      this.carregando = false;
    }
  }

  irParaPagina(n: number) {
    this.carregarPagina(n);
  }

  pages(): number[] {
    return Array.from({ length: this.totalPaginas }, (_, i) => i + 1);
  }

  // ====================== BUSCA POR NOME ======================
  onFiltroNomeChange(v: string) {
    this.filtro.nome = v;
    clearTimeout(this.debounceRef);
    this.debounceRef = setTimeout(() => this.buscarPorNome(), 250);
  }

  // chamado pelo botão "Buscar" do cabeçalho
  async buscarClientes() {
    if (this.carregando) return;
    const termo = (this.filtro.nome || '').trim();
    clearTimeout(this.debounceRef);
    if (termo) {
      this.nomeBuscaAtiva = termo;
      await this.buscarPorNome();
    } else {
      await this.initPaginado();
    }
  }

  private async buscarPorNome() {
    const termoRaw = (this.filtro.nome || '').trim();
    if (!termoRaw) {
      await this.initPaginado();
      return;
    }

    this.nomeBuscaAtiva = termoRaw;
    this.carregando = true;
    this.erroCarregar = '';

    const variants = [
      termoRaw,
      termoRaw.toLowerCase(),
      this.capitalizeFirst(termoRaw),
      this.capitalizeWords(termoRaw),
      termoRaw.toUpperCase(),
    ].filter((v, i, a) => !!v && a.indexOf(v) === i);

    try {
      const runVariant = async (term: string) => {
        const start = term;
        const end = term + '\uf8ff';
        const qy = query(
          collection(db, 'clientes'),
          orderBy('nomeCompleto'),
          startAt(start),
          endAt(end),
          limit(120)
        );
        const snap = await getDocs(qy);
        return snap.docs.map((d) => {
          const dados = d.data() as any;
          const { thumb, assinatura } = this.extractThumbAndAssinatura(dados);
          return { id: d.id, ...dados, _thumbUrl: thumb, _assinaturaUrl: assinatura } as ClienteList;
        });
      };

      const all = (await Promise.all(variants.map(v => runVariant(v)))).flat();

      let results = all;
      if (results.length === 0) {
        const first = termoRaw[0] || '';
        const letters = [first.toLowerCase(), first.toUpperCase()].filter(Boolean);
        const fallbackRuns = await Promise.all(
          letters.map(async (ch) => {
            const s = ch;
            const e = ch + '\uf8ff';
            const qy = query(
              collection(db, 'clientes'),
              orderBy('nomeCompleto'),
              startAt(s),
              endAt(e),
              limit(300)
            );
            const snap = await getDocs(qy);
            return snap.docs.map((d) => {
              const dados = d.data() as any;
              const { thumb, assinatura } = this.extractThumbAndAssinatura(dados);
              return { id: d.id, ...dados, _thumbUrl: thumb, _assinaturaUrl: assinatura } as ClienteList;
            });
          })
        );
        results = fallbackRuns.flat();
      }

      const nl = this.normalize(termoRaw);
      const filtrados = this.dedupeById(results)
        .filter(c => this.normalize(c.nomeCompleto || '').includes(nl))
        .sort((a, b) => (a.nomeCompleto || '').localeCompare(b.nomeCompleto || ''));

      this.clientes = filtrados;
      this.clientesPaginados = filtrados;
      this.paginaAtual = 1;
      this.totalPaginas = 1;
    } catch (e) {
      console.error('Busca por nome falhou:', e);
      this.erroCarregar = 'Falha na busca por nome.';
    } finally {
      this.carregando = false;
    }
  }

  // ====================== FILTROS LOCAIS ======================
  aplicarFiltrosLocais() {
    let arr = [...this.clientes];

    if (this.filtro.cidade) {
      const nc = this.normalize(this.filtro.cidade);
      arr = arr.filter(c => this.normalize(c.cidade || '').includes(nc));
    }
    if (this.filtro.empreende) {
      const want = this.filtro.empreende === 'Sim';
      arr = arr.filter(c => !!c.jaEmpreende === want);
    }
    if (this.filtro.crenorte) {
      const want = this.filtro.crenorte === 'Sim';
      arr = arr.filter(c => !!c.clienteCrenorte === want);
    }

    this.clientesPaginados = arr;
  }

  // ====================== PREVIEW / EDITAR ======================
  openPreview(c: ClienteList) {
    this.preview = {
      open: true,
      titulo: c.nomeCompleto || 'Pré-visualização',
      imgUrl: c._thumbUrl ?? null,
      assinaturaUrl: c._assinaturaUrl ?? null,
    };
  }
  closePreview() { this.preview.open = false; }
  abrirEmNovaAba(url?: string | null) {
    if (!url) return; window.open(url, '_blank', 'noopener,noreferrer');
  }

  trackById(_i: number, c: ClienteList) { return c.id || c.cpf; }

  editarCliente(cpfOuId: string) {
    const cliente = this.clientes.find(c => (c.cpf ?? c.id) === cpfOuId || c.id === cpfOuId);
    if (!cliente) return;
    const { _thumbUrl, _assinaturaUrl, ...rest } = cliente as any;
    localStorage.setItem('clienteEditando', JSON.stringify({ ...rest, _thumbUrl: _thumbUrl ?? null, _assinaturaUrl: _assinaturaUrl ?? null }));
    window.location.href = '/cadastro';
  }

  // ====================== IMPORT/EXPORT ======================
  importarDoExcel(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const dados: any[] = XLSX.utils.sheet_to_json(sheet);
      if (!dados.length) return;

      try {
        for (const linha of dados) {
          await addDoc(collection(db, 'clientes'), {
            nomeCompleto: linha['Nome'] || '',
            cpf: (linha['CPF'] || '').toString(),
            contato: linha['Contato'] || '',
            cidade: linha['Cidade'] || '',
            valorSolicitado: Number(linha['Valor Solicitado']) || 0,
          });
        }
        await this.initPaginado();
        alert('✅ Importado!');
      } catch (err) {
        console.error(err);
        alert('Erro ao importar.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  exportarExcel() {
    const worksheet = XLSX.utils.json_to_sheet(this.clientes);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Clientes');
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' });
    saveAs(blob, 'clientes-crenorte.xlsx');
  }
}
