@echo off
title Avvio Sbobinatore AI

:: Spostati forzatamente nella cartella esatta di questo script
cd /d "%~dp0"

echo ===================================================
echo   SBOBINATORE AI - Avvio e Installazione
echo ===================================================
echo.

:: Controlla se Python e' installato
python --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [*] ATTENZIONE: Python non e' installato sul tuo PC!
    echo [*] Nessun problema: lo sto scaricando e installando in automatico per te...
    echo [*] Questa operazione e' sicura ed e' richiesta SOLO la prima volta. 
    echo [*] Potrebbe volerci un minuto. Non chiudere questa finestra...
    echo.
    curl -s -L -o "%TEMP%\python_installer.exe" "https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe"
    "%TEMP%\python_installer.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0
    del "%TEMP%\python_installer.exe"
    
    :: Aggiorno i percorsi cosi' il sistema lo vede immediatamente senza dover riavviare
    set "PATH=%USERPROFILE%\AppData\Local\Programs\Python\Python311\Scripts\;%USERPROFILE%\AppData\Local\Programs\Python\Python311\;%PATH%"
    echo [*] Python installato con successo!
    echo.
)

echo [*] Python rilevato. Controllo aggiornamenti necessari...
echo.

:: Installa/Aggiorna le librerie necessarie (la prima volta ci mette un po', poi e' istantaneo)
python -m pip install -r requirements.txt

:: Crea in automatico l'icona sul Desktop (Silenzioso) se non esiste gia'
if not exist "%USERPROFILE%\Desktop\Sbobinatore AI.lnk" (
    echo [*] Creazione del collegamento sul Desktop in corso...
    call Crea_Icona_Desktop.bat >nul 2>&1
)

echo.
echo [*] Tutto pronto. Sto avviando lo Sbobinatore!
echo.

:: Avvia l'interfaccia grafica sganciata dal terminale usando pythonw
start "" pythonw Sbobinatore.pyw

:: Chiude immediatamente questa finestra del terminale
exit
