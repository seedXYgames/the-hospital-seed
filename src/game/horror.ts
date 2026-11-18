// Il lato psicologico della notte: i pensieri del guardiano (letti dal narratore), il paziente che
// non c'è più, la stanza da cui nessuno può chiamare, il Babbo Natale che cambia posto.
// Solo testi e piccole regole pure: la logica sta in shift.ts.
import type { L10n } from '../core/contracts';
import type { Patient } from '../world/hospital';

const L = (it: string, en: string): L10n => ({ it, en });

/** Pensieri del guardiano, in prima persona: li legge la voce del narratore. */
export const THINK = {
  start: L('Walter mi ha lasciato le chiavi, un biglietto e la sua torcia. Ventidue piani sopra la città, la notte di Natale. Poteva andare peggio.', 'Walter left me the keys, a note and his torch. Twenty-two floors above the city, on Christmas night. Could be worse.'),
  courtesy: L('Mezzanotte. Si abbassano le luci, per far dormire i pazienti. La musica continua.', 'Midnight. The lights dim so the patients can sleep. The music keeps going.'),
  blackout: L('Buio. Restano solo le luci rosse d\'emergenza. E il ronzio del generatore, da qualche parte.', 'Darkness. Only the red emergency lights are left. And the hum of the generator, somewhere.'),
  torchLow: L('La torcia comincia a tremare. Le pile sono quasi andate.', 'The torch is starting to flicker. The batteries are almost gone.'),
  torchDead: L('La torcia si è spenta. Le pile di ricambio stanno nel deposito della strumentazione, o in ambulatorio.', 'The torch has died. Spare batteries are kept in the equipment store, or in the treatment room.'),
  batteries: L('Pile nuove. Ne prendo un paio di ricambio, non si sa mai.', 'Fresh batteries. I\'ll take a couple of spares, just in case.'),
  swap: L('Pile cambiate.', 'Batteries changed.'),
  fallHeard: L('Un tonfo. Come qualcosa di pesante che cade sul pavimento.', 'A thud. Like something heavy falling on the floor.'),
  helpUp: L('Piano, piano. La tengo io. Torniamo a letto.', 'Easy, easy. I\'ve got you. Back to bed.'),
  rooms: {
    chapel: L('La cappellina. Qualcuno ha acceso i ceri. Stanotte non dovrebbe esserci nessuno.', 'The chapel. Someone has lit the candles. Nobody should be here tonight.'),
    waiting: L('Il soggiorno. La televisione è spenta, ma lo schermo sembra ancora caldo.', 'The day room. The television is off, but the screen still looks warm.'),
    storage: L('Il deposito. Carrozzine vuote, tutte girate verso la porta.', 'The store room. Empty wheelchairs, all turned towards the door.'),
    vacant: L('Una stanza vuota. I letti rifatti, tirati come un tamburo.', 'An empty room. The beds made, tight as a drum.'),
    linen: L('Odore di bucato e di candeggina. Le lenzuola piegate sembrano bende.', 'A smell of laundry and bleach. The folded sheets look like bandages.'),
    electrical: L('Il quadro elettrico. Se salta qualcosa, è qui che devo venire.', 'The electrical panel. If something trips, this is where I come.'),
    staff: L('Il cucinino. Un panettone aperto, una tazza ancora tiepida. Di chi?', 'The kitchenette. An open panettone, a mug still lukewarm. Whose?'),
  } as Record<string, L10n>,
  presepe: [
    L('Il presepe. Manca il Bambinello: lo mettono a mezzanotte.', 'The nativity scene. The baby Jesus is missing: they put it in at midnight.'),
    L('Adesso il Bambinello c\'è. Qualcuno è passato di qui a mezzanotte.', 'Now the baby Jesus is there. Someone came by at midnight.'),
    L('Le statuine sono girate. Non guardano più la mangiatoia: guardano la porta. Guardano me.', 'The figurines have turned. They\'re no longer looking at the manger: they\'re looking at the door. At me.'),
  ],
  gift: L('C\'è un biglietto: «Per Nicola». Nessuno sapeva che stanotte c\'ero io.', 'There\'s a tag: "For Nicola". Nobody knew I\'d be here tonight.'),
  advent: L('Il calendario dell\'Avvento. Tutte le finestrelle aperte, tranne la venticinque. Dietro la carta qualcosa gratta.', 'The Advent calendar. Every little door is open except twenty-five. Something is scratching behind the paper.'),
  santa: [
    L('Un Babbo Natale di plastica, grande come un uomo. Gli occhi sono dipinti. Credo.', 'A plastic Father Christmas, as big as a man. The eyes are painted on. I think.'),
    L('Il Babbo Natale del soggiorno. Prima non era qui.', 'The Father Christmas from the day room. It wasn\'t here before.'),
    L('È solo plastica. È solo plastica. Ma è girato verso di me.', 'It\'s just plastic. Just plastic. But it\'s turned towards me.'),
  ],
  santaMoved: L('Prima non era qui. Ne sono sicuro.', 'It wasn\'t here before. I\'m sure of it.'),
  whisper: L('Qualcuno ha detto il mio nome. Qui nessuno sa come mi chiamo.', 'Someone said my name. Nobody here knows my name.'),
  react: [
    L('Respira. È un ospedale vecchio, fa rumori vecchi.', 'Breathe. It\'s an old hospital, it makes old noises.'),
    L('Non l\'ho visto davvero. Sono stanco.', 'I didn\'t really see that. I\'m tired.'),
    L('Conta fino a dieci. Uno. Due.', 'Count to ten. One. Two.'),
    L('Walter, cosa non mi hai detto?', 'Walter, what didn\'t you tell me?'),
    L('La musica di Natale non aiuta. Peggiora.', 'The Christmas music doesn\'t help. It makes it worse.'),
  ],
  emptyBed: L('Il letto è rifatto. Le lenzuola sono fredde. Non c\'è nessuno da giorni.', 'The bed is made. The sheets are cold. Nobody has been here for days.'),
  emptyBed2: L('Eppure dalle telecamere lo vedo. È lì, nel letto. Mi guarda.', 'And yet on the cameras I can see them. Right there, in bed. Looking at me.'),
  vacantBed: L('Il cuscino è ancora caldo. C\'è un capello bianco, lungo.', 'The pillow is still warm. There\'s a long white hair on it.'),
  vacantArrive: L('Il letto è disfatto. Da qui non può aver chiamato nessuno.', 'The bed has been slept in. Nobody could have called from here.'),
  musicbox: L('Un carillon. Suona da solo. «Stille Nacht». Lo fermo e riparte.', 'A music box. It plays by itself. "Silent Night". I stop it and it starts again.'),
};

/** Walter racconta del paziente che non c'è più. */
export function ghostReveal(p: Patient, room: number): L10n {
  const m = p.sex === 'm';
  return L(
    `Nicola, scusa, una cosa che dovevo dirti prima. ${m ? 'Il signor' : 'La signora'} ${p.last}, della ${room}… ${m ? 'è morto' : 'è morta'} l'anno scorso. La notte di Natale, alle quattro meno venti. Ero di turno io. Il sistema ogni tanto ripesca la sua cartella e io non ho mai avuto il coraggio di chiedere di toglierla. Se suona il campanello della ${room}, non è un guasto. Tu non andarci.`,
    `Nicola, sorry, something I should have told you. ${m ? 'Mr' : 'Mrs'} ${p.last}, in ${room}… died last year. On Christmas night, at twenty to four. I was on duty. The system sometimes brings the file back up and I never had the nerve to ask them to delete it. If the bell in ${room} rings, it isn't a fault. Don't go.`,
  );
}
export const GHOST_NOTE = L('Deceduto/a il 25/12 dell\'anno scorso, ore 03:40.', 'Died on 25 Dec last year, 03:40.');
export function ghostNote(p: Patient): L10n {
  return L(`${p.sex === 'm' ? 'Deceduto' : 'Deceduta'} il 25 dicembre dell'anno scorso, alle 03:40.`, `Died on 25 December last year, at 03:40.`);
}
export const GHOST_TASK_DONE = L('Lasci tutto sul comodino. Il pulsante smette di lampeggiare.', 'You leave everything on the bedside table. The button stops blinking.');

/** La voce al telefono dalla stanza vuota. */
export function phantomCall(name: string, room: number): L10n {
  return L(`Pronto? Pronto… sono ${name}, della ${room}. Ho tanto freddo. Le luci si sono spente e non vedo il campanello. Viene qualcuno? La prego.`, `Hello? Hello… this is ${name}, in ${room}. I'm so cold. The lights went out and I can't find the bell. Is someone coming? Please.`);
}
export function phantomAfter(room: number): L10n {
  return L(`La ${room}? È vuota da tre anni. Il campanello e il telefono di quella stanza sono scollegati. Avrai sentito male.`, `${room}? It has been empty for three years. The bell and the phone in that room are disconnected. You must have misheard.`);
}
export const PHANTOM_NAMES = ['Adele Morandi', 'Ernesta Villa', 'Clotilde Bassani', 'Rina Ferraresi', 'Assunta Gallo', 'Ofelia Sartori'];

export function walterCalls(time: string): L10n {
  return L(`Nicola, perché mi hai chiamato tre volte? Alle ${time}. Ho risposto e dall'altra parte c'era solo la musica di Natale. E qualcuno che respirava. Tutto bene lì?`, `Nicola, why did you call me three times? At ${time}. I answered and there was only Christmas music on the line. And someone breathing. Everything OK there?`);
}

/** Cosa dicono i pazienti dopo le due di notte. */
export const PATIENT_TALK_LATE: L10n[] = [
  L('Prima è passato qualcuno. Non era lei, vero? Lei ha le scarpe che fanno rumore.', 'Someone came by earlier. It wasn\'t you, was it? Your shoes make a noise.'),
  L('{Spouse} dice che stanotte viene a prendermi. Gliel\'ho detto che non c\'è più da sei anni. Ride.', '{Spouse} says they\'re coming to fetch me tonight. I told them they died six years ago. They just laugh.'),
  L('Non spenga la musica. Quando la musica si ferma, arrivano.', 'Don\'t turn the music off. When the music stops, they come.'),
  L('Nella stanza accanto qualcuno canta, piano. Tutta la notte. Ma accanto non c\'è nessuno, no?', 'Someone has been singing next door, softly. All night. But there\'s nobody next door, is there?'),
  L('Lei lo sa che giorno è oggi? Io non me lo ricordo più. Mi sembra Natale da tanto tempo.', 'Do you know what day it is? I can\'t remember any more. It feels like it\'s been Christmas for a long time.'),
  L('Ha visto il Babbo Natale nel corridoio? Si muove solo quando non lo guardi.', 'Have you seen the Father Christmas in the corridor? It only moves when you\'re not looking.'),
];

export const FALL_INTERCOM: L10n = L('…aiuto… sono per terra… non riesco ad alzarmi… fa freddo, qui…', '…help… I\'m on the floor… I can\'t get up… it\'s cold down here…');
export const WALKING_TALK: L10n[] = [
  L('Vado solo in bagno, figliolo. Ce la faccio. Piano piano ce la faccio.', 'Just going to the toilet, son. I can manage. Slowly, I can manage.'),
  L('Non mi tocchi, mi so reggere. Mi reggo al muro.', 'Don\'t touch me, I can stand. I hold on to the wall.'),
  L('C\'è tanta gente, stanotte, nei corridoi. Lei non li vede?', 'There are so many people in the corridors tonight. Can\'t you see them?'),
];
