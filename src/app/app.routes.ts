// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { roleGuard } from './guards/role.guard';

export const routes: Routes = [
  // Redireciona raiz para o dashboard (Home)
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

  // Público
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  { path: 'acesso-negado', loadComponent: () => import('./pages/acesso-negado/acesso-negado.component').then(m => m.AcessoNegadoComponent) },

  // Dashboard (Home) — autenticado
  { path: 'dashboard', canActivate: [authGuard], loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },

  // Módulos internos
  {
    path: 'listagem',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor', 'supervisor', 'coordenador'] },
    loadComponent: () => import('./pages/listagem-cadastros/listagem-cadastros.component').then(m => m.ListagemCadastrosComponent),
  },
  {
    path: 'cadastro',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor', 'supervisor', 'coordenador'] },
    loadComponent: () => import('./pages/cadastro-form/cadastro-form.component').then(m => m.CadastroFormComponent),
  },
  {
    path: 'rotas',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'operacional', 'supervisor', 'coordenador'] },
    loadComponent: () => import('./components/mapa-rotas-heatmap/mapa-rotas-heatmap.component').then(m => m.MapaRotasHeatmapComponent),
  },
  {
    path: 'colaboradores',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'rh'] },
    loadComponent: () => import('./pages/colaboradores/colaboradores.component').then(m => m.ColaboradoresComponent),
  },

  // Painéis
  {
    path: 'painel-produtos',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'supervisor', 'coordenador'] },
    loadComponent: () => import('./pages/painel-produtos/painel-produtos.component').then(m => m.PainelProdutosComponent),
  },
  {
    path: 'painel-clientes',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin', 'assessor', 'supervisor', 'coordenador'] },
    loadComponent: () => import('./pages/painel-clientes/painel-clientes.component').then(m => m.PainelClientesComponent),
  },

  // Fallback
  { path: '**', redirectTo: 'dashboard' },
];
