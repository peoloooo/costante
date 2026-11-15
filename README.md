# Costante

Web app (PWA) per studiare con costanza: piano di studio per più esami, streak e trofei.
Tutti i dati restano sul telefono (localStorage). Nessun server, nessun account.

## File
- `index.html` – struttura della pagina
- `app.js` – logica (piano, streak, trofei) e interfaccia
- `style.css` – stile (chiaro/scuro automatico)
- `sw.js` – service worker: l'app funziona anche offline
- `manifest.webmanifest`, `icons/` – installazione sulla schermata Home

## Come funziona il piano
- Pagine rimaste ÷ giorni di studio rimasti prima del ripasso = pagine minime al giorno.
- Il piano usa il valore più alto tra le pagine che hai scelto e quelle minime.
- Si ricalcola ogni giorno: se resti indietro aumenta un po', se vai avanti torna al tuo ritmo.
- Gli ultimi giorni prima dell'esame sono di ripasso (di default circa il 15% del tempo, max 14 giorni).
- Se il carico di tutti gli esami supera le ore disponibili, l'app avvisa.

## Streak
- Ogni giorno con almeno una pagina (o un ripasso) segnata: +1.
- I giorni liberi non rompono la serie.
- Ogni 7 giorni di fila si guadagna un jolly (max 2) che salva automaticamente un giorno saltato.

## Metterla sull'iPhone
L'app va pubblicata su un indirizzo https (es. GitHub Pages o Netlify, gratis).
Poi sull'iPhone: apri il link in **Safari** → tasto Condividi → **Aggiungi alla schermata Home**.

## Provarla sul Mac
```
python3 -m http.server 5173
```
e apri http://localhost:5173
