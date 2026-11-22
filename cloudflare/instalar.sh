#!/usr/bin/env bash
# Instala (ou atualiza) o servidor do KitDannis no Cloudflare. Roda no GitHub Actions.
# Precisa de: CLOUDFLARE_API_TOKEN, ANTHROPIC_API_KEY, SETUP_TOKEN (e opcional CLOUDFLARE_ACCOUNT_ID).
# Pode rodar quantas vezes quiser: o que já existe é reaproveitado.
set -euo pipefail
API="${CF_API:-https://api.cloudflare.com/client/v4}"
NOME="kitdannis"; KV_NOME="kitdannis-arquivos"
ORIGENS="https://murilodannis123-lang.github.io"
WR="${WR:-npx --yes wrangler@3}"
erro() { echo "::error::$*"; exit 1; }
cf() { # cf MÉTODO caminho [json]
  local r; r=$(curl -sS -X "$1" "$API$2" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" ${3:+--data "$3"})
  echo "$r"
}
ok() { echo "$1" | jq -e '.success == true' >/dev/null; }
msgs() { echo "$1" | jq -r '[.errors[]?.message] | join("; ")'; }

# 1. Conta
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  r=$(cf GET "/accounts?per_page=5")
  ok "$r" || erro "A chave do Cloudflare não funcionou: $(msgs "$r"). Confira o segredo CLOUDFLARE_API_TOKEN."
  CLOUDFLARE_ACCOUNT_ID=$(echo "$r" | jq -r '.result[0].id // empty')
  [ -n "$CLOUDFLARE_ACCOUNT_ID" ] || erro "Não achei a conta. Crie o segredo CLOUDFLARE_ACCOUNT_ID com o Account ID (aparece no painel do Cloudflare, em Workers)."
fi
export CLOUDFLARE_ACCOUNT_ID
A="/accounts/$CLOUDFLARE_ACCOUNT_ID"
echo "Conta encontrada."

# 2. Banco D1
r=$(cf GET "$A/d1/database?name=$NOME")
ok "$r" || erro "Sem permissão no D1: $(msgs "$r"). A chave precisa de 'D1 - Edit'."
DB_ID=$(echo "$r" | jq -r --arg n "$NOME" '.result[]? | select(.name==$n) | .uuid' | head -1)
if [ -z "$DB_ID" ]; then
  r=$(cf POST "$A/d1/database" "{\"name\":\"$NOME\"}")
  ok "$r" || erro "Não consegui criar o banco: $(msgs "$r")"
  DB_ID=$(echo "$r" | jq -r '.result.uuid'); echo "Banco criado."
else echo "Banco já existia."; fi

# 3. Arquivos (KV)
r=$(cf GET "$A/storage/kv/namespaces?per_page=100")
ok "$r" || erro "Sem permissão no KV: $(msgs "$r"). A chave precisa de 'Workers KV Storage - Edit'."
KV_ID=$(echo "$r" | jq -r --arg n "$KV_NOME" '.result[]? | select(.title==$n) | .id' | head -1)
if [ -z "$KV_ID" ]; then
  r=$(cf POST "$A/storage/kv/namespaces" "{\"title\":\"$KV_NOME\"}")
  ok "$r" || erro "Não consegui criar o espaço de arquivos: $(msgs "$r")"
  KV_ID=$(echo "$r" | jq -r '.result.id'); echo "Espaço de arquivos criado."
else echo "Espaço de arquivos já existia."; fi

# 4. Endereço workers.dev (conta nova ainda não tem)
r=$(cf GET "$A/workers/subdomain")
SUB=$(echo "$r" | jq -r '.result.subdomain // empty')
if [ -z "$SUB" ]; then
  for tentativa in murilodannis kitdannis kitdannis-murilo "kitdannis-$(openssl rand -hex 3)"; do
    r=$(cf PUT "$A/workers/subdomain" "{\"subdomain\":\"$tentativa\"}")
    if ok "$r"; then SUB="$tentativa"; break; fi
    echo "Endereço $tentativa indisponível: $(msgs "$r")"
  done
  [ -n "$SUB" ] || erro "Não consegui reservar um endereço workers.dev."
  echo "Endereço reservado."
fi
URL="https://$NOME.$SUB.workers.dev"

# 5. Configuração + tabelas + publicação
cat > wrangler.toml <<EOF
name = "$NOME"
main = "worker.js"
compatibility_date = "2024-11-01"
workers_dev = true

[vars]
ORIGENS = "$ORIGENS"

[[d1_databases]]
binding = "DB"
database_name = "$NOME"
database_id = "$DB_ID"

[[kv_namespaces]]
binding = "ARQUIVOS"
id = "$KV_ID"
EOF
$WR d1 execute "$NOME" --remote --file=schema.sql --yes
$WR deploy

# 6. Segredos (nunca aparecem no log)
umask 077
EXISTENTES=$($WR secret list --format json 2>/dev/null | jq -r '.[].name' || true)
ASS='null'
if ! grep -qx ASSINATURA <<<"$EXISTENTES"; then ASS="\"$(openssl rand -hex 32)\""; fi
jq -n --arg a "$ANTHROPIC_API_KEY" --arg s "$SETUP_TOKEN" --argjson ass "$ASS" \
  '{ANTHROPIC_API_KEY: $a, SETUP_TOKEN: $s} + (if $ass then {ASSINATURA: $ass} else {} end)' > /tmp/segredos.json
$WR secret bulk /tmp/segredos.json
rm -f /tmp/segredos.json

# 7. Teste (endereço novo pode levar alguns minutos para responder)
for i in $(seq 1 30); do
  if curl -sS -m 10 "$URL/api/saude" | jq -e '.ok == true' >/dev/null 2>&1; then
    echo "Servidor no ar: $URL"
    { echo "## Servidor do KitDannis no ar"; echo; echo "Endereço: $URL"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    exit 0
  fi
  sleep 10
done
{ echo "## Servidor publicado"; echo; echo "Endereço: $URL"; echo; echo "Ainda não respondeu (endereço novo pode demorar alguns minutos)."; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "::warning::Publicado em $URL, mas ainda não respondeu. Endereço novo pode demorar alguns minutos."
