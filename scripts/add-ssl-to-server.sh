#!/bin/bash

# -----------------------------------------------------------------------------
# Auto-SSL Script for Nginx using Certbot
# -----------------------------------------------------------------------------

# 1. Check for Root
if [ "$EUID" -ne 0 ]; then
    echo -e "\033[31mError: Please run as root (use sudo).\033[0m"
    exit 1
fi

# 2. Check for Certbot
if ! command -v certbot &> /dev/null; then
    echo "Certbot is not installed. Installing now..."
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
fi

# 3. Prompt for Email (Required by Let's Encrypt)
echo -e "\033[33mNote: This script works for PUBLIC domains pointing to this server.\033[0m"
echo "Enter the email address for certificate renewal notifications:"
read -p "> " USER_EMAIL

if [[ -z "$USER_EMAIL" ]]; then
    echo "Error: Email is required."
    exit 1
fi

echo -e "\n\033[34mScanning /etc/nginx/sites-enabled/ for websites...\033[0m"

# 4. Loop through enabled sites
# We skip the 'default' file as it often lacks a real server_name
for config_file in /etc/nginx/sites-enabled/*; do

    # Skip if it's the default file or not a file
    if [[ "$(basename "$config_file")" == "default" ]] || [[ ! -f "$config_file" ]]; then
        continue
    fi

    # Extract server_names (domains)
    # 1. Grep the server_name line
    # 2. Remove 'server_name' and the semicolon
    # 3. Truncate whitespace
    DOMAINS=$(grep -h "server_name" "$config_file" | sed 's/server_name//; s/;//; s/^[ \t]*//; s/[ \t]*$//')

    # If no domains found, skip
    if [[ -z "$DOMAINS" ]]; then
        echo "No domains found in $(basename "$config_file"), skipping."
        continue
    fi

    # Check if domains look like local test domains (.test, .local, localhost)
    if [[ "$DOMAINS" == *".test"* ]] || [[ "$DOMAINS" == *".local"* ]] || [[ "$DOMAINS" == *"localhost"* ]]; then
        echo -e "\033[33mSkipping $(basename "$config_file") ($DOMAINS) - Let's Encrypt usually fails on local/test TLDs.\033[0m"
        continue
    fi

    echo "------------------------------------------------------------"
    echo "Found site: $(basename "$config_file")"
    echo "Domains: $DOMAINS"
    echo "Requesting SSL Certificate..."

    # 5. Run Certbot
    # --nginx: Use the Nginx plugin
    # --non-interactive: Don't ask questions during run
    # --agree-tos: Agree to terms
    # --redirect: Update Nginx config to force HTTPS automatically
    # --expand: If cert exists, update it with new domains

    certbot --nginx \
    --non-interactive \
    --agree-tos \
    -m "$USER_EMAIL" \
    --redirect \
    --expand \
    $(printf -- "-d %s " $DOMAINS)

    if [ $? -eq 0 ]; then
        echo -e "\033[32mSuccess! SSL installed for $DOMAINS\033[0m"
    else
        echo -e "\033[31mFailed to obtain cert for $DOMAINS. Check DNS settings.\033[0m"
    fi

done

echo -e "\n\033[32mProcess Complete. Nginx configuration reloaded.\033[0m"
systemctl reload nginx
