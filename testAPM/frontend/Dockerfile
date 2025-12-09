# Use Nginx to serve static files
FROM nginx:alpine

# Remove default config (optional; we’ll keep default here)
# COPY nginx.conf /etc/nginx/nginx.conf

# Copy static site to Nginx default html directory
COPY . /usr/share/nginx/html

EXPOSE 80

