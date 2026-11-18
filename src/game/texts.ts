// Testi narrativi IT/EN del turno: messaggi, richieste dei pazienti, battute. Solo dati e piccole funzioni pure.
import type { L10n } from '../core/contracts';
import type { Rng } from '../core/rng';
import { COLLEAGUE } from '../world/names';
import type { Patient, Staff } from '../world/hospital';

export type Item = 'water' | 'blanket' | 'tea' | 'samples';

export const ITEM_NAME: Record<Item, L10n> = {
  water: { it: 'bicchiere d\'acqua', en: 'glass of water' },
  blanket: { it: 'coperta', en: 'blanket' },
  tea: { it: 'camomilla', en: 'chamomile tea' },
  samples: { it: 'provette del laboratorio', en: 'lab samples' },
};

export const L = (it: string, en: string): L10n => ({ it, en });

export const SENDER = {
  colleague: L(`${COLLEAGUE.first} (collega)`, `${COLLEAGUE.first} (colleague)`),
  hq: L('Vigilanza · centrale', 'Security · control room'),
  maint: L('Manutenzione reperibile', 'On-call maintenance'),
  doctor: L('Medico di guardia', 'Doctor on call'),
};

export const nurseSender = (s: Staff, ward: L10n): L10n => L(`${s.first} · ${ward.it}`, `${s.first} · ${ward.en}`);
export const pName = (p: Patient): L10n => L(`${p.sex === 'm' ? 'sig.' : 'sig.ra'} ${p.last}`, `${p.sex === 'm' ? 'Mr' : 'Mrs'} ${p.last}`);
export const pFull = (p: Patient): string => `${p.first} ${p.last}`;

/** Messaggi iniziali: sei stato chiamato a sostituire un collega la notte di Natale. Uguali per ogni seed. */
export const OPENING: { from: L10n; text: L10n }[] = [
  { from: SENDER.colleague, text: L(
    `Ehi, sono ${COLLEAGUE.first}. Grazie, davvero: non sapevo a chi altro chiedere. Stanotte proprio non posso esserci.`,
    `Hey, it's ${COLLEAGUE.first}. Thank you, really: I had no one else to ask. I just can't be there tonight.`) },
  { from: SENDER.colleague, text: L(
    'Di notte al reparto ci sei solo tu. Gli infermieri di guardia stanno al pronto soccorso, giù: se un paziente chiama, vai tu. Sulla pulsantiera: giallo assistenza, rosso urgenza.',
    'At night you\'re the only one on the ward. The nurses on duty are down in A&E: if a patient calls, you go. On the call panel: yellow is help, red is urgent.') },
  { from: SENDER.colleague, text: L(
    'Le telecamere le vedi dal monitor al centro, e puoi girarle. L\'ascensore è lento e la musica non si spegne, fattene una ragione. Buon Natale.',
    'You can see the cameras from the centre monitor, and you can turn them. The lift is slow and the music never stops, just accept it. Merry Christmas.') },
  { from: SENDER.hq, text: L(
    'Turno 22:00–06:00, Ospedale San Nicola, reparto notturno, piani 20–22. Sostituzione registrata. I piani di sotto sono chiusi. Consegne alle 06:00 al bancone dell\'accettazione.',
    'Shift 22:00–06:00, St Nicholas Hospital, night ward, floors 20–22. Substitution logged. The floors below are closed. Handover at 06:00 at the reception desk.') },
];

/** Messaggi del collega durante la notte (la sottotrama). */
export const COLLEAGUE_LATER: L10n[] = [
  L('Mezzanotte quasi. Lì com\'è? Ti ho lasciato un panettone nell\'armadietto, se lo trovi è tuo.', 'Almost midnight. How is it there? I left a panettone in my locker, it\'s yours if you find it.'),
  L('Non riesco a dormire. È la prima notte di Natale in nove anni che non passo lì. Fa strano.', 'Can\'t sleep. First Christmas night in nine years I\'m not there. Feels odd.'),
  L('Quasi l\'alba. Quando arriva il cambio, ricordati di firmare il registro. Ti devo un favore enorme.', 'Nearly dawn. When the morning shift arrives, remember to sign the logbook. I owe you a huge one.'),
];

export const ASSIST_REQ: Record<Exclude<Item, 'samples'>, L10n[]> = {
  water: [L('Mi scusi… potrebbe portarmi un bicchiere d\'acqua? Ho la gola secca.', 'Excuse me… could you bring me a glass of water? My throat is dry.'),
    L('C\'è qualcuno? Avrei tanta sete.', 'Is anyone there? I\'m very thirsty.')],
  blanket: [L('Fa freddo, qui. Avrebbe un\'altra coperta?', 'It\'s cold in here. Could I have another blanket?'),
    L('Mi sono svegliat{o} tremando. Una coperta, per favore.', 'I woke up shivering. A blanket, please.')],
  tea: [L('Non riesco a dormire. Una camomilla, se non è troppo disturbo?', 'I can\'t sleep. A chamomile tea, if it\'s not too much trouble?'),
    L('{Spouse} a Natale mi faceva sempre una camomilla. Me ne porterebbe una?', '{Spouse} always made me chamomile at Christmas. Would you bring me one?')],
};

export const URGENT_REQ: L10n[] = [
  L('Aiuto… sono scivolat{o} giù dal letto. Non riesco ad alzarmi.', 'Help… I slipped out of bed. I can\'t get up.'),
  L('C\'è qualcuno nella stanza. Per favore, venga.', 'There\'s someone in the room. Please, come.'),
  L('Ho fatto un brutto sogno. Venga, la prego, non voglio stare da sol{o}.', 'I had a bad dream. Please come, I don\'t want to be alone.'),
  L('Il campanello… è suonato da solo. Ma adesso che c\'è, può venire?', 'The call bell… it rang by itself. But since it did, could you come?'),
];

export const THANKS: L10n[] = [
  L('Grazie, ragazzo mio. Buon Natale.', 'Thank you, young man. Merry Christmas.'),
  L('Che gentile. Lei non è quello solito, vero?', 'How kind. You\'re not the usual one, are you?'),
  L('Grazie. Lei mi ricorda mio nipote.', 'Thank you. You remind me of my grandson.'),
  L('Ah, grazie. Ora magari riesco a dormire.', 'Ah, thank you. Maybe now I can sleep.'),
];

export const PATIENT_TALK: L10n[] = [
  L('Che ore sono? Qui dentro le notti non finiscono mai.', 'What time is it? In here the nights never end.'),
  L('Sente la musica? La mettono tutti gli anni. Sempre le stesse canzoni.', 'Do you hear the music? They play it every year. Always the same songs.'),
  L('Il guardiano solito passa sempre a mezzanotte a fare gli auguri.', 'The usual guard always comes by at midnight to wish everyone merry Christmas.'),
  L('Fuori nevica ancora? Da qui vedo solo il campanile.', 'Is it still snowing out there? From here I can only see the bell tower.'),
  L('Buon Natale anche a lei. Non è triste lavorare stanotte?', 'Merry Christmas to you too. Isn\'t it sad, working tonight?'),
];

export const URGENT_RESOLVED: L10n[] = [
  L('Aiuti il paziente a rimettersi a letto e sistemi il cuscino.', 'You help the patient back into bed and fix the pillow.'),
  L('Nella stanza non c\'è nessuno. Resti qualche minuto, finché si calma.', 'There\'s nobody in the room. You stay a few minutes, until they calm down.'),
  L('Accendi la luce notturna e resti a parlare un po\'.', 'You switch on the night light and stay to talk for a while.'),
];

export const NURSE_TALK: L10n[] = [
  L('Turno tranquillo, per ora. A Natale mandano a casa tutti quelli che possono.', 'Quiet shift, so far. At Christmas they send home everyone they can.'),
  L('Sei tu il sostituto? Walter non manca mai la notte di Natale. Strano.', 'You\'re the stand-in? Walter never misses Christmas night. Odd.'),
  L('Se ti chiamano dal pulsante rosso, corri. Se è il giallo, di solito è acqua o una coperta.', 'If they call on the red button, run. If it\'s yellow, it\'s usually water or a blanket.'),
  L('La camomilla è nella sala del personale, il bollitore è sul bancone.', 'The chamomile is in the staff room, the kettle\'s on the counter.'),
  L('L\'ascensore a volte si ferma tra un piano e l\'altro. Poi riparte. Più o meno.', 'The lift sometimes stops between floors. Then it starts again. More or less.'),
];

export const RELAY_CALL = (p: Patient, rng: Rng): { caller: L10n; text: L10n; tell: L10n } => {
  const who = rng.pick([L('la figlia', 'the daughter'), L('il nipote', 'the grandson'), L('la sorella', 'the sister'), L('un vecchio amico', 'an old friend')]);
  return {
    caller: who,
    text: L(`Pronto? Sono ${who.it} di ${pFull(p)}, stanza ${p.roomNumber}. Non riesco a passare stanotte… può dirgli che gli voglio bene? E buon Natale.`,
      `Hello? I\'m ${who.en} of ${pFull(p)}, room ${p.roomNumber}. I can\'t come tonight… could you tell them I love them? And merry Christmas.`),
    tell: L(`Le porto un messaggio: ${who.it} le manda tanti auguri e le vuole bene.`, `I have a message: ${who.en} sends their love and wishes you merry Christmas.`),
  };
};

export const LOGBOOK: L10n = L(
  `Registro del turno di notte. Ultima nota, firmata ${COLLEAGUE.first} ${COLLEAGUE.last}: «Tutto regolare. Ricordarsi la ronda nel seminterrato. Non lasciare la radio spenta: ai pazienti fa compagnia.»`,
  `Night shift log. Last entry, signed ${COLLEAGUE.first} ${COLLEAGUE.last}: "All normal. Remember the round in the basement. Don't leave the radio off: it keeps the patients company."`);

export const TREE_LINES: L10n[] = [
  L('Un albero vero: profuma ancora di resina.', 'A real tree: it still smells of resin.'),
  L('Sotto l\'albero ci sono pacchetti vuoti, per bellezza.', 'The parcels under the tree are empty, just for show.'),
  L('Una pallina ha scritto sopra un nome a pennarello. Non riesci a leggerlo.', 'One bauble has a name written on it in marker. You can\'t read it.'),
];

export const VENDING_LINES: L10n[] = [
  L('Il distributore ti dà un caffè lungo e tiepido. Buon Natale anche a te.', 'The machine gives you a long, lukewarm coffee. Merry Christmas to you too.'),
  L('Il distributore inghiotte la moneta e non ti dà niente.', 'The machine swallows the coin and gives you nothing.'),
  L('Esce una barretta al cioccolato. È già mezza sciolta.', 'A chocolate bar drops. It\'s already half melted.'),
];

export const gender = (s: string, sex: 'm' | 'f') => s.replace(/\{o\}/g, sex === 'm' ? 'o' : 'a');
/** Accorda una battuta al paziente che la dice. */
export const gL = (l: L10n, sex: 'm' | 'f'): L10n => ({
  it: gender(l.it, sex).replace(/\{Spouse\}/g, sex === 'm' ? 'Mia moglie' : 'Mio marito'),
  en: l.en.replace(/\{Spouse\}/g, sex === 'm' ? 'My wife' : 'My husband'),
});

export const MIDNIGHT_LINES: L10n[] = [
  L('Buon Natale anche a te, ragazzo. Walter dov\'è?', 'Merry Christmas to you too, lad. Where\'s Walter?'),
  L('Mezzanotte… Senti anche tu le campane? Io le sento da un\'ora.', 'Midnight… Do you hear the bells too? I\'ve been hearing them for an hour.'),
  L('Grazie. Qualcuno è passato prima di te, ma non ha detto niente.', 'Thank you. Someone came by before you, but didn\'t say a word.'),
  L('Buon Natale. Chiuda bene la porta quando esce, per favore.', 'Merry Christmas. Please close the door properly when you leave.'),
];

/** Battute degli eventi insoliti. */
export const GHOST_LINES: { intercom: L10n[]; patient: L10n[]; phone: L10n[] } = {
  intercom: [
    L('… (solo un respiro lento, poi la linea si chiude)', '… (only slow breathing, then the line goes dead)'),
    L('… (qualcuno canticchia una ninna nanna, lontano)', '… (someone hums a lullaby, far away)'),
    L('… (silenzio. Poi, piano: «è tardi»)', '… (silence. Then, softly: "it\'s late")'),
  ],
  patient: [
    L('Io? Non ho chiamato. Dormivo. Ma prima qualcuno è passato davanti alla porta.', 'Me? I didn\'t call. I was asleep. But earlier someone walked past the door.'),
    L('Il campanello? Non l\'ho toccato. Non arrivo neanche a prenderlo.', 'The bell? I didn\'t touch it. I can\'t even reach it.'),
    L('Non sono stat{o} io. È la stanza accanto, forse. Ah no, è vuota.', 'It wasn\'t me. Maybe the room next door. Oh, no, that one\'s empty.'),
  ],
  phone: [
    L('… (un respiro, dall\'altra parte. Poi la linea cade)', '… (breathing, on the other end. Then the line drops)'),
    L('… (si sente la stessa musica di Natale che c\'è qui, solo più lenta)', '… (you hear the same Christmas music that\'s playing here, only slower)'),
    L('… (una voce anziana: «Walter?». Poi niente)', '… (an old voice: "Walter?". Then nothing)'),
  ],
};
