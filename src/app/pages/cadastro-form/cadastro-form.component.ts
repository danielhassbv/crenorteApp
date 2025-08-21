import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Cliente } from '../../models/cliente.model';
import { municipiosNorte } from '../../../shared/municipios-norte';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';

// Firebase
import { db } from '../../firebase.config';
import { doc, setDoc } from 'firebase/firestore';

import emailjs, { EmailJSResponseStatus } from 'emailjs-com';


@Component({
  selector: 'app-cadastro-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, NgxMaskDirective],
  templateUrl: './cadastro-form.component.html',
  styleUrls: ['./cadastro-form.component.css'],
  providers: [provideNgxMask()]
})

export class CadastroFormComponent implements OnInit {
  cliente: Cliente = this.novoCliente();

  // ---- Campos auxiliares para selects de data ----
  dias: number[] = [];
  meses: string[] = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  anos: number[] = Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i);

  diaSelecionado: number | null = null;
  mesSelecionado: number | null = null; // 1..12
  anoSelecionado: number | null = null;

  // ---- Controle "Outro" (Tipo de Negócio e Onde Vende) ----
  selecionouOutroTipoNegocio = false;
  selecionouOutroOndeVende = false;
  private opcoesTipoNegocioPadrao = new Set<string>([
    'Mercearia', 'Vendedor ambulante', 'Comércio de roupas', 'Cosméticos e perfumes', 'Bijuterias e acessórios',
    'Loja de variedades', 'Alimentos e bebidas', 'Materiais de construção', 'Papelaria e utilidades',
    'Lanchonete', 'Restaurante caseiro', 'Venda de salgados e doces', 'Churrasquinho de rua', 'Padaria artesanal',
    'Açaí e sorvetes', 'Marmitas', 'Salão de beleza', 'Barbearia', 'Manicure e pedicure',
    'Estética e design de sobrancelhas', 'Costura e conserto de roupas', 'Bordado e customização',
    'Serviços de limpeza', 'Lavanderia', 'Reparos domésticos', 'Pintura', 'Serralheria',
    'Oficina de bicicletas', 'Oficina de motos', 'Assistência de celulares', 'Serviços de informática',
    'Mototaxi', 'Fretes e entregas', 'Hortifruti', 'Criação de aves', 'Criação de peixes',
    'Criação de suínos', 'Plantas ornamentais', 'Artesanato em madeira', 'Artesanato em cerâmica',
    'Artesanato com fibras', 'Confecção', 'Fotografia e filmagem', 'Produção cultural'
  ]);
  private opcoesOndeVendePadrao = new Set<string>(['Na minha casa', 'Online', 'Na rua/feira']);

  cpfValido: boolean | null = null;

  estadosNorte = [
    { sigla: 'AC', nome: 'Acre' },
    { sigla: 'AP', nome: 'Amapá' },
    { sigla: 'AM', nome: 'Amazonas' },
    { sigla: 'PA', nome: 'Pará' },
    { sigla: 'RO', nome: 'Rondônia' },
    { sigla: 'RR', nome: 'Roraima' },
    { sigla: 'TO', nome: 'Tocantins' }
  ];

  municipios: string[] = [];

  ngOnInit(): void {

    // pega a data de hoje
    const hoje = new Date();
    this.diaPre = hoje.getDate();
    this.mesPre = hoje.getMonth() + 1; // meses em JS começam em 0
    this.anoPre = hoje.getFullYear();

    this.atualizarDataPreenchimento(); // já monta no formato ISO
    this.atualizarParcelasLabels();

    // inicia dias com 31 por padrão
    this.atualizarDias();

    // Se veio edição do storage, carrega
    const clienteEditando = localStorage.getItem('clienteEditando');
    if (clienteEditando) {
      this.cliente = JSON.parse(clienteEditando);
      localStorage.removeItem('clienteEditando');
      this.atualizarMunicipios();

      // Preenche selects a partir de dataNascimento (YYYY-MM-DD)
      if (this.cliente.dataNascimento) {
        const [ano, mes, dia] = this.cliente.dataNascimento.split('-').map(v => parseInt(v, 10));
        if (ano && mes && dia) {
          this.anoSelecionado = ano;
          this.mesSelecionado = mes;
          this.atualizarDias(); // recalcula nº de dias conforme mês/ano
          this.diaSelecionado = Math.min(dia, this.dias[this.dias.length - 1]);
        }
      }
      this.atualizarDataNascimento();
    }

    // Estado inicial de "Outro" para tipoNegocio/ondeVende
    this.selecionouOutroTipoNegocio = !!(this.cliente.tipoNegocio && !this.opcoesTipoNegocioPadrao.has(this.cliente.tipoNegocio));
    this.selecionouOutroOndeVende = !!(this.cliente.ondeVende && !this.opcoesOndeVendePadrao.has(this.cliente.ondeVende));
  }

  // ---------- Data de Nascimento (selects) ----------
  onChangeMesOuAno() {
    this.atualizarDias();
    if (this.diaSelecionado && !this.dias.includes(this.diaSelecionado)) {
      this.diaSelecionado = this.dias[this.dias.length - 1] ?? null;
    }
    this.atualizarDataNascimento();
  }

  atualizarDataNascimento() {
    if (this.diaSelecionado && this.mesSelecionado && this.anoSelecionado) {
      const dia = String(this.diaSelecionado).padStart(2, '0');
      const mes = String(this.mesSelecionado).padStart(2, '0');
      const ano = this.anoSelecionado;
      const composta = `${ano}-${mes}-${dia}`;
      if (this.isDataValida(ano, this.mesSelecionado, this.diaSelecionado)) {
        this.cliente.dataNascimento = composta;
      } else {
        this.cliente.dataNascimento = '';
      }
    } else {
      this.cliente.dataNascimento = '';
    }
  }

  private atualizarDias() {
    const ano = this.anoSelecionado ?? new Date().getFullYear();
    const mes = this.mesSelecionado ?? 1;
    const max = this.diasNoMes(ano, mes);
    this.dias = Array.from({ length: max }, (_, i) => i + 1);
  }

  private diasNoMes(ano: number, mes1a12: number): number {
    return new Date(ano, mes1a12, 0).getDate();
  }

  private isDataValida(ano: number, mes1a12: number, dia: number): boolean {
    if (!ano || !mes1a12 || !dia) return false;
    if (mes1a12 < 1 || mes1a12 > 12) return false;
    if (dia < 1 || dia > this.diasNoMes(ano, mes1a12)) return false;
    return true;
  }

  // Variável para controlar a visibilidade do campo "Outro"
  selecionouOutroGenero: boolean = false;

  /**
   * Função que é chamada quando a seleção no campo de gênero muda.
   * @param event O valor do item selecionado no dropdown.
   */
  aoTrocarGenero(event: string) {
    if (event === 'Outro') {
      this.selecionouOutroGenero = true;
      // Limpa o valor para que o usuário possa digitar
      this.cliente.genero = '';
    } else {
      this.selecionouOutroGenero = false;
      this.cliente.genero = event;
    }
  }

  // -----------------------------------------------

  // ---------- Lógica "Outro" para Tipo de Negócio ----------
  aoTrocarTipoNegocio(valor: string) {
    if (valor === 'Outro') {
      this.selecionouOutroTipoNegocio = true;
      this.cliente.tipoNegocio = ''; // limpa para digitação
    } else {
      this.selecionouOutroTipoNegocio = false;
      this.cliente.tipoNegocio = valor;
    }
  }

  // ---------- Lógica "Outro" para Onde Vende ----------
  aoTrocarOndeVende(valor: string) {
    if (valor === 'Outro') {
      this.selecionouOutroOndeVende = true;
      this.cliente.ondeVende = ''; // limpa para digitação
    } else {
      this.selecionouOutroOndeVende = false;
      this.cliente.ondeVende = valor;
    }
  }

  atualizarMunicipios() {
    const estado = this.cliente.estado ?? '';
    this.municipios = estado
      ? (municipiosNorte as any)[estado] || []
      : [];

    if (!this.municipios.includes(this.cliente.cidade ?? '')) {
      this.cliente.cidade = '';
    }
  }

private isEmailValido(v?: string): boolean {
  return !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

private isDDDValido(ddd: string): boolean {
  const n = Number(ddd);
  return [
    11,12,13,14,15,16,17,18,19,
    21,22,24,27,28,
    31,32,33,34,35,37,38,
    41,42,43,44,45,46,47,48,49,
    51,53,54,55,
    61,62,63,64,65,66,67,68,69,
    71,73,74,75,77,79,
    81,82,83,84,85,86,87,88,89,
    91,92,93,94,95,96,97,98,99
  ].includes(n);
}

/** Converte BR -> E.164. Ex.: "91 98888-7777" => "5591988887777" */
private toE164BR(raw: any): string | null {
  let digits = String(raw ?? '').replace(/\D/g, '');

  // remove DDI duplicado (ex.: 5591...)
  if (digits.startsWith('55') && digits.length > 13) digits = digits.slice(2);

  // precisa ter exatamente 11 dígitos (DDD2 + CELULAR9 começando com 9)
  if (digits.length !== 11) return null;

  const ddd = digits.slice(0, 2);
  const assinante = digits.slice(2);

  if (!this.isDDDValido(ddd)) return null;
  if (!assinante.startsWith('9')) return null; // exige celular

  return `55${ddd}${assinante}`;
}

private abrirWhatsAppE164(e164: string, nome?: string) {
  const msg = encodeURIComponent(
    `Olá${nome ? ' ' + nome : ''}, bem-vindo(a) à CRENORTE! Seu cadastro foi concluído com sucesso.`
  );
  const url = `https://wa.me/${e164}?text=${msg}`;
  window.open(url, '_blank');
}

/** Envia e-mail via EmailJS (só se e-mail válido) */
private async enviarEmailBemVindo(): Promise<void> {
  if (!this.isEmailValido(this.cliente?.email)) return;

  const templateParams = {
    to_email: this.cliente.email,
    to_name: this.cliente.nomeCompleto || 'Cliente',
    from_name: 'CRENORTE',
    reply_to: 'contato@crenorte.com.br',
    subject: 'Bem-vindo(a) à CRENORTE',
    message: `Olá ${this.cliente.nomeCompleto || ''}, seu cadastro foi concluído com sucesso.`
  };

  try {
    const res = await emailjs.send(
      'service_nsgoz87',
      'template_7sabbwk',
      templateParams,
      'bWkGEOvHh11MNlZi9'
    );
    console.log('E-mail enviado!', res.status, res.text);
  } catch (err) {
    const e = err as EmailJSResponseStatus;
    console.error('Erro ao enviar e-mail:', e?.status, e?.text);
    // Dica: se 422, confira os nomes de variáveis no template do EmailJS
  }
}





  converterMoedaParaNumero(valor: any): number {
    if (!valor) return 0;
    return parseFloat(valor.toString().replace(/\./g, '').replace(',', '.'));
  }

  validarCPF(cpf: string): boolean {
    if (!cpf) return false;
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    let soma = 0;
    let resto;

    for (let i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10))) return false;

    soma = 0;
    for (let i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(10, 11))) return false;

    return true;
  }

  // Renomeado para evitar conflito
  limparFormularioCadastro() {
    this.cliente = this.novoCliente();
    this.municipios = [];
    this.cpfValido = null;

    // reseta selects de data
    this.anoSelecionado = null;
    this.mesSelecionado = null;
    this.diaSelecionado = null;
    this.atualizarDias();

    // reseta lógica "Outro"
    this.selecionouOutroTipoNegocio = false;
    this.selecionouOutroOndeVende = false;
  }

  private novoCliente(): Cliente {
    return {
      nomeCompleto: '',
      cpf: '',
      rg: '',
      genero: '',
      estadoCivil: '',
      dataNascimento: '',
      contato: '',
      email: '',
      endereco: '',
      bairro: '',
      cidade: '',
      estado: '',
      jaEmpreende: false,
      tipoNegocio: '',
      ondeVende: '',
      faturamentoMensal: '',
      tempoEmpreendimento: '',
      ocupacaoAtual: '',
      outraRenda: false,
      rendaMensal: '',
      valorSolicitado: '',
      parcelas: '',
      usoValor: '',
      clienteCrenorte: false,
      dataPreenchimento: '',
      autorizacaoUsoDados: false,
      valorParcela: '',
      emprestimoAtivo: false,
      instituicaoEmprestimo: ''
    };
  }

  parcelas: number[] = Array.from({ length: 12 }, (_, i) => i + 1);


  jurosMes = 0.0275; // 2,75% a.m.
  valorSolicitadoNumber = 0;

  // lista para popular o select com labels prontos
  parcelasComValor: { n: number; label: string; valorParcela: number }[] = [];

  resumoParcela = '';

  // quando valor muda
  onValorChange(raw: any) {
    this.valorSolicitadoNumber = this.parseMoedaBR(raw);
    this.atualizarParcelasLabels();
    this.atualizarResumo();
  }

  // quando nº de parcelas muda
  onParcelasChange(n: number) {
    this.atualizarResumo();
  }

  // gera a lista [ {n:1,label:"1x de R$..."} ... ]
  atualizarParcelasLabels() {
    this.parcelasComValor = this.parcelas.map(n => {
      const v = this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
      return {
        n,
        valorParcela: v,
        label: `${n}x de ${this.formatBRL(v)}`
      };
    });
  }



  atualizarResumo() {
    const n = Number(this.cliente?.parcelas || 0);
    if (!n || !this.valorSolicitadoNumber) {
      this.resumoParcela = '';
      return;
    }
    const pmt = this.calcularParcela(this.valorSolicitadoNumber, n, this.jurosMes);
    const total = pmt * n;
    this.resumoParcela = `${n}x de ${this.formatBRL(pmt)} • Total: ${this.formatBRL(total)}`;
  }

  // Fórmula PRICE
  calcularParcela(pv: number, n: number, i: number): number {
    if (!pv || !n || !i) return 0;
    const fator = i / (1 - Math.pow(1 + i, -n));
    return pv * fator;
  }

  // Converte moeda pt-BR para number
  parseMoedaBR(v: any): number {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    const s = String(v).replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
  }

  // Formata number em R$ BRL
  formatBRL(v: number): string {
    if (!isFinite(v)) v = 0;
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // variáveis EXCLUSIVAS desta data
  diaPre: number | '' = '';
  mesPre: number | '' = '';
  anoPre: number | '' = '';

  atualizarDataPreenchimento() {
    const d = Number(this.diaPre);
    const m = Number(this.mesPre);
    const a = Number(this.anoPre);

    if (!d || !m || !a) {
      this.cliente.dataPreenchimento = '';
      return;
    }

    const dd = String(d).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    this.cliente.dataPreenchimento = `${a}-${mm}-${dd}`; // formato YYYY-MM-DD
  }

  async salvar() {
  // Sincroniza data de nascimento antes de validar
  this.atualizarDataNascimento();

  const cpfLimpo = (this.cliente.cpf ?? '').replace(/\D/g, '');

  if (!this.validarCPF(cpfLimpo)) {
    alert('⚠️ CPF inválido. Corrija antes de salvar.');
    return;
  }

  // Telefone: valida e já transforma para E.164 (exige CELULAR com DDD)
  const e164 = this.toE164BR(this.cliente?.contato);
  if (!e164) {
    alert('⚠️ Informe um CELULAR com DDD válido (ex.: 91 9XXXX-XXXX).');
    return;
  }

  // Data de nascimento (se informada)
  if (this.cliente.dataNascimento) {
    const [a, m, d] = this.cliente.dataNascimento.split('-').map(v => parseInt(v, 10));
    if (!this.isDataValida(a, m, d)) {
      alert('⚠️ Data de nascimento inválida.');
      return;
    }
  }

  // Conversões numéricas
  const rendaMensal     = this.converterMoedaParaNumero(this.cliente.rendaMensal);
  const valorSolicitado = this.converterMoedaParaNumero(this.cliente.valorSolicitado);
  const valorParcela    = this.converterMoedaParaNumero(this.cliente.valorParcela);

  try {
    // Persiste
    await setDoc(doc(db, 'clientes', cpfLimpo), {
      ...this.cliente,
      cpf: cpfLimpo,
      rendaMensal,
      valorSolicitado,
      valorParcela
    });

    // Dispara comunicações (não bloqueia o fluxo do usuário)
    this.enviarEmailBemVindo();                // envia e-mail se e-mail válido
    this.abrirWhatsAppE164(e164, this.cliente?.nomeCompleto); // abre conversa no WhatsApp

    alert('✅ Cliente salvo com sucesso!');
    this.limparFormularioCadastro();

  } catch (error) {
    console.error('Erro ao salvar cliente:', error);
    alert('❌ Falha ao salvar cliente.');
  }
}


}
