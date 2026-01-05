@echo off
REM Email Notification Setup Script for hConnect
REM This script sets up Firebase Secrets for email notifications

echo.
echo ========================================
echo  hConnect Email Notification Setup
echo ========================================
echo.
echo This will configure SMTP credentials for email notifications.
echo You'll need a Gmail account with an App Password.
echo.
echo To create a Gmail App Password:
echo   1. Go to https://myaccount.google.com/apppasswords
echo   2. Sign in to your Google account
echo   3. Select "Mail" and your device
echo   4. Click "Generate"
echo   5. Copy the 16-character password
echo.
pause

echo.
echo Setting up Firebase Secrets...
echo (You'll be prompted for each value)
echo.

echo Setting EMAIL_FROM (e.g., alerts@healthspaces.com):
call firebase functions:secrets:set EMAIL_FROM

echo.
echo Setting EMAIL_SMTP_HOST (use: smtp.gmail.com):
call firebase functions:secrets:set EMAIL_SMTP_HOST

echo.
echo Setting EMAIL_SMTP_PORT (use: 465):
call firebase functions:secrets:set EMAIL_SMTP_PORT

echo.
echo Setting EMAIL_SMTP_USER (your Gmail address):
call firebase functions:secrets:set EMAIL_SMTP_USER

echo.
echo Setting EMAIL_SMTP_PASS (your Gmail App Password - 16 chars, no spaces):
call firebase functions:secrets:set EMAIL_SMTP_PASS

echo.
echo Setting EMAIL_SMTP_SECURE (use: true):
call firebase functions:secrets:set EMAIL_SMTP_SECURE

echo.
echo ========================================
echo  Secrets configured!
echo ========================================
echo.
echo Now building and deploying functions...
echo.

cd functions
call npm run build
cd ..

echo.
echo Deploying email notification functions...
call firebase deploy --only functions:sendTestEmailNotification,functions:sendTestEmailNotificationHttp

echo.
echo ========================================
echo  Setup Complete!
echo ========================================
echo.
echo Test the email notification from the Admin Features page.
echo.
pause
