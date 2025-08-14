import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Cliente } from '../../models/cliente.model';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  collection,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  doc,
  addDoc,
  updateDoc
} from 'firebase/firestore';
import { db } from '../../firebase.config';

@Component({
  selector: 'app-listagem-cadastros',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './listagem-cadastros.component.html',
})
export class ListagemCadastrosComponent implements OnInit {
  clientes: (Cliente & { id: string })[] = [];
  clientesPaginados: (Cliente & { id: string })[] = [];
  filtro = { nome: '', cidade: '', empreende: '', crenorte: '' };
  campoOrdenado = '';
  ordemCrescente = true;
  clientesPorPagina = 10;
  paginaAtual = 1;
  linksWhatsapp: { nome: string; numero: string; url: string }[] = [];

  async ngOnInit(): Promise<void> {
    await this.buscarClientes();
  }

  async buscarClientes() {
    try {
      const q = query(collection(db, 'clientes'), orderBy('nomeCompleto'));
      const snapshot = await getDocs(q);
      this.clientes = snapshot.docs.map(d => {
        const dados = d.data() as Cliente;
        return { id: d.id, ...dados };
      });
      this.atualizarListagem();
    } catch (error) {
      console.error('❌ Erro ao buscar clientes no Firestore:', error);
      alert('Erro ao carregar os cadastros do Firebase.');
    }
  }

  importarDoExcel(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const dados: any[] = XLSX.utils.sheet_to_json(sheet);

      if (!dados.length) {
        alert('❌ A planilha está vazia ou com cabeçalhos incorretos.');
        return;
      }

      const colecao = collection(db, 'clientes');
      try {
        for (const linha of dados) {
          await addDoc(colecao, {
            nomeCompleto: linha['Nome'] || '',
            cpf: linha['CPF'] || '',
            valorSolicitado: Number(linha['Valor Solicitado']) || 0,
            parcelas: linha['Parcelar De'] || '',
            email: linha['Email'] || '',
            dataNascimento: linha['Data de Nascimento'] || '',
            contato: linha['Contato'] || '',
            rg: linha['RG'] || '',
            endereco: linha['Endereço'] || '',
            bairro: linha['Bairro'] || '',
            cidade: linha['Cidade'] || '',
            estado: linha['Estado'] || '',
            jaEmpreende: (linha['Empreender?'] || '').toLowerCase().includes('sim'),
            tipoNegocio: linha['Tipo de Negócio'] || '',
            ondeVende: linha['Onde Vende'] || '',
            ocupacaoAtual: linha['Ocupação Atual'] || '',
            outraRenda: (linha['Outra Renda?'] || '').toLowerCase().includes('sim'),
            rendaMensal: Number(linha['Renda Mensal']) || 0,
            dataPrimeiraParcela: linha['Data 1ª Parcela'] || '',
            usoValor: linha['Uso do Valor'] || '',
            clienteCrenorte: (linha['Cliente Crenorte?'] || '').toLowerCase().includes('sim'),
            dataPreenchimento: linha['Data Preenchimento'] || '',
            autorizacaoUsoDados: (linha['Autoriza Dados?'] || '').toLowerCase().includes('sim')
          });
        }
        alert('✅ Todos os dados foram importados com sucesso!');
      } catch (error) {
        console.error('❌ Erro ao salvar dados:', error);
        alert('Erro ao importar dados do Excel.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  exportarContatos() {
    const contatos = this.clientes.map((c) => ({
      Nome: c.nomeCompleto,
      Telefone: c.contato || 'Não informado',
    }));
    if (!contatos.length) {
      alert('Não há contatos para exportar.');
      return;
    }
    const worksheet = XLSX.utils.json_to_sheet(contatos);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Contatos');
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' });
    saveAs(blob, 'Contatos_Clientes.xlsx');
  }

  gerarMensagensWhatsapp() {
    return this.clientes.map((c) => {
      const numero = (c.contato ?? '').replace(/\D/g, '');
      const nome = (c.nomeCompleto ?? '').split(' ')[0] || 'amigo';
      const mensagem = `Olá ${nome}! 🎉\nAqui é da CRENORTE.\nÉ uma alegria ter você conosco no nosso programa de microcrédito.\n\nEm breve entraremos em contato para explicar como funciona sua linha de crédito e como podemos apoiar o crescimento do seu negócio.\n\nQualquer dúvida, pode responder por aqui mesmo! 🤝`;
      return {
        nome: c.nomeCompleto ?? 'Cliente',
        numero,
        url: `https://wa.me/55${numero}?text=${encodeURIComponent(mensagem)}`,
      };
    });
  }

  get totalPaginas(): number {
    return Math.ceil(this.clientesFiltradosSemPaginacao().length / this.clientesPorPagina) || 1;
  }

  atualizarListagem(): void {
    let resultado = this.clientesFiltradosSemPaginacao();
    if (this.campoOrdenado) {
      resultado.sort((a, b) => {
        const valorA = (a as any)[this.campoOrdenado] || '';
        const valorB = (b as any)[this.campoOrdenado] || '';
        return this.ordemCrescente
          ? String(valorA).localeCompare(String(valorB))
          : String(valorB).localeCompare(String(valorA));
      });
    }
    const inicio = (this.paginaAtual - 1) * this.clientesPorPagina;
    const fim = this.paginaAtual * this.clientesPorPagina;
    this.clientesPaginados = resultado.slice(inicio, fim);
  }

  clientesFiltradosSemPaginacao(): (Cliente & { id: string })[] {
    let resultado = [...this.clientes];
    if (this.filtro.nome)
      resultado = resultado.filter((c) => (c.nomeCompleto ?? '').toLowerCase().includes(this.filtro.nome.toLowerCase()));
    if (this.filtro.cidade)
      resultado = resultado.filter((c) => (c.cidade ?? '').toLowerCase().includes(this.filtro.cidade.toLowerCase()));
    if (this.filtro.empreende)
      resultado = resultado.filter((c) => (c.jaEmpreende ? 'Sim' : 'Não') === this.filtro.empreende);
    if (this.filtro.crenorte)
      resultado = resultado.filter((c) => (c.clienteCrenorte ? 'Sim' : 'Não') === this.filtro.crenorte);
    return resultado;
  }

  ordenarPor(campo: string) {
    if (this.campoOrdenado === campo) {
      this.ordemCrescente = !this.ordemCrescente;
    } else {
      this.campoOrdenado = campo;
      this.ordemCrescente = true;
    }
    this.atualizarListagem();
  }

  irParaPagina(pagina: number) {
    if (pagina >= 1 && pagina <= this.totalPaginas) {
      this.paginaAtual = pagina;
      this.atualizarListagem();
    }
  }

  editarCliente(cpf: string) {
    const cliente = this.clientes.find((c) => (c.cpf ?? c.id) === cpf);
    if (cliente) {
      localStorage.setItem('clienteEditando', JSON.stringify(cliente));
      window.location.href = '/cadastro';
    }
  }

  exportarExcel() {
    const worksheet = XLSX.utils.json_to_sheet(this.clientes);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Clientes');
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' });
    saveAs(blob, 'clientes-crenorte.xlsx');
  }
// ✅ Corrige textos com caracteres corrompidos tipo "Ã£", "Ã©", etc.
corrigirTexto(texto: string): string {
  try {
    return decodeURIComponent(escape(texto));
  } catch {
    return texto;
  }


}
async corrigirCaracteres() {
  const campos = [
    'nomeCompleto',
    'cidade',
    'bairro',
    'endereco',
    'tipoNegocio',
    'ondeVende',
    'ocupacaoAtual'
  ];

  for (const cliente of this.clientes) {
    let alterado = false;
    const clienteCorrigido: any = { ...cliente };

    for (const campo of campos) {
      const original = clienteCorrigido[campo];
      const corrigido = this.corrigirTexto(original);
      if (original !== corrigido) {
        clienteCorrigido[campo] = corrigido;
        alterado = true;
      }
    }

    // 🔧 Força a data de preenchimento
    const novaData = '16/07/2025';
    if (clienteCorrigido.dataPreenchimento !== novaData) {
      clienteCorrigido.dataPreenchimento = novaData;
      alterado = true;
    }

    if (alterado && cliente.id) {
      try {
        const { id, ...semId } = clienteCorrigido;
        await updateDoc(doc(db, 'clientes', cliente.id), semId);
        console.log(`✅ Atualizado: ${clienteCorrigido.nomeCompleto}`);
      } catch (e) {
        console.error(`❌ Falha ao salvar ${clienteCorrigido.nomeCompleto}:`, e);
      }
    }
  }

  alert('✅ Correção de caracteres e data aplicadas com sucesso!');
  await this.buscarClientes();
}


}
