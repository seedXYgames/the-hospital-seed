// Nomi e storie dei personaggi. Tutto inventato, combinato dal seed.
import type { L10n } from '../core/contracts';
import type { Rng } from '../core/rng';

export const MALE_FIRST = ['Giuseppe', 'Antonio', 'Giovanni', 'Mario', 'Luigi', 'Franco', 'Bruno', 'Sergio', 'Renato', 'Aldo', 'Ettore', 'Gino', 'Vittorio', 'Armando', 'Ugo', 'Dante', 'Elio', 'Pietro', 'Carlo', 'Nello'];
export const FEMALE_FIRST = ['Maria', 'Anna', 'Giuseppina', 'Rosa', 'Teresa', 'Lucia', 'Carmela', 'Angela', 'Franca', 'Ida', 'Wanda', 'Elsa', 'Gemma', 'Ines', 'Rita', 'Agnese', 'Bruna', 'Nives', 'Lina', 'Iolanda'];
export const NURSE_FIRST = ['Sara', 'Giulia', 'Elena', 'Marta', 'Chiara', 'Paola', 'Davide', 'Luca', 'Federica', 'Silvia', 'Matteo', 'Irene'];
export const LAST_NAMES = ['Rossi', 'Bianchi', 'Ferri', 'Marchetti', 'Galli', 'Conti', 'Mancini', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Testa', 'Cattaneo', 'Pellegrini', 'Palumbo', 'Sartori', 'Bellini', 'Gentile', 'Martinelli', 'Grassi', 'Valentini', 'Orlando', 'Bassi', 'Neri', 'Riva'];

/** Il collega che il guardiano sostituisce stanotte (uguale per ogni seed). */
export const COLLEAGUE = { first: 'Walter', last: 'Ferri' };
export const GUARD = { first: 'Nicola', last: 'Sereni' };

type Pair = [it: string, en: string];
type GPair = [itM: string, itF: string, en: string];

const JOBS: GPair[] = [
  ['ferroviere sulla linea di montagna', 'casellante sulla linea di montagna', 'worked on the mountain railway'],
  ['maestro elementare', 'maestra elementare', 'taught primary school'],
  ['fornaio in centro', 'fornaia in centro', 'ran a bakery in town'],
  ['sarto', 'sarta', 'was a tailor'],
  ['organista della parrocchia', 'organista della parrocchia', 'played the organ at the parish church'],
  ['custode del cimitero', 'custode del cimitero', 'kept the cemetery'],
  ['infermiere proprio qui, negli anni Settanta', 'infermiera proprio qui, negli anni Settanta', 'was a nurse right here in the seventies'],
  ['orologiaio', 'orologiaia', 'repaired clocks'],
  ['proiezionista al vecchio cinema', 'cassiera al vecchio cinema', 'worked at the old cinema'],
  ['guardiano notturno della fabbrica', 'telefonista del centralino', 'worked nights at the factory'],
];
const FAMILY: Pair[] = [
  ['I figli vivono all\'estero e stanotte non sono potuti venire.', 'The children live abroad and could not come tonight.'],
  ['Nessuno è passato a trovarl{o} oggi.', 'Nobody came to visit today.'],
  ['La nipote ha promesso di chiamare dopo la messa di mezzanotte.', 'A granddaughter promised to call after midnight mass.'],
  ['È rimast{o} sol{o} da quando il fratello è morto, tre inverni fa.', 'Has been alone since a brother died, three winters ago.'],
  ['Il coniuge è ricoverato in un altro reparto, al piano di sopra o di sotto: nessuno sa dire quale.', 'The spouse is on another ward, upstairs or downstairs: nobody can say which.'],
  ['Ogni sera chiede se è arrivata posta.', 'Asks every evening whether any post has come.'],
];
const QUIRK: Pair[] = [
  ['Tiene sul comodino una cartolina di Natale senza firma.', 'Keeps an unsigned Christmas card on the bedside table.'],
  ['Canticchia sempre la stessa canzone, ma non ricorda le parole.', 'Always hums the same tune, but cannot remember the words.'],
  ['Dice di non dormire mai la notte di Natale.', 'Says they never sleep on Christmas night.'],
  ['Chiede di lasciare la porta socchiusa e la luce del corridoio accesa.', 'Asks for the door to be left ajar and the corridor light on.'],
  ['Conta i passi di chi passa in corridoio.', 'Counts the footsteps of whoever walks down the corridor.'],
  ['Giura che da giovane ha già passato una notte in questo ospedale, quando era ancora un convento.', 'Swears they spent a night in this building as a youngster, back when it was still a convent.'],
  ['Ha chiesto un orologio da muro: dice che quello della stanza va indietro.', 'Asked for a wall clock: says the one in the room runs slow.'],
];
const REASON: Pair[] = [
  ['una frattura al femore', 'a broken hip'], ['una polmonite', 'pneumonia'], ['un intervento al cuore', 'heart surgery'],
  ['controlli dopo una caduta', 'tests after a fall'], ['scompenso cardiaco', 'heart failure'], ['un\'operazione all\'anca', 'a hip operation'],
];

const g = (s: string, sex: 'm' | 'f') => s.replace(/\{o\}/g, sex === 'm' ? 'o' : 'a');

export function patientStory(rng: Rng, sex: "m" | "f", _age: number): { story: L10n; reason: L10n } {
  const job = rng.pick(JOBS), fam = rng.pick(FAMILY), q = rng.pick(QUIRK), why = rng.pick(REASON);
  const years = rng.int(25, 45);
  const it = `Per ${years} anni è ${sex === 'm' ? 'stato' : 'stata'} ${sex === 'm' ? job[0] : job[1]}. ${g(fam[0], sex)} ${g(q[0], sex)}`;
  const en = `For ${years} years ${sex === 'm' ? 'he' : 'she'} ${job[2]}. ${fam[1]} ${q[1]}`;
  return { story: { it, en }, reason: { it: why[0], en: why[1] } };
}

type GT = [itM: string, itF: string, en: string];
const CHARACTER: GT[] = [
  ['burbero ma gentile con chi lo ascolta', 'burbera ma gentile con chi la ascolta', 'gruff, but kind to anyone who listens'],
  ['silenzioso, osserva tutto', 'silenziosa, osserva tutto', 'quiet, watches everything'],
  ['chiacchierone, racconta sempre la stessa storia', 'chiacchierona, racconta sempre la stessa storia', 'talkative, always tells the same story'],
  ['diffidente con gli sconosciuti', 'diffidente con gli sconosciuti', 'wary of strangers'],
  ['ironico, scherza anche sul suo ricovero', 'ironica, scherza anche sul suo ricovero', 'wry, jokes even about being in hospital'],
  ['dolce, un po\' smemorato', 'dolce, un po\' smemorata', 'sweet, a little forgetful'],
  ['testardo, non vuole mai disturbare', 'testarda, non vuole mai disturbare', 'stubborn, never wants to be a bother'],
  ['inquieto di notte, sereno di giorno', 'inquieta di notte, serena di giorno', 'restless at night, calm by day'],
];
const CURIOSITY: [string, string][] = [
  ['Tiene le pantofole sempre allineate sotto il letto.', 'Always keeps their slippers lined up under the bed.'],
  ['Ha chiesto di non spostare il letto: «deve guardare la porta».', 'Asked for the bed not to be moved: "it has to face the door".'],
  ['Conosce a memoria gli orari dei treni del 1970.', 'Knows the 1970 train timetable by heart.'],
  ['Fa le parole crociate a penna, senza mai sbagliare.', 'Does crosswords in pen and never gets one wrong.'],
  ['Saluta ogni sera qualcuno alla finestra. Fuori non c\'è nessuno.', 'Waves goodnight to someone at the window every evening. There is nobody outside.'],
  ['Ha portato da casa un carillon che suona Stille Nacht.', 'Brought a music box from home that plays Silent Night.'],
  ['Non vuole la luce spenta: «al buio i corridoi si allungano».', 'Won\'t have the light off: "in the dark the corridors get longer".'],
  ['Da giovane ha vinto un concorso di ballo liscio.', 'Won a ballroom dancing contest as a youngster.'],
  ['Chiede sempre che giorno è, poi dice che lo sapeva già.', 'Always asks what day it is, then says they already knew.'],
  ['Ha una foto di famiglia sul comodino, ma non dice chi sono.', 'Has a family photo on the bedside table, but won\'t say who they are.'],
  ['Al posto della firma disegna una piccola stella.', 'Draws a little star instead of signing their name.'],
  ['Sostiene di aver lavorato alla costruzione di questa torre.', 'Claims to have worked on building this tower.'],
];

export function patientDossier(rng: Rng, sex: 'm' | 'f', age: number): { born: { d: number; m: number; y: number }; character: L10n; curiosities: L10n[]; face: number } {
  // nato prima del 24 dicembre, così l'età torna con la data di stanotte
  const m = rng.int(1, 12), d = rng.int(1, m === 12 ? 24 : 28);
  const c = rng.pick(CHARACTER);
  const pool = rng.shuffle([...CURIOSITY]).slice(0, 2);
  return {
    born: { d, m, y: 2026 - age },
    character: { it: sex === 'm' ? c[0] : c[1], en: c[2] },
    curiosities: pool.map((x) => ({ it: x[0], en: x[1] })),
    face: rng.int(0, 1_000_000),
  };
}
