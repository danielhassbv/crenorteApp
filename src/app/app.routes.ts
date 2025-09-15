import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { roleGuard } from './guards/role.guard';
import type { Papel } from './models/colaborador.model';
import { AgendamentosListaComponent } from './pages/agendamentos/agendamentos-lista/agendamentos-lista.component';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.component').then(m => m.LoginComponent),
  },
  { path: 'agendamentos', component: AgendamentosListaComponent },
  {
    path: 'acesso-negado',
    loadComponent: () =>
      import('./pages/acesso-negado/acesso-negado.component').then(m => m.AcessoNegadoComponent),
  },
  // src/app/app.routes.ts
  { path: 'organograma', loadComponent: () => import('./pages/hierarquia-colaboradores/hierarquia-colaboradores.component').then(m => m.HierarquiaColaboradoresComponent) },


  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/home/home.component').then(m => m.HomeComponent),
  },

  {
    path: 'aprovacoes',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin'] as Papel[] },
    loadComponent: () =>
      import('./pages/aprovacoes/aprovacoes.component').then(m => m.AprovacoesComponent),
  },

  // === PRÉ-CADASTRO ===
  {
    path: 'pre-cadastro/novo',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor', 'supervisor', 'analista'] as Papel[] },
    loadComponent: () =>
      import('./pages/pre-cadastro/pre-cadastro-form/pre-cadastro-form.component').then(m => m.PreCadastroFormComponent),
  },
  {
    path: 'pre-cadastro/minha-lista',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor', 'supervisor', 'analista'] as Papel[] },
    loadComponent: () =>
      import('./pages/pre-cadastro/pre-cadastro-lista/pre-cadastro-lista.component').then(m => m.PreCadastroListaComponent),
  },
  {
    path: 'pre-cadastro/relatorio',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin'] as Papel[] },
    loadComponent: () =>
      import('./pages/pre-cadastro/pre-cadastro-relatorio/pre-cadastro-relatorio.component').then(m => m.PreCadastroRelatorioComponent),
  },
  {
    path: 'pre-cadastros',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['operacional', 'admin'] as Papel[] },
    title: 'Todos os Pré-cadastros',
    loadComponent: () =>
      import('./pages/listagem-pre-cadastros/listagem-pre-cadastros.component')
        .then(m => m.ListagemPreCadastrosComponent),
  },

  // === TRIAGEM (Operacional) ===
  {
    path: 'pre-cadastro/triagem',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['operacional', 'admin'] as Papel[] },
    loadComponent: () =>
      import('./pages/triagem/triagem-pre-cadastros/triagem-pre-cadastros.component')
        .then(m => m.TriagemPreCadastrosComponent),
  },

  // === Cadastros ===
  {
    path: 'listagem',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin'] as Papel[] },
    loadComponent: () =>
      import('./pages/listagem-cadastros/listagem-cadastros.component').then(m => m.ListagemCadastrosComponent),
  },

  {
    path: 'lista-cadastros',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor'] as Papel[] },
    loadComponent: () =>
      import('./pages/lista-cadastros/lista-cadastros.component').then(m => m.ListaCadastrosComponent),
  },
  {
    path: 'cadastro/novo',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor'] as Papel[] },
    loadComponent: () =>
      import('./pages/cadastro-form/cadastro-form.component').then(m => m.CadastroFormComponent),
  },
  {
    path: 'cadastro',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor'] as Papel[] },
    loadComponent: () =>
      import('./pages/cadastro-form/cadastro-form.component').then(m => m.CadastroFormComponent),
  },
  {
    path: 'relatorio-cadastros',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin'] as Papel[] },
    loadComponent: () =>
      import('./pages/relatorio-cadastros/relatorio-cadastros.component').then(m => m.RelatorioCadastrosComponent),
  },


  // === Grupos Solidários ===
  {
    path: 'grupos/novo',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor'] as Papel[] },
    loadComponent: () =>
      import('./pages/grupos/grupo-novo/grupo-novo.component').then(m => m.GrupoNovoComponent),
  },
  {
    path: 'grupos/relatorio',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'controle_qualidade'] as Papel[] },
    loadComponent: () =>
      import('./pages/grupos/grupos-relatorio/grupos-relatorio.component').then(m => m.GruposRelatorioComponent),
  },

  // === Internos ===
  {
    path: 'rotas',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin'] as Papel[] },
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

  { path: '**', redirectTo: 'dashboard' },
];
