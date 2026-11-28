@echo off
REM ============================================================================
REM  Make the demo database again: a backup of the current database, then the
REM  scripts 01 to 04 and 06 (05 only checks the ETL). The dates of the sample
REM  data are counted from today, so run this on the morning of the demo.
REM
REM  Run it in the folder of the repository:   database\reset-demo.bat
REM  Without the question "Are you sure":       database\reset-demo.bat /y
REM  Another name of the MySQL container:       set SITEPROOF_DB_CONTAINER=my-mysql
REM ============================================================================
setlocal EnableExtensions
cd /d "%~dp0"

if "%SITEPROOF_DB_CONTAINER%"=="" (set DB=siteproof-mysql) else (set DB=%SITEPROOF_DB_CONTAINER%)
REM The password stays inside the container: MYSQL_PWD is read there from MYSQL_ROOT_PASSWORD.
set MYSQL=sh -c "MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot"

echo.
echo === SiteProof: reset the demo database (container %DB%) ===
echo.

REM ---- 1. Is the container running, and does it have the three data files of the ETL? ----
docker exec %DB% sh -c "test -f /var/lib/mysql-files/companies.tsv && test -f /var/lib/mysql-files/materials.tsv && test -f /var/lib/mysql-files/transactions.tsv" >nul 2>&1
if errorlevel 1 (
    echo [STOP] The container %DB% is not running, or the files companies.tsv, materials.tsv and
    echo        transactions.tsv are not in /var/lib/mysql-files inside it. Start Docker Desktop and the
    echo        container first: docker start %DB%
    goto failed
)
echo [ok] The container %DB% runs and has the data files.

REM ---- 2. Are you sure? ----
if /i not "%~1"=="/y" (
    echo.
    echo All the data of the database siteproof will be DELETED and made again from the scripts
    echo ^(a backup is saved first^). Everything that was done in the website since the last reset is lost.
    set /p ANSWER=Type YES to continue: 
)
if /i not "%~1"=="/y" (
    call :checkAnswer || goto cancelled
)

REM ---- 3. Backup of the current database ----
if not exist backups mkdir backups
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set STAMP=%%i
set BACKUP=backups\siteproof-before-reset-%STAMP%.sql
docker exec %DB% sh -c "MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysqldump -uroot --databases siteproof" > "%BACKUP%" 2> "%TEMP%\siteproof-backup.err"
if errorlevel 1 (
    del "%BACKUP%" >nul 2>&1
    type "%TEMP%\siteproof-backup.err"
    echo [!] The backup failed ^(maybe there is no database siteproof yet^).
    set /p ANSWER=Type YES to continue WITHOUT a backup: 
    call :checkAnswer || goto cancelled
) else (
    echo [ok] Backup: database\%BACKUP%
)

REM ---- 4. The scripts. 01 to 04 must not have any error. ----
for %%f in (01_schema.sql 02_extract.sql 03_profile.sql 04_transform_load.sql) do (
    echo      running %%f ...
    docker exec -i %DB% %MYSQL% < %%f > nul
    if errorlevel 1 (
        echo [STOP] %%f failed. The backup can be loaded again with:
        echo        type database\%BACKUP% ^| docker exec -i %DB% sh -c "MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot"
        goto failed
    )
)
echo [ok] 01 to 04: schema and the data of the course ^(ETL^).

REM 06 ends with 2 inserts that MUST fail (they show that the constraints work), so it runs with --force
REM and exactly 2 errors are expected.
echo      running 06_sample_data.sql ...
docker exec -i %DB% sh -c "MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot --force" < 06_sample_data.sql > nul 2> "%TEMP%\siteproof-06.err"
set ERRORS=0
for /f %%n in ('find /c "ERROR" ^< "%TEMP%\siteproof-06.err"') do set ERRORS=%%n
if not "%ERRORS%"=="2" (
    type "%TEMP%\siteproof-06.err"
    echo [STOP] 06_sample_data.sql had %ERRORS% errors; 2 were expected ^(6.11 and 6.12^).
    echo        The backup can be loaded again with:
    echo        type database\%BACKUP% ^| docker exec -i %DB% sh -c "MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot"
    goto failed
)
echo [ok] 06: the demo data ^(the 2 expected errors of 6.11 and 6.12 are fine^).

REM ---- 5. Check ----
echo.
docker exec -i %DB% sh -c "MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot -t siteproof" < reset-demo-check.sql
echo.
echo === Done. Sign out of the website and sign in again. ===
endlocal
exit /b 0

:checkAnswer
if /i "%ANSWER%"=="YES" exit /b 0
exit /b 1

:cancelled
echo Cancelled. Nothing was changed.
endlocal
exit /b 1

:failed
endlocal
exit /b 1
