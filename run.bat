@echo off
title ShortsPilot - Xavier Memes
echo ============================================
echo   ShortsPilot - Xavier Memes Automation
echo ============================================

if not exist node_modules (
  echo Installing Node.js dependencies...
  call npm install
)

echo Creating shorts lifecycle directories...
if not exist shorts\incoming mkdir shorts\incoming
if not exist shorts\processing mkdir shorts\processing
if not exist shorts\scheduled mkdir shorts\scheduled
if not exist shorts\published mkdir shorts\published
if not exist shorts\failed mkdir shorts\failed
if not exist database mkdir database
if not exist logs mkdir logs

echo Starting optional Windows incoming folder watcher...
start "ShortsPilot Folder Watcher" /min python automation\folder_watcher.py

echo Starting ShortsPilot web dashboard and API server on http://localhost:3000 ...
call npm run dev
