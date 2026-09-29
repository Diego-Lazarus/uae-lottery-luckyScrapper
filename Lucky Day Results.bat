@echo off
rem Double-click to open the Lucky Day Results window.
cd /d "%~dp0"
python -c "import requests, openpyxl" 2>nul || (
  echo Installing the two Python packages this tool needs...
  python -m pip install --quiet -r requirements.txt || (
    echo.
    echo Could not install packages. Is Python installed? Get it from https://www.python.org/downloads/
    pause
    exit /b 1
  )
)
start "" pythonw luckyday_app.py
