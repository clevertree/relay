#!/bin/bash
# Test script for CORS and preflight in nginx-relay.conf
# Creates a minimal Flask backend and nginx container, runs tests, cleans up.

set -e

# Create temp dir
TEST_DIR=$(mktemp -d)
echo "Using temp dir: $TEST_DIR"

# Create Flask backend (minimal relay-like OPTIONS response)
cat > "$TEST_DIR/backend.py" << 'EOF'
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins="*")

@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
def handle_all(path):
    if request.method == 'OPTIONS':
        return jsonify({
            "capabilities": ["GET", "POST", "PUT", "DELETE"],
            "version": "1.0"
        })
    return jsonify({"path": path, "method": request.method})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8088)
EOF

# Create requirements.txt
echo "Flask==2.3.3" > "$TEST_DIR/requirements.txt"
echo "flask-cors==4.0.0" >> "$TEST_DIR/requirements.txt"

# Create Dockerfile for backend
cat > "$TEST_DIR/Dockerfile.backend" << 'EOF'
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY backend.py .
EXPOSE 8088
CMD ["python", "backend.py"]
EOF

# Create test nginx config (simplified from relay)
cat > "$TEST_DIR/nginx.conf" << 'EOF'
events { worker_connections 1024; }

http {
    # Upstream backend
    upstream relay_upstream {
        server backend:8088;
    }

    # Map for GET/HEAD
    map $request_method $is_get_or_head {
        default 0;
        GET 1;
        HEAD 1;
    }

    # CORS maps
    map $request_method $is_options {
        default 0;
        OPTIONS 1;
    }

    map $http_access_control_request_method $has_acrm_header {
        default 0;
        "" 0;
        ~.+ 1;
    }

    map "$is_options$has_acrm_header" $is_cors_preflight {
        default 0;
        "11" 1;
    }

    server {
        listen 80;
        server_name localhost;

        # CORS headers
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Expose-Headers "Content-Length, Content-Range, ETag" always;

        root /usr/share/nginx/html;
        index index.html;

        location / {
            if ($is_cors_preflight) {
                    add_header Access-Control-Allow-Origin "*" always;
                    add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS";
                    add_header Access-Control-Allow-Headers $http_access_control_request_headers;
                    add_header Access-Control-Max-Age 86400;
                    return 204;
                }

            proxy_pass http://relay_upstream;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_http_version 1.1;
            proxy_buffering off;

            proxy_intercept_errors on;
            error_page 404 = @fallback;
        }

        location @fallback {
            if ($is_get_or_head = 0) {
                return 404;
            }
            try_files $uri /index.html =404;
        }

        location ~* \.(js|css)$ {
            if ($is_cors_preflight) {
                    add_header Access-Control-Allow-Origin "*" always;
                    add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS";
                    add_header Access-Control-Allow-Headers $http_access_control_request_headers;
                    add_header Access-Control-Max-Age 86400;
                    return 204;
                }

            try_files $uri =404;
            expires 1h;
            add_header Cache-Control "public, immutable";
            add_header Access-Control-Allow-Origin "*" always;
            add_header Access-Control-Expose-Headers "Content-Length, Content-Range, ETag" always;
        }
    }
}
EOF

# Create index.html for static
echo "<html><body>Test static page</body></html>" > "$TEST_DIR/index.html"

# Build and run containers
cd "$TEST_DIR"
docker build -f Dockerfile.backend -t test-backend .
docker network create test-net || true
# Ensure old containers are removed
docker rm -f backend nginx-test 2>/dev/null || true
docker run -d --name backend --network test-net test-backend

# Pick a free host port for nginx to avoid conflicts
HOST_PORT=$(python3 - <<'PY'
import socket
s=socket.socket()
s.bind(('127.0.0.1',0))
print(s.getsockname()[1])
s.close()
PY
)
echo "Starting nginx test on host port: ${HOST_PORT}"
docker run -d --name nginx-test --network test-net -p "${HOST_PORT}:80" -v "$TEST_DIR/nginx.conf:/etc/nginx/nginx.conf" -v "$TEST_DIR/index.html:/usr/share/nginx/html/index.html" nginx:alpine

# Wait for containers
sleep 5

# Run tests
echo "=== Test 1: Preflight OPTIONS ==="
curl -i -X OPTIONS -H "Origin: https://example.com" -H "Access-Control-Request-Method: GET" http://localhost:${HOST_PORT}/

echo -e "\n=== Test 2: Non-preflight OPTIONS (capabilities) ==="
curl -i -X OPTIONS http://localhost:${HOST_PORT}/

echo -e "\n=== Test 3: Static asset CORS ==="
curl -i http://localhost:${HOST_PORT}/index.html

# Cleanup
docker stop backend nginx-test
docker rm backend nginx-test
docker network rm test-net
rm -rf "$TEST_DIR"

echo "Test complete."