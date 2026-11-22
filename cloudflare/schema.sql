-- KitDannis no Cloudflare D1 (SQLite). Rode uma vez no console do D1.
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  senha_salt TEXT NOT NULL,
  cod_hash TEXT NOT NULL,
  cod_salt TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expira INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS falhas (
  chave TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS falhas_chave ON falhas (chave, ts);
CREATE TABLE IF NOT EXISTS gastos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  valor REAL NOT NULL CHECK (valor > 0),
  categoria TEXT NOT NULL DEFAULT 'outros',
  fornecedor TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  pagamento TEXT NOT NULL DEFAULT '',
  pedreiro INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL,
  editado_em TEXT
);
CREATE INDEX IF NOT EXISTS gastos_user_data ON gastos (user_id, data DESC);
CREATE TABLE IF NOT EXISTS notas (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  arquivo TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT '',
  nome_arquivo TEXT NOT NULL DEFAULT '',
  fornecedor TEXT NOT NULL DEFAULT '',
  valor REAL,
  data TEXT,
  numero TEXT NOT NULL DEFAULT '',
  gasto_id TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notas_user_data ON notas (user_id, data DESC);
CREATE TABLE IF NOT EXISTS config (
  user_id TEXT NOT NULL,
  chave TEXT NOT NULL,
  valor TEXT NOT NULL,
  PRIMARY KEY (user_id, chave)
);
