// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { roleGuard } from './guards/role.guard';
import type { Papel } from './models/colaborador.model';

export const routes: Routes = [
  // Redireciona raiz para o dashboard
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

  // Público
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'acesso-negado',
    loadComponent: () =>
      import('./pages/acesso-negado/acesso-negado.component').then(m => m.AcessoNegadoComponent),
  },

  // Dashboard (Home) — autenticado
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/home/home.component').then(m => m.HomeComponent),
  },

  // Aprovações (analistas/supervisores/admin)
  {
    path: 'aprovacoes',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'supervisor', 'analista'] as Papel[] },
    loadComponent: () =>
      import('./pages/aprovacoes/aprovacoes.component').then(m => m.AprovacoesComponent),
  },

  // === PRÉ-CADASTRO ===
  {
    path: 'pre-cadastro/novo',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['assessor'] as Papel[] },
    loadComponent: () =>
      import('./pages/pre-cadastro/pre-cadastro-form/pre-cadastro-form.component').then(m => m.PreCadastroFormComponent),
  },
  {
    path: 'pre-cadastro/minha-lista',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['assessor'] as Papel[] },
    loadComponent: () =>
      import('./pages/pre-cadastro/pre-cadastro-lista/pre-cadastro-lista.component').then(m => m.PreCadastroListaComponent),
  },
  {
    // Relatório de pré-cadastro (visão pode variar por papel dentro do componente)
    path: 'pre-cadastro/relatorio',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'supervisor', 'assessor'] as Papel[] },
    loadComponent: () =>
      import('./pages/pre-cadastro/pre-cadastro-relatorio/pre-cadastro-relatorio.component').then(m => m.PreCadastroRelatorioComponent),
  },

  // === Cadastros ===
  {
    path: 'listagem',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor', 'supervisor', 'coordenador'] as Papel[] },
    loadComponent: () =>
      import('./pages/listagem-cadastros/listagem-cadastros.component').then(m => m.ListagemCadastrosComponent),
  },
  {
    path: 'cadastro/novo',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor', 'supervisor', 'coordenador'] as Papel[] },
    loadComponent: () =>
      import('./pages/cadastro-form/cadastro-form.component').then(m => m.CadastroFormComponent),
  },
  {
    // Compatibilidade com acessos antigos
    path: 'cadastro',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor', 'supervisor', 'coordenador'] as Papel[] },
    loadComponent: () =>
      import('./pages/cadastro-form/cadastro-form.component').then(m => m.CadastroFormComponent),
  },

  // === Grupos Solidários ===
{
  path: 'grupos/novo',
  canActivate: [authGuard, roleGuard],
  data: { roles: ['admin', 'supervisor', 'analista'] as Papel[] },
  loadComponent: () => import('./pages/grupos/grupo-novo/grupo-novo.component').then(m => m.GrupoNovoComponent),
},
{
  path: 'grupos/relatorio',
  canActivate: [authGuard, roleGuard],
  data: { roles: ['admin', 'controle_qualidade'] as Papel[] },
  loadComponent: () => import('./pages/grupos/grupos-relatorio/grupos-relatorio.component').then(m => m.GruposRelatorioComponent),
},


  // === Outros módulos internos ===
  {
    path: 'rotas',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'operacional', 'supervisor', 'coordenador'] as Papel[] },
    loadComponent: () =>
      import('./components/mapa-rotas-heatmap/mapa-rotas-heatmap.component').then(m => m.MapaRotasHeatmapComponent),
  },
  {
    path: 'colaboradores',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'rh'] as Papel[] },
    loadComponent: () =>
      import('./pages/colaboradores/colaboradores.component').then(m => m.ColaboradoresComponent),
  },

  // Painéis
  {
    path: 'painel-produtos',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'supervisor', 'coordenador'] as Papel[] },
    loadComponent: () =>
      import('./pages/painel-produtos/painel-produtos.component').then(m => m.PainelProdutosComponent),
  },
  {
    path: 'painel-clientes',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor', 'supervisor', 'coordenador'] as Papel[] },
    loadComponent: () =>
      import('./pages/painel-clientes/painel-clientes.component').then(m => m.PainelClientesComponent),
  },

  // Fallback
  { path: '**', redirectTo: 'dashboard' },
];
