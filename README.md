# WikiTimer

Minuteries d’enchères locales, sans compte et sans serveur. Chaque navigateur conserve ses propres minuteries et archives dans son stockage local.

La minuterie mémorise une heure de fin réelle : fermeture du navigateur, arrêt ou redémarrage du poste ne la mettent donc jamais en pause.

À l’échéance, l’application ouvre un popup, tente une notification navigateur et joue le son choisi jusqu’à validation. La validation archive automatiquement la minuterie.

## Lancer le projet

```bash
npm install
npm run dev
```

## Envoyer sur GitHub

Double-cliquer sur `push-github.bat`, puis s’authentifier auprès de GitHub si nécessaire. Le script crée automatiquement un commit daté et ne stocke aucun mot de passe.
