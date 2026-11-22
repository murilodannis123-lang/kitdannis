// Dados do projeto KitDannis no Supabase.
// A chave "publishable" pode ficar pública: o banco só libera os dados para quem fizer login.
window.KITDANNIS_CONFIG = {
  SUPABASE_URL: "https://yhxdljexzmmihpevmlfr.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_jLsUpLp-8uN3EfhWRwi62A_bZX1QuYP",
  // Servidor novo no Cloudflare. Só a página de mudança (migrar.html) usa este enquanto o nome for API_URL_NOVO.
  // Depois da mudança, trocar para API_URL e o app inteiro passa a usar o Cloudflare.
  API_URL_NOVO: "https://kitdannis.delicate-poetry-80f7.workers.dev",
};
