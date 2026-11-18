# THE HOSPITAL SEED

Horror procedurale in prima persona per browser desktop, gemello di *The Dark Seed*. È la vigilia di Natale:
Walter, il guardiano notturno dell'Ospedale San Nicola, non può fare il turno e ti chiede di sostituirlo.
Dalle 22:00 alle 06:00 il reparto dei piani 20, 21 e 22 è tuo: non c'è nessun altro, solo tu e i pazienti. Un seed (0–1.000.000) decide pazienti, storie, meteo, incarichi
e ciò che succede durante la notte. Tutto (grafica, musica, suoni, testi) è generato dal codice.

Stack: TypeScript · Babylon.js · Vite · WebGL2. Sito statico, nessuna rete a runtime.

## Avvio

1. Node.js 20 o superiore.
2. Nella cartella del progetto: `npm install`
3. `npm run dev` e apri `http://localhost:5173`
4. Versione definitiva: `npm run build`, poi `npm run preview` (`http://localhost:4173`).

Un seed si può passare nell'indirizzo: `…/?seed=4242`.

## Comandi

| Tasto | Azione |
| --- | --- |
| WASD | muoversi |
| Shift | correre |
| mouse | guardare |
| E o clic | interagire (porte, pulsanti, pazienti, quadro elettrico…) |
| F | torcia (consuma le pile) |
| R | cambia le pile della torcia con quelle di ricambio |
| T | telefono: messaggi, incarichi, pazienti, mappa dei piani |
| M | mappa del piano (sempre in vista, si toglie con M) |
| Esc | pausa |
| Alle telecamere | WASD, frecce o trascinamento col mouse per girarle; Q e R per cambiare; 1–9; Esc per tornare alla scrivania |

## L'ospedale

Una torre sopra la città. Il reparto notturno occupa tre piani, collegati da un vano scale vero (con il numero del
piano su ogni pianerottolo) e da un ascensore lento con la musichetta d'attesa; i piani di sotto sono chiusi.
**La forma dei piani cambia a ogni seed.** Restano fissi solo il vano scale, l'ascensore e l'accettazione al 20°;
il resto di ogni piano sceglie una topologia:

- *corridoio passante* da una facciata all'altra, con stanze sui due lati;
- *a T*: il corridoio sbatte contro un corridoio trasversale che va da nord a sud, con un'ala di stanze in fondo;
- *a L*: il corridoio piega verso nord fino alla facciata, e a sud-est resta un'ala intera;
- *sala in fondo*: il corridoio si apre su una sala grande quanto mezzo piano (un soggiorno enorme);
- *galleria*: un passaggio porta a una galleria vetrata lungo tutta la facciata nord;
- *sala d'attesa aperta*: a metà corridoio il muro si apre su un soggiorno senza porta.

I tre piani hanno sempre tre forme diverse. Gli arredi tengono conto delle finestre (niente armadi o lavabi davanti ai
vetri), possono essere specchiati, e il soggiorno è diviso in angoli veri: un solo salotto con la TV, i tavoli da pranzo,
l'angolo lettura, il pianoforte, il tavolino delle carte, l'albero. Tappeti nei soggiorni, negli studi, nella cappella
(la passatoia rossa) e accanto ai letti. Ogni stanza ha il suo **interruttore** accanto alla porta, con una piccola spia
arancione per trovarlo al buio; di notte qualche luce si accende o si spegne da sola. Il vano scale ha gradini con la
striscia antiscivolo, corrimano, finestre sui pianerottoli, un solo numero grande sopra la porta di ogni piano e il
cartello «▲ 22 ▼ 21» sul pianerottolo intermedio. Fuori, la città affonda in una foschia bassa: le strade spariscono,
restano le luci che tremolano, il mercatino di Natale e la ruota panoramica. Sul tetto sventola il tricolore.

Le ali sono poi divise in stanze di larghezza diversa (qualche volta una sola, enorme). I due piani di degenza non
hanno mai la stessa forma. Le stanze sono arredate sul modello di un reparto vero: letti articolati con le sponde e la
trave testaletto (ossigeno, vuoto, luce di lettura, campanello), comodino e servitore, asta per flebo, lavabo con
dispenser, crocifisso; servizi con maniglioni e tirante d'allarme rosso; biancheria con scaffali a griglia e carrelli;
deposito della strumentazione con carrozzine, aste, bombole e l'armadio delle pile; ambulatorio col carrello delle
urgenze; soggiorno con divani, TV, tavoli, libreria, l'albero coi regali.

Dalle finestre la città vista dall'alto: isolati illuminati, strade con i lampioni e le luci di Natale, la piazza con
il grande albero, il campanile, le colline lontane. Neve, pioggia o nevischio.

## La postazione della reception

- **Monitor della videosorveglianza**: il monitor centrale mostra le telecamere a rotazione; con E si passa a
  tutto schermo. Tredici telecamere coprono atrio, reception, corridoi, bar, cappella, scale, ascensore (si muove
  con la cabina), seminterrato, obitorio e l'esterno. Se un piano resta al buio la telecamera passa all'infrarosso.
- **Pulsantiera delle chiamate**: per ogni paziente (da 2 a 4, decisi dal seed) due pulsanti luminosi.
  Giallo = assistenza (acqua, coperta, camomilla), rosso = urgenza (bisogna andare di persona).
  Premere un pulsante che lampeggia apre l'interfono: il paziente dice cosa gli serve.
- Telefono della reception, registro delle consegne, radio della filodiffusione.

## I pazienti

Da 2 a 4 per notte (sesso casuale). Di notte si alzano da soli per andare in bagno: lenti, incerti, aprono le porte,
arrivano ai servizi del piano e tornano a letto. Ogni tanto cadono: allora lampeggia il pulsante rosso e un incarico
urgente segna dove sono; li si aiuta a rialzarsi e li si riporta a letto.

Sono anziani, ognuno con nome, cognome, età, motivo del ricovero e una piccola storia
(nel telefono, scheda *Pazienti*, e nel riepilogo di fine turno). Quando chiamano si mettono seduti a letto e la
spia sopra la porta della stanza si accende.

## La notte (horror psicologico)

- A mezzanotte si accendono le **luci di cortesia**: i piani restano nella penombra delle luci notturne e
  d'emergenza. Con il blackout del generale si resta quasi al buio. La torcia **consuma le pile**: quelle di ricambio
  stanno nel deposito della strumentazione e in ambulatorio.
- Il **narratore** (la voce neurale offline di The Dark Seed, file in `public/voices` e `public/piper`) legge i
  pensieri di Nicola: le stanze, le cose che non tornano, il tentativo di calmarsi.
- **Il paziente che non c'è più** (circa due seed su tre): verso le quattro Walter scrive che il paziente di una
  stanza è morto la notte di Natale dell'anno scorso. Da lì il suo letto è vuoto e rifatto se ci vai, ma dalle
  telecamere è ancora lì; il campanello continua a suonare; la foto nella cartella cambia.
- **La stanza vuota**: un telefono interno squilla da una stanza in cui non è ricoverato nessuno. Quando entri la porta
  si chiude da sola, un carillon suona «Stille Nacht», il letto è caldo. Poi la centrale: quella stanza è scollegata.
- Il **Babbo Natale di plastica** del soggiorno cambia posto quando non lo guardi. Il presepe ha la mangiatoia vuota,
  poi no, poi le statuine sono girate verso la porta. Un regalo sotto l'albero porta il tuo nome. Qualcuno sussurra
  «Nicola». Walter chiede perché l'hai chiamato tre volte.
- Il corpo reagisce: un fondo grave che cresce con le ore, il battito del cuore, i bordi dello schermo che si chiudono.

## Il turno

Gli incarichi arrivano durante la notte, in momenti decisi dal seed:

- portare acqua, una coperta o una camomilla a un paziente;
- correre da un paziente che ha premuto il pulsante rosso;
- a mezzanotte passare dai pazienti per gli auguri;
- ronde: timbrare i tre punti di controllo di un piano;
- **blackout**: rialzare il generale e gli interruttori dei piani nel locale tecnico (senza corrente l'ascensore si
  ferma, restano solo le luci d'emergenza, la musica tace, le telecamere passano all'infrarosso);
- chiudere una finestra che sbatte, riavviare una telecamera che ha perso il segnale;
- rispondere a una telefonata e riferire gli auguri a un paziente;
- alle 06:00 firmare il registro e passare le consegne.

I ritardi vengono annotati. A fine turno il riepilogo mostra incarichi, pazienti e il registro completo della notte.

## Rapporti

Ogni incarico fatto sul posto va chiuso con un **rapporto dal telefono** (T, scheda *Incarichi*, «Invia rapporto»).

## Eventi insoliti

Come in The Dark Seed, la notte non è solo lavoro. Il seed decide da 7 a 12 eventi, più fitti dopo mezzanotte:
luci che sfarfallano, porte che sbattono, l'ascensore che sale da solo, il campanello di un paziente che dorme,
una figura in fondo al corridoio che sparisce appena distogli lo sguardo, una figura che si vede solo dalle
telecamere (anche nell'ascensore vuoto), passi alle spalle, sussurri, la filodiffusione che si deforma, una telefonata
muta, qualcuno che bussa da dentro una stanza chiusa, una telecamera piena di disturbi. Quando ne percepisci uno si
accende l'indicatore «Evento insolito» (o «Ti senti osservato») e parte la musica inquietante. Nel riepilogo il
registro mostra tutti gli eventi della notte, anche quelli che non hai visto.

La struttura per le anomalie vere e proprie (`src/game/anomalies.ts`) resta pronta per il catalogo da definire.

## Verifiche

| Comando | Cosa fa |
| --- | --- |
| `npm run typecheck` | controllo dei tipi |
| `npm test` | test automatici: determinismo, pazienti 1–4, raggiungibilità di ogni oggetto, scale, ascensore, turno completo |
| `npm run audit:static` | niente chiamate di rete né casualità non deterministica nella logica |

Architettura: `docs/ARCHITECTURE.md`.
