// L'account del giocatore. Per ora non esiste un vero accesso: il nome è fisso e i progressi
// restano nel browser. Quando arriverà l'account, il nome verrà da qui.
export interface Account { name: string }

export function currentAccount(): Account {
  return { name: 'Test' };
}
