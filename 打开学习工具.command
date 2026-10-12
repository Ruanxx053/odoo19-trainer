#!/bin/bash
# Odoo 19 认证训练器 —— 双击本文件即可打开
cd "$(dirname "$0")" || exit 1
PORT=8765
if command -v python3 >/dev/null 2>&1; then
  # 起一个本地小服务：这样 Safari 也能保存进度，且不依赖 file:// 的存储限制
  while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
  echo "==============================================="
  echo " Odoo 19 认证训练器"
  echo " 地址： http://127.0.0.1:$PORT/index.html"
  echo " 关闭这个窗口就会停止服务（进度已存在浏览器里，不会丢）"
  echo "==============================================="
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  SRV=$!
  sleep 1
  LAN=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
  if [ -n "$LAN" ]; then
    echo " 手机（同一 Wi-Fi）： http://$LAN:$PORT/index.html"
    echo "   ※ 局域网 http 不是安全上下文，Service Worker 不生效 —— 想在地铁离线用，请见 README 的「手机上用」"
  fi
  open "http://127.0.0.1:$PORT/index.html"
  trap 'kill $SRV 2>/dev/null' EXIT
  wait $SRV
else
  open index.html
fi
