#!/bin/sh
# Make the demo database again (macOS / Linux): a backup of the current database, then the scripts 01 to 04 and 06
# (05 only checks the ETL). The dates of the sample data are counted from today, so run this on the morning of the demo.
#   sh database/reset-demo.sh          (asks "Are you sure")
#   sh database/reset-demo.sh -y       (does not ask)
#   SITEPROOF_DB_CONTAINER=my-mysql sh database/reset-demo.sh
set -u
cd "$(dirname "$0")" || exit 1
DB=${SITEPROOF_DB_CONTAINER:-siteproof-mysql}
# The password stays inside the container: MYSQL_PWD is read there from MYSQL_ROOT_PASSWORD.
mysql_in() { docker exec -i "$DB" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot "$@"' mysql "$@"; }

echo "=== SiteProof: reset the demo database (container $DB) ==="

if ! docker exec "$DB" sh -c 'test -f /var/lib/mysql-files/companies.tsv && test -f /var/lib/mysql-files/materials.tsv && test -f /var/lib/mysql-files/transactions.tsv' >/dev/null 2>&1; then
    echo "[STOP] The container $DB is not running, or companies.tsv, materials.tsv and transactions.tsv are not in /var/lib/mysql-files inside it."
    echo "       Start the container first: docker start $DB"
    exit 1
fi
echo "[ok] The container $DB runs and has the data files."

if [ "${1:-}" != "-y" ]; then
    echo "All the data of the database siteproof will be DELETED and made again from the scripts (a backup is saved first)."
    printf 'Type YES to continue: '; read -r answer
    [ "$answer" = "YES" ] || { echo "Cancelled. Nothing was changed."; exit 1; }
fi

mkdir -p backups
BACKUP="backups/siteproof-before-reset-$(date +%Y%m%d-%H%M%S).sql"
if docker exec "$DB" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --databases siteproof' > "$BACKUP"; then
    echo "[ok] Backup: database/$BACKUP"
else
    rm -f "$BACKUP"
    echo "[!] The backup failed (maybe there is no database siteproof yet)."
    printf 'Type YES to continue WITHOUT a backup: '; read -r answer
    [ "$answer" = "YES" ] || { echo "Cancelled. Nothing was changed."; exit 1; }
fi

for f in 01_schema.sql 02_extract.sql 03_profile.sql 04_transform_load.sql; do
    echo "     running $f ..."
    if ! mysql_in < "$f" > /dev/null; then
        echo "[STOP] $f failed. The backup can be loaded again with: docker exec -i $DB sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mysql -uroot' < database/$BACKUP"
        exit 1
    fi
done
echo "[ok] 01 to 04: schema and the data of the course (ETL)."

# 06 ends with 2 inserts that MUST fail (they show that the constraints work): it runs with --force and exactly 2 errors are expected.
echo "     running 06_sample_data.sql ..."
errors_file=$(mktemp)
mysql_in --force < 06_sample_data.sql > /dev/null 2> "$errors_file"
errors=$(grep -c ERROR "$errors_file")
if [ "$errors" != "2" ]; then
    cat "$errors_file"; rm -f "$errors_file"
    echo "[STOP] 06_sample_data.sql had $errors errors; 2 were expected (6.11 and 6.12)."
    echo "       The backup can be loaded again with: docker exec -i $DB sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mysql -uroot' < database/$BACKUP"
    exit 1
fi
rm -f "$errors_file"
echo "[ok] 06: the demo data (the 2 expected errors of 6.11 and 6.12 are fine)."

mysql_in -t siteproof < reset-demo-check.sql
echo "=== Done. Sign out of the website and sign in again. ==="
