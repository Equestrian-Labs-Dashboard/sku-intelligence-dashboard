@echo off
cd /d "%~dp0"
echo Refreshing Shopify SKU reports...
npm run refresh
pause
