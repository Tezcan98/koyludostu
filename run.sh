#!/bin/bash
# Köylü Dostu — geliştirme sunucusunu başlatır.
set -e
cd "$(dirname "$0")"

PORT="${PORT:-3010}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js bulunamadı. Lütfen önce Node.js kurun: https://nodejs.org"
  exit 1
fi

# Aynı portta ÖNCEDEN BİZİM başlattığımız bir serve.js çalışıyorsa kapat.
# Başka bir projeye ait olabileceği için, sadece komut satırı "serve.js" içeren
# süreçleri hedef alır — port sahibi her neyse körü körüne öldürmez.
if command -v lsof >/dev/null 2>&1; then
  OLD_PID=$(lsof -ti tcp:$PORT 2>/dev/null || true)
  if [ -n "$OLD_PID" ]; then
    CMD=$(ps -o command= -p "$OLD_PID" 2>/dev/null || true)
    if echo "$CMD" | grep -q "serve.js"; then
      echo "Port $PORT üzerinde çalışan eski Köylü Dostu süreci kapatılıyor (PID: $OLD_PID)..."
      kill $OLD_PID 2>/dev/null || true
      sleep 1
    else
      echo "UYARI: Port $PORT başka bir sürece ait görünüyor (PID: $OLD_PID, komut: $CMD)."
      echo "Bu süreci otomatik kapatmıyorum. Farklı bir port denemek için: PORT=3011 ./run.sh"
      exit 1
    fi
  fi
fi

echo "Köylü Dostu sunucusu başlatılıyor... (http://localhost:$PORT)"
echo ""
PORT=$PORT node serve.js
