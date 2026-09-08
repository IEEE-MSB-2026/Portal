#!/bin/bash

# 1. Check for Root Privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "\033[31mError: Please run as root (use sudo).\033[0m"
    exit 1
fi

# 2. Check Arguments
# We need at least 3 arguments: Port, Site Name, and at least one Domain.
if [ "$#" -lt 3 ]; then
    echo "Usage: sudo ./add-site.sh <PORT> <SITE_NAME> <DOMAIN_1> [DOMAIN_2] ..."
    echo "Example: sudo ./add-site.sh 3000 myapp myapp.test www.myapp.test"
    exit 1
fi

# 3. Assign Variables
APP_PORT=$1
SITE_NAME=$2
# Capture all arguments starting from the 3rd one as the domain list
shift 2
SERVER_NAMES="$@"

CONFIG_FILE="/etc/nginx/sites-available/$SITE_NAME"
LINK_FILE="/etc/nginx/sites-enabled/$SITE_NAME"

# 4. Check if site already exists to prevent accidental overwrites
if [ -f "$CONFIG_FILE" ]; then
    echo -e "\033[33mWarning: Configuration for $SITE_NAME already exists.\033[0m"
    read -p "Do you want to overwrite it? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborting."
        exit 1
    fi
fi

# 5. Create the Nginx Config File
echo "Creating Nginx configuration for $SITE_NAME on port $APP_PORT..."

cat > "$CONFIG_FILE" <<EOF
server {
    listen 80;
    listen [::]:80;

    server_name $SERVER_NAMES;

    # Allow up to 50MB file uploads for file-service
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;

        # Proxy Headers
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # Timeouts for large uploads and batch jobs
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF

# 6. Enable the Site (Create Symlink)
if [ ! -L "$LINK_FILE" ]; then
    echo "Linking configuration..."
    ln -s "$CONFIG_FILE" "$LINK_FILE"
else
    echo "Link already exists, skipping..."
fi

# 7. Test Nginx Configuration
echo "Testing Nginx configuration..."
nginx -t

if [ $? -eq 0 ]; then
    # 8. Reload Nginx if test passed
    echo "Reloading Nginx..."
    systemctl reload nginx
    echo -e "\033[32mSuccess! $SITE_NAME is now live routing to port $APP_PORT.\033[0m"
    echo "Domains configured: $SERVER_NAMES"
else
    echo -e "\033[31mError: Nginx configuration test failed. Reverting changes...\033[0m"
    # Optional: cleanup if test fails
    rm "$LINK_FILE"
    echo "Please check the error logs above."
    exit 1
fi
