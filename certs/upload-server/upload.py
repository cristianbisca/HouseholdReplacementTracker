#!/usr/bin/env python3
"""Simple HTTP server for uploading cert files to Docker volume.

Usage: Deploy via Portainer, mount hrt-certs volume at /certs.
Then from your PC browser, go to http://<pi-ip>:8080 and upload files.

IMPORTANT: Delete this container after uploading — it has no authentication!
"""

import os
from http.server import HTTPServer, BaseHTTPRequestHandler

CERT_DIR = "/certs"

HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cert Uploader</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #1a1a2e; color: #eee; display: flex; justify-content: center;
         align-items: center; min-height: 100vh; padding: 20px; }
  .card { background: #16213e; border-radius: 12px; padding: 40px; max-width: 500px;
          width: 100%; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
  h1 { font-size: 1.4rem; margin-bottom: 8px; text-align: center; }
  p.sub { color: #aaa; font-size: 0.85rem; text-align: center; margin-bottom: 24px; }
  .warn { background: #ff6b6b22; border-left: 3px solid #ff6b6b; padding: 10px 14px;
          border-radius: 4px; font-size: 0.8rem; margin-bottom: 24px; color: #ff9a9a; }
  label { display: block; font-size: 0.85rem; color: #aaa; margin-bottom: 6px; }
  input[type="file"] { width: 100%; padding: 10px; background: #0f3460; border: 1px solid #333;
                        border-radius: 6px; color: #eee; margin-bottom: 18px; cursor: pointer; }
  button { width: 100%; padding: 12px; background: #e94560; color: white; border: none;
           border-radius: 6px; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
  button:hover { background: #c81e45; }
  .status { margin-top: 16px; padding: 12px; border-radius: 6px; font-size: 0.85rem;
            text-align: center; display: none; }
  .ok { background: #2ecc7133; color: #2ecc71; display: block; }
  .err { background: #e74c3c33; color: #e74c3c; display: block; }
</style>
</head>
<body>
<div class="card">
  <h1>&#x1f512; SSL Cert Uploader</h1>
  <p class="sub">Upload cert files to the Docker volume</p>
  <div class="warn">&#9888; Delete this container after uploading!</div>

  <label for="cert">cert.pem (Certificate + CA Bundle)</label>
  <input type="file" id="cert" accept=".pem,.crt,.pem">

  <label for="key">key.pem (Private Key)</label>
  <input type="file" id="key" accept=".pem,.key">

  <button onclick="upload()">Upload Certificates</button>
  <div class="status" id="status"></div>
</div>

<script>
async function upload() {
  const status = document.getElementById('status');
  const certFile = document.getElementById('cert').files[0];
  const keyFile = document.getElementById('key').files[0];

  if (!certFile || !keyFile) {
    showStatus('Please select both files.', 'err');
    return;
  }

  status.className = 'status';
  status.textContent = 'Uploading...';
  status.style.display = 'block';

  try {
    const [certOk, keyOk] = await Promise.all([
      putFile(certFile, 'cert.pem'),
      putFile(keyFile, 'key.pem')
    ]);

    if (certOk && keyOk) {
      showStatus('&#10004; Certificates uploaded! Now restart your app container in Portainer.', 'ok');
    } else {
      showStatus('Some files failed. Check console for details.', 'err');
    }
  } catch (e) {
    showStatus('Error: ' + e.message, 'err');
  }
}

async function putFile(file, name) {
  const resp = await fetch('/upload/' + name, { method: 'PUT', body: file });
  return resp.ok;
}

function showStatus(msg, cls) {
  const el = document.getElementById('status');
  el.innerHTML = msg;
  el.className = 'status ' + cls;
}
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(HTML.encode())
        else:
            self.send_error(404)

    def do_PUT(self):
        filename = os.path.basename(self.path.replace("/upload/", ""))
        if not filename or ".." in filename:
            self.send_error(400, "Invalid filename")
            return

        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        filepath = os.path.join(CERT_DIR, filename)

        try:
            os.makedirs(CERT_DIR, exist_ok=True)
            with open(filepath, "wb") as f:
                f.write(data)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(f"Uploaded {filename} ({len(data)} bytes)".encode())
        except Exception as e:
            self.send_error(500, str(e))

    def log_message(self, format, *args):
        print(f"[upload] {args[0]}")


if __name__ == "__main__":
    os.makedirs(CERT_DIR, exist_ok=True)
    server = HTTPServer(("0.0.0.0", 8080), Handler)
    print(f"Cert uploader running on port 8080")
    print("Open http://<your-ip>:8080 in your browser to upload files.")
    server.serve_forever()