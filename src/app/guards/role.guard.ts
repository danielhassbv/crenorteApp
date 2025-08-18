import { CanActivateFn, Router, ActivatedRouteSnapshot } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { firstValueFrom } from 'rxjs';

export const roleGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const rolesPermitidos = (route.data?.['roles'] as string[]) ?? [];
  const auth = inject(AuthService);
  const router = inject(Router);

  // 1) Garante que há usuário logado (delegue ao authGuard se quiser, mas aqui é mais robusto)
  const user = await firstValueFrom(auth.firebaseUser$);
  if (!user) return router.parseUrl('/login');

  // 2) Garante que o doc colaboradores/{uid} exista (bootstrap)
  await auth.garantirPerfilMinimo();

  // 3) Pega o papel atual e decide
  const papel = await firstValueFrom(auth.papel$);
  const autorizado = !!papel && rolesPermitidos.includes(papel);

  return autorizado ? true : router.parseUrl('/acesso-negado');
};
