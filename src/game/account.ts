// L'account del giocatore SeedXY.
export interface Account {
  name: string;
  login?: string;
  avatar?: string;
}

export function currentAccount(): Account {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('seedxy.user') : null;
    if (raw) {
      const u = JSON.parse(raw);
      if (u && (u.name || u.login)) {
        return { name: u.name || u.login, login: u.login, avatar: u.avatar };
      }
    }
  } catch {}
  return { name: 'Guardiano' };
}
