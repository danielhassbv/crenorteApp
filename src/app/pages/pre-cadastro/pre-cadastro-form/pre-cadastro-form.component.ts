import {
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { PreCadastroService } from '../../../services/pre-cadastro.service';
import { PreCadastro } from '../../../models/pre-cadastro.model';
import { HeaderComponent } from '../../shared/header/header.component';
import { Firestore, doc, getDoc, updateDoc } from '@angular/fire/firestore';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';

declare const bootstrap: any;

type Star = 1 | 2 | 3 | 4 | 5;
type MaskedNumber = string | null;

type FeedbackCliente = {
  notaAtendimento: Star;
  cordialidade: Star;
  clareza: Star;
  recebeuInformacoesCompletas: boolean;
  recomendaria: boolean;
  comentarios?: string;
};

type FluxoFixos = {
  aluguel: number;
  salarios: number;
  energiaEletrica: number;
  agua: number;
  telefoneInternet: number;
};
type FluxoVariaveis = {
  materiaPrima: number;
  insumos: number;
  frete: number;
  transporte: number;
  outros: Array<{ nome: string; valor: number }>;
};
type FluxoCaixa = {
  faturamentoMensal: number;
  fixos: FluxoFixos;
  variaveis: FluxoVariaveis;
};
type FluxoTotais = { receita: number; custos: number; lucro: number };

@Component({
  selector: 'app-pre-cadastro-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent, NgxMaskDirective],
  templateUrl: './pre-cadastro-form.component.html',
  styleUrls: ['./pre-cadastro-form.component.css'],
  providers: [provideNgxMask()],
  changeDetection: ChangeDetectionStrategy.Default,
})
export class PreCadastroFormComponent implements OnInit {
  private service = inject(PreCadastroService);
  public router = inject(Router);
  private route = inject(ActivatedRoute);
  private afs = inject(Firestore);

  @ViewChild('feedbackModal', { static: false }) feedbackModalRef?: ElementRef<HTMLDivElement>;
  private feedbackModal?: any;

  // Modal Fluxo de Caixa
  private fluxoModalRef: any | null = null;

  loading = signal(false);

  // mensagens de feedback (sucesso/erro)
  msg = signal<string | null>(null);
  msgType = signal<'success' | 'danger' | 'info' | null>(null);
  private showMsg(type: 'success' | 'danger' | 'info', text: string, autoHideMs = 4000) {
    this.msgType.set(type);
    this.msg.set(text);
    if (autoHideMs > 0) {
      setTimeout(() => {
        this.msg.set(null);
        this.msgType.set(null);
      }, autoHideMs);
    }
  }

  // ===== Edição =====
  editMode = false;
  private docPath: string | null = null;
  private docId: string | null = null;

  model: Omit<PreCadastro, 'id' | 'createdAt' | 'createdByUid' | 'createdByNome'> = {
    nomeCompleto: '',
    cpf: '',
    endereco: '',
    telefone: '',
    email: '',
    bairro: '',
    origem: '',
  };

  private lastPreCadastroId: string | null = null;

  // ===================== FINANCEIRO =====================
  jurosMes = 0.0274; // 2,74% a.m.
  parcelas: number[] = Array.from({ length: 12 }, (_, i) => i + 1);

  /** Campo mascarado (string) + número parseado */
  valorSolicitadoMasked: MaskedNumber = '';
  valorSolicitadoNumber = 0;

  /** Select de parcelas */
  parcelasSelecionadas: number | null = null;

  parcelasComValor: { n: number; label: string; valorParcela: number }[] = [];
  resumoParcela = '';

  // ===== Fluxo de Caixa =====
  fluxoCaixa: FluxoCaixa | null = {
    faturamentoMensal: 0,
    fixos: { aluguel: 0, salarios: 0, energiaEletrica: 0, agua: 0, telefoneInternet: 0 },
    variaveis: { materiaPrima: 0, insumos: 0, frete: 0, transporte: 0, outros: [] },
  };
  fluxoCaixaTotais: FluxoTotais = { receita: 0, custos: 0, lucro: 0 };

  // Form do modal (espelha o cadastro-form)
  fluxoForm = {
    faturamentoMensal: 0,
    fixos: {
      aluguelMasked: '' as MaskedNumber,
      salariosMasked: '' as MaskedNumber,
      energiaEletricaMasked: '' as MaskedNumber,
      aguaMasked: '' as MaskedNumber,
      telefoneInternetMasked: '' as MaskedNumber,

      aluguel: 0,
      salarios: 0,
      energiaEletrica: 0,
      agua: 0,
      telefoneInternet: 0,
    },
    variaveis: {
      materiaPrimaMasked: '' as MaskedNumber,
      insumosMasked: '' as MaskedNumber,
      freteMasked: '' as MaskedNumber,
      transporteMasked: '' as MaskedNumber,

      materiaPrima: 0,
      insumos: 0,
      frete: 0,
      transporte: 0,

      outros: [] as Array<{ nome: string; valorMasked: MaskedNumber; valor: number }>,
    },
  };

  // ====== Faturamento (campo integer com mask .0) ======
  faturamento = 0;
  faturamentoInput = '';

  // ================== FEEDBACK ==================
  feedback: FeedbackCliente = {
    notaAtendimento: 5,
    cordialidade: 5,
    clareza: 5,
    recebeuInformacoesCompletas: true,
    recomendaria: true,
    comentarios: '',
  };
  stars: Star[] = [1, 2, 3, 4, 5];

  // ===== Utils =====
  private limpar(str: string) {
    return (str || '').trim();
  }

  // ===== Moeda (iguais ao cadastro-form) =====
  parseMoedaBR(v: any): number {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    const s = String(v).replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
  }
  parseBRN(masked: string | null | undefined): number {
    if (!masked) return 0;
    let s = String(masked).replace(/[^\d,]/g, '');
    const partes = s.split(',');
    if (partes.length > 1) {
      const dec = partes.pop();
      s = partes.join('') + '.' + dec;
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  formatBRL(v: number): string {
    if (!isFinite(v)) v = 0;
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  formatBRN(n: number): string {
    try {
      return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch {
      return `R$ ${(+n || 0).toFixed(2)}`;
    }
  }

  // ===== CPF =====
  private cpfValido(cpf: string): boolean {
    const s = (cpf || '').replace(/\D/g, '');
    if (s.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(s)) return false;

    const calcDV = (base: string, fatorInicial: number) => {
      let soma = 0;
      for (let i = 0; i < base.length; i++) {
        soma += parseInt(base[i], 10) * (fatorInicial - i);
      }
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };

    const dv1 = calcDV(s.substring(0, 9), 10);
    if (dv1 !== parseInt(s[9], 10)) return false;
    const dv2 = calcDV(s.substring(0, 10), 11);
    if (dv2 !== parseInt(s[10], 10)) return false;
    return true;
  }

  // ===== Init =====
  async ngOnInit() {
    this.atualizarParcelasLabels();
    this.atualizarResumo();
    this.recalcularTotaisFromFluxoCaixa();

    this.route.queryParamMap.subscribe(async (qp) => {
      this.editMode = qp.get('edit') === 'true';
      this.docPath = qp.get('path');
      this.docId = qp.get('id');

      if (!this.editMode) return;

      try {
        let ref;
        if (this.docPath) {
          ref = doc(this.afs, this.docPath);
        } else if (this.docId) {
          ref = doc(this.afs, 'pre_cadastros', this.docId);
        } else {
          throw new Error('Sem path ou id para carregar o pré-cadastro.');
        }

        const snap = await getDoc(ref);
        if (!snap.exists()) {
          this.showMsg('danger', 'Pré-cadastro não encontrado.', 6000);
          return;
        }

        const data = snap.data() as any;

        this.model = {
          nomeCompleto: data.nomeCompleto ?? '',
          cpf: data.cpf ?? '',
          endereco: data.endereco ?? data.enderecoCompleto ?? '',
          telefone: data.telefone ?? data.contato ?? '',
          email: data.email ?? '',
          bairro: data.bairro ?? '',
          origem: data.origem ?? '',
        };

        this.valorSolicitadoNumber = Number(data?.valorSolicitado || 0);
        this.valorSolicitadoMasked = this.valorSolicitadoNumber ? this.formatBRN(this.valorSolicitadoNumber) : '';
        this.parcelasSelecionadas = Number(data?.parcelas || 0) || null;

        this.fluxoCaixa = data?.fluxoCaixa ?? this.fluxoCaixa;
        this.fluxoCaixaTotais = data?.fluxoCaixaTotais ?? this.fluxoCaixaTotais;

        this.atualizarParcelasLabels();
        this.atualizarResumo();
        this.recalcularTotaisFromFluxoCaixa();

        this.lastPreCadastroId = snap.id;
      } catch (e: any) {
        console.error('[PreCadastro] Erro ao carregar doc para edição:', e);
        this.showMsg('danger', e?.message || 'Erro ao carregar o pré-cadastro para edição.', 7000);
      }
    });
  }

  // ================= Lógica Financeira =================
  calcularParcela(pv: number, n: number, i: number): number {
    if (!pv || !n || !i) return 0;
    const fator = i / (1 - Math.pow(1 + i, -n));
    return pv * fator;
  }

  onValorChange(raw: any) {
    // igual ao cadastro-form
    this.valorSolicitadoNumber = this.parseMoedaBR(raw);
    this.atualizarParcelasLabels();
    this.atualizarResumo();
  }

  onParcelasChange(_: number) {
    this.atualizarResumo();
  }

  atualizarParcelasLabels() {
    this.parcelasComValor = this.parcelas.map((n) => {
      const v = this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
      return { n, valorParcela: v, label: `${n}x de ${this.formatBRL(v)}` };
    });
  }

  atualizarResumo() {
    const n = Number(this.parcelasSelecionadas || 0);
    if (!n || !this.valorSolicitadoNumber) {
      this.resumoParcela = '';
      return;
    }
    const pmt = this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
    const total = pmt * n;
    this.resumoParcela = `${n}x de ${this.formatBRL(pmt)} • Total: ${this.formatBRL(total)}`;
  }

  getParcelaEscolhidaNumber(): number {
    const n = Number(this.parcelasSelecionadas || 0);
    if (!n || !this.valorSolicitadoNumber) return 0;
    return this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
  }

  // ===== Parcela Sugerida + Cores (iguais ao cadastro) =====
  private getOutrasRendasNumber(): number {
    // pré-cadastro não tem outras rendas declaradas: 0
    return 0;
  }
  computeParcelaSugerida() {
    const lucro = this.fluxoCaixaTotais?.lucro || 0;
    const outras = this.getOutrasRendasNumber();
    const base = lucro > 0 ? lucro + outras : outras;
    if (base <= 0) return { valor: 0, fator: 0.3, base: 0 };
    const valor = base * 0.3;
    return { valor, fator: 0.3, base };
  }
  getComparacaoParcelaTexto(): string {
    const escolhida = this.getParcelaEscolhidaNumber();
    const { valor: sugerida } = this.computeParcelaSugerida();
    if (!escolhida || !sugerida) return '';
    const diff = escolhida - sugerida;
    const limite10 = sugerida * 1.1;
    if (diff > 0) {
      if (escolhida <= limite10) return 'Parcela dentro do limite admitido';
      return `Acima da sugerida em ${this.formatBRL(diff)}.`;
    } else if (diff < 0) {
      return `Abaixo da sugerida em ${this.formatBRL(Math.abs(diff))}.`;
    }
    return 'Igual à sugerida.';
  }
  getComparacaoParcelaClasse(): string {
    const escolhida = this.getParcelaEscolhidaNumber();
    const { valor: sugerida } = this.computeParcelaSugerida();
    if (!escolhida || !sugerida) return 'text-muted';
    if (escolhida <= sugerida) return 'text-dark';
    if (escolhida <= sugerida * 1.1) return 'text-dark';
    return 'text-dark';
  }
  getParcelaEscolhidaClasse(): string {
    const escolhida = this.getParcelaEscolhidaNumber();
    const { valor: sugerida } = this.computeParcelaSugerida();
    if (!escolhida || !sugerida) return 'bg-secondary-subtle text-dark border';
    if (escolhida <= sugerida) return 'bg-success-subtle text-dark border';
    if (escolhida <= sugerida * 1.1) return 'bg-warning-subtle text-dark border';
    return 'bg-danger-subtle text-dark border';
  }

  // ===== Totais do modal (em tempo real, como no cadastro) =====
  totalReceita(): number {
    return this.fluxoForm.faturamentoMensal || 0;
  }
  totalCustos(): number {
    const f = this.fluxoForm.fixos;
    const v = this.fluxoForm.variaveis;
    const somaFixos =
      (f.aluguel || 0) + (f.salarios || 0) + (f.energiaEletrica || 0) + (f.agua || 0) + (f.telefoneInternet || 0);
    const somaVar =
      (v.materiaPrima || 0) + (v.insumos || 0) + (v.frete || 0) + (v.transporte || 0) +
      (v.outros || []).reduce((acc: number, o) => acc + (o.valor || 0), 0);
    return somaFixos + somaVar;
  }
  totalLucro(): number {
    return this.totalReceita() - this.totalCustos();
  }

  // ====== Abrir/fechar modal ======
  openFluxoModal() {
    const f =
      this.fluxoCaixa || ({
        faturamentoMensal: 0,
        fixos: { aluguel: 0, salarios: 0, energiaEletrica: 0, agua: 0, telefoneInternet: 0 },
        variaveis: { materiaPrima: 0, insumos: 0, frete: 0, transporte: 0, outros: [] },
      } as FluxoCaixa);

    this.faturamento = f.faturamentoMensal || 0;
    this.faturamentoInput = this.faturamento ? String(Math.trunc(this.faturamento)) : '';
    this.fluxoForm.faturamentoMensal = this.faturamento;

    this.fluxoForm.fixos.aluguel = f.fixos.aluguel || 0;
    this.fluxoForm.fixos.salarios = f.fixos.salarios || 0;
    this.fluxoForm.fixos.energiaEletrica = f.fixos.energiaEletrica || 0;
    this.fluxoForm.fixos.agua = f.fixos.agua || 0;
    this.fluxoForm.fixos.telefoneInternet = f.fixos.telefoneInternet || 0;

    this.fluxoForm.variaveis.materiaPrima = f.variaveis.materiaPrima || 0;
    this.fluxoForm.variaveis.insumos = f.variaveis.insumos || 0;
    this.fluxoForm.variaveis.frete = f.variaveis.frete || 0;
    this.fluxoForm.variaveis.transporte = f.variaveis.transporte || 0;
    this.fluxoForm.variaveis.outros = (f.variaveis.outros || []).map((o) => ({
      nome: o.nome,
      valor: o.valor || 0,
      valorMasked: this.formatBRN(o.valor || 0),
    }));

    const el = document.getElementById('fluxoCaixaModal');
    if (el) {
      this.fluxoModalRef = new bootstrap.Modal(el, { backdrop: 'static' });
      this.fluxoModalRef.show();
    }
  }
  closeFluxoModal() {
    if (this.fluxoModalRef) {
      this.fluxoModalRef.hide();
      this.fluxoModalRef = null;
    }
  }

  // ======= Handlers do modal =======
  onFaturamentoChange(digits: string) {
    const n = Number(digits || 0);
    this.faturamento = n;
    this.fluxoForm.faturamentoMensal = n;
  }

  syncNumber(path: string, masked: string) {
    const n = this.parseBRN(masked);
    const set = (obj: any, p: string[], value: number): void => {
      if (p.length === 1) { obj[p[0]] = value; return; }
      set(obj[p[0]], p.slice(1), value);
    };
    set(this.fluxoForm, path.split('.'), n);
  }
  syncOutroValor(i: number, masked: string) {
    const val = this.parseBRN(masked);
    this.fluxoForm.variaveis.outros[i].valor = val;
  }
  addOutro() {
    this.fluxoForm.variaveis.outros.push({ nome: '', valorMasked: '', valor: 0 });
  }
  removeOutro(i: number) {
    this.fluxoForm.variaveis.outros.splice(i, 1);
  }

  // Salvar do modal -> grava no objeto principal e atualiza sugerida/resumo
  salvarFluxo() {
    this.fluxoCaixa = {
      faturamentoMensal: this.fluxoForm.faturamentoMensal || 0,
      fixos: {
        aluguel: this.fluxoForm.fixos.aluguel || 0,
        salarios: this.fluxoForm.fixos.salarios || 0,
        energiaEletrica: this.fluxoForm.fixos.energiaEletrica || 0,
        agua: this.fluxoForm.fixos.agua || 0,
        telefoneInternet: this.fluxoForm.fixos.telefoneInternet || 0,
      },
      variaveis: {
        materiaPrima: this.fluxoForm.variaveis.materiaPrima || 0,
        insumos: this.fluxoForm.variaveis.insumos || 0,
        frete: this.fluxoForm.variaveis.frete || 0,
        transporte: this.fluxoForm.variaveis.transporte || 0,
        outros: (this.fluxoForm.variaveis.outros || []).map((o) => ({ nome: o.nome || 'Outro', valor: o.valor || 0 })),
      },
    };

    // Atualiza os totais “oficiais” usados pela parcela sugerida
    this.recalcularTotaisFromFluxoCaixa();
    // Atualiza labels de parcelas/sugerida/resumo
    this.atualizarParcelasLabels();
    this.atualizarResumo();

    this.closeFluxoModal();
  }

  private somaFixos(f: FluxoFixos) {
    return (
      (f.aluguel || 0) +
      (f.salarios || 0) +
      (f.energiaEletrica || 0) +
      (f.agua || 0) +
      (f.telefoneInternet || 0)
    );
  }
  private somaVariaveis(v: FluxoVariaveis) {
    const b = (v.materiaPrima || 0) + (v.insumos || 0) + (v.frete || 0) + (v.transporte || 0);
    const outros = (v.outros || []).reduce((acc, o) => acc + (o.valor || 0), 0);
    return b + outros;
  }
  private recalcFrom(fluxo: FluxoCaixa | null): FluxoTotais {
    if (!fluxo) return { receita: 0, custos: 0, lucro: 0 };
    const receita = +(fluxo.faturamentoMensal || 0);
    const custos = this.somaFixos(fluxo.fixos) + this.somaVariaveis(fluxo.variaveis);
    const lucro = receita - custos;
    return { receita, custos, lucro };
  }
  private recalcularTotaisFromFluxoCaixa() {
    this.fluxoCaixaTotais = this.recalcFrom(this.fluxoCaixa);
  }

  // ================== FEEDBACK ==================
  private abrirFeedbackModal() {
    if (!this.feedbackModalRef) return;
    this.feedbackModal = new bootstrap.Modal(this.feedbackModalRef.nativeElement, { backdrop: 'static' });
    this.feedbackModal.show();
  }
  fecharFeedbackModal() {
    this.feedbackModal?.hide();
  }
  setStar(field: keyof Pick<FeedbackCliente, 'notaAtendimento' | 'cordialidade' | 'clareza'>, v: Star) {
    this.feedback[field] = v;
  }

  // ================== SALVAR ==================
  async salvar(form: NgForm) {
    if (this.loading()) return;

    const payloadBase = {
      nomeCompleto: this.limpar(this.model.nomeCompleto),
      cpf: this.limpar(this.model.cpf),
      endereco: this.limpar(this.model.endereco),
      telefone: this.limpar(this.model.telefone),
      email: this.limpar(this.model.email),
      origem: this.limpar(this.model.origem),
      bairro: this.limpar(this.model.bairro),
    };

    if (!form.valid || (payloadBase.cpf && !this.cpfValido(payloadBase.cpf))) {
      this.showMsg('danger', 'Preencha os campos corretamente (CPF inválido).', 6000);
      return;
    }

    const parcelaSelecionada = Number(this.parcelasSelecionadas || 0) || 0;
    const valorParcela = this.getParcelaEscolhidaNumber();
    const valorParcelaFormatado = this.formatBRN(valorParcela);
    const valorSolicitadoFormatado = this.formatBRN(this.valorSolicitadoNumber);

    const payloadFinanceiro = {
      valorSolicitado: this.valorSolicitadoNumber,
      valorSolicitadoFormatado,
      parcelas: parcelaSelecionada || null,
      valorParcela,
      valorParcelaFormatado,
      fluxoCaixa: this.fluxoCaixa,
      fluxoCaixaTotais: this.fluxoCaixaTotais,
    };

    const payload = { ...payloadBase, ...payloadFinanceiro };

    this.loading.set(true);
    this.msg.set(null);
    this.msgType.set(null);

    try {
      if (this.editMode) {
        let ref;
        if (this.docPath) {
          ref = doc(this.afs, this.docPath);
        } else if (this.docId) {
          ref = doc(this.afs, 'pre_cadastros', this.docId);
        } else {
          throw new Error('Sem referência para atualizar o pré-cadastro.');
        }

        await updateDoc(ref, {
          ...payload,
          atualizadoEm: new Date(),
        });

        this.showMsg('success', 'Pré-cadastro atualizado com sucesso!');
      } else {
        const id = await this.service.criar(payload);
        this.lastPreCadastroId = id;

        this.showMsg('success', 'Pré-cadastro salvo com sucesso!');

        form.resetForm();

        // limpa UI
        this.valorSolicitadoMasked = '';
        this.valorSolicitadoNumber = 0;
        this.parcelasSelecionadas = null;
        this.parcelasComValor = [];
        this.resumoParcela = '';

        this.fluxoCaixa = {
          faturamentoMensal: 0,
          fixos: { aluguel: 0, salarios: 0, energiaEletrica: 0, agua: 0, telefoneInternet: 0 },
          variaveis: { materiaPrima: 0, insumos: 0, frete: 0, transporte: 0, outros: [] },
        };
        this.recalcularTotaisFromFluxoCaixa();
        this.atualizarParcelasLabels();

        setTimeout(() => this.abrirFeedbackModal(), 0);
      }
    } catch (e: any) {
      console.error('[PreCadastro] Erro ao salvar/atualizar:', e);
      this.showMsg('danger', e?.message || 'Erro ao salvar o pré-cadastro.', 7000);
    } finally {
      this.loading.set(false);
    }
  }

  // ================== FEEDBACK: salvar ==================
  async salvarFeedbackCliente() {
    if (!this.lastPreCadastroId) {
      this.showMsg('danger', 'Não foi possível identificar o pré-cadastro para registrar o feedback.', 7000);
      return;
    }

    try {
      await this.service.registrarFeedbackCliente(this.lastPreCadastroId, this.feedback);
      this.showMsg('success', 'Avaliação do cliente registrada. Obrigado!');
      this.fecharFeedbackModal();
    } catch (e: any) {
      console.error('[PreCadastro] Erro ao salvar feedback do cliente:', e);
      this.showMsg('danger', e?.message || 'Erro ao salvar a avaliação do cliente.', 7000);
    }
  }
}
