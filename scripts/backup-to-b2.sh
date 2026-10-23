#!/usr/bin/env bash
# ==============================================================================
# IEEE Menoufia Student Branch Portal — Disaster Recovery Backup to Backblaze B2
# ==============================================================================
# Performs full dumps of PostgreSQL (core-postgres) and MongoDB (event-mongo),
# bundles and compresses them into a single archive, uploads to Backblaze B2 (S3),
# prunes backups older than 7 days, and alerts on failure via IEEE Email Service.
#
# Usage:
#   ./scripts/backup-to-b2.sh
# Scheduled via crontab:
#   0 3 * * * /path/to/IEEE_Portal/scripts/backup-to-b2.sh >> /var/log/ieee-portal-backup.log 2>&1
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Load Environment Configuration
if [[ -f "$PROJECT_ROOT/.env.production" ]]; then
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env.production"
elif [[ -f "$PROJECT_ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
elif [[ -f "$PROJECT_ROOT/prod/.env" ]]; then
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/prod/.env"
fi

# Locate Compose File
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.prod.yml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
fi

# Configuration & Defaults
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-ieee_portal}"
MONGO_DB="${MONGO_DB:-ieee-registration}"
MONGO_URI="${MONGO_URI:-}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
ALERT_EMAIL="yuossefbakier@gmail.com"
EMAIL_SERVICE_URL="${EMAIL_SERVICE_URL:-http://127.0.0.1:3060/email/send}"

# Intelligent default for BACKUP_DIR:
# If not explicitly provided, try /var/backups/ieee-portal if writable or running as root,
# otherwise safely default to $PROJECT_ROOT/backups
if [[ -z "$BACKUP_DIR" ]]; then
  if [[ "$EUID" -eq 0 ]] || [[ -w "/var/backups" ]]; then
    BACKUP_DIR="/var/backups/ieee-portal"
  else
    BACKUP_DIR="${PROJECT_ROOT}/backups"
  fi
fi

# Ensure local backup directory exists, with automatic fallback if permission denied
if ! mkdir -p "$BACKUP_DIR" 2>/dev/null; then
  echo "Notice: Cannot write to $BACKUP_DIR. Falling back to ${PROJECT_ROOT}/backups..."
  BACKUP_DIR="${PROJECT_ROOT}/backups"
  mkdir -p "$BACKUP_DIR"
fi

# Backblaze B2 / S3 Config
B2_KEY_ID="${B2_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
B2_APPLICATION_KEY="${B2_APPLICATION_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
B2_BUCKET_NAME="${B2_BUCKET_NAME:-}"
B2_ENDPOINT_URL="${B2_ENDPOINT_URL:-}"

TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
ARCHIVE_NAME="ieee_portal_backup_${TIMESTAMP}.tar.gz"
LOCAL_ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

# Temporary working directory for uncompressed dumps
TMP_DIR=""

log() {
  echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] $*"
}

# Failure notification handler
send_failure_alert() {
  local exit_code="$1"
  local line_no="$2"
  log "🚨 ERROR: Backup failed at line $line_no with exit code $exit_code."

  if [[ -n "$EMAIL_SERVICE_AUTH_TOKEN" ]]; then
    log "Sending disaster recovery alert email to $ALERT_EMAIL..."
    local json_payload
    json_payload=$(cat <<EOF
{
  "to": ["$ALERT_EMAIL"],
  "subject": "🚨 [ALERT] IEEE Portal Database Backup Failed",
  "html": "<div style=\"font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #f87171; border-radius: 8px; background-color: #fef2f2;\"><h2 style=\"color: #b91c1c; margin-top: 0;\">🚨 Disaster Recovery Backup Failed</h2><p>An error occurred during the automated database backup of <strong>IEEE Portal</strong> on server <code>$(hostname)</code>.</p><table style=\"width: 100%; border-collapse: collapse; margin: 16px 0;\"><tr style=\"border-bottom: 1px solid #fca5a5;\"><td style=\"padding: 8px; font-weight: bold;\">Timestamp:</td><td style=\"padding: 8px;\">$(date -u +"%Y-%m-%d %H:%M:%S UTC")</td></tr><tr style=\"border-bottom: 1px solid #fca5a5;\"><td style=\"padding: 8px; font-weight: bold;\">Exit Code:</td><td style=\"padding: 8px;\">$exit_code</td></tr><tr style=\"border-bottom: 1px solid #fca5a5;\"><td style=\"padding: 8px; font-weight: bold;\">Failed Line:</td><td style=\"padding: 8px;\">$line_no</td></tr><tr><td style=\"padding: 8px; font-weight: bold;\">Compose Stack:</td><td style=\"padding: 8px;\">$COMPOSE_FILE</td></tr></table><p style=\"color: #4b5563; font-size: 13px;\">Please check the server backup logs at <code>/var/log/ieee-portal-backup.log</code> to inspect the details and restore protection.</p></div>"
}
EOF
)
    curl -s -m 15 -X POST "$EMAIL_SERVICE_URL" \
      -H "Content-Type: application/json" \
      -H "x-service-token: $EMAIL_SERVICE_AUTH_TOKEN" \
      -d "$json_payload" || log "⚠️ Failed to send alert email via $EMAIL_SERVICE_URL."
  else
    log "⚠️ EMAIL_SERVICE_AUTH_TOKEN not set; skipping email alert."
  fi
}

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

trap 'send_failure_alert $? $LINENO' ERR
trap cleanup EXIT

log "=================================================================="
log "Starting IEEE Portal Disaster Recovery Backup: $ARCHIVE_NAME"
log "=================================================================="

TMP_DIR="$(mktemp -d -t ieee-backup-XXXXXX)"

# Step 1: Dump PostgreSQL (core-postgres)
log "1/5: Dumping PostgreSQL database ($POSTGRES_DB) from core-postgres..."
docker compose -f "$COMPOSE_FILE" exec -T core-postgres pg_dump \
  -U "$POSTGRES_USER" \
  "$POSTGRES_DB" > "$TMP_DIR/postgres_${POSTGRES_DB}.sql"
log "✅ PostgreSQL dump completed ($(du -h "$TMP_DIR/postgres_${POSTGRES_DB}.sql" | cut -f1))"

# Step 2: Dump MongoDB (Atlas or local event-mongo)
if [[ -n "$MONGO_URI" && "$MONGO_URI" == mongodb* && "$MONGO_URI" != *"event-mongo"* ]]; then
  MASKED_URI="$(echo "$MONGO_URI" | sed -E 's/(mongodb(\+srv)?:\/\/[^:]+:)[^@]+(@)/\1****\3/')"
  log "2/5: Dumping MongoDB database from Atlas ($MASKED_URI)..."
  docker run --rm mongo:7 mongodump \
    --uri="$MONGO_URI" \
    --archive --gzip > "$TMP_DIR/mongo_${MONGO_DB}.archive.gz"
  log "✅ MongoDB Atlas dump completed ($(du -h "$TMP_DIR/mongo_${MONGO_DB}.archive.gz" | cut -f1))"
elif docker compose -f "$COMPOSE_FILE" ps --status=running 2>/dev/null | grep -q "event-mongo"; then
  log "2/5: Dumping MongoDB database ($MONGO_DB) from local event-mongo container..."
  docker compose -f "$COMPOSE_FILE" exec -T event-mongo mongodump \
    --db "$MONGO_DB" \
    --archive --gzip > "$TMP_DIR/mongo_${MONGO_DB}.archive.gz"
  log "✅ MongoDB local dump completed ($(du -h "$TMP_DIR/mongo_${MONGO_DB}.archive.gz" | cut -f1))"
else
  log "⚠️ Neither external MONGO_URI nor running local event-mongo found. Skipping MongoDB dump."
fi

# Step 3: Bundle and Compress into TAR Archive
log "3/5: Compressing dumps into $LOCAL_ARCHIVE_PATH..."
tar -czf "$LOCAL_ARCHIVE_PATH" -C "$TMP_DIR" .
log "✅ Archive created successfully: $(du -h "$LOCAL_ARCHIVE_PATH" | cut -f1)"

# Step 4: Upload to Backblaze B2 (S3-compatible)
log "4/5: Uploading archive to Backblaze B2..."
if [[ -z "$B2_BUCKET_NAME" || -z "$B2_KEY_ID" || -z "$B2_APPLICATION_KEY" ]]; then
  log "⚠️ Backblaze B2 credentials (B2_BUCKET_NAME, B2_KEY_ID, B2_APPLICATION_KEY) not configured."
  log "⚠️ Backup saved locally only at: $LOCAL_ARCHIVE_PATH"
else
  UPLOAD_SUCCESS=false

  # Try AWS CLI (S3 compatibility)
  if command -v aws >/dev/null 2>&1; then
    log "Using AWS CLI to upload to Backblaze B2 (Bucket: $B2_BUCKET_NAME)..."
    AWS_ENDPOINT_FLAG=""
    if [[ -n "$B2_ENDPOINT_URL" ]]; then
      AWS_ENDPOINT_FLAG="--endpoint-url $B2_ENDPOINT_URL"
    fi

    # shellcheck disable=SC2086
    AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
    aws s3 cp "$LOCAL_ARCHIVE_PATH" "s3://${B2_BUCKET_NAME}/${ARCHIVE_NAME}" $AWS_ENDPOINT_FLAG
    UPLOAD_SUCCESS=true

  # Try Rclone
  elif command -v rclone >/dev/null 2>&1; then
    log "Using Rclone to upload to Backblaze B2..."
    RCLONE_CONFIG_B2_TYPE=s3 \
    RCLONE_CONFIG_B2_PROVIDER=Other \
    RCLONE_CONFIG_B2_ACCESS_KEY_ID="$B2_KEY_ID" \
    RCLONE_CONFIG_B2_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
    RCLONE_CONFIG_B2_ENDPOINT="$B2_ENDPOINT_URL" \
    rclone copyto "$LOCAL_ARCHIVE_PATH" "b2:${B2_BUCKET_NAME}/${ARCHIVE_NAME}"
    UPLOAD_SUCCESS=true

  # Try Backblaze B2 CLI
  elif command -v b2 >/dev/null 2>&1; then
    log "Using Backblaze B2 CLI to upload..."
    b2 file upload "$B2_BUCKET_NAME" "$LOCAL_ARCHIVE_PATH" "$ARCHIVE_NAME"
    UPLOAD_SUCCESS=true
  else
    log "❌ Neither 'aws', 'rclone', nor 'b2' CLI is installed on this host."
    log "Please install aws-cli or rclone to enable offsite disaster recovery uploads:"
    log "  sudo apt-get install -y awscli   # or: sudo apt-get install -y rclone"
    exit 1
  fi

  if [[ "$UPLOAD_SUCCESS" == "true" ]]; then
    log "✅ Successfully uploaded $ARCHIVE_NAME to Backblaze B2!"
  fi
fi

# Step 5: Prune Backups Older than Retention Period (7 Days)
log "5/5: Pruning local backups older than $RETENTION_DAYS days..."
DELETED_COUNT=0

# A. Delete files older than retention days by modification time
while IFS= read -r -d '' old_backup; do
  if [[ -f "$old_backup" ]]; then
    log "Deleting local backup older than $RETENTION_DAYS days: $(basename "$old_backup")"
    rm -f "$old_backup"
    DELETED_COUNT=$((DELETED_COUNT + 1))
  fi
done < <(find "$BACKUP_DIR" -maxdepth 1 -name "ieee_portal_backup_*.tar.gz" -mtime +"$RETENTION_DAYS" -print0 2>/dev/null || true)

# B. Enforce max storage safeguard: Keep at most the newest $RETENTION_DAYS archives locally
LOCAL_BACKUPS=()
while IFS= read -r file; do
  [[ -n "$file" ]] && LOCAL_BACKUPS+=("$file")
done < <(ls -1t "$BACKUP_DIR"/ieee_portal_backup_*.tar.gz 2>/dev/null || true)

if (( ${#LOCAL_BACKUPS[@]} > RETENTION_DAYS )); then
  EXCESS_FILES=("${LOCAL_BACKUPS[@]:$RETENTION_DAYS}")
  for excess in "${EXCESS_FILES[@]}"; do
    if [[ -f "$excess" ]]; then
      log "Deleting excess local backup to maintain $RETENTION_DAYS-day retention: $(basename "$excess")"
      rm -f "$excess"
      DELETED_COUNT=$((DELETED_COUNT + 1))
    fi
  done
fi

log "Pruned $DELETED_COUNT old local backup(s). Total retained local backups: $(ls -1 "$BACKUP_DIR"/ieee_portal_backup_*.tar.gz 2>/dev/null | wc -l)"

# Prune Remote Backblaze B2 Backups older than 7 days if aws-cli is available
if command -v aws >/dev/null 2>&1 && [[ -n "$B2_BUCKET_NAME" && -n "$B2_KEY_ID" && -n "$B2_APPLICATION_KEY" ]]; then
  AWS_ENDPOINT_FLAG=""
  if [[ -n "$B2_ENDPOINT_URL" ]]; then
    AWS_ENDPOINT_FLAG="--endpoint-url $B2_ENDPOINT_URL"
  fi

  CUTOFF_DATE="$(date -d "${RETENTION_DAYS} days ago" +%Y-%m-%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y-%m-%d 2>/dev/null || true)"
  if [[ -n "$CUTOFF_DATE" ]]; then
    log "Pruning Backblaze B2 backups created before $CUTOFF_DATE..."
    # shellcheck disable=SC2086
    AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
    aws s3 ls "s3://${B2_BUCKET_NAME}/" $AWS_ENDPOINT_FLAG | while read -r line; do
      FILE_DATE="$(echo "$line" | awk '{print $1}')"
      FILE_NAME="$(echo "$line" | awk '{print $4}')"
      if [[ "$FILE_NAME" == ieee_portal_backup_*.tar.gz && "$FILE_DATE" < "$CUTOFF_DATE" ]]; then
        log "Deleting expired remote backup: $FILE_NAME"
        # shellcheck disable=SC2086
        AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
        AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
        aws s3 rm "s3://${B2_BUCKET_NAME}/${FILE_NAME}" $AWS_ENDPOINT_FLAG || true
      fi
    done
  fi
fi

log "=================================================================="
log "🎉 IEEE Portal Backup Completed Successfully!"
log "Local File:  $LOCAL_ARCHIVE_PATH"
log "Remote Dest: s3://${B2_BUCKET_NAME}/${ARCHIVE_NAME}"
log "=================================================================="
