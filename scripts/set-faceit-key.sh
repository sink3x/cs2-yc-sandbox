#!/usr/bin/env bash
# Берёт Faceit API-ключ из буфера обмена (macOS) и сохраняет его в админ-панели.
# Запуск:  bash scripts/set-faceit-key.sh
# Спросит логин и пароль админа (пароль не показывается и нигде не сохраняется).
set -euo pipefail

PANEL="${PANEL_URL:-https://panel.example.com}"

command -v pbpaste >/dev/null || { echo "Нужен macOS (pbpaste). На Linux: xclip -o -selection clipboard" >&2; exit 1; }
KEY="$(pbpaste | tr -d '[:space:]')"
if [[ ! "$KEY" =~ ^[A-Za-z0-9-]{16,80}$ ]]; then
  echo "В буфере обмена не похоже на Faceit API-ключ (ожидаю 16–80 символов: буквы, цифры, дефис)." >&2
  echo "Скопируйте ключ ещё раз и запустите скрипт заново." >&2
  exit 1
fi
echo "Ключ из буфера: ${KEY:0:4}…${KEY: -4} (${#KEY} символов)"

read -r -p "Логин админа [alice]: " USER_NAME
USER_NAME="${USER_NAME:-alice}"
read -r -s -p "Пароль: " PASS; echo

JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
H=(-H "Content-Type: application/json" -H "X-Requested-With: cs2panel")

login_body="$(USER_NAME="$USER_NAME" PASS="$PASS" python3 -c 'import json,os;print(json.dumps({"username":os.environ["USER_NAME"],"password":os.environ["PASS"]}))')"
code="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" "${H[@]}" -d "$login_body" "$PANEL/api/login")"
[[ "$code" == "200" ]] || { echo "Вход не удался (HTTP $code). Проверьте логин и пароль." >&2; exit 1; }

key_body="$(KEY="$KEY" python3 -c 'import json,os;print(json.dumps({"key":os.environ["KEY"]}))')"
resp="$(curl -s -w '\n%{http_code}' -b "$JAR" -X PUT "${H[@]}" -d "$key_body" "$PANEL/api/faceit-key")"
code="${resp##*$'\n'}"
if [[ "$code" == "200" ]]; then
  echo "Готово: ключ сохранён на сервере панели. Откройте Профиль → Faceit и укажите свой ник."
else
  echo "Не удалось сохранить (HTTP $code): ${resp%$'\n'*}" >&2; exit 1
fi
curl -s -b "$JAR" -X POST "${H[@]}" "$PANEL/api/logout" >/dev/null || true
