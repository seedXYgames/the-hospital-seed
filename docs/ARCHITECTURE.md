# Architettura

Stessi principi di The Dark Seed: la logica di gioco è pura (niente Babylon, niente DOM) e deterministica per seed.

```
src/core       tipi condivisi, PRNG a stream (rng.ts, ripreso da The Dark Seed), seed
src/world      geom.ts (scatole, cilindri, luci), hospital.ts (topologia dei piani, muri, arredi, città),
               names.ts (nomi e storie dei pazienti), physics.ts (collisioni, quote, scale, raggi)
src/game       shift.ts (il turno: tempo, movimento, interazioni, incarichi, corrente, telecamere),
               elevator.ts, texts.ts (testi IT/EN), anomalies.ts (struttura delle anomalie), achievements.ts,
               patients.ts (pazienti che vanno in bagno e cadono, percorsi a griglia nei corridoi),
               horror.ts (pensieri del narratore, paziente fantasma, stanza vuota, Babbo Natale)
src/render     bake.ts (luce precalcolata per zona), shaders.ts, hospitalRenderer.ts, people.ts
src/audio      motore e sintesi di The Dark Seed, più hospitalSfx.ts (ascensore, chiamate, blackout…)
               e music.ts (canti di Natale e musica d'attesa dell'ascensore)
src/ui         schermate riprese da The Dark Seed, HUD, telefono, mappa dei piani, sovraimpressione CCTV
src/main.ts    collega tutto: input, ciclo, audio, interfaccia
```

## Pianta

`planFloor` sceglie per ogni piano una topologia (`spine`, `tee`, `ell`, `hall`) e produce corridoi (rettangoli),
pezzi d'ala (`partition`: larghezze casuali, a volte una stanza enorme) e varchi. Ogni stanza ha un muro della porta
(`DoorWall`, lungo x o lungo z); il riferimento locale `Local` (u lungo il muro della porta, d in profondità) rende gli
arredi indipendenti dall'orientamento. `buildFloor` costruisce pavimenti, soffitti e muri in modo generico: facciata
intera con le finestre sul bordo dell'edificio, altrimenti mezzo muro per lato, con le aperture condivise dai due
ambienti (porte, incroci tra corridoi, varchi delle sale). I corrimano corrono solo sui tratti di muro pieni.

## Luce

Ogni vertice ha due valori di luce precalcolati: con corrente e senza (solo luci d'emergenza e la luce che
entra dalle finestre). Le lampade illuminano solo la loro zona (stanza, corridoio, vano scale, cabina), così la luce
non passa attraverso i muri. Lo shader mescola i due valori con il livello di luce del piano (`power[]`: 1 piena,
0 luci di cortesia dopo mezzanotte, −1 blackout, in cui resta il 14% della luce d'emergenza) e aggiunge torcia,
fino a otto luci mobili (spie delle chiamate, albero, monitor) e l'illuminatore a infrarossi delle telecamere.

## Videosorveglianza

Le telecamere sono punti fissi del modello (`Cam`). Quella dell'ascensore segue la cabina. A tutto schermo la scena
è vista da una seconda telecamera Babylon con una post-elaborazione (grana, righe, vignettatura, infrarosso).
Il monitor della reception è una render target texture aggiornata ogni tre fotogrammi.
Strati: `LAYER_BASE` visibile ovunque, `LAYER_LIVE` solo dal vivo (l'oggetto in mano), `LAYER_CCTV` solo dalle
telecamere (la figura del guardiano). Le anomalie useranno gli stessi strati.

## Terminale sul monitor

Da seduti il campo visivo si stringe sul monitor centrale. Il terminale resta un elemento DOM (testi, pulsanti,
foto), ma ogni fotogramma `terminalMatrix` proietta i quattro angoli dello schermo 3D (`TERM_SCREEN`) e calcola
l'omografia che adagia il riquadro 960×600 su quel quadrilatero (`matrix3d`).

## Tempo

Il turno dura 480 minuti di gioco (22:00–06:00), 3,75 secondi reali per minuto: circa mezz'ora.
Il piano della notte (incarichi, blackout, messaggi di Walter) è estratto all'inizio dallo stream `tasks`.
