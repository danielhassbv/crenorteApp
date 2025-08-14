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

@Component({
  selector: 'app-cadastro-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, NgxMaskDirective],  // 👈 ADICIONE ISTO!],
  templateUrl: './cadastro-form.component.html',
})
export class CadastroFormComponent implements OnInit {
  cliente: Cliente = this.novoCliente();

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
    const clienteEditando = localStorage.getItem('clienteEditando');
    if (clienteEditando) {
      this.cliente = JSON.parse(clienteEditando);
      localStorage.removeItem('clienteEditando');
      this.atualizarMunicipios();
    }
  }

  atualizarMunicipios() {
    const estado = this.cliente.estado ?? '';
    this.municipios = estado
      ? municipiosNorte[estado as keyof typeof municipiosNorte] || []
      : [];

    if (!this.municipios.includes(this.cliente.cidade ?? '')) {
      this.cliente.cidade = '';
    }
  }

  async salvar() {
    const cpfLimpo = (this.cliente.cpf ?? '').replace(/\D/g, '');

    if (!this.validarCPF(cpfLimpo)) {
      alert('⚠️ CPF inválido. Corrija antes de salvar.');
      return;
    }

    if (!this.cliente.contato || (this.cliente.contato ?? '').replace(/\D/g, '').length < 11) {
      alert('⚠️ Informe um telefone válido com DDD.');
      return;
    }

    const rendaMensal = this.converterMoedaParaNumero(this.cliente.rendaMensal);
    const valorSolicitado = this.converterMoedaParaNumero(this.cliente.valorSolicitado);
    const valorParcela = this.converterMoedaParaNumero(this.cliente.valorParcela);

    try {
      await setDoc(doc(db, 'clientes', cpfLimpo), {
        ...this.cliente,
        cpf: cpfLimpo,
        rendaMensal,
        valorSolicitado,
        valorParcela
      });

      alert('✅ Cliente salvo com sucesso no Firebase!');
      this.resetarFormulario();
    } catch (error) {
      console.error('Erro ao salvar cliente:', error);
      alert('❌ Falha ao salvar cliente no Firebase.');
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

  resetarFormulario() {
    this.cliente = this.novoCliente();
    this.municipios = [];
    this.cpfValido = null;
  }

  private novoCliente(): Cliente {
    return {
      nomeCompleto: '',
      cpf: '',
      rg: '',
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
      ocupacaoAtual: '',
      outraRenda: false,
      rendaMensal: '',
      valorSolicitado: '',
      parcelas: '',
      dataPrimeiraParcela: '',
      usoValor: '',
      clienteCrenorte: false,
      dataPreenchimento: '',
      autorizacaoUsoDados: false,
      valorParcela: '',
      emprestimoAtivo: false,
      instituicaoEmprestimo: ''
    };
  }
}
