@echo off
setlocal
cd /d "%~dp0"

git add .
git commit -m "Mise a jour WikiTimer - %date% %time%"
if errorlevel 1 (
  echo Le commit n'a pas ete cree. Verifie les messages Git ci-dessus.
  pause
  exit /b 1
)

git push origin main
if errorlevel 1 (
  echo L'envoi a echoue. Verifie ton acces GitHub ou connecte-toi si necessaire.
  pause
  exit /b 1
)

echo Projet envoye sur GitHub.
pause
