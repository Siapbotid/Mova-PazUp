@echo off
echo PazUp Setup Script
echo ==================

echo.
echo Installing dependencies...
call npm install

echo.
echo Creating application icon...
node create-icon.js

echo.
echo Setup complete!
echo.
echo To start the application in development mode, run:
echo npm start
echo.
echo To build for production, run:
echo npm run build
echo.
pause