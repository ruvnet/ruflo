#!/bin/bash
# Memory Management - Backup Script
# Export memory to backup file

set -e

BACKUP_DIR="${BACKUP_DIR:-./.backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/memory_${TIMESTAMP}.json"

mkdir -p "$BACKUP_DIR"

echo "Backing up memory to $BACKUP_FILE..."
npx @claude-flow/cli memory export --output "$BACKUP_FILE"

echo "Backup complete: $BACKUP_FILE"
